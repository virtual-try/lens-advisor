import { z } from "zod";
import {
  diopterSchema,
  iso4217CurrencySchema,
  optionGroupKindSchema,
  rxTypeSchema,
} from "../../../packages/rx-core/src/index.js";
import { BadRequestError, type FieldError } from "../../shared/http/errors.server";

export class ValidationError extends BadRequestError {
  constructor(codeOrMessage: string, messageOrCode?: string, fields?: FieldError[]) {
    if (/^[A-Z][A-Z0-9_]+$/.test(codeOrMessage)) {
      super(messageOrCode ?? codeOrMessage, codeOrMessage, fields);
    } else if (messageOrCode && /^[A-Z][A-Z0-9_]+$/.test(messageOrCode)) {
      super(codeOrMessage, messageOrCode, fields);
    } else {
      super(codeOrMessage, "INVALID_INPUT", fields);
    }
    this.name = "ValidationError";
  }
}

export function mapZodIssueToCode(issue: z.ZodIssue): string {
  if (/^[A-Z][A-Z0-9_]+$/.test(issue.message)) {
    return issue.message;
  }

  if (
    issue.path.some((p) => String(p).toLowerCase().includes("currency")) ||
    issue.message.toLowerCase().includes("currency") ||
    issue.message.toLowerCase().includes("iso-4217")
  ) {
    return "INVALID_CURRENCY";
  }

  if (issue.code === z.ZodIssueCode.invalid_type) {
    if (issue.received === "undefined") {
      return "REQUIRED";
    }
    if (issue.expected === "integer" || issue.message.toLowerCase().includes("integer")) {
      return "NOT_INTEGER";
    }
  }

  if (issue.code === z.ZodIssueCode.too_small) {
    if (issue.type === "string" && issue.minimum === 1) {
      return "REQUIRED";
    }
    if (issue.type === "array" && issue.minimum === 1) {
      return "REQUIRED";
    }
    if (issue.type === "number") {
      return "NEGATIVE_PRICE";
    }
  }

  const lowerMsg = issue.message.toLowerCase();
  if (lowerMsg.includes("integer")) {
    return "NOT_INTEGER";
  }
  if (lowerMsg.includes("negative")) {
    return "NEGATIVE_PRICE";
  }
  if (lowerMsg.includes("required")) {
    return "REQUIRED";
  }

  return "INVALID_INPUT";
}

