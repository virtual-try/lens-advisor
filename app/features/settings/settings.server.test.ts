// @vitest-environment node
import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotFoundError } from "../../shared/http/errors.server";
import { createTestDb, type TestDb } from "../../../test/db";
import { ValidationError } from "./schema";
import {
  findShopSettings,
  lockShop,
  upsertShopSettings,
} from "./settings.repository.server";
import {
  getSettings,
  isComplete,
  isSetupComplete,
  updateSettings,
} from "./settings.service.server";

const DB_MS = 120_000;

const DEFAULTS = {
  labEmail: [] as string[],
  ticketFormat: "PDF",
  storeRxInOrder: false,
  rxUploadEnabled: true,
  manualRxEnabled: true,
};

let db: TestDb | undefined;

function database(): TestDb {
  if (!db) throw new Error("Test database is not ready");
  return db;
}

beforeAll(async () => {
  db = await createTestDb();
}, DB_MS);

afterAll(async () => {
  await db?.drop();
}, DB_MS);

async function makeShop(): Promise<string> {
  const domain = `${randomBytes(8).toString("hex")}.settings.test`;
  const shop = await database().prisma.shop.create({ data: { domain } });
  return shop.id;
}

describe("Examples", () => {
  it("get with no row returns defaults and storeRxInOrder false", async () => {
    const shopId = await makeShop();
    const settingsBefore = await database().prisma.shopSettings.count();
    const shopsBefore = await database().prisma.shop.count();

    const first = await getSettings(shopId, database().prisma);
    first.labEmail.push("poison@example.com");
    const second = await getSettings(shopId, database().prisma);
    await isSetupComplete(shopId, database().prisma);

    expect(first.storeRxInOrder).toBe(false);
    expect(second).toEqual(DEFAULTS);
    expect(await database().prisma.shopSettings.findUnique({ where: { shopId } })).toBeNull();
    expect(await database().prisma.shopSettings.count()).toBe(settingsBefore);
    expect(await database().prisma.shop.count()).toBe(shopsBefore);
  }, DB_MS);

  it("patch ticketFormat CSV leaves the other fields unchanged", async () => {
    const shopId = await makeShop();
    await updateSettings(
      shopId,
      {
        labEmail: "lab@example.com",
        storeRxInOrder: true,
        rxUploadEnabled: false,
        manualRxEnabled: true,
      },
      database().prisma,
    );

    const saved = await updateSettings(
      shopId,
      { ticketFormat: "CSV" },
      database().prisma,
    );

    expect(saved).toEqual({
      labEmail: ["lab@example.com"],
      ticketFormat: "CSV",
      storeRxInOrder: true,
      rxUploadEnabled: false,
      manualRxEnabled: true,
    });
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId } }),
    ).toMatchObject({
      labEmails: ["lab@example.com"],
      ticketFormat: "CSV",
      storeRxInOrder: true,
      rxUploadEnabled: false,
      manualRxEnabled: true,
    });
  }, DB_MS);

  it("patch both Rx inputs off throws ValidationError AT_LEAST_ONE_RX_INPUT", async () => {
    const shopId = await makeShop();
    await updateSettings(
      shopId,
      { labEmail: "lab@example.com" },
      database().prisma,
    );
    const before = await database().prisma.shopSettings.findUnique({
      where: { shopId },
    });

    const error = await updateSettings(
      shopId,
      { rxUploadEnabled: false, manualRxEnabled: false },
      database().prisma,
    ).then(
      () => {
        throw new Error("expected ValidationError");
      },
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({
      name: "ValidationError",
      code: "AT_LEAST_ONE_RX_INPUT",
      status: 400,
      fields: [
        { path: "rxUploadEnabled", code: "AT_LEAST_ONE_RX_INPUT" },
        { path: "manualRxEnabled", code: "AT_LEAST_ONE_RX_INPUT" },
      ],
    });
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId } }),
    ).toEqual(before);

    const oneOff = await updateSettings(
      shopId,
      { rxUploadEnabled: false },
      database().prisma,
    );
    expect(oneOff.rxUploadEnabled).toBe(false);
    expect(oneOff.manualRxEnabled).toBe(true);

    await expect(
      updateSettings(shopId, { manualRxEnabled: false }, database().prisma),
    ).rejects.toMatchObject({ code: "AT_LEAST_ONE_RX_INPUT" });
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId } }),
    ).toMatchObject({ rxUploadEnabled: false, manualRxEnabled: true });
  }, DB_MS);

  it('labEmail "lab@x" throws ValidationError EMAIL and saves nothing', async () => {
    const shopId = await makeShop();
    await updateSettings(
      shopId,
      { labEmail: "keep@example.com" },
      database().prisma,
    );
    const before = await database().prisma.shopSettings.findUnique({
      where: { shopId },
    });

    const error = await updateSettings(
      shopId,
      { labEmail: "lab@x" },
      database().prisma,
    ).then(
      () => {
        throw new Error("expected ValidationError");
      },
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({
      name: "ValidationError",
      code: "EMAIL",
      status: 400,
      fields: [{ path: "labEmail", code: "EMAIL" }],
    });
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId } }),
    ).toEqual(before);

    await expect(
      updateSettings(
        shopId,
        { labEmail: ["keep@example.com", "lab@x"] },
        database().prisma,
      ),
    ).rejects.toMatchObject({
      code: "EMAIL",
      fields: [{ path: "labEmail.1", code: "EMAIL" }],
    });
    await expect(
      updateSettings(shopId, { labEmail: "   " }, database().prisma),
    ).rejects.toMatchObject({ code: "EMAIL" });
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId } }),
    ).toEqual(before);
  }, DB_MS);

  it("shop B reads B's defaults and never A's row", async () => {
    const shopA = await makeShop();
    const shopB = await makeShop();
    await updateSettings(
      shopA,
      {
        labEmail: "alpha@example.com",
        ticketFormat: "CSV",
        storeRxInOrder: true,
      },
      database().prisma,
    );

    const readB = await getSettings(shopB, database().prisma);
    expect(readB).toEqual(DEFAULTS);
    expect(JSON.stringify(readB)).not.toContain("alpha@example.com");
    expect(await isSetupComplete(shopB, database().prisma)).toEqual({
      labEmail: false,
    });
    expect(await isSetupComplete(shopA, database().prisma)).toEqual({
      labEmail: true,
    });
    expect(await findShopSettings(database().prisma, shopB)).toBeNull();
    expect((await findShopSettings(database().prisma, shopA))?.labEmails).toEqual([
      "alpha@example.com",
    ]);
  }, DB_MS);
});

