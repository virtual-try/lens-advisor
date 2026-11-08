import { describe, expect, it } from "vitest";
import {
  parseProductData,
  productDataSchema,
  productVariantDataSchema,
} from "./types";

describe("product types and schema parsing (R3-F2)", () => {
  it("normalises numeric Shopify IDs to strings in the exact liquid block payload shape", () => {
    // Literal JSON emitted by select-lenses.liquid:
    // {"productId":{{ product.id | json }},"variantIds":[...],"priceMinor":...,"currency":...,"variants":[{"id":{{ variant.id | json }},"priceMinor":...}]}
    const liquidPayload = {
      productId: 7891234567890,
      variantIds: [45678901234567, 45678901234568],
      priceMinor: 12900,
      currency: "USD",
      variants: [
        { id: 45678901234567, priceMinor: 12900 },
        { id: 45678901234568, priceMinor: 14900 },
      ],
    };

    const parsed = parseProductData(liquidPayload);
    expect(parsed).toBeDefined();
    expect(parsed?.productId).toBe("7891234567890");
    expect(typeof parsed?.productId).toBe("string");
    expect(parsed?.variantIds).toEqual(["45678901234567", "45678901234568"]);
    expect(typeof parsed?.variantIds?.[0]).toBe("string");
    expect(parsed?.priceMinor).toBe(12900);
    expect(parsed?.currency).toBe("USD");
    expect(parsed?.variants).toHaveLength(2);
    expect(parsed?.variants?.[0]?.id).toBe("45678901234567");
    expect(typeof parsed?.variants?.[0]?.id).toBe("string");
    expect(parsed?.variants?.[0]?.priceMinor).toBe(12900);
    expect(parsed?.variants?.[1]?.id).toBe("45678901234568");
    expect(typeof parsed?.variants?.[1]?.id).toBe("string");
  });

  it("parses string serialized JSON from data-product-json attribute", () => {
    const rawJson = JSON.stringify({
      productId: 99887766,
      variantId: 11223344,
      title: "Aviator Classic",
      priceMinor: 15000,
      currency: "EUR",
      variants: [{ id: 11223344, priceMinor: 15000, title: "Gold / 58mm" }],
    });

    const parsed = parseProductData(rawJson);
    expect(parsed).toEqual({
      productId: "99887766",
      variantId: "11223344",
      title: "Aviator Classic",
      priceMinor: 15000,
      currency: "EUR",
      variants: [{ id: "11223344", priceMinor: 15000, title: "Gold / 58mm" }],
    });
  });

  it("preserves string IDs without alteration", () => {
    const parsed = parseProductData({
      id: "prod-alpha",
      productId: "gid://shopify/Product/123",
      variantId: "gid://shopify/ProductVariant/456",
      variants: [{ id: "var-custom-1" }],
    });
    expect(parsed?.id).toBe("prod-alpha");
    expect(parsed?.productId).toBe("gid://shopify/Product/123");
    expect(parsed?.variantId).toBe("gid://shopify/ProductVariant/456");
    expect(parsed?.variants?.[0]?.id).toBe("var-custom-1");
  });

  it("falls back to undefined (no-product state) on null, undefined, or empty string", () => {
    expect(parseProductData(null)).toBeUndefined();
    expect(parseProductData(undefined)).toBeUndefined();
    expect(parseProductData("")).toBeUndefined();
    expect(parseProductData("   ")).toBeUndefined();
  });

  it("falls back to undefined on malformed JSON", () => {
    expect(parseProductData("{invalid json")).toBeUndefined();
    expect(parseProductData("true")).toBeUndefined();
    expect(parseProductData("123")).toBeUndefined();
  });

  it("falls back to undefined on schema validation failures", () => {
    // Empty id string
    expect(parseProductData({ id: "" })).toBeUndefined();
    expect(parseProductData({ id: "   " })).toBeUndefined();
    // Non-finite number
    expect(parseProductData({ id: NaN })).toBeUndefined();
    expect(parseProductData({ id: Infinity })).toBeUndefined();
    // Invalid variant id
    expect(parseProductData({ variants: [{ id: "" }] })).toBeUndefined();
    // Null field
    expect(parseProductData({ productId: null })).toBeUndefined();
    // Non-array variantIds
    expect(parseProductData({ variantIds: "not-an-array" })).toBeUndefined();
  });

  it("validates individual variant data with productVariantDataSchema", () => {
    const valid = productVariantDataSchema.parse({
      id: 554433,
      priceMinor: 4900,
      title: "Matte Black",
    });
    expect(valid.id).toBe("554433");
    expect(typeof valid.id).toBe("string");

    expect(() => productVariantDataSchema.parse({ id: "" })).toThrow();
    expect(() => productVariantDataSchema.parse({ id: null })).toThrow();
  });

  it("validates product data with productDataSchema", () => {
    const parsed = productDataSchema.parse({
      productId: 100,
      variantIds: [200, 300],
    });
    expect(parsed.productId).toBe("100");
    expect(parsed.variantIds).toEqual(["200", "300"]);
  });
});