export function validateInput<TOutput>(
  schema: z.ZodType<TOutput, z.ZodTypeDef, unknown>,
  data: unknown,
): TOutput {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const code = mapZodIssueToCode(firstIssue);
    const fields: FieldError[] = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: mapZodIssueToCode(issue),
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
    priceMinor: z
      .number({ required_error: "Price is required" })
      .int({ message: "Price must be an integer" }),
    currency: iso4217CurrencySchema.optional().default("USD"),
    price: z.unknown().optional(),
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
    if (val.price !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INVALID_INPUT",
        path: ["price"],
      });
    }
    if (val.priceMinor !== undefined && val.priceMinor < 0) {
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
    price: z.unknown().optional(),
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
    if (val.price !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INVALID_INPUT",
        path: ["price"],
      });
    }
    if (val.priceMinor !== undefined && val.priceMinor < 0) {
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
    priceDeltaMinor: z
      .number()
      .int({ message: "Price delta must be an integer" })
      .optional()
      .default(0),
    currency: iso4217CurrencySchema.optional().default("USD"),
    priceDelta: z.unknown().optional(),
    tokenKey: z.string().trim().min(1).optional().nullable(),
    tokenValue: z.string().trim().min(1).optional().nullable(),
    overrideCode: z.string().trim().min(1).optional().nullable(),
    swatch: z.string().trim().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.priceDelta !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INVALID_INPUT",
        path: ["priceDelta"],
      });
    }
    if (val.priceDeltaMinor !== undefined && val.priceDeltaMinor < 0) {
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
    priceDelta: z.unknown().optional(),
    tokenKey: z.string().trim().min(1).optional().nullable(),
    tokenValue: z.string().trim().min(1).optional().nullable(),
    overrideCode: z.string().trim().min(1).optional().nullable(),
    swatch: z.string().trim().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.priceDelta !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INVALID_INPUT",
        path: ["priceDelta"],
      });
    }
    if (val.priceDeltaMinor !== undefined && val.priceDeltaMinor < 0) {
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
    priceMinor: z
      .number({ required_error: "Price is required" })
      .int({ message: "Price must be an integer" }),
    currency: iso4217CurrencySchema.optional().default("USD"),
    price: z.unknown().optional(),
    shopifyProductId: z.string().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.price !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INVALID_INPUT",
        path: ["price"],
      });
    }
    if (val.priceMinor !== undefined && val.priceMinor < 0) {
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
    price: z.unknown().optional(),
    shopifyProductId: z.string().min(1).optional().nullable(),
    shopifyVariantId: z.string().min(1).optional().nullable(),
    position: z.number().int().nonnegative().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.price !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INVALID_INPUT",
        path: ["price"],
      });
    }
    if (val.priceMinor !== undefined && val.priceMinor < 0) {
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

// ---------------------------------------------------------------------------
// Action Boundary Schemas
// ---------------------------------------------------------------------------

export const createGroupActionSchema = z.object({
  intent: z.literal("create_group"),
  name: z
    .string({ required_error: "Group name is required", invalid_type_error: "Group name is required" })
    .trim()
    .min(1, "Group name is required"),
  kind: optionGroupKindSchema,
});

export const deleteGroupActionSchema = z.object({
  intent: z.literal("delete_group"),
  groupId: z.string({ required_error: "Group ID is required" }).trim().min(1, "Group ID is required"),
});

export const reorderIdsSchema = z.union([
  z.array(z.string().min(1)),
  z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string" && item.length > 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ids must be an array of strings" });
        return z.NEVER;
      }
      return parsed;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid JSON for ids" });
      return z.NEVER;
    }
  }),
]);

export const reorderGroupsActionSchema = z.object({
  intent: z.literal("reorder_groups"),
  ids: reorderIdsSchema,
});

export const reorderValuesActionSchema = z.object({
  intent: z.literal("reorder_values"),
  ids: reorderIdsSchema,
  optionGroupId: z.string().trim().min(1).optional(),
});

export const reorderAddOnsActionSchema = z.object({
  intent: z.literal("reorder_add_ons"),
  ids: reorderIdsSchema,
});

export const deleteOptionValueActionSchema = z.object({
  intent: z.literal("delete_option_value"),
  id: z.string({ required_error: "ID is required" }).trim().min(1, "ID is required"),
});

export const deleteAddOnActionSchema = z.object({
  intent: z.literal("delete_add_on"),
  id: z.string({ required_error: "ID is required" }).trim().min(1, "ID is required"),
});

export const retrySyncActionSchema = z.object({
  intent: z.literal("retry_sync"),
  entity: z.enum(["optionValue", "addOn"]),
  id: z.string({ required_error: "ID is required" }).trim().min(1, "ID is required"),
});

export const optionValueActionSchema = z.object({
  intent: z
    .enum(["save", "delete", "archive"], {
      errorMap: () => ({ message: "UNKNOWN_INTENT" }),
    })
    .optional(),
  label: z.string().trim().optional(),
  priceDeltaMinor: z
    .number({ invalid_type_error: "Price delta must be an integer" })
    .int({ message: "Price delta must be an integer" })
    .min(0, "Price delta must be at least 0")
    .optional(),
  priceDelta: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
  optionGroupId: z.string().trim().min(1).optional(),
  token: z.string().optional(),
  tokenKey: z.string().optional(),
  tokenValue: z.string().optional(),
  overrideCode: z.string().optional(),
  swatch: z.string().optional(),
});

export const addOnActionSchema = z.object({
  intent: z
    .enum(["save", "delete", "archive"], {
      errorMap: () => ({ message: "UNKNOWN_INTENT" }),
    })
    .optional(),
  name: z.string().trim().optional(),
  priceMinor: z
    .number({ invalid_type_error: "Price must be an integer" })
    .int({ message: "Price must be an integer" })
    .min(0, "Price must be at least 0")
    .optional(),
  price: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
});
