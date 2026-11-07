import type { Eye, Prescription, RxType } from "../types/index.js";

/**
 * Closed enumeration of error codes for Rx parsing and validation.
 */
export const RX_VALIDATION_CODES = {
  SPH_RANGE: "SPH_RANGE",
  SPH_STEP: "SPH_STEP",
  SPH_REQUIRED: "SPH_REQUIRED",
  CYL_RANGE: "CYL_RANGE",
  CYL_STEP: "CYL_STEP",
  AXIS_REQUIRED: "AXIS_REQUIRED",
  AXIS_RANGE: "AXIS_RANGE",
  ADD_REQUIRED: "ADD_REQUIRED",
  ADD_RANGE: "ADD_RANGE",
  ADD_STEP: "ADD_STEP",
  PD_REQUIRED: "PD_REQUIRED",
  PD_RANGE: "PD_RANGE",
  PD_STEP: "PD_STEP",
  NON_PRESCRIPTION_NOT_EMPTY: "NON_PRESCRIPTION_NOT_EMPTY",
  INVALID: "INVALID",
} as const;

export const RX_ERROR_CODES = RX_VALIDATION_CODES;

export type RxValidationCode =
  (typeof RX_VALIDATION_CODES)[keyof typeof RX_VALIDATION_CODES];
export type RxErrorCode = RxValidationCode;

export interface RxValidationError {
  field: string;
  eye?: "od" | "os";
  path?: string;
  code: RxValidationCode;
}

function isEmptyPrescription(rx: unknown): boolean {
  if (rx === undefined || rx === null) {
    return true;
  }
  if (
    typeof rx === "object" &&
    !Array.isArray(rx) &&
    (rx.constructor === Object || !rx.constructor) &&
    Reflect.ownKeys(rx).length === 0
  ) {
    return true;
  }
  return false;
}

/**
 * Validate a prescription against clinical rules and the selected RxType.
 * Returns a list of all validation errors (empty list if valid).
 */
