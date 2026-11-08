import { describe, expect, it } from "vitest";
import type { Prescription } from "../types/index.js";
import {
  RX_VALIDATION_CODES,
  isValidPrescription,
  normalizePrescription,
  validateAndNormalizePrescription,
  validatePrescription,
} from "./validate.js";

const VALID_SV_RX: Prescription = {
  od: { sph: -225, cyl: -50, axis: 180 },
  os: { sph: -200 },
  pd: { single: 635 },
};

const VALID_PROGRESSIVE_RX: Prescription = {
  od: { sph: -225, cyl: -50, axis: 180, add: 200 },
  os: { sph: -200, add: 200 },
  pd: { single: 635 },
};

describe("Spec 10 — Rx validation", () => {
  describe("Cross-field rows (Examples table)", () => {
    it("CYL -1.00 with empty AXIS produces AXIS_REQUIRED on that eye", () => {
      const rx: Prescription = {
        od: { sph: -200, cyl: -100 },
        os: { sph: -200 },
        pd: { single: 630 },
      };
      const errors = validatePrescription(rx, "SINGLE_VISION");
      expect(errors).toEqual([
        {
          field: "axis",
          eye: "od",
          path: "od.axis",
          code: RX_VALIDATION_CODES.AXIS_REQUIRED,
        },
      ]);
    });

    it("CYL 0 with AXIS 90 is valid, and normalization drops the axis", () => {
      const rx: Prescription = {
        od: { sph: -200, cyl: 0, axis: 90 },
        os: { sph: -200 },
        pd: { single: 630 },
      };
      const errors = validatePrescription(rx, "SINGLE_VISION");
      expect(errors).toEqual([]);

      const normalized = normalizePrescription(rx, "SINGLE_VISION");
      expect(normalized.od.axis).toBeUndefined();
      expect(normalized.od.cyl).toBeUndefined();
    });

    it("PROGRESSIVE with empty ADD produces ADD_REQUIRED on that eye", () => {
      const rx: Prescription = {
        od: { sph: -200, add: 200 },
        os: { sph: -200 }, // missing ADD
        pd: { single: 630 },
      };
      const errors = validatePrescription(rx, "PROGRESSIVE");
      expect(errors).toEqual([
        {
          field: "add",
          eye: "os",
          path: "os.add",
          code: RX_VALIDATION_CODES.ADD_REQUIRED,
        },
      ]);
    });

    it("READING with empty ADD produces ADD_REQUIRED on that eye", () => {
      const rx: Prescription = {
        od: { sph: -200 }, // missing ADD
        os: { sph: -200, add: 200 },
        pd: { single: 630 },
      };
      const errors = validatePrescription(rx, "READING");
      expect(errors).toEqual([
        {
          field: "add",
          eye: "od",
          path: "od.add",
          code: RX_VALIDATION_CODES.ADD_REQUIRED,
        },
      ]);
    });

    it("SINGLE_VISION with ADD +2.00 is valid, and normalization drops the add", () => {
      const rx: Prescription = {
        od: { sph: -200, add: 200 },
        os: { sph: -200, add: 200 },
        pd: { single: 630 },
      };
      const errors = validatePrescription(rx, "SINGLE_VISION");
      expect(errors).toEqual([]);

      const normalized = normalizePrescription(rx, "SINGLE_VISION");
      expect(normalized.od.add).toBeUndefined();
      expect(normalized.os.add).toBeUndefined();
    });
  });

  describe("NON_PRESCRIPTION rules", () => {
    it("valid when prescription is empty or undefined", () => {
      expect(validatePrescription(undefined, "NON_PRESCRIPTION")).toEqual([]);
      expect(validatePrescription(null, "NON_PRESCRIPTION")).toEqual([]);
      expect(validatePrescription({}, "NON_PRESCRIPTION")).toEqual([]);
    });

    it("rejects non-empty values and hostile shapes with NON_PRESCRIPTION_NOT_EMPTY (R1-F2)", () => {
      const hostileInputs = [
        "not empty",
        "",
        123,
        0,
        true,
        false,
        [],
        [1, 2, 3],
        { notes: "private" },
        { notes: "" },
        { unknownKey: true },
        { od: {} },
        { od: {}, os: {}, pd: {} },
        VALID_SV_RX,
      ];

      for (const input of hostileInputs) {
        const errors = validatePrescription(input, "NON_PRESCRIPTION");
        expect(errors).toEqual([
          {
            field: "prescription",
            path: "prescription",
            code: RX_VALIDATION_CODES.NON_PRESCRIPTION_NOT_EMPTY,
          },
        ]);
      }
    });

    it("normalizes valid empty NON_PRESCRIPTION to explicit absent prescription (R1-F3)", () => {
      // validateAndNormalizePrescription must return { ok: true, prescription: undefined, errors: [] }
      // without throwing TypeError and without inventing OD/OS 0 or PD 630
      const fromUndefined = validateAndNormalizePrescription(
        undefined,
        "NON_PRESCRIPTION",
      );
      expect(fromUndefined).toEqual({
        ok: true,
        prescription: undefined,
        errors: [],
      });
      expect(fromUndefined.ok).toBe(true);
      if (fromUndefined.ok) {
        expect(fromUndefined.prescription).toBeUndefined();
      }

      const fromNull = validateAndNormalizePrescription(
        null,
        "NON_PRESCRIPTION",
      );
      expect(fromNull).toEqual({
        ok: true,
        prescription: undefined,
        errors: [],
      });
      expect(fromNull.ok).toBe(true);
      if (fromNull.ok) {
        expect(fromNull.prescription).toBeUndefined();
      }

      const fromEmptyObj = validateAndNormalizePrescription(
        {},
        "NON_PRESCRIPTION",
      );
      expect(fromEmptyObj).toEqual({
        ok: true,
        prescription: undefined,
        errors: [],
      });
      expect(fromEmptyObj.ok).toBe(true);
      if (fromEmptyObj.ok) {
        expect(fromEmptyObj.prescription).toBeUndefined();
      }

      // normalizePrescription directly returns undefined
      expect(
        normalizePrescription(undefined, "NON_PRESCRIPTION"),
      ).toBeUndefined();
      expect(normalizePrescription(null, "NON_PRESCRIPTION")).toBeUndefined();
      expect(normalizePrescription({}, "NON_PRESCRIPTION")).toBeUndefined();
    });
  });

  describe("Mixed CYL sign between eyes", () => {
    it("allows mixed CYL signs (OD minus, OS plus)", () => {
      const rx: Prescription = {
        od: { sph: -200, cyl: -100, axis: 90 },
        os: { sph: -200, cyl: 100, axis: 90 },
        pd: { single: 630 },
      };
      const errors = validatePrescription(rx, "SINGLE_VISION");
      expect(errors).toEqual([]);
    });
  });

  describe("Self-check 3 — errors carry the eye for UI highlighting", () => {
    it("assigns eye: 'od' for OD errors and eye: 'os' for OS errors", () => {
      const rx: Prescription = {
        od: { sph: -2500, cyl: -100 }, // SPH_RANGE, AXIS_REQUIRED
        os: { sph: 200, add: 50 }, // ADD_RANGE
        pd: { od: 200, os: 450 }, // PD_RANGE on OD, PD_RANGE on OS
      };

      const errors = validatePrescription(rx, "PROGRESSIVE");

      const odSphError = errors.find(
        (e) => e.field === "sph" && e.eye === "od",
      );
      expect(odSphError).toBeDefined();
      expect(odSphError?.code).toBe(RX_VALIDATION_CODES.SPH_RANGE);

      const odAxisError = errors.find(
        (e) => e.field === "axis" && e.eye === "od",
      );
      expect(odAxisError).toBeDefined();
      expect(odAxisError?.code).toBe(RX_VALIDATION_CODES.AXIS_REQUIRED);

      const osAddError = errors.find(
        (e) => e.field === "add" && e.eye === "os",
      );
      expect(osAddError).toBeDefined();
      expect(osAddError?.code).toBe(RX_VALIDATION_CODES.ADD_RANGE);

      const odPdError = errors.find((e) => e.field === "pd" && e.eye === "od");
      expect(odPdError).toBeDefined();
      expect(odPdError?.code).toBe(RX_VALIDATION_CODES.PD_RANGE);

      const osPdError = errors.find((e) => e.field === "pd" && e.eye === "os");
      expect(osPdError).toBeDefined();
      expect(osPdError?.code).toBe(RX_VALIDATION_CODES.PD_RANGE);
    });
  });

  describe("Multi-error collection (3 errors)", () => {
    it("returns all three errors when a prescription has three distinct errors", () => {
      const rx: Prescription = {
        od: { sph: -200, cyl: -100 }, // Error 1: AXIS_REQUIRED
        os: { sph: 2500 }, // Error 2: SPH_RANGE (+25.00 exceeds +20.00)
        pd: { single: 633 }, // Error 3: PD_STEP (63.3 is not a 0.5 mm step)
      };

      const errors = validatePrescription(rx, "SINGLE_VISION");
      expect(errors).toHaveLength(3);
      expect(errors).toEqual([
        {
          field: "axis",
          eye: "od",
          path: "od.axis",
          code: RX_VALIDATION_CODES.AXIS_REQUIRED,
        },
        {
          field: "sph",
          eye: "os",
          path: "os.sph",
          code: RX_VALIDATION_CODES.SPH_RANGE,
        },
        {
          field: "pd",
          path: "pd.single",
          code: RX_VALIDATION_CODES.PD_STEP,
        },
      ]);
    });
  });

  describe("Field ranges and steps validation", () => {
    it("validates SPH step (0.25) and range (-2000..+2000)", () => {
      // Step failure
      const stepRx: Prescription = {
        od: { sph: 230 }, // 2.30 D is not a quarter step
        os: { sph: 0 },
        pd: { single: 630 },
      };
      expect(validatePrescription(stepRx, "SINGLE_VISION")).toEqual([
        {
          field: "sph",
          eye: "od",
          path: "od.sph",
          code: RX_VALIDATION_CODES.SPH_STEP,
        },
      ]);

      // Range failure (-2025)
      const rangeRx: Prescription = {
        od: { sph: -2025 },
        os: { sph: 0 },
        pd: { single: 630 },
      };
      expect(validatePrescription(rangeRx, "SINGLE_VISION")).toEqual([
        {
          field: "sph",
          eye: "od",
          path: "od.sph",
          code: RX_VALIDATION_CODES.SPH_RANGE,
        },
      ]);
    });

    it("validates CYL step (0.25) and range (-600..+600)", () => {
      const stepRx: Prescription = {
        od: { sph: 0, cyl: -110, axis: 90 },
        os: { sph: 0 },
        pd: { single: 630 },
      };
      expect(validatePrescription(stepRx, "SINGLE_VISION")).toEqual([
        {
          field: "cyl",
          eye: "od",
          path: "od.cyl",
          code: RX_VALIDATION_CODES.CYL_STEP,
        },
      ]);

      const rangeRx: Prescription = {
        od: { sph: 0, cyl: -625, axis: 90 },
        os: { sph: 0 },
        pd: { single: 630 },
      };
      expect(validatePrescription(rangeRx, "SINGLE_VISION")).toEqual([
        {
          field: "cyl",
          eye: "od",
          path: "od.cyl",
          code: RX_VALIDATION_CODES.CYL_RANGE,
        },
      ]);
    });

    it("validates AXIS range (1..180)", () => {
      const zeroAxis: Prescription = {
        od: { sph: 0, cyl: -100, axis: 0 },
        os: { sph: 0 },
        pd: { single: 630 },
      };
      expect(validatePrescription(zeroAxis, "SINGLE_VISION")).toEqual([
        {
          field: "axis",
          eye: "od",
          path: "od.axis",
          code: RX_VALIDATION_CODES.AXIS_RANGE,
        },
      ]);

      const highAxis: Prescription = {
        od: { sph: 0, cyl: -100, axis: 181 },
        os: { sph: 0 },
        pd: { single: 630 },
      };
      expect(validatePrescription(highAxis, "SINGLE_VISION")).toEqual([
        {
          field: "axis",
          eye: "od",
          path: "od.axis",
          code: RX_VALIDATION_CODES.AXIS_RANGE,
        },
      ]);
    });

    it("validates ADD range (+75..+350) and step (0.25)", () => {
      const lowAdd: Prescription = {
        od: { sph: 0, add: 50 },
        os: { sph: 0, add: 200 },
        pd: { single: 630 },
      };
      expect(validatePrescription(lowAdd, "PROGRESSIVE")).toEqual([
        {
          field: "add",
          eye: "od",
          path: "od.add",
          code: RX_VALIDATION_CODES.ADD_RANGE,
        },
      ]);

      const highAdd: Prescription = {
        od: { sph: 0, add: 375 },
        os: { sph: 0, add: 200 },
        pd: { single: 630 },
      };
      expect(validatePrescription(highAdd, "PROGRESSIVE")).toEqual([
        {
          field: "add",
          eye: "od",
          path: "od.add",
          code: RX_VALIDATION_CODES.ADD_RANGE,
        },
      ]);

      const stepAdd: Prescription = {
        od: { sph: 0, add: 230 },
        os: { sph: 0, add: 200 },
        pd: { single: 630 },
      };
      expect(validatePrescription(stepAdd, "PROGRESSIVE")).toEqual([
        {
          field: "add",
          eye: "od",
          path: "od.add",
          code: RX_VALIDATION_CODES.ADD_STEP,
        },
      ]);
    });

    it("rejects ADD 0 / PL as out of range for PROGRESSIVE and READING (R1-F1)", () => {
      const progressiveZeroAdd: Prescription = {
        od: { sph: 0, add: 0 },
        os: { sph: 0, add: 200 },
        pd: { single: 630 },
      };
      expect(validatePrescription(progressiveZeroAdd, "PROGRESSIVE")).toEqual([
        {
          field: "add",
          eye: "od",
          path: "od.add",
          code: RX_VALIDATION_CODES.ADD_RANGE,
        },
      ]);

      const readingZeroAdd: Prescription = {
        od: { sph: 0, add: 200 },
        os: { sph: 0, add: 0 },
        pd: { single: 630 },
      };
      expect(validatePrescription(readingZeroAdd, "READING")).toEqual([
        {
          field: "add",
          eye: "os",
          path: "os.add",
          code: RX_VALIDATION_CODES.ADD_RANGE,
        },
      ]);
    });

    it("validates PD single and dual requirements", () => {
      // Missing PD
      const noPd = {
        od: { sph: 0 },
        os: { sph: 0 },
      };
      expect(validatePrescription(noPd, "SINGLE_VISION")).toEqual([
        {
          field: "pd",
          path: "pd",
          code: RX_VALIDATION_CODES.PD_REQUIRED,
        },
      ]);

      // Single PD out of range
      const lowPd: Prescription = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: { single: 490 },
      };
      expect(validatePrescription(lowPd, "SINGLE_VISION")).toEqual([
        {
          field: "pd",
          path: "pd.single",
          code: RX_VALIDATION_CODES.PD_RANGE,
        },
      ]);

      // Dual PD valid
      const dualPd: Prescription = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: { od: 320, os: 315 },
      };
      expect(validatePrescription(dualPd, "SINGLE_VISION")).toEqual([]);
    });

    it("enforces single XOR dual PD representation and rejects conflicting shapes (R1-F4)", () => {
      // Conflicting shape: both single and dual values present
      const bothWithBogusDual = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: { single: 630, od: 100, os: 100 },
      };
      expect(validatePrescription(bothWithBogusDual, "SINGLE_VISION")).toEqual([
        {
          field: "pd",
          path: "pd",
          code: RX_VALIDATION_CODES.INVALID,
        },
      ]);

      const bothWithValidDual = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: { single: 630, od: 320, os: 310 },
      };
      expect(validatePrescription(bothWithValidDual, "SINGLE_VISION")).toEqual([
        {
          field: "pd",
          path: "pd",
          code: RX_VALIDATION_CODES.INVALID,
        },
      ]);

      const singleWithPartialDualOd = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: { single: 630, od: 320 },
      };
      expect(
        validatePrescription(singleWithPartialDualOd, "SINGLE_VISION"),
      ).toEqual([
        {
          field: "pd",
          path: "pd",
          code: RX_VALIDATION_CODES.INVALID,
        },
      ]);

      const singleWithPartialDualOs = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: { single: 630, os: 310 },
      };
      expect(
        validatePrescription(singleWithPartialDualOs, "SINGLE_VISION"),
      ).toEqual([
        {
          field: "pd",
          path: "pd",
          code: RX_VALIDATION_CODES.INVALID,
        },
      ]);

      // Neither representation: empty object
      const emptyPd = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: {},
      };
      expect(validatePrescription(emptyPd, "SINGLE_VISION")).toEqual([
        {
          field: "pd",
          path: "pd",
          code: RX_VALIDATION_CODES.PD_REQUIRED,
        },
      ]);

      // Partial dual PD (missing one eye)
      const missingOs = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: { od: 320 },
      };
      expect(validatePrescription(missingOs, "SINGLE_VISION")).toEqual([
        {
          field: "pd",
          eye: "os",
          path: "pd.os",
          code: RX_VALIDATION_CODES.PD_REQUIRED,
        },
      ]);

      const missingOd = {
        od: { sph: 0 },
        os: { sph: 0 },
        pd: { os: 315 },
      };
      expect(validatePrescription(missingOd, "SINGLE_VISION")).toEqual([
        {
          field: "pd",
          eye: "od",
          path: "pd.od",
          code: RX_VALIDATION_CODES.PD_REQUIRED,
        },
      ]);
    });
  });

  describe("Helper functions: isValidPrescription & validateAndNormalizePrescription", () => {
    it("isValidPrescription returns true for valid, false for invalid", () => {
      expect(isValidPrescription(VALID_SV_RX, "SINGLE_VISION")).toBe(true);
      expect(isValidPrescription(VALID_PROGRESSIVE_RX, "PROGRESSIVE")).toBe(
        true,
      );
      expect(
        isValidPrescription(
          { od: { sph: 0, cyl: -100 }, os: { sph: 0 }, pd: { single: 630 } },
          "SINGLE_VISION",
        ),
      ).toBe(false);
    });

    it("validateAndNormalizePrescription returns { ok: true, prescription } on valid input", () => {
      const rxWithExtra: Prescription = {
        od: { sph: -200, cyl: 0, axis: 90, add: 200 },
        os: { sph: -200, add: 200 },
        pd: { single: 630 },
      };

      const result = validateAndNormalizePrescription(
        rxWithExtra,
        "SINGLE_VISION",
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.errors).toEqual([]);
        expect(result.prescription.od.axis).toBeUndefined();
        expect(result.prescription.od.add).toBeUndefined();
        expect(result.prescription.os.add).toBeUndefined();
      }
    });

    it("validateAndNormalizePrescription returns { ok: false, errors } on invalid input", () => {
      const badRx: Prescription = {
        od: { sph: -200, cyl: -100 },
        os: { sph: -200 },
        pd: { single: 630 },
      };
      const result = validateAndNormalizePrescription(badRx, "SINGLE_VISION");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].code).toBe(RX_VALIDATION_CODES.AXIS_REQUIRED);
      }
    });
  });
});
