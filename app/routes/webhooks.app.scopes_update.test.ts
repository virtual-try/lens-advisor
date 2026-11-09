// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  action,
  appScopesUpdateWebhookPayloadSchema,
  scopesUpdateWebhookPayloadSchema,
} from "./webhooks.app.scopes_update";
import { getShopify } from "../shopify.server";
import * as sessionService from "../shared/session/session.service.server";

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

describe("Spec 38: webhooks.app.scopes_update", () => {
  const shop = "test-shop.myshopify.com";
  const topic = "app/scopes_update";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Payload schema validation (scopesUpdateWebhookPayloadSchema)", () => {
    it("accepts valid payload with array of strings", () => {
      const payload = {
        current: ["read_products", "write_products", "read_orders"],
      };
      const result = scopesUpdateWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.current).toEqual([
          "read_products",
          "write_products",
          "read_orders",
        ]);
      }
    });

    it("accepts valid payload with empty array", () => {
      const payload = { current: [] };
      const result = scopesUpdateWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.current).toEqual([]);
      }
    });

    it("accepts valid payload with previous scopes and extra Shopify fields via passthrough", () => {
      const payload = {
        current: ["read_products"],
        previous: ["read_products", "write_orders"],
        shop_id: 12345,
        timestamp: "2026-11-09T00:00:00Z",
      };
      const result = scopesUpdateWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.current).toEqual(["read_products"]);
        expect(result.data.previous).toEqual(["read_products", "write_orders"]);
      }
    });

    it("appScopesUpdateWebhookPayloadSchema alias points to identical schema", () => {
      expect(appScopesUpdateWebhookPayloadSchema).toBe(scopesUpdateWebhookPayloadSchema);
    });

    it("rejects non-array current field", () => {
      const invalid = [
        { current: "read_products" },
        { current: 123 },
        { current: true },
        { current: { scope: "read_products" } },
        { current: null },
      ];
      for (const payload of invalid) {
        const result = scopesUpdateWebhookPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });

    it("rejects array with non-string elements", () => {
      const invalid = [
        { current: [123, 456] },
        { current: ["read_products", 123] },
        { current: ["read_products", null] },
        { current: [true, false] },
        { current: [{}] },
      ];
      for (const payload of invalid) {
        const result = scopesUpdateWebhookPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });

    it("rejects missing current field", () => {
      const invalid = [
        {},
        { previous: ["read_products"] },
        { other: "value" },
      ];
      for (const payload of invalid) {
        const result = scopesUpdateWebhookPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });

    it("rejects non-object payloads", () => {
      const invalid = [
        null,
        undefined,
        "string",
        12345,
        true,
        ["read_products"],
      ];
      for (const payload of invalid) {
        const result = scopesUpdateWebhookPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("Route action execution", () => {
    it("returns 401 when authenticate.webhook rejects with 401 (INV-6)", async () => {
      const updateSessionScopeSpy = vi.spyOn(sessionService, "updateSessionScope");

      vi.spyOn(getShopify().authenticate, "webhook").mockRejectedValueOnce(
        new Response(null, { status: 401 }),
      );

      const request = new Request("https://example.com/webhooks/app/scopes_update", {
        method: "POST",
      });

      const response = await action(createActionArgs(request));
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error?.code).toBe("UNAUTHORIZED");
      expect(json.error?.message).toBe("Webhook verification failed");
      expect(updateSessionScopeSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when authenticate.webhook rejects with 400", async () => {
      const updateSessionScopeSpy = vi.spyOn(sessionService, "updateSessionScope");

      vi.spyOn(getShopify().authenticate, "webhook").mockRejectedValueOnce(
        new Response(null, { status: 400 }),
      );

      const request = new Request("https://example.com/webhooks/app/scopes_update", {
        method: "POST",
      });

      const response = await action(createActionArgs(request));
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error?.code).toBe("BAD_REQUEST");
      expect(updateSessionScopeSpy).not.toHaveBeenCalled();
    });

    it("rethrows non-Response errors from authenticate.webhook", async () => {
      vi.spyOn(getShopify().authenticate, "webhook").mockRejectedValueOnce(
        new Error("Network timeout"),
      );

      const request = new Request("https://example.com/webhooks/app/scopes_update", {
        method: "POST",
      });

      await expect(action(createActionArgs(request))).rejects.toThrow("Network timeout");
    });

    it("returns 400 and logs error code only on malformed payloads without executing writes (INV-6)", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const updateSessionScopeSpy = vi.spyOn(sessionService, "updateSessionScope");

      const invalidPayloads = [
        {},
        { current: "not_an_array" },
        { current: [123, 456] },
        { current: ["read_products", null] },
        { other: "field" },
        null,
      ];

      for (const payload of invalidPayloads) {
        vi.spyOn(getShopify().authenticate, "webhook").mockResolvedValueOnce({
          shop,
          topic,
          webhookId: "wh_test",
          payload: payload as unknown as Record<string, unknown>,
          apiVersion: "2026-10",
          webhookType: "webhooks" as const,
          session: { id: "offline_test.myshopify.com", shop } as never,
          admin: undefined,
        });

        const request = new Request("https://example.com/webhooks/app/scopes_update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Shop-Domain": shop,
            "X-Shopify-Topic": topic,
          },
          body: JSON.stringify(payload),
        });

        const response = await action(createActionArgs(request));
        expect(response.status).toBe(400);

        const json = await response.json();
        expect(json.error?.code).toBe("MALFORMED_PAYLOAD");
        expect(json.error?.message).toBe("Invalid scopes update payload");
        expect(updateSessionScopeSpy).not.toHaveBeenCalled();
      }

      // Assert error logs contain error code and shop only, never dumped payload content
      expect(consoleErrorSpy).toHaveBeenCalled();
      for (const call of consoleErrorSpy.mock.calls) {
        const logged = call.join(" ");
        expect(logged).toContain("MALFORMED_PAYLOAD");
        expect(logged).toContain(shop);
        expect(logged).not.toContain("not_an_array");
      }
    });

    it("processes valid payload, updates session scope via service, and returns 200", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const updateSessionScopeSpy = vi
        .spyOn(sessionService, "updateSessionScope")
        .mockResolvedValueOnce({ count: 1 });

      const payload = {
        current: ["read_products", "write_products", "read_orders"],
      };

      vi.spyOn(getShopify().authenticate, "webhook").mockResolvedValueOnce({
        shop,
        topic,
        webhookId: "wh_test",
        payload,
        apiVersion: "2026-10",
        webhookType: "webhooks" as const,
        session: { id: "offline_test-shop.myshopify.com", shop } as never,
        admin: undefined,
      });

      const request = new Request("https://example.com/webhooks/app/scopes_update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": shop,
          "X-Shopify-Topic": topic,
        },
        body: JSON.stringify(payload),
      });

      const response = await action(createActionArgs(request));
      expect(response.status).toBe(200);

      // Verify session scope service was called with session id, current scopes, and shop option
      expect(updateSessionScopeSpy).toHaveBeenCalledTimes(1);
      expect(updateSessionScopeSpy).toHaveBeenCalledWith(
        "offline_test-shop.myshopify.com",
        ["read_products", "write_products", "read_orders"],
        { shop },
      );

      // Verify safe log
      expect(consoleLogSpy).toHaveBeenCalledWith(`Received ${topic} webhook for ${shop}`);
    });

    it("processes valid payload when session is undefined and returns 200 without calling service", async () => {
      const updateSessionScopeSpy = vi.spyOn(sessionService, "updateSessionScope");

      const payload = {
        current: ["read_products"],
      };

      vi.spyOn(getShopify().authenticate, "webhook").mockResolvedValueOnce({
        shop,
        topic,
        webhookId: "wh_test",
        payload,
        apiVersion: "2026-10",
        webhookType: "webhooks" as const,
        session: undefined,
        admin: undefined,
      });

      const request = new Request("https://example.com/webhooks/app/scopes_update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Shop-Domain": shop,
          "X-Shopify-Topic": topic,
        },
        body: JSON.stringify(payload),
      });

      const response = await action(createActionArgs(request));
      expect(response.status).toBe(200);
      expect(updateSessionScopeSpy).not.toHaveBeenCalled();
    });
  });

  describe("Structural Invariant 1 (Static analysis)", () => {
    it("route does not import forbidden persistence module or execute direct Prisma queries", () => {
      const filePath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "webhooks.app.scopes_update.tsx",
      );
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).not.toContain(["db", "server"].join("."));
      expect(content).not.toContain("db.session");
      expect(content).not.toContain("prisma.session");
      expect(content).not.toContain("import db from");
      expect(content).toContain("updateSessionScope");
    });
  });
});
