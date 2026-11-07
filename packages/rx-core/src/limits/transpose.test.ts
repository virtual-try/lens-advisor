import { describe, expect, it } from "vitest";
import type { Axis, Diopter, Eye, Prescription } from "../types/index.js";
import { transpose, transposeEye } from "./transpose.js";

describe("transposeEye", () => {
  it("transposes axis 90 to 180", () => {
    const eye: Eye = { sph: 0 as Diopter, cyl: 100 as Diopter, axis: 90 as Axis };
    const result = transposeEye(eye);
    expect(result.axis).toBe(180);
    expect(result.cyl).toBe(-100);
    expect(result.sph).toBe(100);
  });

  it("transposes axis 180 to 90", () => {
    const eye: Eye = { sph: 0 as Diopter, cyl: 100 as Diopter, axis: 180 as Axis };
    const result = transposeEye(eye);
    expect(result.axis).toBe(90);
    expect(result.cyl).toBe(-100);
    expect(result.sph).toBe(100);
  });

  it("transposes axis 45 to 135", () => {
    const eye: Eye = { sph: 200 as Diopter, cyl: 150 as Diopter, axis: 45 as Axis };
    const result = transposeEye(eye);
    expect(result.axis).toBe(135);
    expect(result.cyl).toBe(-150);
    expect(result.sph).toBe(350);
  });

  it("transposes axis 135 to 45", () => {
    const eye: Eye = { sph: 350 as Diopter, cyl: -150 as Diopter, axis: 135 as Axis };
    const result = transposeEye(eye);
    expect(result.axis).toBe(45);
    expect(result.cyl).toBe(150);
    expect(result.sph).toBe(200);
  });

  it("never produces axis 0 or 270", () => {
    for (let a = 1; a <= 180; a++) {
      const eye: Eye = { sph: 0 as Diopter, cyl: 100 as Diopter, axis: a as Axis };
      const transposed = transposeEye(eye);
      expect(transposed.axis).toBeGreaterThanOrEqual(1);
      expect(transposed.axis).toBeLessThanOrEqual(180);
      expect(transposed.axis).not.toBe(0);
      expect(transposed.axis).not.toBe(270);
    }
  });

  it("leaves plano CYL (0) untouched (no transposition)", () => {
    const eye: Eye = { sph: -200 as Diopter, cyl: 0 as Diopter, axis: 90 as Axis };
    const result = transposeEye(eye);
    expect(result.sph).toBe(-200);
    expect(result.cyl).toBe(0);
    expect(result.axis).toBe(90);
  });

  it("leaves undefined CYL untouched (no transposition)", () => {
    const eye: Eye = { sph: -800 as Diopter };
    const result = transposeEye(eye);
    expect(result.sph).toBe(-800);
    expect(result.cyl).toBeUndefined();
    expect(result.axis).toBeUndefined();
  });

  it("transposes plus cyl correctly (Examples row 4: +500/+150x90 -> +650/-150x180)", () => {
    const eye: Eye = { sph: 500 as Diopter, cyl: 150 as Diopter, axis: 90 as Axis };
    const result = transposeEye(eye);
    expect(result).toEqual({
      sph: 650,
      cyl: -150,
      axis: 180,
    });
  });

  it("transposes plus cyl correctly (Examples row 5: +400/+100x180 -> +500/-100x90)", () => {
    const eye: Eye = { sph: 400 as Diopter, cyl: 100 as Diopter, axis: 180 as Axis };
    const result = transposeEye(eye);
    expect(result).toEqual({
      sph: 500,
      cyl: -100,
      axis: 90,
    });
  });

  it("preserves ADD and other fields", () => {
    const eye: Eye = {
      sph: 100 as Diopter,
      cyl: 100 as Diopter,
      axis: 90 as Axis,
      add: 200 as Diopter,
    };
    const result = transposeEye(eye);
    expect(result).toEqual({
      sph: 200,
      cyl: -100,
      axis: 180,
      add: 200,
    });
  });
});

