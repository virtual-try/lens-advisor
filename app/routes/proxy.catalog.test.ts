// @vitest-environment node
import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb, seedShop, type TestDb } from "../../test/db";
import type { CatalogResponse } from "../../packages/rx-core/src/schemas/catalog.js";
import * as catalogService from "../features/catalog/catalog.service.server";
import * as settingsService from "../features/settings/settings.service.server";
import {
  action,
  loader,
} from "./proxy.catalog";
import { authenticate } from "../shopify.server";
import { getConfig } from "../shared/config.server";
import { AppError } from "../shared/http/errors.server";

const DB_TIMEOUT = 120_000;

const mocks = vi.hoisted(() => ({
  getPlanStatus: vi.fn(),
}));

vi.mock("../features/billing/plan.server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../features/billing/plan.server")>();
  return {
    ...mod,
    getPlanStatus: (...args: Parameters<typeof mod.getPlanStatus>) =>
      mocks.getPlanStatus(...args),
  };
});

function createLoaderArgs(request: Request): LoaderFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params: {},
    context: {},
    url,
    pattern: url.pathname,
  };
}

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

describe("Spec 21: App Proxy Catalog Endpoint (proxy.catalog.test.ts)", () => {
  let db: TestDb;
  let shopA: { shopId: string; domain: string };
  let shopB: { shopId: string; domain: string };
  let shopEmpty: { shopId: string; domain: string };

  beforeAll(async () => {
    db = await createTestDb();

    // 1. Seed shops A and B with test data
    shopA = await seedShop(db.prisma, "shop-a-catalog.myshopify.com");
    shopB = await seedShop(db.prisma, "shop-b-catalog.myshopify.com");

    // 2. Seed an empty shop with no catalog rows
    const emptyShopRow = await db.prisma.shop.create({
      data: {
        domain: "shop-empty-catalog.myshopify.com",
        installedAt: new Date("2026-01-15T00:00:00.000Z"),
      },
    });
    shopEmpty = { shopId: emptyShopRow.id, domain: emptyShopRow.domain };

    // 3. Seed offline sessions for appProxy authenticator lookup
    await db.prisma.session.createMany({
      data: [
        {
          id: `offline_${shopA.domain}`,
          shop: shopA.domain,
          state: "active",
          accessToken: "fake-offline-token-a",
        },
        {
          id: `offline_${shopB.domain}`,
          shop: shopB.domain,
          state: "active",
          accessToken: "fake-offline-token-b",
        },
        {
          id: `offline_${shopEmpty.domain}`,
          shop: shopEmpty.domain,
          state: "active",
          accessToken: "fake-offline-token-empty",
        },
      ],
    });

    // 4. Populate Shop A with distinctive catalog items (synced with shopifyVariantId)
    const groupA = await db.prisma.lensGroup.create({
      data: {
        shopId: shopA.shopId,
        name: "Shop A Exclusive Group",
        description: "Group only in Shop A",
        position: 0,
      },
    });

    await db.prisma.lens.create({
      data: {
        shopId: shopA.shopId,
        groupId: groupA.id,
        name: "Shop A Premium Single Vision",
        description: "Lens only in Shop A",
        priceMinor: 4500,
        currency: "USD",
        rxTypes: ["SINGLE_VISION"],
        sphMin: -600,
        sphMax: 400,
        cylMin: -200,
        cylMax: 0,
        labCodeTemplate: "LENS-A-[material=CR39]",
        shopifyVariantId: "gid://shopify/ProductVariant/10001",
        position: 0,
      },
    });

    const optGroupA = await db.prisma.optionGroup.create({
      data: {
        shopId: shopA.shopId,
        kind: "MATERIAL",
        name: "Shop A Materials",
        position: 0,
      },
    });

    await db.prisma.optionValue.create({
      data: {
        shopId: shopA.shopId,
        optionGroupId: optGroupA.id,
        label: "Polycarbonate A",
        priceDeltaMinor: 2000,
        currency: "USD",
        shopifyVariantId: "gid://shopify/ProductVariant/20001",
        position: 0,
      },
    });

    await db.prisma.addOn.create({
      data: {
        shopId: shopA.shopId,
        name: "Anti-Reflective Coating A",
        priceMinor: 1500,
        currency: "USD",
        shopifyVariantId: "gid://shopify/ProductVariant/30001",
        position: 0,
      },
    });

    // 5. Populate Shop B with completely distinct catalog items
    const groupB = await db.prisma.lensGroup.create({
      data: {
        shopId: shopB.shopId,
        name: "Shop B Exclusive Group",
        description: "Group only in Shop B",
        position: 0,
      },
    });

    await db.prisma.lens.create({
      data: {
        shopId: shopB.shopId,
        groupId: groupB.id,
        name: "Shop B Ultra Progressive",
        description: "Lens only in Shop B",
        priceMinor: 8900,
        currency: "USD",
        rxTypes: ["PROGRESSIVE"],
        sphMin: -800,
        sphMax: 600,
        cylMin: -300,
        cylMax: 0,
        addMin: 100,
        addMax: 300,
        labCodeTemplate: "LENS-B-[material=HIINDEX]",
        shopifyVariantId: "gid://shopify/ProductVariant/90001",
        position: 0,
      },
    });

    // 6. Hook global prisma client for container singleton resolution
    global.__prismaClient = db.prisma;
  }, DB_TIMEOUT);

  afterAll(async () => {
    delete global.__prismaClient;
    await db?.drop();
  }, DB_TIMEOUT);

  beforeEach(() => {
    mocks.getPlanStatus.mockReset();
    mocks.getPlanStatus.mockResolvedValue({
      active: true,
      planName: "Pro Plan",
      test: false,
    });
  });

  function makeSignedProxyRequest(
    pathname: string,
    shopDomain: string,
    extraParams: Record<string, string> = {},
    options: {
      unsigned?: boolean;
      forged?: boolean;
      method?: string;
    } = {},
  ): Request {
    const secret = getConfig().shopify.apiSecretKey;
    const searchParams = new URLSearchParams({
      path_prefix: "/apps/lens-advisor",
      shop: shopDomain,
      timestamp: String(Math.floor(Date.now() / 1000)),
      ...extraParams,
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
    return new Request(url, {
      method: options.method ?? "GET",
    });
  }

  function spyOnShopFindUnique() {
    const original = db.prisma.shop.findUnique;
    const spy = vi.fn((...args: Parameters<typeof original>) =>
      original.apply(db.prisma.shop, args),
    );
    db.prisma.shop.findUnique =
      spy as unknown as PrismaClient["shop"]["findUnique"];
    return {
      spy,
      restore() {
        db.prisma.shop.findUnique = original;
      },
    };
  }

  // =========================================================================
  // Examples Table Verification
  // =========================================================================

  describe("Examples Table Rows", () => {
    it("Row 1: valid signature, shop A -> 200, A's catalog only", async () => {
      const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
      const res = await loader(createLoaderArgs(req));

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");

      const body = (await res.json()) as CatalogResponse;

      // Confirms Shop A catalog content is present
      const groupNames = body.lensGroups.map((g) => g.name);
      expect(groupNames).toContain("Shop A Exclusive Group");
      expect(groupNames).not.toContain("Shop B Exclusive Group");

      const lensNames = body.lensGroups.flatMap((g) => g.lenses.map((l) => l.name));
      expect(lensNames).toContain("Shop A Premium Single Vision");
      expect(lensNames).not.toContain("Shop B Ultra Progressive");

      // Confirms settings block is present
      expect(body.settings).toBeDefined();
      expect(typeof body.settings.manualRxEnabled).toBe("boolean");
      expect(typeof body.settings.rxUploadEnabled).toBe("boolean");
      expect(typeof body.settings.storeRxInOrder).toBe("boolean");
    });

    it("Row 2: missing/forged signature -> 401, no repository call (INV-6)", async () => {
      const shopSpy = spyOnShopFindUnique();
      const catalogSpy = vi.spyOn(catalogService, "getStorefrontCatalog");
      const settingsSpy = vi.spyOn(settingsService, "getSettings");

      try {
        // 1. Missing signature
        const unsignedReq = makeSignedProxyRequest(
          "/apps/lens-advisor/catalog",
          shopA.domain,
          {},
          { unsigned: true },
        );
        const unsignedRes = await loader(createLoaderArgs(unsignedReq));

        expect(unsignedRes.status).toBe(401);
        const unsignedBody = await unsignedRes.json();
        expect(unsignedBody.error.code).toBe("UNAUTHORIZED");

        expect(shopSpy.spy).toHaveBeenCalledTimes(0);
        expect(catalogSpy).toHaveBeenCalledTimes(0);
        expect(settingsSpy).toHaveBeenCalledTimes(0);
        expect(mocks.getPlanStatus).toHaveBeenCalledTimes(0);

        // 2. Forged signature
        const forgedReq = makeSignedProxyRequest(
          "/apps/lens-advisor/catalog",
          shopA.domain,
          {},
          { forged: true },
        );
        const forgedRes = await loader(createLoaderArgs(forgedReq));

        expect(forgedRes.status).toBe(401);
        const forgedBody = await forgedRes.json();
        expect(forgedBody.error.code).toBe("UNAUTHORIZED");

        expect(shopSpy.spy).toHaveBeenCalledTimes(0);
        expect(catalogSpy).toHaveBeenCalledTimes(0);
        expect(settingsSpy).toHaveBeenCalledTimes(0);
        expect(mocks.getPlanStatus).toHaveBeenCalledTimes(0);
      } finally {
        shopSpy.restore();
        catalogSpy.mockRestore();
        settingsSpy.mockRestore();
      }
    });

    it("Row 3: ?shop=B added to A's signed request -> still A's catalog (signature covers params) (INV-1)", async () => {
      const shopSpy = spyOnShopFindUnique();
      const catalogSpy = vi.spyOn(catalogService, "getStorefrontCatalog");
      type AppProxyResult = Awaited<ReturnType<typeof authenticate.public.appProxy>>;
      const appProxySpy = vi
        .spyOn(authenticate.public, "appProxy")
        .mockResolvedValueOnce({
          session: { shop: shopA.domain } as unknown as AppProxyResult["session"],
          admin: {} as unknown as AppProxyResult["admin"],
          liquid: vi.fn(),
        } as unknown as AppProxyResult);

      try {
        // Arrange a verified app-proxy request for shop A whose query literally carries shop=B
        const reqWithShopB = new Request(
          `https://${shopA.domain}/apps/lens-advisor/catalog?path_prefix=%2Fapps%2Flens-advisor&shop=${shopB.domain}&timestamp=${Math.floor(
            Date.now() / 1000,
          )}`,
        );

        const res = await loader(createLoaderArgs(reqWithShopB));
        expect(res.status).toBe(200);

        const body = (await res.json()) as CatalogResponse;
        const lensNames = body.lensGroups.flatMap((g) => g.lenses.map((l) => l.name));
        expect(lensNames).toContain("Shop A Premium Single Vision");
        expect(lensNames).not.toContain("Shop B Ultra Progressive");

        // Tenancy strictly uses verified session A; catalog lookup called with A's id only
        expect(catalogSpy).toHaveBeenCalledWith(shopA.shopId, expect.anything());
        expect(catalogSpy).not.toHaveBeenCalledWith(shopB.shopId, expect.anything());
        expect(catalogSpy).toHaveBeenCalledTimes(1);

        expect(shopSpy.spy).toHaveBeenCalledWith({ where: { domain: shopA.domain } });
        expect(shopSpy.spy).not.toHaveBeenCalledWith({ where: { domain: shopB.domain } });
      } finally {
        appProxySpy.mockRestore();
        catalogSpy.mockRestore();
        shopSpy.restore();
      }
    });

    it("Row 4: shop with no catalog -> 200 with empty groups", async () => {
      const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopEmpty.domain);
      const res = await loader(createLoaderArgs(req));

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.lensGroups).toEqual([]);
      expect(body.optionGroups).toEqual([]);
      expect(body.addOns).toEqual([]);
      expect(body.settings).toEqual({
        manualRxEnabled: true,
        rxUploadEnabled: true,
        storeRxInOrder: false,
      });
    });

    it("Row 5: response includes labEmails -> never — test asserts absent (leak prevention)", async () => {
      // Ensure Shop A has labEmails seeded in shopSettings
      await db.prisma.shopSettings.upsert({
        where: { shopId: shopA.shopId },
        create: {
          shopId: shopA.shopId,
          labEmails: ["private-lab@lab-network.test", "orders@optical-lab.test"],
          storeRxInOrder: true,
          ticketFormat: "BOTH",
        },
        update: {
          labEmails: ["private-lab@lab-network.test", "orders@optical-lab.test"],
          storeRxInOrder: true,
          ticketFormat: "BOTH",
        },
      });

      const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
      const res = await loader(createLoaderArgs(req));

      expect(res.status).toBe(200);
      const rawText = await res.text();

      // Assert neither the emails nor labEmail keys exist in the raw response text
      expect(rawText).not.toContain("private-lab@lab-network.test");
      expect(rawText).not.toContain("orders@optical-lab.test");
      expect(rawText).not.toContain("labEmails");
      expect(rawText).not.toContain("labEmail");
      expect(rawText).not.toContain("ticketFormat");

      const body = JSON.parse(rawText);
      expect(body.settings.labEmail).toBeUndefined();
      expect(body.settings.labEmails).toBeUndefined();
      expect(body.settings.ticketFormat).toBeUndefined();
      expect(body.settings.storeRxInOrder).toBe(true);
    });
  });

  // =========================================================================
  // Invariants & Requirements
  // =========================================================================

  describe("Invariants & Specific Contracts", () => {
    it("INV-1: Shop isolation between two shops (A and B)", async () => {
      const reqA = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
      const resA = await loader(createLoaderArgs(reqA));
      expect(resA.status).toBe(200);
      const bodyA = (await resA.json()) as CatalogResponse;

      const reqB = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopB.domain);
      const resB = await loader(createLoaderArgs(reqB));
      expect(resB.status).toBe(200);
      const bodyB = (await resB.json()) as CatalogResponse;

      // Shop A has only Shop A items
      const lensesA = bodyA.lensGroups.flatMap((g) => g.lenses.map((l) => l.name));
      expect(lensesA).toContain("Shop A Premium Single Vision");
      expect(lensesA).not.toContain("Shop B Ultra Progressive");

      // Shop B has only Shop B items
      const lensesB = bodyB.lensGroups.flatMap((g) => g.lenses.map((l) => l.name));
      expect(lensesB).toContain("Shop B Ultra Progressive");
      expect(lensesB).not.toContain("Shop A Premium Single Vision");

      // Option groups and values isolation
      const optionsA = bodyA.optionGroups.map((g) => g.name);
      expect(optionsA).toContain("Shop A Materials");

      const optionsB = bodyB.optionGroups.map((g) => g.name);
      expect(optionsB).not.toContain("Shop A Materials");
    });

    it("INV-3: Carries storeRxInOrder (both false and true) and never lab emails", async () => {
      // 1. storeRxInOrder = false
      await db.prisma.shopSettings.update({
        where: { shopId: shopA.shopId },
        data: { storeRxInOrder: false },
      });

      const reqFalse = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
      const resFalse = await loader(createLoaderArgs(reqFalse));
      expect(resFalse.status).toBe(200);
      const bodyFalse = await resFalse.json();
      expect(bodyFalse.settings.storeRxInOrder).toBe(false);
      expect(bodyFalse.settings.labEmail).toBeUndefined();
      expect(bodyFalse.settings.labEmails).toBeUndefined();

      // 2. storeRxInOrder = true
      await db.prisma.shopSettings.update({
        where: { shopId: shopA.shopId },
        data: { storeRxInOrder: true },
      });

      const reqTrue = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
      const resTrue = await loader(createLoaderArgs(reqTrue));
      expect(resTrue.status).toBe(200);
      const bodyTrue = await resTrue.json();
      expect(bodyTrue.settings.storeRxInOrder).toBe(true);
      expect(bodyTrue.settings.labEmail).toBeUndefined();
      expect(bodyTrue.settings.labEmails).toBeUndefined();
    });

    it("INV-6: Spies assert zero calls on unsigned and forged requests", async () => {
      const shopSpy = spyOnShopFindUnique();
      const getCatalogSpy = vi.spyOn(catalogService, "getStorefrontCatalog");
      const getSettingsSpy = vi.spyOn(settingsService, "getSettings");

      try {
        // 1. Unsigned request
        const unsignedReq = makeSignedProxyRequest(
          "/apps/lens-advisor/catalog",
          shopA.domain,
          {},
          { unsigned: true },
        );
        const unsignedRes = await loader(createLoaderArgs(unsignedReq));
        expect(unsignedRes.status).toBe(401);

        expect(shopSpy.spy).toHaveBeenCalledTimes(0);
        expect(getCatalogSpy).toHaveBeenCalledTimes(0);
        expect(getSettingsSpy).toHaveBeenCalledTimes(0);
        expect(mocks.getPlanStatus).toHaveBeenCalledTimes(0);

        // 2. Forged request
        const forgedReq = makeSignedProxyRequest(
          "/apps/lens-advisor/catalog",
          shopA.domain,
          {},
          { forged: true },
        );
        const forgedRes = await loader(createLoaderArgs(forgedReq));
        expect(forgedRes.status).toBe(401);

        expect(shopSpy.spy).toHaveBeenCalledTimes(0);
        expect(getCatalogSpy).toHaveBeenCalledTimes(0);
        expect(getSettingsSpy).toHaveBeenCalledTimes(0);
        expect(mocks.getPlanStatus).toHaveBeenCalledTimes(0);
      } finally {
        shopSpy.restore();
        getCatalogSpy.mockRestore();
        getSettingsSpy.mockRestore();
      }
    });

    it("Cache-Control header is private, max-age=60", async () => {
      const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
      const res = await loader(createLoaderArgs(req));

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    });

    it("Shop not installed or no session -> 404 NOT_AVAILABLE", async () => {
      // Domain with no session in DB
      const uninstalledDomain = "uninstalled-store.myshopify.com";
      const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", uninstalledDomain);
      const res = await loader(createLoaderArgs(req));

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_AVAILABLE");
    });

    it("Shop uninstalled in DB (uninstalledAt not null) -> 404 NOT_AVAILABLE", async () => {
      const uninstalledShop = await db.prisma.shop.create({
        data: {
          domain: "previously-uninstalled.myshopify.com",
          installedAt: new Date("2026-01-01T00:00:00.000Z"),
          uninstalledAt: new Date("2026-02-01T00:00:00.000Z"),
        },
      });

      await db.prisma.session.create({
        data: {
          id: `offline_${uninstalledShop.domain}`,
          shop: uninstalledShop.domain,
          state: "active",
          accessToken: "token-uninstalled",
        },
      });

      const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", uninstalledShop.domain);
      const res = await loader(createLoaderArgs(req));

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_AVAILABLE");
    });

    it("Inactive billing plan -> 404 NOT_AVAILABLE", async () => {
      mocks.getPlanStatus.mockResolvedValueOnce({ active: false, test: false });

      const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
      const res = await loader(createLoaderArgs(req));

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_AVAILABLE");
    });

    it("Billing failure (BILLING_UNAVAILABLE) -> 502", async () => {
      mocks.getPlanStatus.mockRejectedValueOnce(
        new AppError(502, "BILLING_UNAVAILABLE", "Shopify billing service unavailable"),
      );

      const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
      const res = await loader(createLoaderArgs(req));

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.code).toBe("BILLING_UNAVAILABLE");
    });

    it("Malformed catalog response -> 500 INVALID_CATALOG_RESPONSE", async () => {
      // Corrupt catalog data violating rx-core schema (float price & invalid currency)
      const corruptCatalog = {
        lensGroups: [
          {
            id: "g1",
            name: "Corrupt Group",
            position: 0,
            lenses: [
              {
                id: "l1",
                groupId: "g1",
                name: "Corrupt Lens",
                // Invalid: float price and invalid currency code violate rx-core moneySchema (INV-4)
                price: { amountMinor: 12.34, currency: "INVALID" },
                limits: { sphMin: 0, sphMax: 0, cylMin: 0, cylMax: 0, rxTypes: ["SINGLE_VISION"] },
                labCodeTemplate: "L1",
                shopifyVariantId: "v1",
                position: 0,
              },
            ],
          },
        ],
        optionGroups: [],
        addOns: [],
        settings: { manualRxEnabled: true, rxUploadEnabled: true, storeRxInOrder: false },
      } as unknown as CatalogResponse;

      const catalogSpy = vi
        .spyOn(catalogService, "getStorefrontCatalog")
        .mockResolvedValueOnce(corruptCatalog);

      try {
        const req = makeSignedProxyRequest("/apps/lens-advisor/catalog", shopA.domain);
        const res = await loader(createLoaderArgs(req));

        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error.code).toBe("INVALID_CATALOG_RESPONSE");
      } finally {
        catalogSpy.mockRestore();
      }
    });

    it("Method validation: non-GET request handling", async () => {
      // 1. Unsigned POST -> 401 UNAUTHORIZED (authentication runs first)
      const unsignedPost = makeSignedProxyRequest(
        "/apps/lens-advisor/catalog",
        shopA.domain,
        {},
        { unsigned: true, method: "POST" },
      );
      const unsignedRes = await action(createActionArgs(unsignedPost));
      expect(unsignedRes.status).toBe(401);

      // 2. Signed POST -> 400 METHOD_NOT_ALLOWED
      const signedPost = makeSignedProxyRequest(
        "/apps/lens-advisor/catalog",
        shopA.domain,
        {},
        { method: "POST" },
      );
      const signedRes = await action(createActionArgs(signedPost));
      expect(signedRes.status).toBe(400);
      const body = await signedRes.json();
      expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
    });
  });
});
