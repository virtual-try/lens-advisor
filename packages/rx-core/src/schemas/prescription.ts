import { z } from "zod";
import {
  axisSchema,
  diopterSchema,
  pdTenthsMmSchema,
} from "./units.js";

export const eyeSchema = z.object({
  sph: diopterSchema,
  cyl: diopterSchema.optional(),
  axis: axisSchema.optional(),
  add: diopterSchema.optional(),
});
export type Eye = z.infer<typeof eyeSchema>;

export const pdSchema = z.union([
  z.object({
    single: pdTenthsMmSchema,
  }),
  z.object({
    od: pdTenthsMmSchema,
    os: pdTenthsMmSchema,
  }),
]);
export type Pd = z.infer<typeof pdSchema>;

export const prescriptionSchema = z.object({
  od: eyeSchema,
  os: eyeSchema,
  pd: pdSchema,
  notes: z.string().optional(),
});
export type Prescription = z.infer<typeof prescriptionSchema>;
