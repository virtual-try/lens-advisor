import { z } from "zod";

const normalizedIdSchema = z
  .union([
    z.string().trim().min(1),
    z.number().refine(Number.isFinite, "ID must be a finite number").transform((n) => String(n)),
  ])
  .transform((val) => (typeof val === "string" ? val.trim() : String(val)));

export const productVariantDataSchema = z.object({
  id: normalizedIdSchema,
  priceMinor: z.number().int().optional(),
  title: z.string().optional(),
});
export type ProductVariantData = z.output<typeof productVariantDataSchema>;
export type ProductVariantDataInput = z.input<typeof productVariantDataSchema>;

export const productDataSchema = z.object({
  id: normalizedIdSchema.optional(),
  productId: normalizedIdSchema.optional(),
  title: z.string().optional(),
  variantId: normalizedIdSchema.optional(),
  variantIds: z.array(normalizedIdSchema).optional(),
  priceMinor: z.number().int().optional(),
  currency: z.string().optional(),
  variants: z.array(productVariantDataSchema).optional(),
});
export type ProductData = z.output<typeof productDataSchema>;
export type ProductDataInput = z.input<typeof productDataSchema>;

export function parseProductData(raw: unknown): ProductData | undefined {
  if (raw === null || raw === undefined) return undefined;
  let parsedJson: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim().length === 0) return undefined;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  const result = productDataSchema.safeParse(parsedJson);
  if (!result.success) {
    return undefined;
  }
  return result.data;
}
