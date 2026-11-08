// @vitest-environment node
import crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { action as prescriptionsAction } from "../../routes/proxy.prescriptions";
import { action as uploadUrlAction } from "../../routes/proxy.upload-url";
import { getConfig } from "../../shared/config.server";
import type {
  HeadObjectResult,
  ObjectStore,
  PresignUploadParams,
  PutObjectParams,
} from "../../shared/storage/object-store.server";
import * as repo from "./prescriptions.repository.server";
import { prescriptionRateLimiter } from "./rate-limiter.server";

const DB_TIMEOUT = 120_000;

function createActionArgs(request: Request): ActionFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params: {},
    context: {},
    url,
    pattern: url.pathname,
  };
}

class FakeObjectStore implements ObjectStore {
  readonly bucket = "lens-test-bucket";
  readonly kmsKeyId = "arn:aws:kms:test-key";
  public existingObjects = new Set<string>();
  public presignedUploads: PresignUploadParams[] = [];

  async presignUpload(params: PresignUploadParams): Promise<string> {
    this.presignedUploads.push(params);
    return `https://${this.bucket}.s3.amazonaws.com/${params.key}?presigned=true`;
  }

  async putObject(_params: PutObjectParams): Promise<void> {}

  async presignDownload(_keyOrParams: string | { key: string }): Promise<string> {
    return "https://download.fake";
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    if (this.existingObjects.has(key)) {
      return {
        exists: true,
        contentLength: 2048,
        contentType: "image/png",
        serverSideEncryption: "aws:kms",
        sseKmsKeyId: this.kmsKeyId,
      };
    }
    return { exists: false };
  }

  async objectExists(key: string): Promise<boolean> {
    return this.existingObjects.has(key);
  }

  async deletePrefix(_prefix: string): Promise<number> {
    return 0;
  }
}

