import type {
  Eye,
  Lens,
  Prescription,
  RxLimits,
  RxType,
} from "../types/index.js";
import { transposeEye } from "./transpose.js";
import type {
  CheckLensResult,
  LimitExceededEye,
  LimitExceededReason,
} from "./types.js";

function normalizeEyeForLimits(eye: Eye): Eye {
  if (eye.cyl !== undefined && eye.cyl > 0) {
    return transposeEye(eye);
  }
  return eye;
}

function checkEye(
  eye: Eye,
  eyeSide: LimitExceededEye,
  limits: RxLimits,
): LimitExceededReason | null {
  // SPH check: min and max inclusive
  if (eye.sph < limits.sphMin) {
    return {
      code: "SPH_BELOW_MIN",
      field: "sph",
      eye: eyeSide,
      value: eye.sph,
      limit: limits.sphMin,
    };
  }
  if (eye.sph > limits.sphMax) {
    return {
      code: "SPH_ABOVE_MAX",
      field: "sph",
      eye: eyeSide,
      value: eye.sph,
      limit: limits.sphMax,
    };
  }

  // CYL check: min and max inclusive
  const cyl = eye.cyl ?? 0;
  if (cyl < limits.cylMin) {
    return {
      code: "CYL_OUT_OF_RANGE",
      field: "cyl",
      eye: eyeSide,
      value: cyl,
      limit: limits.cylMin,
    };
  }
  if (cyl > limits.cylMax) {
    return {
      code: "CYL_OUT_OF_RANGE",
      field: "cyl",
      eye: eyeSide,
      value: cyl,
      limit: limits.cylMax,
    };
  }

  // ADD check: "Missing ADD limits mean 'no ADD restriction'."
  if (eye.add !== undefined) {
    if (limits.addMin !== undefined && eye.add < limits.addMin) {
      return {
        code: "ADD_OUT_OF_RANGE",
        field: "add",
        eye: eyeSide,
        value: eye.add,
        limit: limits.addMin,
      };
    }
    if (limits.addMax !== undefined && eye.add > limits.addMax) {
      return {
        code: "ADD_OUT_OF_RANGE",
        field: "add",
        eye: eyeSide,
        value: eye.add,
        limit: limits.addMax,
      };
    }
  }

  return null;
}

/**
 * Checks whether a lens can accommodate a given prescription and RxType.
 *
 * Checks in fixed order:
 * 1. rx type
 * 2. OD SPH
 * 3. OD CYL
 * 4. OD ADD
 * 5. OS SPH
 * 6. OS CYL
 * 7. OS ADD
 */
export function checkLens(
  rx: Prescription | undefined | null,
  rxType: RxType,
  lens: Lens | { limits: RxLimits },
): CheckLensResult {
  const { limits } = lens;

  // 1. Check Rx Type
  if (!limits.rxTypes.includes(rxType)) {
    return {
      available: false,
      reason: {
        code: "RX_TYPE_NOT_SUPPORTED",
        field: "rxType",
        eye: undefined,
        value: rxType,
        limit: limits.rxTypes,
      },
    };
  }

  // 2. Non-prescription has no Rx to check
  if (rxType === "NON_PRESCRIPTION") {
    return { available: true };
  }

  if (!rx) {
    return { available: true };
  }

  // 3. OD checks
  const od = normalizeEyeForLimits(rx.od);
  const odReason = checkEye(od, "OD", limits);
  if (odReason) {
    return { available: false, reason: odReason };
  }

  // 4. OS checks
  const os = normalizeEyeForLimits(rx.os);
  const osReason = checkEye(os, "OS", limits);
  if (osReason) {
    return { available: false, reason: osReason };
  }

  return { available: true };
}
