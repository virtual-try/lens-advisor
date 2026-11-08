import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

describe("formatMoney", () => {
  it("formats integer cents into formatted currency string", () => {
    expect(formatMoney(12900, "USD")).toBe("$129.00");
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatMoney(4950, "USD")).toBe("$49.50");
  });

  it("handles 0-, 2-, and 3-decimal currencies based on ISO-4217 minor units", () => {
    // 0-decimal: JPY 12900 -> 12,900
    const jpy = formatMoney(12900, "JPY", "en-US");
    expect(jpy).toContain("12,900");
    expect(jpy).not.toContain("129");

    // 2-decimal: USD 12900 -> 129.00
    const usd = formatMoney(12900, "USD", "en-US");
    expect(usd).toBe("$129.00");

    // 3-decimal: KWD 12900 -> 12.900
    const kwd = formatMoney(12900, "KWD", "en-US");
    expect(kwd).toContain("12.900");
    expect(kwd).not.toContain("129.000");
  });

  it("handles negative minor units", () => {
    expect(formatMoney(-500, "USD")).toBe("-$5.00");
  });

  it("handles EUR currency", () => {
    const formatted = formatMoney(1200, "EUR", "en-US");
    expect(formatted).toContain("12.00");
  });
});