describe("Spec 22: App Proxy Prescription Endpoints (routes.test.ts)", () => {
  let db: TestDb;
  let shopA: { shopId: string; domain: string };
  let shopB: { shopId: string; domain: string };
  let fakeStore: FakeObjectStore;

  beforeAll(async () => {
    db = await createTestDb();
    shopA = await seedShop(db.prisma, "shop-a-proxy.myshopify.com");
    shopB = await seedShop(db.prisma, "shop-b-proxy.myshopify.com");

    // Seed offline session for shopA so app proxy verified context resolves it
    await db.prisma.session.create({
      data: {
        id: `offline_${shopA.domain}`,
        shop: shopA.domain,
        state: "active",
        accessToken: "fake-offline-token",
      },
    });

    fakeStore = new FakeObjectStore();

    // Hook globals so container singletons resolve to test instances
    global.__prismaClient = db.prisma;
    global.__objectStore = fakeStore;
  }, DB_TIMEOUT);

  afterAll(async () => {
    delete global.__prismaClient;
    delete global.__objectStore;
    await db?.drop();
  }, DB_TIMEOUT);

  beforeEach(() => {
    prescriptionRateLimiter.reset();
  });

  function makeSignedProxyRequest(
    pathname: string,
    shopDomain: string,
    body?: unknown,
    options: {
      unsigned?: boolean;
      forged?: boolean;
      ip?: string;
      method?: string;
    } = {},
  ): Request {
    const secret = getConfig().shopify.apiSecretKey;
    const searchParams = new URLSearchParams({
      path_prefix: "/apps/lens-advisor",
      shop: shopDomain,
      timestamp: String(Math.floor(Date.now() / 1000)),
    });

    if (!options.unsigned) {
      const entries = Array.from(searchParams.entries()).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const queryString = entries.map(([k, v]) => `${k}=${v}`).join("");
      const signature = crypto
        .createHmac("sha256", options.forged ? "wrong_secret" : secret)
        .update(queryString)
        .digest("hex");
      searchParams.set("signature", signature);
    }

    const url = `https://${shopDomain}${pathname}?${searchParams.toString()}`;
    const headers = new Headers();
    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (options.ip) {
      headers.set("x-forwarded-for", options.ip);
    }

    return new Request(url, {
      method: options.method ?? "POST",
      headers,
      body:
        typeof body === "string"
          ? body
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
    });
  }

  // --- Examples table rows ---

  it("Row 1: valid MANUAL Rx -> 201 {rxRef}; DB cipher holds no plaintext", async () => {
    const rxPayload = {
      od: { sph: -325, cyl: -75, axis: 180 },
      os: { sph: -275, cyl: 0 },
      pd: { single: 620 },
      notes: "DISTINCTIVE_NOTES_XYZ_987",
    };

    const req = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopA.domain,
      {
        rxType: "SINGLE_VISION",
        prescription: rxPayload,
      },
    );

    const res = await prescriptionsAction(createActionArgs(req));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.rxRef).toBeDefined();

    // Verify DB cipher column holds no plaintext (INV-2)
    const row = await db.prisma.prescription.findUnique({
      where: { id: data.rxRef },
    });
    expect(row).not.toBeNull();
    expect(row?.shopId).toBe(shopA.shopId);
    expect(row?.source).toBe("MANUAL");
    expect(row?.cipher).not.toContain("-325");
    expect(row?.cipher).not.toContain("-3.25");
    expect(row?.cipher).not.toContain("-75");
    expect(row?.cipher).not.toContain("-0.75");
    expect(row?.cipher).not.toContain("DISTINCTIVE_NOTES_XYZ_987");
  });

  it("Row 2: MANUAL with CYL and no AXIS -> 400 fields:[{path:'od.axis',code:'AXIS_REQUIRED'}]", async () => {
    const invalidRx = {
      od: { sph: -200, cyl: -125 }, // CYL present, AXIS missing
      os: { sph: -200, cyl: 0 },
      pd: { single: 600 },
    };

    const req = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopA.domain,
      {
        rxType: "SINGLE_VISION",
        prescription: invalidRx,
      },
    );

    const res = await prescriptionsAction(createActionArgs(req));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe("BAD_REQUEST");
    expect(data.error.fields).toEqual([
      { path: "od.axis", code: "AXIS_REQUIRED" },
    ]);
  });

  it("Row 3: UPLOAD with a key under another shop's prefix -> 400 INVALID_UPLOAD_KEY", async () => {
    // 1. Create a draft under Shop A
    const uploadReq = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      {
        contentType: "image/png",
        size: 1024,
      },
    );
    const uploadRes = await uploadUrlAction(createActionArgs(uploadReq));
    expect(uploadRes.status).toBe(200);
    const { draftId } = await uploadRes.json();

    // 2. Submit with a key pointing under Shop B's prefix (INV-1)
    const foreignKey = `shops/${shopB.shopId}/rx/${draftId}/forged.png`;
    const submitReq = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopA.domain,
      {
        rxType: "SINGLE_VISION",
        draftId,
        uploadedKeys: [foreignKey],
      },
    );

    const submitRes = await prescriptionsAction(createActionArgs(submitReq));

    expect(submitRes.status).toBe(400);
    const data = await submitRes.json();
    expect(data.error.code).toBe("INVALID_UPLOAD_KEY");
  });

  it("Row 4: UPLOAD with a key never uploaded -> 400 UPLOAD_MISSING", async () => {
    // 1. Create draft under Shop A
    const uploadReq = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      {
        contentType: "image/jpeg",
        size: 2048,
      },
    );
    const uploadRes = await uploadUrlAction(createActionArgs(uploadReq));
    expect(uploadRes.status).toBe(200);
    const { draftId, key } = await uploadRes.json();

    // Notice: we do NOT add `key` to fakeStore.existingObjects (it was never uploaded!)
    const submitReq = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopA.domain,
      {
        rxType: "SINGLE_VISION",
        draftId,
        uploadedKeys: [key],
      },
    );

    const submitRes = await prescriptionsAction(createActionArgs(submitReq));

    expect(submitRes.status).toBe(400);
    const data = await submitRes.json();
    expect(data.error.code).toBe("UPLOAD_MISSING");
  });

  it("Row 5: upload-url for text/html -> 400 UNSUPPORTED_TYPE", async () => {
    const req = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      {
        contentType: "text/html",
        size: 512,
      },
    );

    const res = await uploadUrlAction(createActionArgs(req));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("UNSUPPORTED_TYPE");
  });

  it("Row 6: unsigned request -> 401, nothing written (INV-6)", async () => {
    const prescriptionsBefore = await db.prisma.prescription.count();

    // 1. Unsigned request to upload-url
    const unsignedUpload = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      { contentType: "image/png", size: 1024 },
      { unsigned: true },
    );
    const resUpload = await uploadUrlAction(createActionArgs(unsignedUpload));
    expect(resUpload.status).toBe(401);
    const uploadData = await resUpload.json();
    expect(uploadData.error.code).toBe("UNAUTHORIZED");

    // 2. Unsigned request to prescriptions
    const unsignedPrescription = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopA.domain,
      {
        rxType: "SINGLE_VISION",
        prescription: {
          od: { sph: -100 },
          os: { sph: -100 },
          pd: { single: 600 },
        },
      },
      { unsigned: true },
    );
    const resPrescription = await prescriptionsAction(createActionArgs(unsignedPrescription));
    expect(resPrescription.status).toBe(401);
    const rxData = await resPrescription.json();
    expect(rxData.error.code).toBe("UNAUTHORIZED");

    // Assert nothing written to database
    const prescriptionsAfter = await db.prisma.prescription.count();
    expect(prescriptionsAfter).toBe(prescriptionsBefore);
  });

  it("Row 7: 21st request in a minute -> 429 RATE_LIMITED", async () => {
    const clientIp = "192.168.10.50";

    // Perform 20 allowed requests
    for (let i = 1; i <= 20; i++) {
      const req = makeSignedProxyRequest(
        "/apps/lens-advisor/upload-url",
        shopA.domain,
        { contentType: "image/png", size: 1024 },
        { ip: clientIp },
      );
      const res = await uploadUrlAction(createActionArgs(req));
      expect(res.status).toBe(200);
    }

    // 21st request from same shop + IP within the minute is rate-limited
    const req21 = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      { contentType: "image/png", size: 1024 },
      { ip: clientIp },
    );
    const res21 = await uploadUrlAction(createActionArgs(req21));
    expect(res21.status).toBe(429);
    const data = await res21.json();
    expect(data.error.code).toBe("RATE_LIMITED");

    // A request from a different IP is allowed
    const reqDifferentIp = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      { contentType: "image/png", size: 1024 },
      { ip: "192.168.10.51" },
    );
    const resDifferent = await uploadUrlAction(createActionArgs(reqDifferentIp));
    expect(resDifferent.status).toBe(200);
  });

  // --- Invariant & Security Verification Tests ---

  it("R1-F2: unsigned non-POST request returns 401 on both endpoints; signed non-POST returns 400", async () => {
    // 1. Unsigned GET to prescriptions -> 401
    const unsignedRxGet = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopA.domain,
      undefined,
      { unsigned: true, method: "GET" },
    );
    const resUnsignedRx = await prescriptionsAction(createActionArgs(unsignedRxGet));
    expect(resUnsignedRx.status).toBe(401);

    // 2. Unsigned GET to upload-url -> 401
    const unsignedUpGet = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      undefined,
      { unsigned: true, method: "GET" },
    );
    const resUnsignedUp = await uploadUrlAction(createActionArgs(unsignedUpGet));
    expect(resUnsignedUp.status).toBe(401);

    // 3. Signed GET to prescriptions -> 400 METHOD_NOT_ALLOWED
    const signedRxGet = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopA.domain,
      undefined,
      { method: "GET" },
    );
    const resSignedRx = await prescriptionsAction(createActionArgs(signedRxGet));
    expect(resSignedRx.status).toBe(400);
    const rxData = await resSignedRx.json();
    expect(rxData.error.code).toBe("METHOD_NOT_ALLOWED");

    // 4. Signed GET to upload-url -> 400 METHOD_NOT_ALLOWED
    const signedUpGet = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      undefined,
      { method: "GET" },
    );
    const resSignedUp = await uploadUrlAction(createActionArgs(signedUpGet));
    expect(resSignedUp.status).toBe(400);
    const upData = await resSignedUp.json();
    expect(upData.error.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("R1-F3: request without verified offline session returns 401 and writes nothing", async () => {
    const prescriptionsBefore = await db.prisma.prescription.count();

    // shopB has no offline session in db.prisma.session
    const rxNoSession = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopB.domain,
      {
        rxType: "SINGLE_VISION",
        prescription: {
          od: { sph: -100 },
          os: { sph: -100 },
          pd: { single: 600 },
        },
      },
    );
    const resRx = await prescriptionsAction(createActionArgs(rxNoSession));
    expect(resRx.status).toBe(401);
    const dataRx = await resRx.json();
    expect(dataRx.error.code).toBe("UNAUTHORIZED");

    const upNoSession = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopB.domain,
      { contentType: "image/png", size: 1024 },
    );
    const resUp = await uploadUrlAction(createActionArgs(upNoSession));
    expect(resUp.status).toBe(401);
    const dataUp = await resUp.json();
    expect(dataUp.error.code).toBe("UNAUTHORIZED");

    expect(await db.prisma.prescription.count()).toBe(prescriptionsBefore);
  });

  describe("R1-F7: table-test both endpoints for unsigned, forged-signature, and malformed-body requests", () => {
    const testCases = [
      {
        endpoint: "/apps/lens-advisor/prescriptions",
        action: prescriptionsAction,
        type: "unsigned",
        body: {
          rxType: "SINGLE_VISION",
          prescription: { od: { sph: -100 }, os: { sph: -100 }, pd: { single: 600 } },
        },
        options: { unsigned: true },
        expectedStatus: 401,
        expectedCode: "UNAUTHORIZED",
      },
      {
        endpoint: "/apps/lens-advisor/upload-url",
        action: uploadUrlAction,
        type: "unsigned",
        body: { contentType: "image/png", size: 1024 },
        options: { unsigned: true },
        expectedStatus: 401,
        expectedCode: "UNAUTHORIZED",
      },
      {
        endpoint: "/apps/lens-advisor/prescriptions",
        action: prescriptionsAction,
        type: "forged-signature",
        body: {
          rxType: "SINGLE_VISION",
          prescription: { od: { sph: -100 }, os: { sph: -100 }, pd: { single: 600 } },
        },
        options: { forged: true },
        expectedStatus: 401,
        expectedCode: "UNAUTHORIZED",
      },
      {
        endpoint: "/apps/lens-advisor/upload-url",
        action: uploadUrlAction,
        type: "forged-signature",
        body: { contentType: "image/png", size: 1024 },
        options: { forged: true },
        expectedStatus: 401,
        expectedCode: "UNAUTHORIZED",
      },
      {
        endpoint: "/apps/lens-advisor/prescriptions",
        action: prescriptionsAction,
        type: "malformed-body",
        body: "{ not valid json !!",
        options: {},
        expectedStatus: 400,
        expectedCode: "BAD_REQUEST",
      },
      {
        endpoint: "/apps/lens-advisor/upload-url",
        action: uploadUrlAction,
        type: "malformed-body",
        body: "{ not valid json !!",
        options: {},
        expectedStatus: 400,
        expectedCode: "BAD_REQUEST",
      },
    ] as const;

    for (const tc of testCases) {
      it(`${tc.endpoint} [${tc.type}] -> ${tc.expectedStatus} and calls NO repository functions`, async () => {
        const createSpy = vi.spyOn(repo, "createPrescription");
        const updateSpy = vi.spyOn(repo, "updatePrescriptionUpload");
        const getSpy = vi.spyOn(repo, "getPrescriptionById");
        const findShopSpy = vi.spyOn(repo, "findShopByDomain");
        const attachSpy = vi.spyOn(repo, "attachOrder");

        try {
          const req = makeSignedProxyRequest(
            tc.endpoint,
            shopA.domain,
            tc.body,
            tc.options,
          );

          const res = await tc.action(createActionArgs(req));
          expect(res.status).toBe(tc.expectedStatus);
          const data = await res.json();
          expect(data.error.code).toBe(tc.expectedCode);

          // Assert NO repository function was called
          expect(createSpy).not.toHaveBeenCalled();
          expect(updateSpy).not.toHaveBeenCalled();
          expect(getSpy).not.toHaveBeenCalled();
          expect(findShopSpy).not.toHaveBeenCalled();
          expect(attachSpy).not.toHaveBeenCalled();
        } finally {
          createSpy.mockRestore();
          updateSpy.mockRestore();
          getSpy.mockRestore();
          findShopSpy.mockRestore();
          attachSpy.mockRestore();
        }
      });
    }
  });

  it("R1-F1: rejected upload key with PHI is echoed in neither response body nor logs (INV-2)", async () => {
    // Create draft
    const uploadReq = makeSignedProxyRequest(
      "/apps/lens-advisor/upload-url",
      shopA.domain,
      { contentType: "application/pdf", size: 1024 },
    );
    const uploadRes = await uploadUrlAction(createActionArgs(uploadReq));
    expect(uploadRes.status).toBe(200);
    const { draftId } = await uploadRes.json();

    const phiFilename = "SPH_-7.75_PATIENT.pdf";
    const phiKey = `shops/${shopA.shopId}/rx/${draftId}/${phiFilename}`;

    const logSpy = vi.spyOn(console, "log");
    const infoSpy = vi.spyOn(console, "info");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");

    try {
      const submitReq = makeSignedProxyRequest(
        "/apps/lens-advisor/prescriptions",
        shopA.domain,
        {
          rxType: "SINGLE_VISION",
          draftId,
          uploadedKeys: [phiKey],
        },
      );

      const submitRes = await prescriptionsAction(createActionArgs(submitReq));
      expect(submitRes.status).toBe(400);

      const rawBody = await submitRes.text();
      expect(rawBody).not.toContain(phiFilename);
      expect(rawBody).not.toContain("-7.75");

      const allLogged = [
        ...logSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errorSpy.mock.calls,
      ]
        .flat()
        .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
        .join(" ");

      expect(allLogged).not.toContain(phiFilename);
      expect(allLogged).not.toContain("-7.75");
    } finally {
      logSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("INV-2: captured console/logs contain no Rx values during submission", async () => {
    const rxSecretSphere = -625;
    const rxSecretCyl = -175;
    const rxSecretAxis = 45;
    const rxSecretNotes = "CONFIDENTIAL_PATIENT_RECORD_XYZ";

    const logSpy = vi.spyOn(console, "log");
    const infoSpy = vi.spyOn(console, "info");
    const warnSpy = vi.spyOn(console, "warn");
    const errorSpy = vi.spyOn(console, "error");

    const req = makeSignedProxyRequest(
      "/apps/lens-advisor/prescriptions",
      shopA.domain,
      {
        rxType: "SINGLE_VISION",
        prescription: {
          od: { sph: rxSecretSphere, cyl: rxSecretCyl, axis: rxSecretAxis },
          os: { sph: -200, cyl: 0 },
          pd: { single: 630 },
          notes: rxSecretNotes,
        },
      },
    );

    const res = await prescriptionsAction(createActionArgs(req));

    expect(res.status).toBe(201);

    const allLogged = [
      ...logSpy.mock.calls,
      ...infoSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]
      .flat()
      .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
      .join(" ");

    expect(allLogged).not.toContain("-625");
    expect(allLogged).not.toContain("-175");
    expect(allLogged).not.toContain(rxSecretNotes);

    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
