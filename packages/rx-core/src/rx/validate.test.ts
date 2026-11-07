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
      expect(
        validatePrescription({ od: {}, os: {}, pd: {} }, "NON_PRESCRIPTION"),
      ).toEqual([]);
    });

    it("rejects non-empty prescription with NON_PRESCRIPTION_NOT_EMPTY", () => {
      const errors = validatePrescription(VALID_SV_RX, "NON_PRESCRIPTION");
      expect(errors).toEqual([
        {
          field: "prescription",
          path: "prescription",
          code: RX_VALIDATION_CODES.NON_PRESCRIPTION_NOT_EMPTY,
        },
      ]);
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
