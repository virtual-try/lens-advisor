// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  action,
  productUpdateWebhookPayloadSchema,
  productWebhookPayloadSchema,
  productsUpdateWebhookPayloadSchema,
} from "./webhooks.products.update";
import { getShopify } from "../shopify.server";

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

describe("Spec 38: webhooks.products.update", () => {
  const shop = "test-shop.myshopify.com";
  const topic = "products/update";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Payload schema validation (productUpdateWebhookPayloadSchema)", () => {
    it("accepts valid payload with numeric integer id", () => {
      const payload = { id: 7891234567890 };
      const result = productUpdateWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(7891234567890);
      }
    });

    it("accepts valid payload with string id", () => {
      const payload = { id: "7891234567890" };
      const result = productUpdateWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe("7891234567890");
      }
    });

    it("accepts valid payload with GraphQL GID id", () => {
      const payload = { id: "gid://shopify/Product/7891234567890" };
      const result = productUpdateWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe("gid://shopify/Product/7891234567890");
      }
    });

    it("accepts valid payload with full Shopify product fields via passthrough", () => {
      const payload = {
        id: 7891234567890,
        title: "Designer Sunglasses",
        vendor: "Eyewear Brand",
        product_type: "Glasses",
        handle: "designer-sunglasses",
        admin_graphql_api_id: "gid://shopify/Product/7891234567890",
        variants: [
          {
            id: 123456789,
            product_id: 7891234567890,
            title: "Black",
            price: "120.00",
            sku: "DS-BLK",
          },
        ],
        options: [
          {
            id: 987654321,
            product_id: 7891234567890,
            name: "Color",
            values: ["Black", "Tortoise"],
          },
        ],
        tags: "sunglasses, polarized, eyewear",
      };
      const result = productUpdateWebhookPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(7891234567890);
        expect(result.data.title).toBe("Designer Sunglasses");
      }
    });

    it("schema aliases point to identical schema", () => {
      expect(productWebhookPayloadSchema).toBe(productUpdateWebhookPayloadSchema);
      expect(productsUpdateWebhookPayloadSchema).toBe(productUpdateWebhookPayloadSchema);
    });

    it("rejects payload missing id", () => {
      const invalid = [
        {},
        { title: "Sunglasses" },
        { handle: "designer-sunglasses" },
        { variants: [] },
      ];
      for (const payload of invalid) {
        const result = productUpdateWebhookPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });

    it("rejects non-positive numeric id", () => {
      const invalid = [
        { id: 0 },
        { id: -1 },
        { id: -12345 },
      ];
      for (const payload of invalid) {
        const result = productUpdateWebhookPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });

    it("rejects empty string id", () => {
      const result = productUpdateWebhookPayloadSchema.safeParse({ id: "" });
      expect(result.success).toBe(false);
    });

    it("rejects non-string non-number id types", () => {
      const invalid = [
        { id: true },
        { id: false },
        { id: null },
        { id: undefined },
        { id: [12345] },
        { id: { key: 12345 } },
      ];
      for (const payload of invalid) {
        const result = productUpdateWebhookPayloadSchema.safeParse(payload);
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
        [1, 2, 3],
      ];
      for (const payload of invalid) {
        const result = productUpdateWebhookPayloadSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("Route action execution", () => {
    it("returns 401 when authenticate.webhook rejects with 401 (INV-6)", async () => {
      vi.spyOn(getShopify().authenticate, "webhook").mockRejectedValueOnce(
        new Response(null, { status: 401 }),
      );

      const request = new Request("https://example.com/webhooks/products/update", {
        method: "POST",
      });

      const response = await action(createActionArgs(request));
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.error?.code).toBe("UNAUTHORIZED");
      expect(json.error?.message).toBe("Webhook verification failed");
    });

    it("returns 400 when authenticate.webhook rejects with 400", async () => {
      vi.spyOn(getShopify().authenticate, "webhook").mockRejectedValueOnce(
        new Response(null, { status: 400 }),
      );

      const request = new Request("https://example.com/webhooks/products/update", {
        method: "POST",
      });

      const response = await action(createActionArgs(request));
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error?.code).toBe("BAD_REQUEST");
    });

    it("rethrows non-Response errors from authenticate.webhook", async () => {
      vi.spyOn(getShopify().authenticate, "webhook").mockRejectedValueOnce(
        new Error("Network timeout"),
      );

      const request = new Request("https://example.com/webhooks/products/update", {
        method: "POST",
      });

      await expect(action(createActionArgs(request))).rejects.toThrow("Network timeout");
    });

    it("returns 400 and logs error code only on malformed payloads (INV-6)", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const invalidPayloads = [
        {},
        { id: 0 },
        { id: -1 },
        { id: "" },
        { id: null },
        { title: "No id" },
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
          session: undefined,
          admin: undefined,
        });

        const request = new Request("https://example.com/webhooks/products/update", {
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
        expect(json.error?.message).toBe("Invalid product update payload");
      }

      // Assert error logs contain error code and shop only, never dumped payload content
      expect(consoleErrorSpy).toHaveBeenCalled();
      for (const call of consoleErrorSpy.mock.calls) {
        const logged = call.join(" ");
        expect(logged).toContain("MALFORMED_PAYLOAD");
        expect(logged).toContain(shop);
        expect(logged).not.toContain("No id");
      }

      // Assert console.log was never called with any raw payload dump
      for (const call of consoleLogSpy.mock.calls) {
        const logged = call.join(" ");
        expect(logged).not.toContain("No id");
      }
    });

    it("processes valid payload, logs product ID only, and returns 200", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const payload = {
        id: 7891234567890,
        title: "Wayfarer Classic",
        sensitive_data: "should_not_be_dumped_to_console",
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

      const request = new Request("https://example.com/webhooks/products/update", {
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

      // Verify safe logging: contains shop, topic, and payload.id only
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Received ${topic} webhook for ${shop}, product id: 7891234567890`,
      );

      // Verify raw payload content is NEVER dumped
      for (const call of consoleLogSpy.mock.calls) {
        const logged = call.join(" ");
        expect(logged).not.toContain("sensitive_data");
        expect(logged).not.toContain("should_not_be_dumped_to_console");
        expect(logged).not.toContain("Wayfarer Classic");
      }
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("Anti-dumping check (Static analysis)", () => {
    it("route does not dump raw JSON.stringify(payload) or import direct database module", () => {
      const filePath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "webhooks.products.update.tsx",
      );
      const content = fs.readFileSync(filePath, "utf-8");

      expect(content).not.toContain("JSON.stringify(payload");
      expect(content).not.toContain(["db", "server"].join("."));
      expect(content).toContain("productUpdateWebhookPayloadSchema");
    });
  });
});
