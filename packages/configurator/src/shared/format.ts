/**
 * Currency formatting using Intl.NumberFormat.
 * Complies with INV-4: no float arithmetic on money, minor units are divided only for display.
 */
export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = "en-US",
): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = Math.pow(10, fractionDigits);
  return formatter.format(amountMinor / divisor);
}