describe("INV-1", () => {
  it("reads and writes stay inside the shop", async () => {
    const shopA = await makeShop();
    const shopB = await makeShop();
    await updateSettings(
      shopA,
      {
        labEmail: "alpha@example.com",
        ticketFormat: "CSV",
        storeRxInOrder: true,
        rxUploadEnabled: false,
      },
      database().prisma,
    );

    await updateSettings(
      shopB,
      { ticketFormat: "BOTH", labEmail: "beta@example.com" },
      database().prisma,
    );

    const rawA = await database().prisma.shopSettings.findUnique({
      where: { shopId: shopA },
    });
    const rawB = await database().prisma.shopSettings.findUnique({
      where: { shopId: shopB },
    });
    expect(rawA).toMatchObject({
      shopId: shopA,
      labEmails: ["alpha@example.com"],
      ticketFormat: "CSV",
      storeRxInOrder: true,
      rxUploadEnabled: false,
      manualRxEnabled: true,
    });
    expect(rawB).toMatchObject({
      shopId: shopB,
      labEmails: ["beta@example.com"],
      ticketFormat: "BOTH",
      storeRxInOrder: false,
      rxUploadEnabled: true,
      manualRxEnabled: true,
    });

    await database().prisma.$transaction(async (tx) => {
      expect(await lockShop(tx, shopA)).toBe(true);
      expect(await lockShop(tx, "missing-shop-settings")).toBe(false);
    });

    await expect(
      updateSettings("missing-shop-settings", { ticketFormat: "CSV" }, database().prisma),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await database().prisma.shopSettings.findUnique({
        where: { shopId: "missing-shop-settings" },
      }),
    ).toBeNull();
    expect(rawA).toMatchObject({
      labEmails: ["alpha@example.com"],
      ticketFormat: "CSV",
    });
  }, DB_MS);
});

describe("INV-3", () => {
  it("a fresh shop reads storeRxInOrder false, including the Prisma default", async () => {
    const shopId = await makeShop();
    expect((await getSettings(shopId, database().prisma)).storeRxInOrder).toBe(false);
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId } }),
    ).toBeNull();

    await database().prisma.shopSettings.create({ data: { shopId } });
    const stored = await database().prisma.shopSettings.findUniqueOrThrow({
      where: { shopId },
    });
    expect(stored.storeRxInOrder).toBe(false);
    expect(stored.ticketFormat).toBe("PDF");
    expect(stored.rxUploadEnabled).toBe(true);
    expect(stored.manualRxEnabled).toBe(true);
    expect((await getSettings(shopId, database().prisma)).storeRxInOrder).toBe(false);

    const model = Prisma.dmmf.datamodel.models.find(
      (item) => item.name === "ShopSettings",
    );
    const field = model?.fields.find((item) => item.name === "storeRxInOrder");
    expect(field?.hasDefaultValue).toBe(true);
    expect(field?.default).toBe(false);

    await expect(
      updateSettings(shopId, { storeRxInOrder: "true" }, database().prisma),
    ).rejects.toMatchObject({ name: "ValidationError", code: "INVALID" });
    expect(
      (
        await database().prisma.shopSettings.findUniqueOrThrow({
          where: { shopId },
        })
      ).storeRxInOrder,
    ).toBe(false);
  }, DB_MS);
});

