import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

describe("formatMoney", () => {
  it("formats integer cents into formatted currency string", () => {
    expect(formatMoney(12900, "USD")).toBe("$129.00");
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatMoney(4950, "USD")).toBe("$49.50");
  });

  it("handles negative minor units", () => {
    expect(formatMoney(-500, "USD")).toBe("-$5.00");
  });

  it("handles EUR currency", () => {
    const formatted = formatMoney(1200, "EUR", "en-US");
    expect(formatted).toContain("12.00");
  });
});
