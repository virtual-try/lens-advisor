import { describe, expect, it } from "vitest";
import type { Diopter, Lens, Prescription, RxType } from "../types/index.js";
import { checkLens } from "./check-lens.js";
import { filterLenses } from "./filter-lenses.js";

// Lens L from spec 11 Examples table:
// SPH −800..+600, CYL −400..0, rx types SV and PROGRESSIVE
const fixtureLensL: Lens = {
  id: "lens-l",
  groupId: "group-1",
  name: "Lens L",
  description: "Standard Single Vision / Progressive Lens",
  price: { amountMinor: 5000, currency: "USD" },
  limits: {
    sphMin: -800 as Diopter,
    sphMax: 600 as Diopter,
    cylMin: -400 as Diopter,
    cylMax: 0 as Diopter,
    rxTypes: ["SINGLE_VISION", "PROGRESSIVE"],
  },
  labCodeTemplate: "LENS-L",
  shopifyVariantId: "gid://shopify/ProductVariant/100",
  position: 0,
};

describe("Spec 11 Examples Table", () => {
  it("Row 1: OD −225/−225, OS −200/0, SV -> available (normal)", () => {
    const rx: Prescription = {
      od: { sph: -225 as Diopter, cyl: -225 as Diopter, axis: 90 },
      os: { sph: -200 as Diopter, cyl: 0 as Diopter, axis: 90 },
      pd: { single: 630 },
    };
    const result = checkLens(rx, "SINGLE_VISION", fixtureLensL);
    expect(result).toEqual({ available: true });
  });

  it("Row 2: OD −800, SV -> available (min boundary inclusive)", () => {
    const rx: Prescription = {
      od: { sph: -800 as Diopter },
      os: { sph: -200 as Diopter },
      pd: { single: 630 },
    };
    const result = checkLens(rx, "SINGLE_VISION", fixtureLensL);
    expect(result).toEqual({ available: true });
  });

  it("Row 3: OD −825, SV -> SPH_BELOW_MIN, OD, value −825, limit −800 (just outside)", () => {
    const rx: Prescription = {
      od: { sph: -825 as Diopter },
      os: { sph: -200 as Diopter },
      pd: { single: 630 },
    };
    const result = checkLens(rx, "SINGLE_VISION", fixtureLensL);
    expect(result).toEqual({
      available: false,
      reason: {
        code: "SPH_BELOW_MIN",
        field: "sph",
        eye: "OD",
        value: -825,
        limit: -800,
      },
    });
  });

  it("Row 4: OD +500 / +150 × 90 (plus cyl), SV -> transposed to +650 / −150 × 180 -> SPH_ABOVE_MAX (transposition matters)", () => {
    const rx: Prescription = {
      od: { sph: 500 as Diopter, cyl: 150 as Diopter, axis: 90 },
      os: { sph: 100 as Diopter },
      pd: { single: 630 },
    };
    const result = checkLens(rx, "SINGLE_VISION", fixtureLensL);
    expect(result).toEqual({
      available: false,
      reason: {
        code: "SPH_ABOVE_MAX",
        field: "sph",
        eye: "OD",
        value: 650,
        limit: 600,
      },
    });
  });

  it("Row 5: OD +400 / +100 × 180, SV -> transposed +500 / −100 × 90 -> available (transposition axis wraps)", () => {
    const rx: Prescription = {
      od: { sph: 400 as Diopter, cyl: 100 as Diopter, axis: 180 },
      os: { sph: 100 as Diopter },
      pd: { single: 630 },
    };
    const result = checkLens(rx, "SINGLE_VISION", fixtureLensL);
    expect(result).toEqual({ available: true });
  });

  it("Row 6: any Rx, READING -> RX_TYPE_NOT_SUPPORTED (rx type first)", () => {
    const rx: Prescription = {
      od: { sph: -200 as Diopter },
      os: { sph: -200 as Diopter },
      pd: { single: 630 },
    };
    const result = checkLens(rx, "READING", fixtureLensL);
    expect(result).toEqual({
      available: false,
      reason: {
        code: "RX_TYPE_NOT_SUPPORTED",
        field: "rxType",
        eye: undefined,
        value: "READING",
        limit: ["SINGLE_VISION", "PROGRESSIVE"],
      },
    });
  });

  it("Row 7: OD fails SPH and OS fails CYL -> reason is OD SPH (fixed order)", () => {
    const rx: Prescription = {
      od: { sph: -900 as Diopter, cyl: 0 as Diopter }, // fails SPH_BELOW_MIN (-800)
      os: { sph: -200 as Diopter, cyl: -500 as Diopter }, // fails CYL_OUT_OF_RANGE (-400)
      pd: { single: 630 },
    };
    const result = checkLens(rx, "SINGLE_VISION", fixtureLensL);
    expect(result).toEqual({
      available: false,
      reason: {
        code: "SPH_BELOW_MIN",
        field: "sph",
        eye: "OD",
        value: -900,
        limit: -800,
      },
    });
  });

  it("Row 8: NON_PRESCRIPTION, lens allowing it -> available (no Rx to check)", () => {
    const lensWithNonRx: Lens = {
      ...fixtureLensL,
      limits: {
        ...fixtureLensL.limits,
        rxTypes: ["SINGLE_VISION", "PROGRESSIVE", "NON_PRESCRIPTION"],
      },
    };
    // Available even with no Rx
    expect(checkLens(undefined, "NON_PRESCRIPTION", lensWithNonRx)).toEqual({
      available: true,
    });
    expect(checkLens(null, "NON_PRESCRIPTION", lensWithNonRx)).toEqual({
      available: true,
    });
    // Available even if a prescription with out-of-limits values is passed
    const outOfBoundsRx: Prescription = {
      od: { sph: -2000 as Diopter },
      os: { sph: -2000 as Diopter },
      pd: { single: 630 },
    };
    expect(checkLens(outOfBoundsRx, "NON_PRESCRIPTION", lensWithNonRx)).toEqual({
      available: true,
    });
  });

  it("Row 9: empty lens list -> empty result (empty input)", () => {
    const rx: Prescription = {
      od: { sph: -200 as Diopter },
      os: { sph: -200 as Diopter },
      pd: { single: 630 },
    };
    const results = filterLenses(rx, "SINGLE_VISION", []);
    expect(results).toEqual([]);
  });
});

