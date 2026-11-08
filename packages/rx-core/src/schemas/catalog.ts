import { z } from "zod";
import { prescriptionSchema } from "./prescription.js";
import {
  diopterSchema,
  moneySchema,
  rxTypeSchema,
} from "./units.js";

export const idSchema = z.string().min(1);

export const rxLimitsSchema = z.object({
  sphMin: diopterSchema,
  sphMax: diopterSchema,
  cylMin: diopterSchema,
  cylMax: diopterSchema,
  addMin: diopterSchema.optional(),
  addMax: diopterSchema.optional(),
  rxTypes: z.array(rxTypeSchema),
});
export type RxLimits = z.infer<typeof rxLimitsSchema>;

export const lensSchema = z.object({
  id: idSchema,
  groupId: idSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  price: moneySchema,
  limits: rxLimitsSchema,
  labCodeTemplate: z.string(),
  shopifyVariantId: idSchema,
  position: z.number().int().nonnegative(),
});
export type Lens = z.infer<typeof lensSchema>;

export const lensGroupSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  position: z.number().int().nonnegative(),
  lenses: z.array(lensSchema),
});
export type LensGroup = z.infer<typeof lensGroupSchema>;

export const OPTION_GROUP_KINDS = ["MATERIAL", "TINT_TYPE", "COLOR"] as const;
export const optionGroupKindSchema = z.enum(OPTION_GROUP_KINDS);
export type OptionGroupKind = z.infer<typeof optionGroupKindSchema>;

export const optionValueSchema = z.object({
  id: idSchema,
  optionGroupId: idSchema,
  label: z.string().min(1),
  priceDelta: moneySchema,
  tokenKey: z.string().min(1).optional(),
  tokenValue: z.string().min(1).optional(),
  overrideCode: z.string().min(1).optional(),
  swatch: z.string().min(1).optional(),
  shopifyVariantId: idSchema.optional(),
  position: z.number().int().nonnegative(),
});
export type OptionValue = z.infer<typeof optionValueSchema>;

export const optionGroupSchema = z.object({
  id: idSchema,
  kind: optionGroupKindSchema,
  name: z.string().min(1),
  position: z.number().int().nonnegative(),
  values: z.array(optionValueSchema),
});
export type OptionGroup = z.infer<typeof optionGroupSchema>;

export const addOnSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  price: moneySchema,
  shopifyVariantId: idSchema,
  position: z.number().int().nonnegative(),
});
export type AddOn = z.infer<typeof addOnSchema>;

export const catalogSettingsSchema = z.object({
  manualRxEnabled: z.boolean(),
  rxUploadEnabled: z.boolean(),
  storeRxInOrder: z.boolean(),
});
export type CatalogSettings = z.infer<typeof catalogSettingsSchema>;

export const catalogResponseSchema = z.object({
  lensGroups: z.array(lensGroupSchema),
  optionGroups: z.array(optionGroupSchema),
  addOns: z.array(addOnSchema),
  settings: catalogSettingsSchema,
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

export const selectionSchema = z.object({
  frameVariantId: idSchema,
  rxType: rxTypeSchema,
  prescriptionRef: idSchema.optional(),
  lensId: idSchema.optional(),
  optionValueIds: z.array(idSchema),
  addOnIds: z.array(idSchema),
});
export type Selection = z.infer<typeof selectionSchema>;

export const prescriptionSubmitBodySchema = z.object({
  rxType: rxTypeSchema,
  prescription: prescriptionSchema.optional(),
  draftId: idSchema.optional(),
  uploadedKeys: z.array(idSchema).optional(),
});
export type PrescriptionSubmitBody = z.infer<typeof prescriptionSubmitBodySchema>;

export const uploadUrlRequestSchema = z.object({
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  draftId: idSchema.optional(),
});
export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;
