/**
 * Matches a number unless it is part of a longer number or an id: no letter,
 * digit or dot right before it, no digit (or decimal part) right after it.
 * Units or symbols after it still match ("-2.25D", "137°"), while cuid ids
 * ("cmw8137i") and ISO timestamps ("...12.250Z") do not.
 */
export function standaloneNumber(value: string): RegExp {
  const escaped = value.replace(/[.-]/g, (c) => `\\${c}`);
  return new RegExp(`(?<![\\w.])${escaped}(?!\\d|\\.\\d)`);
}