describe("storage", () => {
  it("a rejected patch and a crashed upsert leave the previous row", async () => {
    const shopId = await makeShop();
    const fresh = await makeShop();
    await expect(
      updateSettings(
        fresh,
        { rxUploadEnabled: false, manualRxEnabled: false },
        database().prisma,
      ),
    ).rejects.toMatchObject({ code: "AT_LEAST_ONE_RX_INPUT" });
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId: fresh } }),
    ).toBeNull();

    await updateSettings(
      shopId,
      { labEmail: "lab@example.com", ticketFormat: "PDF" },
      database().prisma,
    );

    await expect(
      database().prisma.$transaction(async (tx) => {
        await upsertShopSettings(tx, shopId, {
          labEmail: ["changed@example.com"],
          ticketFormat: "BOTH",
          storeRxInOrder: true,
          rxUploadEnabled: true,
          manualRxEnabled: true,
        });
        throw new Error("crash");
      }),
    ).rejects.toThrow("crash");

    const row = await database().prisma.shopSettings.findUniqueOrThrow({
      where: { shopId },
    });
    expect(row.labEmails).toEqual(["lab@example.com"]);
    expect(row.ticketFormat).toBe("PDF");
    expect(row.storeRxInOrder).toBe(false);
  }, DB_MS);

  it("a corrupt stored row is reported and not trusted", async () => {
    const badEmail = await makeShop();
    const bothOff = await makeShop();
    await database().prisma.shopSettings.create({
      data: { shopId: badEmail, labEmails: ["lab@x"] },
    });
    await database().prisma.shopSettings.create({
      data: {
        shopId: bothOff,
        labEmails: ["lab@example.com"],
        rxUploadEnabled: false,
        manualRxEnabled: false,
      },
    });

    await expect(getSettings(badEmail, database().prisma)).rejects.toMatchObject({
      code: "CORRUPT_SETTINGS",
      status: 500,
    });
    await expect(isSetupComplete(bothOff, database().prisma)).rejects.toMatchObject({
      code: "CORRUPT_SETTINGS",
    });
    await expect(
      updateSettings(badEmail, { ticketFormat: "CSV" }, database().prisma),
    ).rejects.toMatchObject({ code: "CORRUPT_SETTINGS" });

    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId: badEmail } }),
    ).toMatchObject({ labEmails: ["lab@x"], ticketFormat: "PDF" });
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId: bothOff } }),
    ).toMatchObject({
      labEmails: ["lab@example.com"],
      rxUploadEnabled: false,
      manualRxEnabled: false,
    });

    const repaired = await updateSettings(
      badEmail,
      {
        labEmail: "lab@example.com",
        ticketFormat: "CSV",
        storeRxInOrder: false,
        rxUploadEnabled: true,
        manualRxEnabled: false,
      },
      database().prisma,
    );
    expect(repaired).toEqual({
      labEmail: ["lab@example.com"],
      ticketFormat: "CSV",
      storeRxInOrder: false,
      rxUploadEnabled: true,
      manualRxEnabled: false,
    });
  }, DB_MS);

  it("stores one or more lab emails and reports setup from them", async () => {
    const shopId = await makeShop();
    expect(isComplete).toBe(isSetupComplete);
    expect(await isComplete(shopId, database().prisma)).toEqual({ labEmail: false });

    const saved = await updateSettings(
      shopId,
      {
        labEmail: [" Lab@Example.com ", "lab@example.com", "other@example.com"],
      },
      database().prisma,
    );
    expect(saved.labEmail).toEqual(["lab@example.com", "other@example.com"]);
    expect(await isSetupComplete(shopId, database().prisma)).toEqual({
      labEmail: true,
    });

    const cleared = await updateSettings(
      shopId,
      { labEmail: [] },
      database().prisma,
    );
    expect(cleared.labEmail).toEqual([]);
    expect(cleared.ticketFormat).toBe("PDF");
    expect(await isSetupComplete(shopId, database().prisma)).toEqual({
      labEmail: false,
    });

    await expect(
      updateSettings(shopId, { labEmails: ["lab@example.com"] }, database().prisma),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(
      await database().prisma.shopSettings.findUnique({ where: { shopId } }),
    ).toMatchObject({ labEmails: [] });
  }, DB_MS);
});
