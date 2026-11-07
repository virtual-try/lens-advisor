import type { Axis } from "../schemas/units.js";

/**
 * Format an axis as the optical three-digit string (`1` → `001`, `180` → `180`).
 */
export function formatAxis(axisDegrees: Axis): string {
  return String(axisDegrees).padStart(3, "0");
}
