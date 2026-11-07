import type { Axis, Diopter, PdTenthsMm } from "../types/index.js";
import {
  RX_ERROR_CODES,
  RX_VALIDATION_CODES,
  type RxErrorCode,
  type RxValidationCode,
} from "./validate.js";

export {
  RX_ERROR_CODES,
  RX_VALIDATION_CODES,
  type RxErrorCode,
  type RxValidationCode,
};

export type ParseSuccess<T> = {
  ok: true;
  value: T;
};

export type ParseFailure = {
  ok: false;
  error: RxValidationCode;
};

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

export type DiopterField = "sph" | "cyl" | "add";

export interface ParseDiopterOptions {
  field?: DiopterField;
  min?: number;
  max?: number;
  checkRange?: boolean;
}

const FIELD_DEFAULTS: Record<
  DiopterField,
  { min: number; max: number; stepError: RxValidationCode; rangeError: RxValidationCode }
> = {
  sph: {
    min: -2000,
    max: 2000,
    stepError: RX_VALIDATION_CODES.SPH_STEP,
    rangeError: RX_VALIDATION_CODES.SPH_RANGE,
  },
  cyl: {
    min: -600,
    max: 600,
    stepError: RX_VALIDATION_CODES.CYL_STEP,
    rangeError: RX_VALIDATION_CODES.CYL_RANGE,
  },
  add: {
    min: 75,
    max: 350,
    stepError: RX_VALIDATION_CODES.ADD_STEP,
    rangeError: RX_VALIDATION_CODES.ADD_RANGE,
  },
};

/**
 * Parses user-entered text into integer hundredths of a diopter.
 * Normalizes Unicode minus (−), comma decimals (,), plano (PL, plano, 0),
 * and handles boundary/step checks in pure integer math without float drift.
 */
