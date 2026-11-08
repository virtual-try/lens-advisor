// @vitest-environment node
import { createHmac, randomBytes } from "node:crypto";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { PgBoss } from "pg-boss";
import type { ActionFunctionArgs } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Valid HMAC skips Prisma session storage (the app database has no session
// table in this suite). Forged HMAC still goes through the real
// authenticate.webhook, which rejects before any session read.
vi.mock("../../shopify.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shopify.server")>();
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const { getShopifyConfig } = await import("../../shared/config.server");

  const webhook = async (request: Request) => {
    const raw = await request.clone().text();
    const provided = request.headers.get("X-Shopify-Hmac-Sha256") ?? "";
    const expected = createHmac("sha256", getShopifyConfig().apiSecretKey)
      .update(raw, "utf8")
      .digest("base64");
    const providedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    const valid =
      providedBytes.length === expectedBytes.length &&
      timingSafeEqual(providedBytes, expectedBytes);
    if (!valid) return actual.authenticate.webhook(request);

    const topic = request.headers.get("X-Shopify-Topic") ?? "";
    const shop = request.headers.get("X-Shopify-Shop-Domain") ?? "";
    const id = request.headers.get("X-Shopify-Webhook-Id") ?? "";
    const apiVersion = request.headers.get("X-Shopify-API-Version") ?? "";
    // A valid signature with a missing webhook header is Shopify's non-HMAC
    // auth failure (empty 400). Delegate so the route maps that Response.
    if (!topic || !shop || !id || !apiVersion) {
      return actual.authenticate.webhook(request);
    }

    let payload: unknown;
    try {
      payload = raw === "" ? {} : JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) throw error;
      throw new SyntaxError("Invalid webhook payload");
    }
    return {
      topic: request.headers.get("X-Shopify-Topic") ?? "",
      shop: request.headers.get("X-Shopify-Shop-Domain") ?? "",
      webhookId: request.headers.get("X-Shopify-Webhook-Id") ?? "",
      payload,
    };
  };

  return {
    ...actual,
    authenticate: new Proxy(actual.authenticate, {
      get(target, prop, receiver) {
        if (prop === "webhook") return webhook;
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return (value as (...args: unknown[]) => unknown).bind(target);
        }
        return value;
      },
    }),
  };
});

import { action as complianceAction } from "../../routes/webhooks.compliance";
import { action as uninstalledAction } from "../../routes/webhooks.app.uninstalled";
import { getShopifyConfig } from "../../shared/config.server";
import { createPgBoss } from "../../shared/container/queue.server";
import { createFieldCipher, type FieldCipher } from "../../shared/crypto/field-cipher.server";
import type { SendMailOptions } from "../../shared/mail/mailer.server";
import type { JobContext } from "../../shared/queue/define-job";
import { createQueue, type Queue } from "../../shared/queue/queue";
import { requireTestDatabaseUrl, uniqueSchema } from "../../shared/queue/test-support";
import {
  buildRxKey,
  buildRxPrefix,
  buildShopPrefix,
  createObjectStore,
  type ObjectStore,
} from "../../shared/storage/object-store.server";
import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { runShopRedact } from "./redact.server";
import { setComplianceDepsForTests, type ComplianceDeps, type ComplianceLogFields } from "./deps.server";
import {
  customersDataRequestJob,
  customersRedactJob,
  shopRedactJob,
} from "./jobs.server";
import { shopOwnedModelDeleteOrder } from "./models.server";
import { MAX_ORDER_IDS, readShopContactEmail } from "./schema";

const DB_MS = 120_000;
const NEEDLE = "SPH -2.25 patient";
const CONTACT = "owner@shop-a.test";
const CUSTOMER_EMAIL = "customer@example.test";

const sent: SendMailOptions[] = [];
const logs: string[] = [];

const cipher: FieldCipher = createFieldCipher({
  keys: { k1: Buffer.alloc(32, 9).toString("base64") },
  activeKeyId: "k1",
});

const mailer = {
  async send(options: SendMailOptions) {
    sent.push(options);
    return { providerId: "fake-provider" };
  },
};

const logger = {
  info(event: string, fields: ComplianceLogFields) {
    logs.push(JSON.stringify({ event, fields }));
  },
};

let db: TestDb | undefined;
let queue: Queue | undefined;
let boss: PgBoss | undefined;
let objectStore: ObjectStore | undefined;
let storedKeys: Set<string> | undefined;
let listedPrefixes: string[] | undefined;

function database(): PrismaClient {
  if (!db) throw new Error("Test database is not ready");
  return db.prisma;
}

function testQueue(): Queue {
  if (!queue) throw new Error("Test queue is not ready");
  return queue;
}

function sign(raw: string): string {
  return createHmac("sha256", getShopifyConfig().apiSecretKey).update(raw, "utf8").digest("base64");
}

function webhookId(): string {
  return `wh_${randomBytes(8).toString("hex")}`;
}

function shopDomain(label: string): string {
  return `${label}-${randomBytes(4).toString("hex")}.myshopify.com`;
}

function jobContext(): JobContext {
  return {
    jobId: "test-job",
    retryCount: 0,
    signal: new AbortController().signal,
  };
}

