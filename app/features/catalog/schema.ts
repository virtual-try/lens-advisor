import { z } from "zod";
import {
  diopterSchema,
  iso4217CurrencySchema,
  moneySchema,
  optionGroupKindSchema,
  rxTypeSchema,
} from "../../../packages/rx-core/src/index.js";
import { BadRequestError, type FieldError } from "../../shared/http/errors.server";

export class ValidationError extends BadRequestError {
  constructor(codeOrMessage: string, messageOrCode?: string, fields?: FieldError[]) {
    if (/^[A-Z][A-Z0-9_]+$/.test(codeOrMessage)) {
      super(messageOrCode ?? codeOrMessage, codeOrMessage, fields);
    } else {
      super(codeOrMessage, messageOrCode ?? "VALIDATION_ERROR", fields);
    }
    this.name = "ValidationError";
  }
}

export function validateInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const code = firstIssue.message || firstIssue.code;
    const fields: FieldError[] = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.message || issue.code,
    }));
    throw new ValidationError(code, firstIssue.message, fields);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Lens Group Schemas
// ---------------------------------------------------------------------------

export const lensGroupInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: z.string().optional().default(""),
  position: z.number().int().nonnegative().optional(),
});
export type LensGroupInput = z.input<typeof lensGroupInputSchema>;

export const lensGroupUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").optional(),
  description: z.string().optional(),
  position: z.number().int().nonnegative().optional(),
});
export type LensGroupUpdateInput = z.input<typeof lensGroupUpdateSchema>;

// ---------------------------------------------------------------------------
// Lens Schemas
// ---------------------------------------------------------------------------

function checkLimits(
  sphMin: number | undefined,
  sphMax: number | undefined,
  cylMin: number | undefined,
  cylMax: number | undefined,
  addMin: number | undefined | null,
  addMax: number | undefined | null,
  ctx: z.RefinementCtx,
): void {
  if (sphMin !== undefined && sphMax !== undefined && sphMin > sphMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "LIMITS_INVERTED",
      path: ["sphMax"],
    });
  }
  if (cylMin !== undefined && cylMax !== undefined && cylMin > cylMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "LIMITS_INVERTED",
      path: ["cylMax"],
    });
  }
  if (
    addMin !== undefined &&
    addMin !== null &&
    addMax !== undefined &&
    addMax !== null &&
    addMin > addMax
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "LIMITS_INVERTED",
      path: ["addMax"],
    });
  }
}

export const lensInputSchema = z
  .object({
    groupId: z.string().min(1, "Group ID is required"),
    name: z.string().trim().min(1, "Name is required"),
    description: z.string().optional().default(""),
    priceMinor: z.number().int({ message: "Price must be an integer" }).optional(),
    currency: iso4217CurrencySchema.optional().default("USD"),
    price: moneySchema.optional(),
    rxTypes: z.array(rxTypeSchema).min(1, "At least one Rx type is required"),
    sphMin: diopterSchema,
    sphMax: diopterSchema,
    cylMin: diopterSchema,
    cylMax: diopterSchema,
    addMin: diopterSchema.optional().nullable(),
    addMax: diopterSchema.optional().nullable(),
    labCodeTemplate: z.string().default(""),
    shopifyProductId: z.string().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    const priceAmount = val.priceMinor ?? val.price?.amountMinor;
    if (priceAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Price is required",
        path: ["priceMinor"],
      });
    } else if (priceAmount < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NEGATIVE_PRICE",
        path: ["priceMinor"],
      });
    }
    checkLimits(val.sphMin, val.sphMax, val.cylMin, val.cylMax, val.addMin, val.addMax, ctx);
  });
export type LensInput = z.input<typeof lensInputSchema>;

export const lensUpdateSchema = z
  .object({
    groupId: z.string().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    description: z.string().optional(),
    priceMinor: z.number().int({ message: "Price must be an integer" }).optional(),
    currency: iso4217CurrencySchema.optional(),
    price: moneySchema.optional(),
    rxTypes: z.array(rxTypeSchema).min(1).optional(),
    sphMin: diopterSchema.optional(),
    sphMax: diopterSchema.optional(),
    cylMin: diopterSchema.optional(),
    cylMax: diopterSchema.optional(),
    addMin: diopterSchema.optional().nullable(),
    addMax: diopterSchema.optional().nullable(),
    labCodeTemplate: z.string().optional(),
    shopifyProductId: z.string().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    const priceAmount = val.priceMinor ?? val.price?.amountMinor;
    if (priceAmount !== undefined && priceAmount < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NEGATIVE_PRICE",
        path: ["priceMinor"],
      });
    }
    checkLimits(val.sphMin, val.sphMax, val.cylMin, val.cylMax, val.addMin, val.addMax, ctx);
  });