describe("Fixed check order (rx type, OD SPH, OD CYL, OD ADD, OS SPH, OS CYL, OS ADD)", () => {
  const bifocalLens: Lens = {
    ...fixtureLensL,
    limits: {
      sphMin: -600 as Diopter,
      sphMax: 400 as Diopter,
      cylMin: -300 as Diopter,
      cylMax: 0 as Diopter,
      addMin: 100 as Diopter,
      addMax: 300 as Diopter,
      rxTypes: ["PROGRESSIVE"],
    },
  };

  it("1. rx type is checked before OD SPH", () => {
    const rx: Prescription = {
      od: { sph: -900 as Diopter }, // fails SPH
      os: { sph: 0 as Diopter },
      pd: { single: 600 },
    };
    const result = checkLens(rx, "SINGLE_VISION", bifocalLens);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason.code).toBe("RX_TYPE_NOT_SUPPORTED");
    }
  });

  it("2. OD SPH is checked before OD CYL", () => {
    const rx: Prescription = {
      od: { sph: -700 as Diopter, cyl: -400 as Diopter }, // fails both SPH and CYL
      os: { sph: 0 as Diopter },
      pd: { single: 600 },
    };
    const result = checkLens(rx, "PROGRESSIVE", bifocalLens);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason.code).toBe("SPH_BELOW_MIN");
      expect(result.reason.eye).toBe("OD");
    }
  });

  it("3. OD CYL is checked before OD ADD", () => {
    const rx: Prescription = {
      od: { sph: 0 as Diopter, cyl: -400 as Diopter, add: 400 as Diopter }, // fails CYL and ADD
      os: { sph: 0 as Diopter },
      pd: { single: 600 },
    };
    const result = checkLens(rx, "PROGRESSIVE", bifocalLens);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason.code).toBe("CYL_OUT_OF_RANGE");
      expect(result.reason.eye).toBe("OD");
    }
  });

  it("4. OD ADD is checked before OS SPH", () => {
    const rx: Prescription = {
      od: { sph: 0 as Diopter, add: 50 as Diopter }, // fails ADD (min 100)
      os: { sph: -800 as Diopter }, // fails SPH
      pd: { single: 600 },
    };
    const result = checkLens(rx, "PROGRESSIVE", bifocalLens);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason.code).toBe("ADD_OUT_OF_RANGE");
      expect(result.reason.eye).toBe("OD");
      expect(result.reason.value).toBe(50);
      expect(result.reason.limit).toBe(100);
    }
  });

  it("5. OS SPH is checked before OS CYL", () => {
    const rx: Prescription = {
      od: { sph: 0 as Diopter, add: 200 as Diopter },
      os: { sph: 500 as Diopter, cyl: -400 as Diopter }, // fails SPH (max 400) and CYL
      pd: { single: 600 },
    };
    const result = checkLens(rx, "PROGRESSIVE", bifocalLens);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason.code).toBe("SPH_ABOVE_MAX");
      expect(result.reason.eye).toBe("OS");
      expect(result.reason.value).toBe(500);
      expect(result.reason.limit).toBe(400);
    }
  });

  it("6. OS CYL is checked before OS ADD", () => {
    const rx: Prescription = {
      od: { sph: 0 as Diopter, add: 200 as Diopter },
      os: { sph: 0 as Diopter, cyl: -500 as Diopter, add: 400 as Diopter }, // fails CYL and ADD
      pd: { single: 600 },
    };
    const result = checkLens(rx, "PROGRESSIVE", bifocalLens);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason.code).toBe("CYL_OUT_OF_RANGE");
      expect(result.reason.eye).toBe("OS");
      expect(result.reason.value).toBe(-500);
      expect(result.reason.limit).toBe(-300);
    }
  });

  it("7. OS ADD is checked when everything else passes", () => {
    const rx: Prescription = {
      od: { sph: 0 as Diopter, add: 200 as Diopter },
      os: { sph: 0 as Diopter, add: 350 as Diopter }, // fails ADD (max 300)
      pd: { single: 600 },
    };
    const result = checkLens(rx, "PROGRESSIVE", bifocalLens);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason.code).toBe("ADD_OUT_OF_RANGE");
      expect(result.reason.eye).toBe("OS");
      expect(result.reason.value).toBe(350);
      expect(result.reason.limit).toBe(300);
    }
  });
});

