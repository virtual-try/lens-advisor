import { padDecimal, splitScaledInteger } from "../format/scaled-integer.js";
import { iso4217CurrencySchema } from "../schemas/index.js";
import { PRICING_ERROR_CODES, PricingError } from "./errors.js";

/**
 * Powers of ten for ISO-4217 minor-unit scales. CLDR's largest exponent
 * that `Intl` reports here is 4; the table stops at 6 so a future code
 * still stays on integer math.
 */
const POW10 = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000] as const;
const MAX_SCALE = POW10.length - 1;

/** Hostile input longer than this is `MONEY_FORMAT` and is not scanned. */
const MAX_TEXT_LENGTH = 10_000;

/**
 * Locale is pinned. Currency exponents did not change across the locales
 * checked (en, ja, ar, de, fr), and pinning avoids reading the machine locale.
 */
const CURRENCY_LOCALE = "en";

const UNICODE_MINUS = /[\u2212\u2013\u2014\uFE63\uFF0D]/g;

/**
 * Optional sign, digits, optional fractional digits. No exponent, no
 * thousands separator, no hex. A comma is rejected on purpose: "1,500"
 * is either 1500 or 1.500, and guessing undercharges.
 */
const MONEY_TEXT = /^([+-])?(\d*)(?:\.(\d*))?$/;

const digitCache = new Map<string, number | null>();

export type MoneyTextSuccess = {
  ok: true;
  amountMinor: number;
};

export type MoneyTextFailure = {
  ok: false;
  error:
    | typeof PRICING_ERROR_CODES.MONEY_FORMAT
    | typeof PRICING_ERROR_CODES.MONEY_PRECISION;
};

export type MoneyTextResult = MoneyTextSuccess | MoneyTextFailure;

function fail(
  error: MoneyTextFailure["error"],
): MoneyTextFailure {
  return { ok: false, error };
}

/**
 * Minor-unit digits for an ISO-4217 code: USD 2, JPY 0, KWD 3.
 * Unknown codes return null. Cached. Not a display formatter.
 */
function minorUnitDigits(currency: string): number | null {
  const cached = digitCache.get(currency);
  if (cached !== undefined) {
    return cached;
  }
  const digits = readMinorUnitDigits(currency);
  digitCache.set(currency, digits);
  return digits;
}

function readMinorUnitDigits(currency: string): number | null {
  if (!iso4217CurrencySchema.safeParse(currency).success) {
    return null;
  }
  let digits: number | undefined;
  try {
    digits = new Intl.NumberFormat(CURRENCY_LOCALE, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    return null;
  }
  if (
    digits === undefined ||
    !Number.isInteger(digits) ||
    digits < 0 ||
    digits > MAX_SCALE
  ) {
    return null;
  }
  return digits;
}

function pow10(scale: number): number | null {
  return POW10[scale] ?? null;
}

/**
 * Decimal digits to an integer. Stops before `n * 10 + d` would leave
 * the safe-integer range, so a 10 000-digit string cannot round-trip
 * through a float.
 */
function parseDigits(digits: string): number | null {
  const stripped = digits.replace(/^0+/, "");
  const body = stripped.length === 0 ? "0" : stripped;
  let value = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) {
      return null;
    }
    if (value > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 10)) {
      return null;
    }
    value = value * 10 + digit;
  }
  return value;
}

function combineMinor(
  whole: number,
  frac: number,
  scale: number,
  fracLength: number,
): number | null {
  const unit = pow10(scale);
  const fracUnit = pow10(scale - fracLength);
  if (unit === null || fracUnit === null) {
    return null;
  }
  const wholePart = whole * unit;
  const fracPart = frac * fracUnit;
  if (
    !Number.isSafeInteger(wholePart) ||
    !Number.isSafeInteger(fracPart) ||
    wholePart > Number.MAX_SAFE_INTEGER - fracPart
  ) {
    return null;
  }
  return wholePart + fracPart;
}

/**
 * Parse admin money text into integer minor units.
 * "35.5" USD → 3550, "0.1" USD → 10, "1500" JPY → 1500.
 * Extra fractional digits are `MONEY_PRECISION`, not rounded.
 * Empty, non-numeric, and exponent text are `MONEY_FORMAT`.
 */
export function parseMoneyText(
  text: string,
  currency: string,
): MoneyTextResult {
  if (typeof text !== "string" || typeof currency !== "string") {
    return fail(PRICING_ERROR_CODES.MONEY_FORMAT);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return fail(PRICING_ERROR_CODES.MONEY_FORMAT);
  }

  const trimmed = text.trim().replace(UNICODE_MINUS, "-");
  if (trimmed.length === 0) {
    return fail(PRICING_ERROR_CODES.MONEY_FORMAT);
  }

  const match = MONEY_TEXT.exec(trimmed);
  if (match === null) {
    return fail(PRICING_ERROR_CODES.MONEY_FORMAT);
  }

  const sign = match[1] ?? "";
  const wholeDigits = match[2] ?? "";
  const frac = match[3] ?? "";
  if (wholeDigits.length === 0 && frac.length === 0) {
    return fail(PRICING_ERROR_CODES.MONEY_FORMAT);
  }

  const scale = minorUnitDigits(currency);
  if (scale === null) {
    return fail(PRICING_ERROR_CODES.MONEY_FORMAT);
  }
  if (frac.length > scale) {
    return fail(PRICING_ERROR_CODES.MONEY_PRECISION);
  }

  const whole = parseDigits(wholeDigits);
  const fracValue = parseDigits(frac);
  if (whole === null || fracValue === null) {
    return fail(PRICING_ERROR_CODES.MONEY_FORMAT);
  }

  const magnitude = combineMinor(whole, fracValue, scale, frac.length);
  if (magnitude === null) {
    return fail(PRICING_ERROR_CODES.MONEY_FORMAT);
  }

  const signed = sign === "-" ? -magnitude : magnitude;
  return { ok: true, amountMinor: signed === 0 ? 0 : signed };
}

/**
 * Integer minor units → Shopify Admin decimal string.
 * 8000 USD → "80.00", 1500 JPY → "1500", 1500 KWD → "1.500".
 * A non-integer amount or an unknown currency throws `PricingError`.
 */
export function toShopifyDecimal(
  amountMinor: number,
  currency: string,
): string {
  if (typeof currency !== "string" || !Number.isSafeInteger(amountMinor)) {
    throw new PricingError(PRICING_ERROR_CODES.MONEY_FORMAT);
  }
  const scale = minorUnitDigits(currency);
  const unit = scale === null ? null : pow10(scale);
  if (scale === null || unit === null) {
    throw new PricingError(PRICING_ERROR_CODES.MONEY_FORMAT);
  }
  if (scale === 0) {
    return amountMinor < 0 ? `-${String(-amountMinor)}` : String(amountMinor);
  }
  const { negative, whole, frac } = splitScaledInteger(amountMinor, unit);
  const body = `${String(whole)}.${padDecimal(frac, scale)}`;
  return negative ? `-${body}` : body;
}