export function validatePrescription(
  rx: unknown,
  rxType: RxType,
): RxValidationError[] {
  const errors: RxValidationError[] = [];

  // NON_PRESCRIPTION: prescription must be empty (undefined, null, or {})
  if (rxType === "NON_PRESCRIPTION") {
    if (!isEmptyPrescription(rx)) {
      errors.push({
        field: "prescription",
        path: "prescription",
        code: RX_VALIDATION_CODES.NON_PRESCRIPTION_NOT_EMPTY,
      });
    }
    return errors;
  }

  // Other Rx types require a prescription object
  if (rx == null || typeof rx !== "object" || Array.isArray(rx)) {
    errors.push({
      field: "prescription",
      path: "prescription",
      code: RX_VALIDATION_CODES.INVALID,
    });
    return errors;
  }

  const rxObj = rx as Record<string, unknown>;

  // Check OD and OS eyes
  for (const eyeName of ["od", "os"] as const) {
    const eye = rxObj[eyeName];
    if (!eye || typeof eye !== "object") {
      errors.push({
        field: "sph",
        eye: eyeName,
        path: `${eyeName}.sph`,
        code: RX_VALIDATION_CODES.SPH_REQUIRED,
      });
      continue;
    }

    const eyeObj = eye as Record<string, unknown>;

    // SPH: required, −20.00..+20.00 (-2000..+2000), 0.25 steps (25 hundredths)
    const sph = eyeObj.sph;
    if (sph === undefined || sph === null) {
      errors.push({
        field: "sph",
        eye: eyeName,
        path: `${eyeName}.sph`,
        code: RX_VALIDATION_CODES.SPH_REQUIRED,
      });
    } else if (
      typeof sph !== "number" ||
      !Number.isInteger(sph) ||
      sph % 25 !== 0
    ) {
      errors.push({
        field: "sph",
        eye: eyeName,
        path: `${eyeName}.sph`,
        code: RX_VALIDATION_CODES.SPH_STEP,
      });
    } else if (sph < -2000 || sph > 2000) {
      errors.push({
        field: "sph",
        eye: eyeName,
        path: `${eyeName}.sph`,
        code: RX_VALIDATION_CODES.SPH_RANGE,
      });
    }

    // CYL: optional, −6.00..+6.00 (-600..+600), 0.25 steps
    const cyl = eyeObj.cyl;
    let isCylValidNumber = false;
    let isCylNonZero = false;

    if (cyl !== undefined && cyl !== null) {
      if (
        typeof cyl !== "number" ||
        !Number.isInteger(cyl) ||
        cyl % 25 !== 0
      ) {
        errors.push({
          field: "cyl",
          eye: eyeName,
          path: `${eyeName}.cyl`,
          code: RX_VALIDATION_CODES.CYL_STEP,
        });
      } else if (cyl < -600 || cyl > 600) {
        errors.push({
          field: "cyl",
          eye: eyeName,
          path: `${eyeName}.cyl`,
          code: RX_VALIDATION_CODES.CYL_RANGE,
        });
      } else {
        isCylValidNumber = true;
        isCylNonZero = cyl !== 0;
      }
    }

    // AXIS: required when CYL ≠ 0; absent/ignored when CYL = 0
    const axis = eyeObj.axis;
    if (isCylNonZero) {
      if (axis === undefined || axis === null) {
        errors.push({
          field: "axis",
          eye: eyeName,
          path: `${eyeName}.axis`,
          code: RX_VALIDATION_CODES.AXIS_REQUIRED,
        });
      } else if (
        typeof axis !== "number" ||
        !Number.isInteger(axis) ||
        axis < 1 ||
        axis > 180
      ) {
        errors.push({
          field: "axis",
          eye: eyeName,
          path: `${eyeName}.axis`,
          code: RX_VALIDATION_CODES.AXIS_RANGE,
        });
      }
    } else if (!isCylValidNumber && cyl !== undefined && cyl !== null) {
      // If CYL had an error, still check if AXIS was provided and valid
      if (axis !== undefined && axis !== null) {
        if (
          typeof axis !== "number" ||
          !Number.isInteger(axis) ||
          axis < 1 ||
          axis > 180
        ) {
          errors.push({
            field: "axis",
            eye: eyeName,
            path: `${eyeName}.axis`,
            code: RX_VALIDATION_CODES.AXIS_RANGE,
          });
        }
      }
    }
    // When CYL = 0 or absent, AXIS is ignored / dropped (no error).

    // ADD: required for PROGRESSIVE and READING, +0.75..+3.50 (+75..+350)
    // Ignored for SINGLE_VISION
    const add = eyeObj.add;
    if (rxType === "PROGRESSIVE" || rxType === "READING") {
      if (add === undefined || add === null) {
        errors.push({
          field: "add",
          eye: eyeName,
          path: `${eyeName}.add`,
          code: RX_VALIDATION_CODES.ADD_REQUIRED,
        });
      } else if (
        typeof add !== "number" ||
        !Number.isInteger(add) ||
        add % 25 !== 0
      ) {
        errors.push({
          field: "add",
          eye: eyeName,
          path: `${eyeName}.add`,
          code: RX_VALIDATION_CODES.ADD_STEP,
        });
      } else if (add < 75 || add > 350) {
        errors.push({
          field: "add",
          eye: eyeName,
          path: `${eyeName}.add`,
          code: RX_VALIDATION_CODES.ADD_RANGE,
        });
      }
    }
    // For SINGLE_VISION, ADD is ignored / dropped (no error).
  }

  // PD: single 50.0–80.0 mm (500–800 tenths), or dual 25.0–40.0 mm (250–400 tenths) per eye, 0.5 mm steps (5 tenths)
  const pd = rxObj.pd;
  if (!pd || typeof pd !== "object" || Array.isArray(pd)) {
    errors.push({
      field: "pd",
      path: "pd",
      code: RX_VALIDATION_CODES.PD_REQUIRED,
    });
  } else {
    const pdObj = pd as Record<string, unknown>;
    const hasSingle = pdObj.single !== undefined;
    const hasDual = pdObj.od !== undefined || pdObj.os !== undefined;

    if (hasSingle && hasDual) {
      errors.push({
        field: "pd",
        path: "pd",
        code: RX_VALIDATION_CODES.INVALID,
      });
    } else if (hasSingle) {
      const single = pdObj.single;
      if (
        typeof single !== "number" ||
        !Number.isInteger(single) ||
        single % 5 !== 0
      ) {
        errors.push({
          field: "pd",
          path: "pd.single",
          code: RX_VALIDATION_CODES.PD_STEP,
        });
      } else if (single < 500 || single > 800) {
        errors.push({
          field: "pd",
          path: "pd.single",
          code: RX_VALIDATION_CODES.PD_RANGE,
        });
      }
    } else if (hasDual) {
      const odPd = pdObj.od;
      const osPd = pdObj.os;

      if (odPd === undefined || odPd === null) {
        errors.push({
          field: "pd",
          eye: "od",
          path: "pd.od",
          code: RX_VALIDATION_CODES.PD_REQUIRED,
        });
      } else if (
        typeof odPd !== "number" ||
        !Number.isInteger(odPd) ||
        odPd % 5 !== 0
      ) {
        errors.push({
          field: "pd",
          eye: "od",
          path: "pd.od",
          code: RX_VALIDATION_CODES.PD_STEP,
        });
      } else if (odPd < 250 || odPd > 400) {
        errors.push({
          field: "pd",
          eye: "od",
          path: "pd.od",
          code: RX_VALIDATION_CODES.PD_RANGE,
        });
      }

      if (osPd === undefined || osPd === null) {
        errors.push({
          field: "pd",
          eye: "os",
          path: "pd.os",
          code: RX_VALIDATION_CODES.PD_REQUIRED,
        });
      } else if (
        typeof osPd !== "number" ||
        !Number.isInteger(osPd) ||
        osPd % 5 !== 0
      ) {
        errors.push({
          field: "pd",
          eye: "os",
          path: "pd.os",
          code: RX_VALIDATION_CODES.PD_STEP,
        });
      } else if (osPd < 250 || osPd > 400) {
        errors.push({
          field: "pd",
          eye: "os",
          path: "pd.os",
          code: RX_VALIDATION_CODES.PD_RANGE,
        });
      }
    } else {
      errors.push({
        field: "pd",
        path: "pd",
        code: RX_VALIDATION_CODES.PD_REQUIRED,
      });
    }
  }

  return errors;
}