describe("Boundaries and ADD restrictions", () => {
  it("boundaries are inclusive for SPH min and max", () => {
    const rxMin: Prescription = {
      od: { sph: -800 as Diopter },
      os: { sph: -800 as Diopter },
      pd: { single: 600 },
    };
    expect(checkLens(rxMin, "SINGLE_VISION", fixtureLensL).available).toBe(true);

    const rxMax: Prescription = {
      od: { sph: 600 as Diopter },
      os: { sph: 600 as Diopter },
      pd: { single: 600 },
    };
    expect(checkLens(rxMax, "SINGLE_VISION", fixtureLensL).available).toBe(true);

    // Just outside
    const rxAboveMax: Prescription = {
      od: { sph: 625 as Diopter },
      os: { sph: 0 as Diopter },
      pd: { single: 600 },
    };
    const resAbove = checkLens(rxAboveMax, "SINGLE_VISION", fixtureLensL);
    expect(resAbove).toEqual({
      available: false,
      reason: {
        code: "SPH_ABOVE_MAX",
        field: "sph",
        eye: "OD",
        value: 625,
        limit: 600,
      },
    });
  });

  it("boundaries are inclusive for CYL min and max", () => {
    const rxCylMin: Prescription = {
      od: { sph: 0 as Diopter, cyl: -400 as Diopter, axis: 90 },
      os: { sph: 0 as Diopter, cyl: 0 as Diopter, axis: 90 },
      pd: { single: 600 },
    };
    expect(checkLens(rxCylMin, "SINGLE_VISION", fixtureLensL).available).toBe(true);

    // Outside cylMin
    const rxCylBelowMin: Prescription = {
      od: { sph: 0 as Diopter, cyl: -425 as Diopter, axis: 90 },
      os: { sph: 0 as Diopter },
      pd: { single: 600 },
    };
    expect(checkLens(rxCylBelowMin, "SINGLE_VISION", fixtureLensL)).toEqual({
      available: false,
      reason: {
        code: "CYL_OUT_OF_RANGE",
        field: "cyl",
        eye: "OD",
        value: -425,
        limit: -400,
      },
    });

    // Outside cylMax
    const lensWithCylMinMax: Lens = {
      ...fixtureLensL,
      limits: {
        ...fixtureLensL.limits,
        cylMin: -400 as Diopter,
        cylMax: -100 as Diopter,
      },
    };
    const rxSpherical: Prescription = {
      od: { sph: 0 as Diopter, cyl: 0 as Diopter },
      os: { sph: 0 as Diopter, cyl: -200 as Diopter },
      pd: { single: 600 },
    };
    expect(checkLens(rxSpherical, "SINGLE_VISION", lensWithCylMinMax)).toEqual({
      available: false,
      reason: {
        code: "CYL_OUT_OF_RANGE",
        field: "cyl",
        eye: "OD",
        value: 0,
        limit: -100,
      },
    });
  });

  it("missing ADD limits mean no ADD restriction", () => {
    // fixtureLensL has addMin/addMax = undefined
    const rxWithAdd: Prescription = {
      od: { sph: 0 as Diopter, add: 350 as Diopter },
      os: { sph: 0 as Diopter, add: 400 as Diopter },
      pd: { single: 600 },
    };
    expect(checkLens(rxWithAdd, "PROGRESSIVE", fixtureLensL).available).toBe(true);
  });

  it("ADD limits are checked inclusively when defined", () => {
    const lensWithAddLimits: Lens = {
      ...fixtureLensL,
      limits: {
        ...fixtureLensL.limits,
        addMin: 75 as Diopter,
        addMax: 350 as Diopter,
      },
    };

    // Inclusive min
    const rxMin: Prescription = {
      od: { sph: 0 as Diopter, add: 75 as Diopter },
      os: { sph: 0 as Diopter, add: 350 as Diopter },
      pd: { single: 600 },
    };
    expect(checkLens(rxMin, "PROGRESSIVE", lensWithAddLimits).available).toBe(true);

    // Below min
    const rxBelowMin: Prescription = {
      od: { sph: 0 as Diopter, add: 50 as Diopter },
      os: { sph: 0 as Diopter, add: 200 as Diopter },
      pd: { single: 600 },
    };
    expect(checkLens(rxBelowMin, "PROGRESSIVE", lensWithAddLimits)).toEqual({
      available: false,
      reason: {
        code: "ADD_OUT_OF_RANGE",
        field: "add",
        eye: "OD",
        value: 50,
        limit: 75,
      },
    });

    // Above max
    const rxAboveMax: Prescription = {
      od: { sph: 0 as Diopter, add: 200 as Diopter },
      os: { sph: 0 as Diopter, add: 375 as Diopter },
      pd: { single: 600 },
    };
    expect(checkLens(rxAboveMax, "PROGRESSIVE", lensWithAddLimits)).toEqual({
      available: false,
      reason: {
        code: "ADD_OUT_OF_RANGE",
        field: "add",
        eye: "OS",
        value: 375,
        limit: 350,
      },
    });
  });

  it("OS with plus-cyl is transposed properly", () => {
    const rx: Prescription = {
      od: { sph: -200 as Diopter },
      os: { sph: 500 as Diopter, cyl: 150 as Diopter, axis: 90 }, // transposes to +650/-150x180
      pd: { single: 600 },
    };
    const result = checkLens(rx, "SINGLE_VISION", fixtureLensL);
    expect(result).toEqual({
      available: false,
      reason: {
        code: "SPH_ABOVE_MAX",
        field: "sph",
        eye: "OS",
        value: 650,
        limit: 600,
      },
    });
  });
});

