import { describe, expect, it } from "vitest";
import { formatAxis, formatDiopter, formatEye, formatPd } from "./index.js";

describe("formatDiopter", () => {
  it("formats -225 as -2.25", () => {
    expect(formatDiopter(-225)).toBe("-2.25");
  });

  it("shows an explicit plus on positives", () => {
    expect(formatDiopter(25)).toBe("+0.25");
  });

  it("formats zero as PL (plano)", () => {
    expect(formatDiopter(0)).toBe("PL");
  });
});

describe("formatPd", () => {
  it("formats single PD tenths as one decimal", () => {
    expect(formatPd({ single: 635 })).toBe("63.5");
  });

  it("formats dual PD as od/os", () => {
    expect(formatPd({ od: 320, os: 315 })).toBe("32.0/31.5");
  });
});

describe("formatAxis", () => {
  it("zero-pads to three digits", () => {
    expect(formatAxis(1)).toBe("001");
    expect(formatAxis(90)).toBe("090");
    expect(formatAxis(180)).toBe("180");
  });
});

describe("formatEye", () => {
  it("joins cyl and axis when present", () => {
    expect(formatEye({ sph: -225, cyl: -50, axis: 180 })).toBe(
      "-2.25/-0.50x180",
    );
  });
});