function memoryStore(keys: string[]): {
  store: ObjectStore;
  keys: Set<string>;
  prefixes: string[];
} {
  const stored = new Set(keys);
  const prefixes: string[] = [];
  const client = new S3Client({
    region: "us-east-1",
    credentials: {
      accessKeyId: "TEST_ACCESS_KEY_ID",
      secretAccessKey: "TEST_SECRET_ACCESS_KEY",
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  client.send = (async (command: unknown) => {
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? "";
      prefixes.push(prefix);
      const contents = [...stored]
        .filter((key) => key.startsWith(prefix))
        .map((Key) => ({ Key }));
      return { Contents: contents, IsTruncated: false };
    }
    if (command instanceof DeleteObjectsCommand) {
      for (const object of command.input.Delete?.Objects ?? []) {
        if (object.Key) stored.delete(object.Key);
      }
      return {};
    }
    throw new Error("Unexpected S3 command");
  }) as typeof client.send;

  return {
    store: createObjectStore({
      client,
      bucket: "test-bucket",
      kmsKeyId: "test-kms",
    }),
    keys: stored,
    prefixes,
  };
}

function loadMemoryStore(keys: string[]): void {
  const memory = memoryStore(keys);
  objectStore = memory.store;
  storedKeys = memory.keys;
  listedPrefixes = memory.prefixes;
  applyDeps();
}

function applyDeps(): void {
  if (!objectStore) loadMemoryStore([]);
  const deps: Partial<ComplianceDeps> = {
    prisma: database(),
    queue: testQueue(),
    objectStore,
    mailer,
    cipher,
    logger,
    shopContactEmail: async () => CONTACT,
  };
  setComplianceDepsForTests(deps);
}

async function post(
  route: "compliance" | "uninstalled",
  topic: string,
  body: unknown,
  mode: "valid" | "forged",
  domain: string,
  id: string,
  options?: { omitHeaders?: readonly string[] },
): Promise<Response> {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Shopify-Hmac-Sha256": mode === "valid" ? sign(raw) : "forged-not-a-signature",
    "X-Shopify-Topic": topic,
    "X-Shopify-Shop-Domain": domain,
    "X-Shopify-API-Version": "2026-10",
    "X-Shopify-Webhook-Id": id,
  };
  for (const name of options?.omitHeaders ?? []) delete headers[name];
  const request = new Request(
    `https://app.example.test${route === "compliance" ? "/webhooks/compliance" : "/webhooks/app/uninstalled"}`,
    {
      method: "POST",
      headers,
      body: raw,
    },
  );
  const action = route === "compliance" ? complianceAction : uninstalledAction;
  try {
    return await action({ request } as ActionFunctionArgs);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];

/** Shop-owned models from the DMMF, independent of the redaction helper. */
function dmmfShopModelNames(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((model) => {
      if (model.name === "Session") return false;
      if (model.name === "Shop") return true;
      return model.fields.some((field) => field.name === "shopId" && field.kind === "scalar");
    })
    .map((model) => model.name);
}

async function countModel(prisma: PrismaClient, modelName: string, shopId: string): Promise<number> {
  const key = modelName.slice(0, 1).toLowerCase() + modelName.slice(1);
  const delegate = (
    prisma as unknown as Record<
      string,
      { count(args: { where: Record<string, string> }): Promise<number> }
    >
  )[key];
  if (!delegate) throw new Error(`Missing delegate for ${modelName}`);
  if (modelName === "Shop") return delegate.count({ where: { id: shopId } });
  return delegate.count({ where: { shopId } });
}

async function snapshot(prisma: PrismaClient, shopId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of dmmfShopModelNames()) {
    counts[name] = await countModel(prisma, name, shopId);
  }
  return counts;
}

function mustPrecede(order: readonly string[], models: readonly DmmfModel[]): void {
  const index = new Map(order.map((name, position) => [name, position]));
  for (const model of models) {
    if (!index.has(model.name)) continue;
    for (const field of model.fields) {
      if (field.kind !== "object") continue;
      if (!field.relationFromFields || field.relationFromFields.length === 0) continue;
      if (!index.has(field.type)) continue;
      const from = index.get(model.name);
      const to = index.get(field.type);
      if (from === undefined || to === undefined) continue;
      expect(from).toBeLessThan(to);
    }
  }
}

beforeAll(async () => {
  db = await createTestDb();
  const schema = uniqueSchema();
  boss = createPgBoss({
    connectionString: requireTestDatabaseUrl(),
    schema,
    onError: () => undefined,
  });
  try {
    queue = await createQueue(boss, { schema, pollingIntervalSeconds: 0.5 });
  } catch (error) {
    await boss.stop({ graceful: false, timeout: 5_000 }).catch(() => undefined);
    throw error;
  }
}, DB_MS);

afterAll(async () => {
  setComplianceDepsForTests(undefined);
  if (queue) await queue.destroy({ dropSchema: true });
  else if (boss) await boss.stop({ graceful: false, timeout: 5_000 }).catch(() => undefined);
  await db?.drop();
}, DB_MS);

beforeEach(() => {
  sent.length = 0;
  logs.length = 0;
  loadMemoryStore([]);
});

describe("shop contact and delete order", () => {
  it("reads contactEmail, then email, and ignores a non-mailbox", () => {
    expect(
      readShopContactEmail({
        data: { shop: { contactEmail: "owner@shop.example", email: "other@shop.example" } },
      }),
    ).toBe("owner@shop.example");
    expect(
      readShopContactEmail({
        data: { shop: { contactEmail: "not-an-email", email: "other@shop.example" } },
      }),
    ).toBe("other@shop.example");
    expect(readShopContactEmail({ data: { shop: { email: "nope" } } })).toBeNull();
    expect(readShopContactEmail({ errors: [{ message: "owner@shop.example" }] })).toBeNull();
  });

  it("orders shop-owned models from the DMMF so a referencing row is deleted first", () => {
    const names = dmmfShopModelNames();
    const order = shopOwnedModelDeleteOrder();
    expect(new Set(order)).toEqual(new Set(names));
    expect(order).toContain("Shop");
    expect(order).not.toContain("Session");
    mustPrecede(order, Prisma.dmmf.datamodel.models);
    expect(order.indexOf("LabOrder")).toBeLessThan(order.indexOf("Prescription"));
    expect(order.indexOf("LabOrder")).toBeLessThan(order.indexOf("Lens"));
    expect(order.indexOf("Lens")).toBeLessThan(order.indexOf("LensGroup"));
    expect(order.indexOf("OptionValue")).toBeLessThan(order.indexOf("OptionGroup"));
    expect(order.indexOf("Shop")).toBe(order.length - 1);
  });
});

describe("Examples", () => {
  it("customers/redact for orders [1001] deletes that order's prescriptions and S3 objects", async () => {
    const prisma = database();
    const shopA = await seedShop(prisma, shopDomain("redact-a"));
    const shopB = await seedShop(prisma, shopDomain("redact-b"));
    const rxA = await prisma.prescription.findFirstOrThrow({ where: { shopId: shopA.shopId } });
    const rxB = await prisma.prescription.findFirstOrThrow({ where: { shopId: shopB.shopId } });
    await prisma.prescription.update({
      where: { id: rxA.id },
      data: { orderId: "1001" },
    });
    const lens = await prisma.lens.findFirstOrThrow({ where: { shopId: shopA.shopId } });
    const rxKeep = await prisma.prescription.create({
      data: {
        shopId: shopA.shopId,
        rxType: "SINGLE_VISION",
        source: "MANUAL",
        cipher: "v1.fake-ciphertext-token",
        orderId: "1002",
      },
    });
    await prisma.labOrder.create({
      data: {
        shopId: shopA.shopId,
        shopifyOrderId: "1002",
        orderName: "#1002",
        bundleId: "bundle-1002",
        prescriptionId: rxKeep.id,
        lensId: lens.id,
        frameTitle: "Other frame",
      },
    });
    const beforeB = await snapshot(prisma, shopB.shopId);
    const labB = await prisma.labOrder.findFirstOrThrow({ where: { shopId: shopB.shopId } });

    loadMemoryStore([
      buildRxKey(shopA.shopId, rxA.id, "file", "pdf"),
      buildRxKey(shopA.shopId, rxKeep.id, "file", "pdf"),
      buildRxKey(shopB.shopId, rxB.id, "file", "pdf"),
    ]);

    const response = await post(
      "compliance",
      "customers/redact",
      {
        shop_id: 954889,
        shop_domain: "ignored.example.test",
        customer: { id: 191167, email: CUSTOMER_EMAIL },
        orders_to_redact: [1001],
      },
      "valid",
      shopA.domain,
      webhookId(),
    );
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(listedPrefixes).toEqual([]);
    expect(storedKeys?.size).toBe(3);

    const jobs = await testQueue().findJobs(customersRedactJob.name, { data: { shopId: shopA.shopId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({
      complianceRequestId: expect.any(String),
      shopId: shopA.shopId,
      orderIds: ["1001"],
      customerId: "191167",
    });
    expect(JSON.stringify(jobs[0]?.data)).not.toContain(NEEDLE);
    expect(JSON.stringify(jobs[0]?.data)).not.toContain(CUSTOMER_EMAIL);

    const payload = customersRedactJob.schema.parse(jobs[0]?.data);
    await customersRedactJob.handler(payload, jobContext());

    expect(await prisma.prescription.findUnique({ where: { id: rxA.id } })).toBeNull();
    expect(await prisma.prescription.findUnique({ where: { id: rxKeep.id } })).not.toBeNull();
    expect(await prisma.prescription.findUnique({ where: { id: rxB.id } })).not.toBeNull();
    const labA = await prisma.labOrder.findFirstOrThrow({
      where: { shopId: shopA.shopId, shopifyOrderId: "1001" },
    });
    expect(labA.prescriptionId).toBeNull();
    const labKeep = await prisma.labOrder.findFirstOrThrow({
      where: { shopId: shopA.shopId, shopifyOrderId: "1002" },
    });
    expect(labKeep.prescriptionId).toBe(rxKeep.id);
    expect(storedKeys?.has(buildRxKey(shopA.shopId, rxA.id, "file", "pdf"))).toBe(false);
    expect(storedKeys?.has(buildRxKey(shopA.shopId, rxKeep.id, "file", "pdf"))).toBe(true);
    expect(storedKeys?.has(buildRxKey(shopB.shopId, rxB.id, "file", "pdf"))).toBe(true);
    expect(listedPrefixes).toContain(buildRxPrefix(shopA.shopId, rxA.id));
    expect(listedPrefixes).not.toContain(buildRxPrefix(shopB.shopId, rxB.id));
    expect(await snapshot(prisma, shopB.shopId)).toEqual(beforeB);
    expect(labB.prescriptionId).toBe(
      (await prisma.labOrder.findFirstOrThrow({ where: { id: labB.id } })).prescriptionId,
    );

    const prefixesAfter = listedPrefixes?.length ?? 0;
    await customersRedactJob.handler(payload, jobContext());
    expect(listedPrefixes).toHaveLength(prefixesAfter);
    expect(await prisma.prescription.findUnique({ where: { id: rxKeep.id } })).not.toBeNull();
  }, DB_MS);

  it("same request id twice enqueues one job", async () => {
    const prisma = database();
    const shop = await seedShop(prisma, shopDomain("dup"));
    const id = webhookId();
    const body = { orders_to_redact: [1001], customer: { id: 191167 } };
    const first = await post("compliance", "customers/redact", body, "valid", shop.domain, id);
    const second = await post("compliance", "customers/redact", body, "valid", shop.domain, id);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      await prisma.complianceRequest.count({
        where: { shopId: shop.shopId, shopifyRequestId: id },
      }),
    ).toBe(1);
    const jobs = await testQueue().findJobs(customersRedactJob.name, { data: { shopId: shop.shopId } });
    expect(jobs).toHaveLength(1);
  }, DB_MS);

  it("shop/redact for shop A removes every DMMF shop-owned model and leaves B", async () => {
    const prisma = database();
    const shopA = await seedShop(prisma, shopDomain("wipe-a"));
    const shopB = await seedShop(prisma, shopDomain("wipe-b"));
    await prisma.session.create({
      data: {
        id: `offline_${shopA.domain}`,
        shop: shopA.domain,
        state: "fixture",
        isOnline: false,
        accessToken: "fake-token",
      },
    });
    await prisma.session.create({
      data: {
        id: `offline_${shopB.domain}`,
        shop: shopB.domain,
        state: "fixture",
        isOnline: false,
        accessToken: "fake-token",
      },
    });
    const beforeA = await snapshot(prisma, shopA.shopId);
    const beforeB = await snapshot(prisma, shopB.shopId);
    for (const name of dmmfShopModelNames()) {
      expect(beforeA[name]).toBeGreaterThan(0);
    }
    const keyA = buildRxKey(shopA.shopId, "rx-a", "file", "pdf");
    const keyB = buildRxKey(shopB.shopId, "rx-b", "file", "pdf");
    loadMemoryStore([keyA, keyB, `shops/${shopA.shopId}/tickets/lab.pdf`]);

    const response = await post(
      "compliance",
      "shop/redact",
      { shop_id: 954889, shop_domain: "ignored.example.test" },
      "valid",
      shopA.domain,
      webhookId(),
    );
    expect(response.status).toBe(200);
    expect(await prisma.shop.findUnique({ where: { id: shopA.shopId } })).not.toBeNull();
    expect(listedPrefixes).toEqual([]);

    const jobs = await testQueue().findJobs(shopRedactJob.name, { data: { shopId: shopA.shopId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({
      complianceRequestId: expect.any(String),
      shopId: shopA.shopId,
    });
    await shopRedactJob.handler(shopRedactJob.schema.parse(jobs[0]?.data), jobContext());

    for (const name of dmmfShopModelNames()) {
      expect(await countModel(prisma, name, shopA.shopId)).toBe(0);
    }
    expect(await snapshot(prisma, shopB.shopId)).toEqual(beforeB);
    expect(await prisma.session.findUnique({ where: { id: `offline_${shopA.domain}` } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: `offline_${shopB.domain}` } })).not.toBeNull();
    expect(storedKeys?.has(keyA)).toBe(false);
    expect(storedKeys?.has(`shops/${shopA.shopId}/tickets/lab.pdf`)).toBe(false);
    expect(storedKeys?.has(keyB)).toBe(true);
    expect(listedPrefixes).toContain(buildShopPrefix(shopA.shopId));
    expect(listedPrefixes).not.toContain(buildShopPrefix(shopB.shopId));

    await shopRedactJob.handler(shopRedactJob.schema.parse(jobs[0]?.data), jobContext());
    expect(storedKeys?.has(keyB)).toBe(true);
    expect(await snapshot(prisma, shopB.shopId)).toEqual(beforeB);
  }, DB_MS);

  it("data_request emails JSON to the shop contact and logs ids only", async () => {
    const prisma = database();
    const shopA = await seedShop(prisma, shopDomain("data-a"));
    const shopB = await seedShop(prisma, shopDomain("data-b"));
    const rxA = await prisma.prescription.findFirstOrThrow({ where: { shopId: shopA.shopId } });
    const rxB = await prisma.prescription.findFirstOrThrow({ where: { shopId: shopB.shopId } });
    const plain = {
      od: { sph: -225 },
      os: { sph: -100 },
      pd: { single: 630 },
      notes: NEEDLE,
    };
    await prisma.prescription.update({
      where: { id: rxA.id },
      data: {
        orderId: "1001",
        cipher: cipher.encrypt(plain, `${shopA.shopId}:${rxA.id}`),
      },
    });
    await prisma.prescription.update({
      where: { id: rxB.id },
      data: {
        orderId: "1001",
        cipher: cipher.encrypt(
          { notes: "SHOP-B-ONLY", od: { sph: -225 }, os: { sph: 0 }, pd: { single: 630 } },
          `${shopB.shopId}:${rxB.id}`,
        ),
      },
    });
    const other = await prisma.prescription.create({
      data: {
        shopId: shopA.shopId,
        rxType: "SINGLE_VISION",
        source: "MANUAL",
        orderId: "1002",
        cipher: "pending",
      },
    });
    await prisma.prescription.update({
      where: { id: other.id },
      data: {
        cipher: cipher.encrypt(
          { notes: "order 1002 only", od: { sph: 0 }, os: { sph: 0 }, pd: { single: 630 } },
          `${shopA.shopId}:${other.id}`,
        ),
      },
    });

    const consoleLines: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleLines.push(
          args
            .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
            .join(" "),
        );
      }),
    );

    try {
      const response = await post(
        "compliance",
        "customers/data_request",
        {
          shop_id: 954889,
          shop_domain: "ignored.example.test",
          orders_requested: [1001],
          customer: { id: 191167, email: CUSTOMER_EMAIL, phone: "555-0100" },
          data_request: { id: 9999 },
        },
        "valid",
        shopA.domain,
        webhookId(),
      );
      expect(response.status).toBe(200);
      expect(sent).toHaveLength(0);

      const jobs = await testQueue().findJobs(customersDataRequestJob.name, {
        data: { shopId: shopA.shopId },
      });
      expect(jobs).toHaveLength(1);
      const stored = JSON.stringify(jobs[0]?.data);
      expect(stored).not.toContain(NEEDLE);
      expect(stored).not.toContain(CUSTOMER_EMAIL);
      expect(stored).not.toContain("@");
      expect(Object.keys(customersDataRequestJob.schema.shape).sort()).toEqual([
        "complianceRequestId",
        "customerId",
        "orderIds",
        "shopId",
      ]);

      const payload = customersDataRequestJob.schema.parse(jobs[0]?.data);
      await customersDataRequestJob.handler(payload, jobContext());
      await customersDataRequestJob.handler(payload, jobContext());
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message?.to).toBe(CONTACT);
    expect(message?.subject).toBe("Customer data request");
    expect(message?.text).not.toContain(NEEDLE);
    expect(message?.text).not.toContain(CUSTOMER_EMAIL);
    expect(message?.idempotencyKey).toEqual(expect.any(String));
    const attachment = message?.attachments?.[0];
    const json = JSON.parse(attachment?.content.toString("utf8") ?? "{}") as {
      prescriptions: { id: string; prescription: { notes?: string } }[];
    };
    expect(json.prescriptions.map((row) => row.id)).toEqual([rxA.id]);
    expect(json.prescriptions[0]?.prescription.notes).toBe(NEEDLE);
    expect(attachment?.content.toString("utf8")).not.toContain("SHOP-B-ONLY");
    expect(attachment?.content.toString("utf8")).not.toContain("order 1002 only");
    expect(attachment?.content.toString("utf8")).not.toContain(CUSTOMER_EMAIL);

    const logged = logs.join("\n");
    expect(logged).toContain(shopA.shopId);
    expect(logged).toContain(rxA.id);
    expect(logged).toContain("1001");
    expect(logged).not.toContain(NEEDLE);
    expect(logged).not.toContain("-225");
    expect(logged).not.toContain("@");
    expect(logged).not.toContain(CUSTOMER_EMAIL);
    expect(consoleLines.join("\n")).not.toContain(NEEDLE);
    expect(consoleLines.join("\n")).not.toContain(CUSTOMER_EMAIL);
    expect(await prisma.prescription.findUnique({ where: { id: rxB.id } })).not.toBeNull();
  }, DB_MS);

  it("returns the canonical error body for webhook auth failures and calls no repository", async () => {
    const prisma = database();
    const shop = await seedShop(prisma, shopDomain("hmac"));
    await prisma.session.create({
      data: {
        id: `offline_${shop.domain}`,
        shop: shop.domain,
        state: "fixture",
        isOnline: false,
        accessToken: "fake-token",
      },
    });
    const beforeJobs = await jobTotal();
    const beforeRequests = await prisma.complianceRequest.count({ where: { shopId: shop.shopId } });
    let repositoryCalls = 0;
    setComplianceDepsForTests({
      prisma: countingPrisma(prisma, () => {
        repositoryCalls += 1;
      }),
      queue: testQueue(),
      objectStore: objectStore as ObjectStore,
      mailer,
      cipher,
      logger,
      shopContactEmail: async () => CONTACT,
    });
    const cases: [string, "compliance" | "uninstalled", unknown][] = [
      ["customers/redact", "compliance", { orders_to_redact: [1001] }],
      ["customers/data_request", "compliance", { orders_requested: [1001] }],
      ["shop/redact", "compliance", { shop_id: 1 }],
      ["app/uninstalled", "uninstalled", { myshopify_domain: shop.domain }],
    ];
    try {
      for (const [topic, route, body] of cases) {
        const forged = await post(route, topic, body, "forged", shop.domain, webhookId());
        expect(forged.status).toBe(401);
        expect(await errorBody(forged)).toEqual({
          error: { code: "UNAUTHORIZED", message: "Unauthorized" },
        });

        const rejected = await post(route, topic, body, "valid", shop.domain, webhookId(), {
          omitHeaders: ["X-Shopify-Webhook-Id"],
        });
        expect(rejected.status).toBe(400);
        expect(await errorBody(rejected)).toEqual({
          error: { code: "BAD_REQUEST", message: "Bad request" },
        });
      }
      expect(repositoryCalls).toBe(0);
    } finally {
      applyDeps();
    }
    expect(await prisma.complianceRequest.count({ where: { shopId: shop.shopId } })).toBe(
      beforeRequests,
    );
    expect(await jobTotal()).toBe(beforeJobs);
    expect(sent).toHaveLength(0);
    expect(listedPrefixes).toEqual([]);
    expect(await prisma.session.findUnique({ where: { id: `offline_${shop.domain}` } })).not.toBeNull();
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shop.shopId } })).uninstalledAt).toBeNull();
  }, DB_MS);
});

