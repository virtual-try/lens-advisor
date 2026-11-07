/**
 * Split a scaled integer into sign, whole, and fractional digits without
 * floating-point arithmetic. `scale` is 10 (one decimal) or 100 (two).
 */
export function splitScaledInteger(
  value: number,
  scale: number,
): { negative: boolean; whole: number; frac: number } {
  const negative = value < 0;
  const abs = negative ? -value : value;
  return {
    negative,
    whole: Math.trunc(abs / scale),
    frac: abs % scale,
  };
}

export function padDecimal(frac: number, places: number): string {
  const digits = String(frac);
  return digits.length >= places
    ? digits
    : "0".repeat(places - digits.length) + digits;
}