/**
 * Returns true if the prescription passes all validation rules.
 */
export function isValidPrescription(rx: unknown, rxType: RxType): boolean {
  return validatePrescription(rx, rxType).length === 0;
}

/**
 * Normalize a prescription according to the RxType rules:
 * - Drops AXIS when CYL = 0 or absent.
 * - Drops ADD when RxType is SINGLE_VISION.
 * - For NON_PRESCRIPTION, returns undefined (absent prescription).
 */
export function normalizePrescription(
  rx: unknown,
  rxType: "NON_PRESCRIPTION",
): undefined;
export function normalizePrescription(
  rx: Prescription,
  rxType: Exclude<RxType, "NON_PRESCRIPTION">,
): Prescription;
export function normalizePrescription(
  rx: Prescription | unknown,
  rxType: RxType,
): Prescription | undefined;
export function normalizePrescription(
  rx: Prescription | unknown,
  rxType: RxType,
): Prescription | undefined {
  if (rxType === "NON_PRESCRIPTION") {
    return undefined;
  }

  const typedRx = rx as Prescription;
  const normalizeEye = (eye: Eye): Eye => {
    const result: Eye = { sph: eye.sph };
    const hasCyl = eye.cyl !== undefined && eye.cyl !== 0;
    if (hasCyl) {
      result.cyl = eye.cyl;
      if (eye.axis !== undefined) {
        result.axis = eye.axis;
      }
    }

    if (rxType === "PROGRESSIVE" || rxType === "READING") {
      if (eye.add !== undefined) {
        result.add = eye.add;
      }
    }

    return result;
  };

  const pdResult =
    "single" in typedRx.pd
      ? { single: typedRx.pd.single }
      : { od: typedRx.pd.od, os: typedRx.pd.os };

  return {
    od: normalizeEye(typedRx.od),
    os: normalizeEye(typedRx.os),
    pd: pdResult,
    ...(typedRx.notes ? { notes: typedRx.notes } : {}),
  };
}

/**
 * Validates and returns the normalized prescription if valid, or errors if not.
 * For NON_PRESCRIPTION, valid empty input normalizes to an explicit absent prescription (`prescription: undefined`).
 */
export function validateAndNormalizePrescription(
  rx: unknown,
  rxType: "NON_PRESCRIPTION",
):
  | { ok: true; prescription: undefined; errors: [] }
  | { ok: false; errors: RxValidationError[] };
export function validateAndNormalizePrescription(
  rx: unknown,
  rxType: Exclude<RxType, "NON_PRESCRIPTION">,
):
  | { ok: true; prescription: Prescription; errors: [] }
  | { ok: false; errors: RxValidationError[] };
export function validateAndNormalizePrescription(
  rx: unknown,
  rxType: RxType,
):
  | { ok: true; prescription: Prescription | undefined; errors: [] }
  | { ok: false; errors: RxValidationError[] };
export function validateAndNormalizePrescription(
  rx: unknown,
  rxType: RxType,
):
  | { ok: true; prescription: Prescription | undefined; errors: [] }
  | { ok: false; errors: RxValidationError[] } {
  const errors = validatePrescription(rx, rxType);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (rxType === "NON_PRESCRIPTION") {
    return {
      ok: true,
      prescription: undefined,
      errors: [],
    };
  }
  return {
    ok: true,
    prescription: normalizePrescription(rx as Prescription, rxType)!,
    errors: [],
  };
}
