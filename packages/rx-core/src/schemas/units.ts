import { z } from "zod";

/** Signed integer hundredths of a diopter (−2.25 D → -225). */
export const diopterSchema = z.number().int();
export type Diopter = z.infer<typeof diopterSchema>;

/** Integer axis in degrees, inclusive 1–180. */
export const axisSchema = z.number().int().min(1).max(180);
export type Axis = z.infer<typeof axisSchema>;

/** Integer tenths of a millimetre (63.5 mm → 635). */
export const pdTenthsMmSchema = z.number().int();
export type PdTenthsMm = z.infer<typeof pdTenthsMmSchema>;

/** ISO 4217 alphabetic code (USD, EUR, JPY). */
export const iso4217CurrencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/);

export const moneySchema = z.object({
  amountMinor: z.number().int(),
  currency: iso4217CurrencySchema,
});
export type Money = z.infer<typeof moneySchema>;

export const RX_TYPES = [
  "SINGLE_VISION",
  "PROGRESSIVE",
  "READING",
  "NON_PRESCRIPTION",
] as const;

export const rxTypeSchema = z.enum(RX_TYPES);
export type RxType = z.infer<typeof rxTypeSchema>;
