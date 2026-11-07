import type { Lens, Prescription, RxType } from "../types/index.js";
import { checkLens } from "./check-lens.js";
import type { FilteredLens } from "./types.js";

/**
 * Filter lenses for a given prescription and RxType.
 * Preserves the exact input order of lenses (determinism).
 * Each element in the returned list contains the lens and its check result.
 */
export function filterLenses(
  rx: Prescription | undefined | null,
  rxType: RxType,
  lenses: readonly Lens[],
): FilteredLens[] {
  return lenses.map((lens) => {
    const result = checkLens(rx, rxType, lens);
    return {
      lens,
      result,
      available: result.available,
      ...(result.available ? {} : { reason: result.reason }),
    };
  });
}
