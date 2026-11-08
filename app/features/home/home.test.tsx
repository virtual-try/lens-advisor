import React from "react";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { testConfig } from "@shopify/shopify-app-react-router/test-helpers";
import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { getConfig } from "../../shared/config.server";
import { loadHomeData, type HomeLoaderData } from "./home.server";
import { HomeView } from "./home-view";
import type { ActivePlanContext } from "../billing/require-plan.server";

describe("Admin Home & Setup Checklist (Spec 31)", () => {
  let db: TestDb;
  let shopADomain: string;
  let shopBDomain: string;

  beforeAll(async () => {
    db = await createTestDb();

    // Seed Shop A with 1 lens and lab email set (done state)
    shopADomain = "shop-a.myshopify.com";
    await seedShop(db.prisma, shopADomain);

    // Seed Shop B as a new empty shop with no lenses and no lab email
    shopBDomain = "shop-b.myshopify.com";
    await db.prisma.shop.create({
      data: {
        domain: shopBDomain,
        installedAt: new Date("2026-01-15T00:00:00.000Z"),
      },
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  afterEach(() => {
    cleanup();
  });

  function createPlanContext(shop: string, active: boolean): ActivePlanContext {
    return {
      admin: {} as unknown as ActivePlanContext["admin"],
      session: { shop } as unknown as ActivePlanContext["session"],
      plan: { active, planName: active ? "Pro" : undefined, test: false },
      redirect: vi.fn((url: string) => {
        return new Response(null, {
          status: 302,
          headers: { location: url },
        });
      }),
    } as unknown as ActivePlanContext;
  }

  // =========================================================================
  // Spec 31 Examples Table Rows
  // =========================================================================

  describe("Examples Table", () => {
    it("Row 1: no lenses, no lab email -> 2 open items + theme link (new shop)", async () => {
      const planContext = createPlanContext(shopBDomain, true);
      const req = new Request("https://shop-b.myshopify.com/app");

      const data = await loadHomeData(req, {
        prisma: db.prisma,
        requireActivePlan: async () => planContext,
      });

      expect(data.hasLens).toBe(false);
      expect(data.hasLabEmail).toBe(false);

      const { container } = render(<HomeView {...data} />);

      // Checklist item texts are present
      const lensLink = screen.getByText("Add your first lens");
      expect(lensLink).toBeTruthy();
      expect(lensLink.tagName.toLowerCase()).toBe("s-link");
      expect(lensLink.getAttribute("href")).toBe("/app/lenses");

      const settingsLink = screen.getByText("Add a lab email");
      expect(settingsLink).toBeTruthy();
      expect(settingsLink.tagName.toLowerCase()).toBe("s-link");
      expect(settingsLink.getAttribute("href")).toBe("/app/settings");

      const themeLink = screen.getByText(
        "Add the Select lenses button to your product page",
      );
      expect(themeLink).toBeTruthy();
      expect(themeLink.tagName.toLowerCase()).toBe("s-link");
      expect(themeLink.getAttribute("href")).toBe(data.themeDeepLink);

      // 2 open items: both data items show "To do"
      const badges = container.querySelectorAll("s-badge");
      expect(badges.length).toBe(3);
      expect(badges[0].textContent).toBe("To do");
      expect(badges[1].textContent).toBe("To do");
      expect(badges[2].textContent).toBe("To do");

      // "You're live" card is NOT present
      expect(screen.queryByText("You're live")).toBeNull();
    });

    it("Row 2: 1 lens, lab email set -> both ticked, \"You're live\" card (done)", async () => {
      const planContext = createPlanContext(shopADomain, true);
      const req = new Request("https://shop-a.myshopify.com/app");

      const data = await loadHomeData(req, {
        prisma: db.prisma,
        requireActivePlan: async () => planContext,
      });

      expect(data.hasLens).toBe(true);
      expect(data.hasLabEmail).toBe(true);

      const { container } = render(<HomeView {...data} />);

      // Both data items show a tick (✓ Done)
      const badges = container.querySelectorAll("s-badge");
      expect(badges[0].textContent).toBe("✓ Done");
      expect(badges[1].textContent).toBe("✓ Done");

      // Items stay listed
      expect(screen.getByText("Add your first lens")).toBeTruthy();
      expect(screen.getByText("Add a lab email")).toBeTruthy();
      expect(
        screen.getByText("Add the Select lenses button to your product page"),
      ).toBeTruthy();

      // "You're live" card is rendered with links to Lab orders and Lenses
      expect(screen.getByText("You're live")).toBeTruthy();
      const labOrdersLink = screen.getByText("Lab orders");
      expect(labOrdersLink).toBeTruthy();
      expect(labOrdersLink.tagName.toLowerCase()).toBe("s-link");
      expect(labOrdersLink.getAttribute("href")).toBe("/app/lab-orders");

      const lensesLink = screen.getByText("Lenses");
      expect(lensesLink).toBeTruthy();
      expect(lensesLink.tagName.toLowerCase()).toBe("s-link");
      expect(lensesLink.getAttribute("href")).toBe("/app/lenses");
    });

    it("Row 3 (INV-1): other shop has lenses -> this shop still shows the item open", async () => {
      // Shop A has lenses, but we are querying for Shop B
      const planContext = createPlanContext(shopBDomain, true);
      const req = new Request("https://shop-b.myshopify.com/app");

      const data = await loadHomeData(req, {
        prisma: db.prisma,
        requireActivePlan: async () => planContext,
      });

      // Shop B has 0 lenses and no lab email
      expect(data.hasLens).toBe(false);
      expect(data.hasLabEmail).toBe(false);

      const { container } = render(<HomeView {...data} />);

      // For Shop B, "Add your first lens" is open ("To do"), not ticked
      const badges = container.querySelectorAll("s-badge");
      expect(badges[0].textContent).toBe("To do");
      expect(badges[1].textContent).toBe("To do");

      // "You're live" is not rendered
      expect(screen.queryByText("You're live")).toBeNull();
    });

    it("Row 4: no plan -> redirect to plan page (09 gate)", async () => {
      const req = new Request("https://shop-b.myshopify.com/app");

      const noPlanError = new Response(null, {
        status: 302,
        headers: {
          location: "https://admin.shopify.com/store/shop-b/charges/lens-advisor/pricing_plans",
        },
      });

      const requireActivePlanMock = vi.fn().mockRejectedValue(noPlanError);

      await expect(
        loadHomeData(req, {
          prisma: db.prisma,
          requireActivePlan: requireActivePlanMock,
        }),
      ).rejects.toThrow();

      try {
        await loadHomeData(req, {
          prisma: db.prisma,
          requireActivePlan: requireActivePlanMock,
        });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Response);
        const res = err as Response;
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(
          "https://admin.shopify.com/store/shop-b/charges/lens-advisor/pricing_plans",
        );
      }
    });
  });

  // =========================================================================
  // Self-Checks and Additional Requirements
  // =========================================================================

  describe("Self-Checks & Component Interactions", () => {
    it("Self-check 1: deep link uses the app's real API key from config (01), not a literal", async () => {
      const tConf = testConfig();
      const planContext = createPlanContext(shopADomain, true);
      const req = new Request("https://shop-a.myshopify.com/app");

      // Using configured apiKey
      const realApiKey = getConfig().shopify.apiKey;
      const dataWithRealKey = await loadHomeData(req, {
        prisma: db.prisma,
        requireActivePlan: async () => planContext,
      });

      expect(dataWithRealKey.apiKey).toBe(realApiKey);
      expect(dataWithRealKey.themeDeepLink).toBe(
        `/admin/themes/current/editor?template=product&addAppBlockId=${realApiKey}/select-lenses`,
      );

      // Using testConfig apiKey
      const dataWithTestKey = await loadHomeData(req, {
        prisma: db.prisma,
        requireActivePlan: async () => planContext,
        apiKey: tConf.apiKey,
      });

      expect(dataWithTestKey.apiKey).toBe(tConf.apiKey);
      expect(dataWithTestKey.themeDeepLink).toBe(
        `/admin/themes/current/editor?template=product&addAppBlockId=${tConf.apiKey}/select-lenses`,
      );
    });

    it("Manual 'Mark as done' toggles theme block item state in component state only", () => {
      const fixtureData: HomeLoaderData = {
        hasLens: true,
        hasLabEmail: false,
        apiKey: "api-key-xyz",
        themeDeepLink: "/admin/themes/current/editor?template=product&addAppBlockId=api-key-xyz/select-lenses",
      };

      const { container } = render(<HomeView {...fixtureData} />);

      const markDoneBtn = screen.getByText("Mark as done");
      expect(markDoneBtn).toBeTruthy();

      // Theme block badge is initially "To do"
      const badges = container.querySelectorAll("s-badge");
      expect(badges[2].textContent).toBe("To do");

      // Click "Mark as done"
      fireEvent.click(markDoneBtn);

      // Now badge shows "✓ Done" and button changes to "Mark as incomplete"
      expect(badges[2].textContent).toBe("✓ Done");
      expect(screen.getByText("Mark as incomplete")).toBeTruthy();

      // Click again to toggle back
      fireEvent.click(screen.getByText("Mark as incomplete"));
      expect(badges[2].textContent).toBe("To do");
    });

    it("Done items show a tick and stay listed even when all items are done", () => {
      const fixtureData: HomeLoaderData = {
        hasLens: true,
        hasLabEmail: true,
        apiKey: "api-key-xyz",
        themeDeepLink: "/admin/themes/current/editor?template=product&addAppBlockId=api-key-xyz/select-lenses",
      };

      const { container } = render(<HomeView {...fixtureData} />);

      // Mark the theme block done as well
      const markDoneBtn = screen.getByText("Mark as done");
      fireEvent.click(markDoneBtn);

      // All 3 badges show "✓ Done"
      const badges = container.querySelectorAll("s-badge");
      expect(badges[0].textContent).toBe("✓ Done");
      expect(badges[1].textContent).toBe("✓ Done");
      expect(badges[2].textContent).toBe("✓ Done");

      // All 3 items stay listed
      expect(screen.getByText("Add your first lens")).toBeTruthy();
      expect(screen.getByText("Add a lab email")).toBeTruthy();
      expect(
        screen.getByText("Add the Select lenses button to your product page"),
      ).toBeTruthy();

      // "You're live" card is displayed
      expect(screen.getByText("You're live")).toBeTruthy();
    });

    it("Self-check 2: INV-7 holds — Polaris components only, no raw style or className in owned files", () => {
      const { container } = render(
        <HomeView
          hasLens={true}
          hasLabEmail={true}
          apiKey="test-key"
          themeDeepLink="/test-link"
        />,
      );

      // No elements should have style attributes or class attributes
      const allElements = container.querySelectorAll("*");
      for (const el of allElements) {
        expect(el.getAttribute("style")).toBeNull();
        expect(el.getAttribute("class")).toBeNull();
      }
    });
  });
});
