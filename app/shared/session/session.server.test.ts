// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { updateSessionScopeInDb } from "./session.repository.server";
import {
  createSessionService,
  updateSessionScope,
} from "./session.service.server";

describe("Shared Session: repository and service (session.server.test.ts)", () => {
  let testDb: TestDb;
  let shopA: { shopId: string; domain: string };
  let shopB: { shopId: string; domain: string };

  const sessionAId = "offline_shop-a-session.myshopify.com";
  const sessionBId = "offline_shop-b-session.myshopify.com";

  beforeAll(async () => {
    testDb = await createTestDb();
    shopA = await seedShop(testDb.prisma, "shop-a-session.myshopify.com");
    shopB = await seedShop(testDb.prisma, "shop-b-session.myshopify.com");

    // Seed session records for both shops
    await testDb.prisma.session.create({
      data: {
        id: sessionAId,
        shop: shopA.domain,
        state: "state_a",
        isOnline: false,
        scope: "read_products,write_products",
        accessToken: "shpat_test_token_a",
      },
    });

    await testDb.prisma.session.create({
      data: {
        id: sessionBId,
        shop: shopB.domain,
        state: "state_b",
        isOnline: false,
        scope: "read_orders,write_orders",
        accessToken: "shpat_test_token_b",
      },
    });
  });

  afterAll(async () => {
    await testDb.drop();
  });

  describe("session.repository.server", () => {
    it("updates session scope in database with required shop", async () => {
      const result = await updateSessionScopeInDb(testDb.prisma, {
        sessionId: sessionAId,
        scope: "read_products,write_products,read_themes",
        shop: shopA.domain,
      });

      expect(result.count).toBe(1);

      const updated = await testDb.prisma.session.findUnique({
        where: { id: sessionAId },
      });
      expect(updated?.scope).toBe("read_products,write_products,read_themes");
    });

    it("two-shop isolation: update scoped to shopA never modifies shopB session (INV-1)", async () => {
      // 1. Record shop B's session state before write
      const shopBBefore = await testDb.prisma.session.findUnique({
        where: { id: sessionBId },
      });
      expect(shopBBefore?.scope).toBe("read_orders,write_orders");

      // 2. Perform scoped update on shop A
      const resultA = await updateSessionScopeInDb(testDb.prisma, {
        sessionId: sessionAId,
        scope: "read_customers,write_customers",
        shop: shopA.domain,
      });
      expect(resultA.count).toBe(1);

      // 3. Verify shop A is updated
      const shopAAfter = await testDb.prisma.session.findUnique({
        where: { id: sessionAId },
      });
      expect(shopAAfter?.scope).toBe("read_customers,write_customers");

      // 4. Verify shop B's session is completely untouched
      const shopBAfter = await testDb.prisma.session.findUnique({
        where: { id: sessionBId },
      });
      expect(shopBAfter?.scope).toBe("read_orders,write_orders");

      // 5. Attempting to update shop B session with shop A's domain updates 0 rows
      const crossShopResult = await updateSessionScopeInDb(testDb.prisma, {
        sessionId: sessionBId,
        scope: "malicious_scope",
        shop: shopA.domain, // Wrong shop!
      });
      expect(crossShopResult.count).toBe(0);

      // Verify shop B is still untouched
      const shopBStillUntouched = await testDb.prisma.session.findUnique({
        where: { id: sessionBId },
      });
      expect(shopBStillUntouched?.scope).toBe("read_orders,write_orders");
    });

    it("rejects update if shop is missing or empty (INV-1)", async () => {
      await expect(
        updateSessionScopeInDb(testDb.prisma, {
          sessionId: sessionAId,
          scope: "invalid_update",
          shop: "",
        }),
      ).rejects.toThrow("shop is required to update session scope (INV-1)");

      await expect(
        // @ts-expect-error shop is required
        updateSessionScopeInDb(testDb.prisma, {
          sessionId: sessionAId,
          scope: "invalid_update",
        }),
      ).rejects.toThrow("shop is required to update session scope (INV-1)");
    });
  });

  describe("session.service.server", () => {
    it("updateSessionScope joins array of scopes with comma", async () => {
      const service = createSessionService({ prisma: testDb.prisma });

      await service.updateSessionScope(sessionAId, ["read_products", "write_inventory"], {
        shop: shopA.domain,
      });

      const updated = await testDb.prisma.session.findUnique({
        where: { id: sessionAId },
      });
      expect(updated?.scope).toBe("read_products,write_inventory");
    });

    it("updateSessionScope accepts string scope directly", async () => {
      const service = createSessionService({ prisma: testDb.prisma });

      await service.updateSessionScope(sessionAId, "read_all", {
        shop: shopA.domain,
      });

      const updated = await testDb.prisma.session.findUnique({
        where: { id: sessionAId },
      });
      expect(updated?.scope).toBe("read_all");
    });

    it("updateSessionScope accepts shop string directly as options", async () => {
      const service = createSessionService({ prisma: testDb.prisma });

      await service.updateSessionScope(sessionAId, "read_themes", shopA.domain);

      const updated = await testDb.prisma.session.findUnique({
        where: { id: sessionAId },
      });
      expect(updated?.scope).toBe("read_themes");
    });

    it("updateSessionScope handles empty scopes array", async () => {
      const service = createSessionService({ prisma: testDb.prisma });

      await service.updateSessionScope(sessionAId, [], {
        shop: shopA.domain,
      });

      const updated = await testDb.prisma.session.findUnique({
        where: { id: sessionAId },
      });
      expect(updated?.scope).toBe("");
    });

    it("two-shop isolation: service update scoped to shopA cannot modify shopB session (INV-1)", async () => {
      const service = createSessionService({ prisma: testDb.prisma });

      // Attempt cross-shop update via service
      const crossResult = await service.updateSessionScope(
        sessionBId,
        ["cross_shop_tamper"],
        { shop: shopA.domain },
      );
      expect(crossResult.count).toBe(0);

      // Verify shop B remains untouched
      const shopBRecord = await testDb.prisma.session.findUnique({
        where: { id: sessionBId },
      });
      expect(shopBRecord?.scope).toBe("read_orders,write_orders");
    });

    it("rejects service update if shop is missing or empty (INV-1)", async () => {
      const service = createSessionService({ prisma: testDb.prisma });

      await expect(
        service.updateSessionScope(sessionAId, ["read_products"], { shop: "" }),
      ).rejects.toThrow("shop is required to update session scope (INV-1)");

      await expect(
        // @ts-expect-error shop is required
        service.updateSessionScope(sessionAId, ["read_products"], {}),
      ).rejects.toThrow("shop is required to update session scope (INV-1)");
    });

    it("standalone function updateSessionScope delegates to service with shop", async () => {
      const result = await updateSessionScope(sessionBId, ["read_orders"], {
        shop: shopB.domain,
        deps: { prisma: testDb.prisma },
      });
      expect(result.count).toBe(1);

      const session = await testDb.prisma.session.findUnique({
        where: { id: sessionBId },
      });
      expect(session).not.toBeNull();
      expect(session?.id).toBe(sessionBId);
      expect(session?.scope).toBe("read_orders");
    });
  });
});