export type LensUpdateInput = z.input<typeof lensUpdateSchema>;

// ---------------------------------------------------------------------------
// Option Group Schemas
// ---------------------------------------------------------------------------

export const optionGroupInputSchema = z.object({
  kind: optionGroupKindSchema,
  name: z.string().trim().min(1, "Name is required"),
  position: z.number().int().nonnegative().optional(),
});
export type OptionGroupInput = z.input<typeof optionGroupInputSchema>;

export const optionGroupUpdateSchema = z.object({
  kind: optionGroupKindSchema.optional(),
  name: z.string().trim().min(1).optional(),
  position: z.number().int().nonnegative().optional(),
});
export type OptionGroupUpdateInput = z.input<typeof optionGroupUpdateSchema>;

// ---------------------------------------------------------------------------
// Option Value Schemas
// ---------------------------------------------------------------------------

export const optionValueInputSchema = z
  .object({
    optionGroupId: z.string().min(1, "Option group ID is required"),
    label: z.string().trim().min(1, "Label is required"),
    priceDeltaMinor: z.number().int({ message: "Price delta must be an integer" }).optional().default(0),
    currency: iso4217CurrencySchema.optional().default("USD"),
    priceDelta: moneySchema.optional(),
    tokenKey: z.string().trim().min(1).optional().nullable(),
    tokenValue: z.string().trim().min(1).optional().nullable(),
    overrideCode: z.string().trim().min(1).optional().nullable(),
    swatch: z.string().trim().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    const delta = val.priceDeltaMinor ?? val.priceDelta?.amountMinor ?? 0;
    if (delta < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NEGATIVE_PRICE",
        path: ["priceDeltaMinor"],
      });
    }
    const hasToken = Boolean(val.tokenKey || val.tokenValue);
    const hasOverride = Boolean(val.overrideCode);
    if (hasToken && hasOverride) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ONE_CODE_SOURCE",
        path: ["overrideCode"],
      });
    }
  });
export type OptionValueInput = z.input<typeof optionValueInputSchema>;

export const optionValueUpdateSchema = z
  .object({
    optionGroupId: z.string().min(1).optional(),
    label: z.string().trim().min(1).optional(),
    priceDeltaMinor: z.number().int({ message: "Price delta must be an integer" }).optional(),
    currency: iso4217CurrencySchema.optional(),
    priceDelta: moneySchema.optional(),
    tokenKey: z.string().trim().min(1).optional().nullable(),
    tokenValue: z.string().trim().min(1).optional().nullable(),
    overrideCode: z.string().trim().min(1).optional().nullable(),
    swatch: z.string().trim().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    const delta = val.priceDeltaMinor ?? val.priceDelta?.amountMinor;
    if (delta !== undefined && delta < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NEGATIVE_PRICE",
        path: ["priceDeltaMinor"],
      });
    }
    const hasToken = Boolean(val.tokenKey || val.tokenValue);
    const hasOverride = Boolean(val.overrideCode);
    if (hasToken && hasOverride) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ONE_CODE_SOURCE",
        path: ["overrideCode"],
      });
    }
  });
export type OptionValueUpdateInput = z.input<typeof optionValueUpdateSchema>;

// ---------------------------------------------------------------------------
// Add-On Schemas
// ---------------------------------------------------------------------------

export const addOnInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    priceMinor: z.number().int({ message: "Price must be an integer" }).optional(),
    currency: iso4217CurrencySchema.optional().default("USD"),
    price: moneySchema.optional(),
    shopifyProductId: z.string().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    const priceAmount = val.priceMinor ?? val.price?.amountMinor;
    if (priceAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Price is required",
        path: ["priceMinor"],
      });
    } else if (priceAmount < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NEGATIVE_PRICE",
        path: ["priceMinor"],
      });
    }
  });
export type AddOnInput = z.input<typeof addOnInputSchema>;

export const addOnUpdateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    priceMinor: z.number().int({ message: "Price must be an integer" }).optional(),
    currency: iso4217CurrencySchema.optional(),
    price: moneySchema.optional(),
    shopifyProductId: z.string().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    const priceAmount = val.priceMinor ?? val.price?.amountMinor;
    if (priceAmount !== undefined && priceAmount < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "NEGATIVE_PRICE",
        path: ["priceMinor"],
      });
    }
  });
export type AddOnUpdateInput = z.input<typeof addOnUpdateSchema>;

// ---------------------------------------------------------------------------
// Reorder Schema
// ---------------------------------------------------------------------------

export const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "At least one ID is required"),
});
export type ReorderInput = z.input<typeof reorderSchema>;
