import { test, expect } from "@playwright/test";
import { standaloneNumber } from "./standalone-number";

test.describe("standaloneNumber helper (e2e/helpers)", () => {
  test("R4-F1: matches unit-suffixed Rx clinical values (-2.25D, 137°)", () => {
    expect(standaloneNumber("-2.25").test("SPH -2.25D")).toBe(true);
    expect(standaloneNumber("-2.25").test("OD -2.25D")).toBe(true);
    expect(standaloneNumber("-2.25").test("-2.25D")).toBe(true);
    expect(standaloneNumber("137").test("axis 137°")).toBe(true);
    expect(standaloneNumber("137").test("137°")).toBe(true);
    expect(standaloneNumber("-1.5").test('{"cyl":-1.5}')).toBe(true);
    expect(standaloneNumber("-2.25").test('{"sph":-2.25}')).toBe(true);
    expect(standaloneNumber("63.0").test("PD: 63.0 mm")).toBe(true);
  });

  test("R4-F1: does not match cuid IDs or ISO timestamps", () => {
    expect(standaloneNumber("-2.25").test("2026-11-08T22:12:25.250Z")).toBe(false);
    expect(standaloneNumber("137").test("cmw8137i1006")).toBe(false);
    expect(standaloneNumber("90").test("id9012")).toBe(false);
    expect(standaloneNumber("137").test("1370")).toBe(false);
  });

  test("R4-F5: distinguishes opaque IDs containing 630 from clinical PD values", () => {
    // Clinical PD text matches
    expect(standaloneNumber("630").test("PD 630")).toBe(true);
    expect(standaloneNumber("630").test("630")).toBe(true);
    expect(standaloneNumber("630").test("PD: 630 mm")).toBe(true);
    expect(standaloneNumber("630").test('{"pd":630}')).toBe(true);

    // Opaque random IDs containing 630 as substring do NOT match
    expect(standaloneNumber("630").test("cmw630xyz")).toBe(false);
    expect(standaloneNumber("630").test("bundle_630_item")).toBe(false);
    expect(standaloneNumber("630").test("item630")).toBe(false);
    expect(standaloneNumber("630").test("rx_630_draft")).toBe(false);
  });
});