describe("filterLenses", () => {
  it("preserves input order deterministically", () => {
    const lensA: Lens = { ...fixtureLensL, id: "lens-a", position: 1 };
    const lensB: Lens = {
      ...fixtureLensL,
      id: "lens-b",
      position: 2,
      limits: { ...fixtureLensL.limits, sphMin: -500 as Diopter },
    };
    const lensC: Lens = { ...fixtureLensL, id: "lens-c", position: 3 };

    const rx: Prescription = {
      od: { sph: -600 as Diopter }, // passes A (-800), fails B (-500), passes C (-800)
      os: { sph: 0 as Diopter },
      pd: { single: 630 },
    };

    const lenses = [lensA, lensB, lensC];
    const results = filterLenses(rx, "SINGLE_VISION", lenses);

    expect(results).toHaveLength(3);
    expect(results[0].lens.id).toBe("lens-a");
    expect(results[0].available).toBe(true);
    expect(results[0].result).toEqual({ available: true });

    expect(results[1].lens.id).toBe("lens-b");
    expect(results[1].available).toBe(false);
    expect(results[1].reason?.code).toBe("SPH_BELOW_MIN");
    expect(results[1].result.available).toBe(false);

    expect(results[2].lens.id).toBe("lens-c");
    expect(results[2].available).toBe(true);
    expect(results[2].result).toEqual({ available: true });
  });
});

