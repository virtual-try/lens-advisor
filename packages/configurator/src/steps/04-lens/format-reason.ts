import type { Diopter } from "../../../../rx-core/src/index.js";
import { formatDiopter } from "../../../../rx-core/src/index.js";
import type { LimitExceededReason } from "../../../../rx-core/src/limits/types.js";
import { lensStrings } from "./strings.js";

/**
 * Formats integer hundredths of a diopter through rx-core's formatDiopter (INV-5),
 * normalizing ASCII hyphen to typographic minus (U+2212).
 */
export function formatReasonDiopter(hundredths: Diopter): string {
  return formatDiopter(hundredths).replace(/-/g, "−");
}

/**
 * Formats a structured LimitExceededReason into human-readable text
 * using strings.ts templates and formatReasonDiopter.
 */
export function formatLensReason(reason: LimitExceededReason): string {
  switch (reason.code) {
    case "SPH_BELOW_MIN":
      return lensStrings.reasons.sphBelowMin(
        formatReasonDiopter(reason.value),
        formatReasonDiopter(reason.limit),
      );
    case "SPH_ABOVE_MAX":
      return lensStrings.reasons.sphAboveMax(
        formatReasonDiopter(reason.value),
        formatReasonDiopter(reason.limit),
      );
    case "CYL_OUT_OF_RANGE":
      return lensStrings.reasons.cylOutOfRange(
        formatReasonDiopter(reason.value),
        formatReasonDiopter(reason.limit),
      );
    case "ADD_OUT_OF_RANGE":
      return lensStrings.reasons.addOutOfRange(
        formatReasonDiopter(reason.value),
        formatReasonDiopter(reason.limit),
      );
    case "RX_TYPE_NOT_SUPPORTED":
      return lensStrings.reasons.rxTypeNotSupported;
    default:
      return lensStrings.reasons.generic;
  }
}
