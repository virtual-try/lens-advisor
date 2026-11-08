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
  return formatter.format(amountMinor / 100);
}