describe("webhook boundaries", () => {
  it("rejects an invalid body and a body over the order-id limit, and accepts the limit", async () => {
    const prisma = database();
    const shop = await seedShop(prisma, shopDomain("limit"));
    const before = await prisma.complianceRequest.count({ where: { shopId: shop.shopId } });

    const invalid = await post(
      "compliance",
      "customers/redact",
      { orders_to_redact: "1001" },
      "valid",
      shop.domain,
      webhookId(),
    );
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { error: { code: string; message: string } };
    expect(invalidBody.error.code).toBe("INVALID_WEBHOOK");
    expect(invalidBody.error.message).not.toContain("1001");

    const broken = await post(
      "compliance",
      "customers/redact",
      "{",
      "valid",
      shop.domain,
      webhookId(),
    );
    expect(broken.status).toBe(400);

    const unknown = await post(
      "compliance",
      "orders/create",
      { orders_to_redact: [1001] },
      "valid",
      shop.domain,
      webhookId(),
    );
    expect(unknown.status).toBe(400);
    expect(await prisma.complianceRequest.count({ where: { shopId: shop.shopId } })).toBe(before);

    const tooMany = await post(
      "compliance",
      "customers/redact",
      { orders_to_redact: Array.from({ length: MAX_ORDER_IDS + 1 }, (_, index) => index + 1) },
      "valid",
      shop.domain,
      webhookId(),
    );
    expect(tooMany.status).toBe(400);
    expect(await prisma.complianceRequest.count({ where: { shopId: shop.shopId } })).toBe(before);

    const atLimit = await post(
      "compliance",
      "customers/redact",
      { orders_to_redact: Array.from({ length: MAX_ORDER_IDS }, (_, index) => index + 1) },
      "valid",
      shop.domain,
      webhookId(),
    );
    expect(atLimit.status).toBe(200);
    const jobs = await testQueue().findJobs(customersRedactJob.name, { data: { shopId: shop.shopId } });
    expect(jobs).toHaveLength(1);
    const payload = customersRedactJob.schema.parse(jobs[0]?.data);
    expect(payload.orderIds).toHaveLength(MAX_ORDER_IDS);
  }, DB_MS);

  it("acks an unknown shop without writing a request", async () => {
    const id = webhookId();
    const response = await post(
      "compliance",
      "shop/redact",
      { shop_id: 1 },
      "valid",
      shopDomain("missing"),
      id,
    );
    expect(response.status).toBe(200);
    expect(
      await database().complianceRequest.findUnique({ where: { shopifyRequestId: id } }),
    ).toBeNull();
  }, DB_MS);

  it("app/uninstalled marks the shop, deletes sessions, and keeps prescription rows", async () => {
    const prisma = database();
    const shop = await seedShop(prisma, shopDomain("bye"));
    const shopB = await seedShop(prisma, shopDomain("bye-b"));
    const rx = await prisma.prescription.findFirstOrThrow({ where: { shopId: shop.shopId } });
    await prisma.session.create({
      data: {
        id: `offline_${shop.domain}`,
        shop: shop.domain,
        state: "fixture",
        isOnline: false,
        accessToken: "fake-token",
      },
    });
    await prisma.session.create({
      data: {
        id: `offline_${shopB.domain}`,
        shop: shopB.domain,
        state: "fixture-b",
        isOnline: false,
        accessToken: "fake-token-b",
      },
    });
    const shopBBefore = await prisma.shop.findUniqueOrThrow({ where: { id: shopB.shopId } });
    const sessionBBefore = await prisma.session.findUniqueOrThrow({
      where: { id: `offline_${shopB.domain}` },
    });
    const first = await post(
      "uninstalled",
      "app/uninstalled",
      { myshopify_domain: shop.domain },
      "valid",
      shop.domain,
      webhookId(),
    );
    expect(first.status).toBe(200);
    const marked = await prisma.shop.findUniqueOrThrow({ where: { id: shop.shopId } });
    expect(marked.uninstalledAt).not.toBeNull();
    expect(await prisma.session.findUnique({ where: { id: `offline_${shop.domain}` } })).toBeNull();
    expect(await prisma.prescription.findUnique({ where: { id: rx.id } })).not.toBeNull();

    const second = await post(
      "uninstalled",
      "app/uninstalled",
      {},
      "valid",
      shop.domain,
      webhookId(),
    );
    expect(second.status).toBe(200);
    const again = await prisma.shop.findUniqueOrThrow({ where: { id: shop.shopId } });
    expect(again.uninstalledAt?.toISOString()).toBe(marked.uninstalledAt?.toISOString());

    const shopBAfter = await prisma.shop.findUniqueOrThrow({ where: { id: shopB.shopId } });
    expect(shopBAfter.domain).toBe(shopBBefore.domain);
    expect(shopBAfter.uninstalledAt).toBeNull();
    expect(shopBAfter.installedAt.toISOString()).toBe(shopBBefore.installedAt.toISOString());
    expect(await prisma.session.findUnique({ where: { id: sessionBBefore.id } })).toMatchObject({
      shop: sessionBBefore.shop,
      state: sessionBBefore.state,
      accessToken: sessionBBefore.accessToken,
      isOnline: sessionBBefore.isOnline,
    });
  }, DB_MS);

  it("re-enqueues one job when insert committed and the process died before enqueue", async () => {
    const prisma = database();
    const shop = await seedShop(prisma, shopDomain("died"));
    const id = webhookId();
    const persisted = await prisma.complianceRequest.create({
      data: {
        shopId: shop.shopId,
        topic: "customers/redact",
        shopifyRequestId: id,
      },
    });
    const response = await post(
      "compliance",
      "customers/redact",
      { orders_to_redact: [1001], customer: { id: 191167 } },
      "valid",
      shop.domain,
      id,
    );
    expect(response.status).toBe(200);
    expect(
      await prisma.complianceRequest.count({ where: { shopifyRequestId: id } }),
    ).toBe(1);
    const jobs = await testQueue().findJobs(customersRedactJob.name, {
      data: { shopId: shop.shopId },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toMatchObject({
      complianceRequestId: persisted.id,
      shopId: shop.shopId,
      orderIds: ["1001"],
      customerId: "191167",
    });
  }, DB_MS);

  it("does not enqueue when the duplicate compliance request is already handled", async () => {
    const prisma = database();
    const shop = await seedShop(prisma, shopDomain("done"));
    const id = webhookId();
    await prisma.complianceRequest.create({
      data: {
        shopId: shop.shopId,
        topic: "customers/redact",
        shopifyRequestId: id,
        handledAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    const before = await jobTotal();
    const response = await post(
      "compliance",
      "customers/redact",
      { orders_to_redact: [1001] },
      "valid",
      shop.domain,
      id,
    );
    expect(response.status).toBe(200);
    expect(await jobTotal()).toBe(before);
    expect(
      await prisma.complianceRequest.count({ where: { shopifyRequestId: id } }),
    ).toBe(1);
  }, DB_MS);

  it("enqueue failure deletes only this shop's unfinished request and leaves shop B", async () => {
    const prisma = database();
    const shopA = await seedShop(prisma, shopDomain("enq-a"));
    const shopB = await seedShop(prisma, shopDomain("enq-b"));
    await prisma.session.create({
      data: {
        id: `offline_${shopA.domain}`,
        shop: shopA.domain,
        state: "fixture",
        isOnline: false,
        accessToken: "fake-token-a",
      },
    });
    await prisma.session.create({
      data: {
        id: `offline_${shopB.domain}`,
        shop: shopB.domain,
        state: "fixture-b",
        isOnline: false,
        accessToken: "fake-token-b",
      },
    });
    const shopBBefore = await prisma.shop.findUniqueOrThrow({ where: { id: shopB.shopId } });
    const sessionBBefore = await prisma.session.findUniqueOrThrow({
      where: { id: `offline_${shopB.domain}` },
    });
    const requestB = await prisma.complianceRequest.findFirstOrThrow({
      where: { shopId: shopB.shopId },
    });
    const id = webhookId();
    setComplianceDepsForTests({
      prisma,
      queue: queueThatRejectsEnqueue(testQueue()),
      objectStore: objectStore as ObjectStore,
      mailer,
      cipher,
      logger,
      shopContactEmail: async () => CONTACT,
    });
    try {
      const response = await post(
        "compliance",
        "customers/redact",
        { orders_to_redact: [1001] },
        "valid",
        shopA.domain,
        id,
      );
      expect(response.status).toBe(500);
    } finally {
      applyDeps();
    }

    expect(
      await prisma.complianceRequest.findUnique({ where: { shopifyRequestId: id } }),
    ).toBeNull();
    expect(await testQueue().findJobs(customersRedactJob.name, { data: { shopId: shopA.shopId } })).toEqual(
      [],
    );
    const shopBAfter = await prisma.shop.findUniqueOrThrow({ where: { id: shopB.shopId } });
    expect(shopBAfter.domain).toBe(shopBBefore.domain);
    expect(shopBAfter.uninstalledAt).toBeNull();
    expect(shopBAfter.installedAt.toISOString()).toBe(shopBBefore.installedAt.toISOString());
    expect(await prisma.session.findUnique({ where: { id: sessionBBefore.id } })).toMatchObject({
      shop: sessionBBefore.shop,
      state: sessionBBefore.state,
      accessToken: sessionBBefore.accessToken,
      isOnline: sessionBBefore.isOnline,
    });
    expect(await prisma.complianceRequest.findUnique({ where: { id: requestB.id } })).toMatchObject({
      shopId: shopB.shopId,
      handledAt: null,
    });
    expect(await prisma.session.findUnique({ where: { id: `offline_${shopA.domain}` } })).toMatchObject({
      shop: shopA.domain,
      accessToken: "fake-token-a",
    });
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shopA.shopId } })).uninstalledAt).toBeNull();
  }, DB_MS);

  it("retries customer redaction after storage succeeds and the database throws", async () => {
    const prisma = database();
    const shopA = await seedShop(prisma, shopDomain("retry-rx-a"));
    const shopB = await seedShop(prisma, shopDomain("retry-rx-b"));
    const rxA = await prisma.prescription.findFirstOrThrow({ where: { shopId: shopA.shopId } });
    const rxB = await prisma.prescription.findFirstOrThrow({ where: { shopId: shopB.shopId } });
    const request = await prisma.complianceRequest.create({
      data: {
        shopId: shopA.shopId,
        topic: "customers/redact",
        shopifyRequestId: webhookId(),
      },
    });
    const beforeB = await snapshot(prisma, shopB.shopId);
    const keyA = buildRxKey(shopA.shopId, rxA.id, "file", "pdf");
    const keyB = buildRxKey(shopB.shopId, rxB.id, "file", "pdf");
    loadMemoryStore([keyA, keyB]);
    const flaky = prismaThatThrowsOnceOnTransaction(prisma);
    setComplianceDepsForTests({
      prisma: flaky,
      queue: testQueue(),
      objectStore: objectStore as ObjectStore,
      mailer,
      cipher,
      logger,
      shopContactEmail: async () => CONTACT,
    });

    const payload = {
      complianceRequestId: request.id,
      shopId: shopA.shopId,
      orderIds: ["1001"],
    };
    try {
      await expect(customersRedactJob.handler(payload, jobContext())).rejects.toThrow(
        "injected database failure",
      );
      expect(storedKeys?.has(keyA)).toBe(false);
      expect(storedKeys?.has(keyB)).toBe(true);
      expect(await prisma.prescription.findUnique({ where: { id: rxA.id } })).not.toBeNull();
      expect(
        (await prisma.complianceRequest.findUniqueOrThrow({ where: { id: request.id } })).handledAt,
      ).toBeNull();

      await customersRedactJob.handler(payload, jobContext());
    } finally {
      applyDeps();
    }

    expect(await prisma.prescription.findUnique({ where: { id: rxA.id } })).toBeNull();
    expect(await prisma.prescription.findUnique({ where: { id: rxB.id } })).not.toBeNull();
    expect(storedKeys?.has(keyA)).toBe(false);
    expect(storedKeys?.has(keyB)).toBe(true);
    const lab = await prisma.labOrder.findFirstOrThrow({
      where: { shopId: shopA.shopId, shopifyOrderId: "1001" },
    });
    expect(lab.prescriptionId).toBeNull();
    expect(
      (await prisma.complianceRequest.findUniqueOrThrow({ where: { id: request.id } })).handledAt,
    ).not.toBeNull();
    expect(await snapshot(prisma, shopB.shopId)).toEqual(beforeB);
  }, DB_MS);

  it("retries shop redaction after the database commits and storage throws", async () => {
    const prisma = database();
    const shopA = await seedShop(prisma, shopDomain("retry-shop-a"));
    const shopB = await seedShop(prisma, shopDomain("retry-shop-b"));
    await prisma.session.create({
      data: {
        id: `offline_${shopA.domain}`,
        shop: shopA.domain,
        state: "fixture",
        isOnline: false,
        accessToken: "fake-token-a",
      },
    });
    await prisma.session.create({
      data: {
        id: `offline_${shopB.domain}`,
        shop: shopB.domain,
        state: "fixture-b",
        isOnline: false,
        accessToken: "fake-token-b",
      },
    });
    const beforeB = await snapshot(prisma, shopB.shopId);
    const keyA = buildRxKey(shopA.shopId, "rx-a", "file", "pdf");
    const keyB = buildRxKey(shopB.shopId, "rx-b", "file", "pdf");
    const ticket = `shops/${shopA.shopId}/tickets/lab.pdf`;
    loadMemoryStore([keyA, keyB, ticket]);
    const store = objectStore as ObjectStore;
    setComplianceDepsForTests({
      prisma,
      queue: testQueue(),
      objectStore: objectStoreThatThrowsOnce(store),
      mailer,
      cipher,
      logger,
      shopContactEmail: async () => CONTACT,
    });

    const request = await prisma.complianceRequest.findFirstOrThrow({
      where: { shopId: shopA.shopId },
    });
    const payload = { complianceRequestId: request.id, shopId: shopA.shopId };
    try {
      await expect(shopRedactJob.handler(payload, jobContext())).rejects.toThrow(
        "injected storage failure",
      );
      for (const name of dmmfShopModelNames()) {
        expect(await countModel(prisma, name, shopA.shopId)).toBe(0);
      }
      expect(storedKeys?.has(keyA)).toBe(true);
      expect(storedKeys?.has(ticket)).toBe(true);
      expect(await prisma.session.findUnique({ where: { id: `offline_${shopA.domain}` } })).toBeNull();
      expect(await snapshot(prisma, shopB.shopId)).toEqual(beforeB);
      expect(await prisma.session.findUnique({ where: { id: `offline_${shopB.domain}` } })).toMatchObject({
        shop: shopB.domain,
        accessToken: "fake-token-b",
      });

      await shopRedactJob.handler(payload, jobContext());
    } finally {
      applyDeps();
    }

    expect(storedKeys?.has(keyA)).toBe(false);
    expect(storedKeys?.has(ticket)).toBe(false);
    expect(storedKeys?.has(keyB)).toBe(true);
    for (const name of dmmfShopModelNames()) {
      expect(await countModel(prisma, name, shopA.shopId)).toBe(0);
    }
    expect(await snapshot(prisma, shopB.shopId)).toEqual(beforeB);
    expect(await prisma.session.findUnique({ where: { id: `offline_${shopB.domain}` } })).toMatchObject({
      shop: shopB.domain,
      state: "fixture-b",
      accessToken: "fake-token-b",
    });
  }, DB_MS);

  it("rolls back shop redaction when a delete fails inside the transaction", async () => {
    const prisma = database();
    const shop = await seedShop(prisma, shopDomain("rollback"));
    const before = await snapshot(prisma, shop.shopId);
    const failing = prismaThatThrowsOnNthDelete(prisma, 2);
    await expect(
      runShopRedact(
        {
          prisma: failing,
          queue: testQueue(),
          objectStore: objectStore as ObjectStore,
          mailer,
          cipher,
          logger,
          shopContactEmail: async () => CONTACT,
        },
        { shopId: shop.shopId, complianceRequestId: "unused" },
      ),
    ).rejects.toThrow("injected failure");
    expect(await snapshot(prisma, shop.shopId)).toEqual(before);
    expect(listedPrefixes).toEqual([]);
  }, DB_MS);
});

