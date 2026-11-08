import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { getSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { action as settingsAction, loader as settingsLoader } from "../../app/routes/app.settings";
import {
  createActionArgs,
  createAdminUrl,
  createAuthHeaders,
  createLoaderArgs,
  unwrapData,
} from "../helpers/shopify-auth";
import {
  setMockPlanActive,
  setupShopifyMock,
  teardownShopifyMock,
} from "../helpers/shopify-mock";
import { seedShop } from "../helpers/seed";

test.describe("Spec 33 Flow 4: Admin Settings (admin-settings)", () => {
  let db: TestDb;

  test.beforeAll(async () => {
    db = await getSharedTestDb();
    setupShopifyMock();
  });

  test.afterAll(async () => {
    teardownShopifyMock();
  });

  test("Flow 4: Save settings with two lab emails, invalid email rejected -> values persist after reload; error shown", async () => {
    setMockPlanActive(true);
    const domain = "settings-flow-shop.myshopify.com";
    await seedShop(db.prisma, domain);

    // 1. Post invalid email: rejected with 400 and error code EMAIL
    const invalidReq = new Request(createAdminUrl("/app/settings", domain), {
      method: "POST",
      headers: {
        ...createAuthHeaders(domain),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        labEmail: "not-a-valid-email",
        ticketFormat: "PDF",
      }),
    });
    const invalidRes = (await settingsAction(createActionArgs(invalidReq))) as Response;
    expect(invalidRes.status).toBe(400);
    const invalidJson = (await invalidRes.json()) as {
      error?: { code?: string; fields?: Array<{ path: string; code: string }> };
    };
    expect(invalidJson.error?.code).toBe("EMAIL");

    // 2. Post two valid lab emails: saved successfully
    const validReq = new Request(createAdminUrl("/app/settings", domain), {
      method: "POST",
      headers: {
        ...createAuthHeaders(domain),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        labEmail: "lab1@example.com\nlab2@example.com",
        ticketFormat: "BOTH",
      }),
    });

    const validRes = await settingsAction(createActionArgs(validReq));
    const validData = await unwrapData<{ ok: boolean }>(validRes);
    expect(validData.ok).toBe(true);

    // 3. Reload settings via loader: values persist after reload
    const loadReq = new Request(createAdminUrl("/app/settings", domain), {
      headers: createAuthHeaders(domain),
    });

    const loaderResponse = await settingsLoader(createLoaderArgs(loadReq));
    const loaderData = await unwrapData<{
      settings: {
        labEmail: string[];
        ticketFormat: string;
      };
    }>(loaderResponse);

    expect(loaderData.settings.labEmail).toEqual(["lab1@example.com", "lab2@example.com"]);
    expect(loaderData.settings.ticketFormat).toBe("BOTH");
  });
});