export function parseDiopterText(
  text: string,
  options?: DiopterField | ParseDiopterOptions,
): ParseResult<Diopter> {
  const opts: ParseDiopterOptions =
    typeof options === "string" ? { field: options } : options ?? {};

  const field = opts.field ?? "sph";
  const defaults = FIELD_DEFAULTS[field];
  const min = opts.min ?? defaults.min;
  const max = opts.max ?? defaults.max;
  const checkRange = opts.checkRange ?? true;
  const stepError = defaults.stepError;
  const rangeError = defaults.rangeError;

  if (typeof text !== "string") {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  const lower = trimmed.toLowerCase();
  if (lower === "pl" || lower === "plano") {
    return { ok: true, value: 0 as Diopter };
  }

  // Normalize Unicode minuses to ASCII hyphen-minus
  const withAsciiMinus = trimmed.replace(
    /\u2212|\u2013|\u2014|\uFE63|\uFF0D/g,
    "-",
  );

  // Normalize comma decimal separator to dot
  const normalized = withAsciiMinus.replace(/,/g, ".");

  // Check explicit zero strings
  if (
    normalized === "0" ||
    normalized === "+0" ||
    normalized === "-0" ||
    normalized === "0.0" ||
    normalized === "0.00" ||
    normalized === "+0.00" ||
    normalized === "-0.00" ||
    normalized === ".0" ||
    normalized === ".00" ||
    normalized === "+.00" ||
    normalized === "-.00"
  ) {
    return { ok: true, value: 0 as Diopter };
  }

  // Match optional sign, followed by whole digits + optional frac, or just .frac
  const match = normalized.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/);
  if (!match) {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  const signStr = match[1];
  const isNegative = signStr === "-";
  const wholeStr = match[2];
  const fracWithWhole = match[3];
  const fracWithoutWhole = match[4];

  const whole = wholeStr !== undefined ? parseInt(wholeStr, 10) : 0;
  const fracStr = fracWithWhole ?? fracWithoutWhole ?? "";

  let fracHundredths = 0;
  if (fracStr.length === 0) {
    fracHundredths = 0;
  } else if (fracStr.length === 1) {
    fracHundredths = parseInt(fracStr, 10) * 10;
  } else if (fracStr.length === 2) {
    fracHundredths = parseInt(fracStr, 10);
  } else {
    // If extra decimal digits exist, they must be trailing zeros
    const extra = fracStr.slice(2);
    if (/^0+$/.test(extra)) {
      fracHundredths = parseInt(fracStr.slice(0, 2), 10);
    } else {
      return { ok: false, error: stepError };
    }
  }

  // Diopters must be in quarter steps (0, 25, 50, 75 hundredths)
  if (fracHundredths % 25 !== 0) {
    return { ok: false, error: stepError };
  }

  const absHundredths = whole * 100 + fracHundredths;
  let signedHundredths = isNegative ? -absHundredths : absHundredths;

  // Ensure 0 is +0, never -0
  if (signedHundredths === 0 || Object.is(signedHundredths, -0)) {
    signedHundredths = 0;
  }

  if (checkRange) {
    if (signedHundredths < min || signedHundredths > max) {
      return { ok: false, error: rangeError };
    }
  }

  return { ok: true, value: signedHundredths as Diopter };
}

/**
 * Alias for `parseDiopterText`.
 */
export const parseDiopter = parseDiopterText;

/**
 * Helper to parse SPH text with SPH-specific ranges and errors.
 */
export function parseSphText(text: string): ParseResult<Diopter> {
  return parseDiopterText(text, "sph");
}

/**
 * Helper to parse CYL text with CYL-specific ranges and errors.
 */
export function parseCylText(text: string): ParseResult<Diopter> {
  return parseDiopterText(text, "cyl");
}

/**
 * Helper to parse ADD text with ADD-specific ranges and errors.
 */
export function parseAddText(text: string): ParseResult<Diopter> {
  return parseDiopterText(text, "add");
}

/**
 * Parses user-entered text into an Axis integer (1–180 degrees).
 */
export function parseAxis(text: string): ParseResult<Axis> {
  if (typeof text !== "string") {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 10) {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  if (!/^[+]?\d+$/.test(trimmed)) {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  const val = parseInt(trimmed, 10);
  if (val < 1 || val > 180) {
    return { ok: false, error: RX_ERROR_CODES.AXIS_RANGE };
  }

  return { ok: true, value: val as Axis };
}

export interface ParsePdOptions {
  dual?: boolean;
}

/**
 * Parses user-entered text into pupillary distance (PD) in tenths of a millimetre.
 * Single PD range: 50.0–80.0 mm (500–800 tenths).
 * Dual PD range (per eye): 25.0–40.0 mm (250–400 tenths).
 * Steps: 0.5 mm (5 tenths).
 */
export function parsePd(
  text: string,
  options?: ParsePdOptions,
): ParseResult<PdTenthsMm> {
  if (typeof text !== "string") {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 20) {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  const normalized = trimmed.replace(/,/g, ".");
  const match = normalized.match(/^(\d+)(?:\.(\d*))?$/);
  if (!match) {
    return { ok: false, error: RX_ERROR_CODES.INVALID };
  }

  const whole = parseInt(match[1], 10);
  const fracStr = match[2] ?? "";

  let fracTenths = 0;
  if (fracStr.length === 0) {
    fracTenths = 0;
  } else if (fracStr.length === 1) {
    fracTenths = parseInt(fracStr, 10);
  } else {
    const extra = fracStr.slice(1);
    if (/^0+$/.test(extra)) {
      fracTenths = parseInt(fracStr[0], 10);
    } else {
      return { ok: false, error: RX_ERROR_CODES.PD_STEP };
    }
  }

  // 0.5 mm steps (5 tenths)
  if (fracTenths % 5 !== 0) {
    return { ok: false, error: RX_ERROR_CODES.PD_STEP };
  }

  const tenths = whole * 10 + fracTenths;

  if (options?.dual) {
    if (tenths < 250 || tenths > 400) {
      return { ok: false, error: RX_ERROR_CODES.PD_RANGE };
    }
  } else {
    if (tenths < 500 || tenths > 800) {
      return { ok: false, error: RX_ERROR_CODES.PD_RANGE };
    }
  }

  return { ok: true, value: tenths as PdTenthsMm };
}

/**
 * Parses OD and OS dual PD text inputs into integer tenths of a millimetre.
 */
export function parseDualPd(
  odText: string,
  osText: string,
): ParseResult<{ od: PdTenthsMm; os: PdTenthsMm }> {
  const odRes = parsePd(odText, { dual: true });
  if (!odRes.ok) {
    return odRes;
  }

  const osRes = parsePd(osText, { dual: true });
  if (!osRes.ok) {
    return osRes;
  }

  return {
    ok: true,
    value: {
      od: odRes.value,
      os: osRes.value,
    },
  };
}