async function jobTotal(): Promise<number> {
  const names = [customersRedactJob.name, customersDataRequestJob.name, shopRedactJob.name];
  let total = 0;
  for (const name of names) {
    try {
      total += (await testQueue().findJobs(name)).length;
    } catch (error) {
      if (error instanceof Error && error.message.includes("does not exist")) continue;
      throw error;
    }
  }
  return total;
}

async function errorBody(response: Response): Promise<unknown> {
  expect(response.headers.get("Content-Type")).toContain("application/json");
  return response.json();
}

/** Counts Prisma calls made through the compliance repository and uninstall writes. */
function countingPrisma(prisma: PrismaClient, onCall: () => void): PrismaClient {
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return (...args: unknown[]) => {
          onCall();
          return (value as (...inner: unknown[]) => unknown).apply(target, args);
        };
      }
      if (value && typeof value === "object") {
        return new Proxy(value, {
          get(model, modelProp, modelReceiver) {
            const method: unknown = Reflect.get(model, modelProp, modelReceiver);
            if (typeof method !== "function") return method;
            return (...args: unknown[]) => {
              onCall();
              return (method as (...inner: unknown[]) => unknown).apply(model, args);
            };
          },
        });
      }
      return value;
    },
  }) as PrismaClient;
}

function queueThatRejectsEnqueue(inner: Queue): Queue {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "enqueue") {
        return async () => {
          throw new Error("enqueue failed");
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function prismaThatThrowsOnceOnTransaction(prisma: PrismaClient): PrismaClient {
  let thrown = false;
  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          if (!thrown) {
            thrown = true;
            throw new Error("injected database failure");
          }
          return target.$transaction(fn);
        };
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

function objectStoreThatThrowsOnce(store: ObjectStore): ObjectStore {
  let pending = true;
  return {
    bucket: store.bucket,
    kmsKeyId: store.kmsKeyId,
    presignUpload: (params) => store.presignUpload(params),
    putObject: (params) => store.putObject(params),
    presignDownload: (key) => store.presignDownload(key),
    headObject: (key) => store.headObject(key),
    objectExists: (key) => store.objectExists(key),
    deletePrefix: async (prefix) => {
      if (pending) {
        pending = false;
        throw new Error("injected storage failure");
      }
      return store.deletePrefix(prefix);
    },
  };
}

function prismaThatThrowsOnNthDelete(prisma: PrismaClient, failOn: number): PrismaClient {
  let deletes = 0;
  const wrapTx = (tx: object): object =>
    new Proxy(tx, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (typeof value === "object" && value !== null && "deleteMany" in value) {
          return new Proxy(value, {
            get(model, modelProp, modelReceiver) {
              if (modelProp === "deleteMany") {
                return async (...args: unknown[]) => {
                  deletes += 1;
                  if (deletes === failOn) throw new Error("injected failure");
                  const fn = Reflect.get(model, modelProp, modelReceiver) as (
                    ...inner: unknown[]
                  ) => Promise<unknown>;
                  return fn.apply(model, args);
                };
              }
              const inner: unknown = Reflect.get(model, modelProp, modelReceiver);
              return typeof inner === "function" ? inner.bind(model) : inner;
            },
          });
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          target.$transaction(async (tx) => fn(wrapTx(tx) as Prisma.TransactionClient));
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}
