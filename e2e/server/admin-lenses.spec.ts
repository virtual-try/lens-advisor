import "../helpers/shopify-mock";
import { test, expect } from "@playwright/test";
import { getSharedTestDb } from "../helpers/shared-db";
import type { TestDb } from "../../test/db";
import { action as lensGroupAction } from "../../app/routes/app.lens-groups.$id";
import { action as lensAction } from "../../app/routes/app.lenses.$id";
import { loader as lensesIndexLoader } from "../../app/routes/app.lenses._index";
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
import { listLensGroups } from "../../app/features/catalog/catalog.service.server";

test.describe("Spec 33 Flow 2: Admin Lenses (admin-lenses)", () => {
  let db: TestDb;

  test.beforeAll(async () => {
    db = await getSharedTestDb();
    setupShopifyMock();
  });

  test.afterAll(async () => {
    teardownShopifyMock();
  });

  test("Flow 2: Create group + lens with limits, save -> lens listed, sync badge Synced, variant id stored", async () => {
    setMockPlanActive(true);
    const domain = "lenses-flow-shop.myshopify.com";
    const { shopId } = await seedShop(db.prisma, domain);

    // 1. Create a lens group via action
    const groupReq = new Request(createAdminUrl("/app/lens-groups/new", domain), {
      method: "POST",
      headers: {
        ...createAuthHeaders(domain),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "save",
        name: "Standard Everyday",
        description: "Clear everyday prescription lenses",
      }),
    });

    await lensGroupAction(createActionArgs(groupReq, { id: "new" }));

    const groups = await listLensGroups(shopId, { includeArchived: false });
    expect(groups.length).toBeGreaterThan(0);
    const group = groups.find((g) => g.name === "Standard Everyday");
    expect(group).toBeDefined();
    const groupId = group!.id;

    // 2. Create a lens with limits via action
    const lensReq = new Request(createAdminUrl("/app/lenses/new", domain), {
      method: "POST",
      headers: {
        ...createAuthHeaders(domain),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "save",
        groupId,
        name: "1.67 High Index",
        description: "Ultra lightweight thin lens",
        price: "79.00",
        rxTypes: ["SINGLE_VISION"],
        sphMin: "-8.00",
        sphMax: "+6.00",
        cylMin: "-4.00",
        cylMax: "0.00",
        labCodeTemplate: "HI167",
      }),
    });

    await lensAction(createActionArgs(lensReq, { id: "new" }));

    // 3. Verify in repository / service: variant id stored, limits persisted as hundredths (INV-5)
    const storedLens = await db.prisma.lens.findFirst({
      where: { shopId, name: "1.67 High Index" },
    });
    expect(storedLens).not.toBeNull();
    expect(storedLens?.sphMin).toBe(-800);
    expect(storedLens?.sphMax).toBe(600);
    expect(storedLens?.shopifyVariantId).toBeTruthy();
    expect(storedLens?.shopifyVariantId).toContain("gid://shopify/ProductVariant/");

    // 4. Call list loader: lens listed, sync badge Synced
    const listReq = new Request(createAdminUrl("/app/lenses", domain), {
      headers: createAuthHeaders(domain),
    });
    const loaderResponse = await lensesIndexLoader(createLoaderArgs(listReq));
    const loaderData = await unwrapData<{
      groups: Array<{
        id: string;
        name: string;
        lenses: Array<{
          id: string;
          name: string;
          shopifyVariantId: string | null;
          sphMin: number;
          sphMax: number;
        }>;
      }>;
      syncFailedId: string | null;
    }>(loaderResponse);

    const loadedGroup = loaderData.groups.find((g) => g.id === groupId);
    expect(loadedGroup).toBeDefined();
    const loadedLens = loadedGroup?.lenses.find((l) => l.name === "1.67 High Index");
    expect(loadedLens).toBeDefined();

    // Assert the exact sync status conditions the badge reads:
    // Sync failed condition: syncFailedId matches lens id -> false
    expect(loaderData.syncFailedId).toBeNull();
    const isFailed = loaderData.syncFailedId === loadedLens?.id;
    expect(isFailed).toBe(false);

    // Synced condition: has shopifyVariantId and !isFailed -> true (renders <s-badge tone="success">Synced</s-badge>)
    const isSynced = Boolean(loadedLens?.shopifyVariantId) && !isFailed;
    expect(isSynced).toBe(true);
    expect(loadedLens?.shopifyVariantId).toContain("gid://shopify/ProductVariant/");
  });
});