describe("Sabotage test (transposition omitted)", () => {
  // If we simulate checkLens without transposition:
  function checkLensWithoutTransposition(
    rx: Prescription,
    rxType: RxType,
    lens: Lens,
  ): { available: true } | { available: false; reason: { code: string } } {
    const { limits } = lens;
    if (!limits.rxTypes.includes(rxType)) {
      return { available: false, reason: { code: "RX_TYPE_NOT_SUPPORTED" } };
    }
    // No transposition of plus cyl
    const checkEyeNoTrans = (eye: { sph: number; cyl?: number }) => {
      if (eye.sph < limits.sphMin) return { code: "SPH_BELOW_MIN" };
      if (eye.sph > limits.sphMax) return { code: "SPH_ABOVE_MAX" };
      const cyl = eye.cyl ?? 0;
      if (cyl < limits.cylMin) return { code: "CYL_OUT_OF_RANGE" };
      if (cyl > limits.cylMax) return { code: "CYL_OUT_OF_RANGE" };
      return null;
    };
    const od = checkEyeNoTrans(rx.od);
    if (od) return { available: false, reason: od };
    const os = checkEyeNoTrans(rx.os);
    if (os) return { available: false, reason: os };
    return { available: true };
  }

  it("verifies plus-cyl row 4 fails with CYL_OUT_OF_RANGE instead of SPH_ABOVE_MAX if transposition is dropped", () => {
    const row4Rx: Prescription = {
      od: { sph: 500 as Diopter, cyl: 150 as Diopter, axis: 90 },
      os: { sph: 100 as Diopter },
      pd: { single: 630 },
    };
    const withoutTrans = checkLensWithoutTransposition(row4Rx, "SINGLE_VISION", fixtureLensL);
    // Without transposition, CYL +150 > cylMax (0), so it fails with CYL_OUT_OF_RANGE instead of SPH_ABOVE_MAX
    expect(withoutTrans.available).toBe(false);
    if (!withoutTrans.available) {
      expect(withoutTrans.reason.code).toBe("CYL_OUT_OF_RANGE");
      expect(withoutTrans.reason.code).not.toBe("SPH_ABOVE_MAX");
    }
  });

  it("verifies plus-cyl row 5 fails with CYL_OUT_OF_RANGE instead of available: true if transposition is dropped", () => {
    const row5Rx: Prescription = {
      od: { sph: 400 as Diopter, cyl: 100 as Diopter, axis: 180 },
      os: { sph: 100 as Diopter },
      pd: { single: 630 },
    };
    const withoutTrans = checkLensWithoutTransposition(row5Rx, "SINGLE_VISION", fixtureLensL);
    // Without transposition, CYL +100 > cylMax (0), so it incorrectly reports unavailable!
    expect(withoutTrans.available).toBe(false);
  });
});

describe("INV-5: integer hundredths and tenths", () => {
  it("reason values and limits are all integers", () => {
    const testCases: Array<{ rx: Prescription; expectedCode: string }> = [
      {
        rx: {
          od: { sph: -825 as Diopter },
          os: { sph: 0 as Diopter },
          pd: { single: 630 },
        },
        expectedCode: "SPH_BELOW_MIN",
      },
      {
        rx: {
          od: { sph: 625 as Diopter },
          os: { sph: 0 as Diopter },
          pd: { single: 630 },
        },
        expectedCode: "SPH_ABOVE_MAX",
      },
      {
        rx: {
          od: { sph: 0 as Diopter, cyl: -425 as Diopter },
          os: { sph: 0 as Diopter },
          pd: { single: 630 },
        },
        expectedCode: "CYL_OUT_OF_RANGE",
      },
    ];

    for (const { rx, expectedCode } of testCases) {
      const res = checkLens(rx, "SINGLE_VISION", fixtureLensL);
      expect(res.available).toBe(false);
      if (!res.available && res.reason.code !== "RX_TYPE_NOT_SUPPORTED") {
        expect(res.reason.code).toBe(expectedCode);
        expect(Number.isInteger(res.reason.value)).toBe(true);
        expect(Number.isInteger(res.reason.limit)).toBe(true);
      }
    }
  });
});
