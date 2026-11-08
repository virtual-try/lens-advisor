import type { Pd } from "../schemas/prescription.js";
import type { PdTenthsMm } from "../schemas/units.js";
import { padDecimal, splitScaledInteger } from "./scaled-integer.js";

const TENTHS = 10;

function formatTenthsMm(tenthsMm: PdTenthsMm): string {
  const { negative, whole, frac } = splitScaledInteger(tenthsMm, TENTHS);
  const sign = negative ? "-" : "";
  return `${sign}${whole}.${padDecimal(frac, 1)}`;
}

/**
 * Format PD in millimetres from integer tenths. Dual PD is `od/os`.
 */
export function formatPd(pd: Pd): string {
  if ("single" in pd) {
    return formatTenthsMm(pd.single);
  }
  return `${formatTenthsMm(pd.od)}/${formatTenthsMm(pd.os)}`;
}