describe("transpose (involution property test)", () => {
  it("transposing an eye twice returns the original eye", () => {
    const eyes: Eye[] = [
      { sph: 500 as Diopter, cyl: 150 as Diopter, axis: 90 as Axis },
      { sph: 400 as Diopter, cyl: 100 as Diopter, axis: 180 as Axis },
      { sph: -225 as Diopter, cyl: -225 as Diopter, axis: 45 as Axis },
      { sph: -200 as Diopter, cyl: 0 as Diopter, axis: 90 as Axis },
      { sph: -800 as Diopter },
      { sph: 100 as Diopter, cyl: 200 as Diopter, axis: 1 as Axis, add: 250 as Diopter },
      { sph: -300 as Diopter, cyl: -150 as Diopter, axis: 180 as Axis, add: 175 as Diopter },
    ];

    for (const eye of eyes) {
      const once = transpose(eye);
      const twice = transpose(once);
      expect(twice).toEqual(eye);
    }
  });

  it("transposing a full prescription twice returns the original prescription", () => {
    const rx: Prescription = {
      od: { sph: 500 as Diopter, cyl: 150 as Diopter, axis: 90 as Axis, add: 200 as Diopter },
      os: { sph: -300 as Diopter, cyl: -125 as Diopter, axis: 180 as Axis, add: 200 as Diopter },
      pd: { single: 630 },
      notes: "Test prescription",
    };

    const once = transpose(rx);
    expect(once.od).toEqual({ sph: 650, cyl: -150, axis: 180, add: 200 });
    expect(once.os).toEqual({ sph: -425, cyl: 125, axis: 90, add: 200 });
    expect(once.pd).toEqual({ single: 630 });
    expect(once.notes).toBe("Test prescription");

    const twice = transpose(once);
    expect(twice).toEqual(rx);
  });

  it("property test: 300 generated prescriptions round-trip exactly with double-transposition", () => {
    // Deterministic pseudo-random generator
    let seed = 42;
    function nextRand(): number {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    function randInt(min: number, max: number): number {
      return Math.floor(nextRand() * (max - min + 1)) + min;
    }

    function generateRandomEye(): Eye {
      const sph = (randInt(-40, 30) * 25) as Diopter; // -10.00 to +7.50 in quarter steps
      const hasCyl = nextRand() > 0.15;
      if (!hasCyl) {
        const hasAdd = nextRand() > 0.5;
        return {
          sph,
          ...(hasAdd ? { add: (randInt(3, 14) * 25) as Diopter } : {}),
        };
      }

      // cyl can be negative, zero, or positive
      const cylType = randInt(0, 3);
      let cyl: Diopter;
      if (cylType === 0) {
        cyl = 0 as Diopter;
      } else if (cylType === 1) {
        cyl = (randInt(1, 16) * 25) as Diopter; // +0.25 to +4.00
      } else {
        cyl = (randInt(-16, -1) * 25) as Diopter; // -4.00 to -0.25
      }

      const axis = randInt(1, 180) as Axis;
      const hasAdd = nextRand() > 0.5;
      const add = hasAdd ? ((randInt(3, 14) * 25) as Diopter) : undefined;

      return {
        sph,
        cyl,
        axis,
        ...(add !== undefined ? { add } : {}),
      };
    }

    for (let i = 0; i < 300; i++) {
      const isDualPd = nextRand() > 0.5;
      const rx: Prescription = {
        od: generateRandomEye(),
        os: generateRandomEye(),
        pd: isDualPd
          ? { od: randInt(250, 400), os: randInt(250, 400) }
          : { single: randInt(500, 800) },
        notes: nextRand() > 0.7 ? `Note ${i}` : undefined,
      };

      const transposedOnce = transpose(rx);
      const transposedTwice = transpose(transposedOnce);

      expect(transposedTwice).toEqual(rx);
    }
  });
});
