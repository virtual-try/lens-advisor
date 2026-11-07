import type { Diopter } from "../schemas/units.js";
import { padDecimal, splitScaledInteger } from "./scaled-integer.js";

const HUNDREDTHS = 100;

/**
 * Format integer hundredths of a diopter. Zero SPH is plano (`PL`);
 * non-zero values always include an explicit sign and two decimals.
 */
export function formatDiopter(hundredths: Diopter): string {
  if (hundredths === 0) {
    return "PL";
  }
  const { negative, whole, frac } = splitScaledInteger(hundredths, HUNDREDTHS);
  const sign = negative ? "-" : "+";
  return `${sign}${whole}.${padDecimal(frac, 2)}`;
}
