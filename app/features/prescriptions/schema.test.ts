import { describe, expect, it } from "vitest";

import { BadRequestError } from "../../shared/http/errors.server";
import {
  localPrescriptionSubmitBodySchema,
  manualPrescriptionSubmitSchema,
  MAX_UPLOAD_KEYS,
  parsePrescriptionSubmitBody,
  prescriptionSubmitSchema,
  uploadPrescriptionSubmitSchema,
} from "./schema";

describe("Spec 22: Prescriptions local schemas (R5-F1)", () => {
  const validPrescription = {
    od: { sph: -200, cyl: -50, axis: 90 },
    os: { sph: -175, cyl: -75, axis: 85 },
    pd: { single: 620 },
  };

  describe("MAX_UPLOAD_KEYS constant", () => {
    it("is defined as 5 locally in app/features/prescriptions", () => {
      expect(MAX_UPLOAD_KEYS).toBe(5);
    });
  });

  describe("localPrescriptionSubmitBodySchema", () => {
    it("enforces MAX_UPLOAD_KEYS (accepts 5, rejects 6)", () => {
      const fiveKeys = Array.from({ length: 5 }, (_, i) => `key-${i}`);
      const sixKeys = Array.from({ length: 6 }, (_, i) => `key-${i}`);

      const ok = localPrescriptionSubmitBodySchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: fiveKeys,
      });
      expect(ok.success).toBe(true);

      const fail = localPrescriptionSubmitBodySchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: sixKeys,
      });
      expect(fail.success).toBe(false);
    });
  });

  describe("manualPrescriptionSubmitSchema", () => {
    it("accepts valid manual prescription", () => {
      const ok = manualPrescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        prescription: validPrescription,
      });
      expect(ok.success).toBe(true);
    });

    it("forbids draftId and uploadedKeys", () => {
      const withDraft = manualPrescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        prescription: validPrescription,
        draftId: "draft-1",
      });
      expect(withDraft.success).toBe(false);

      const withUploads = manualPrescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        prescription: validPrescription,
        uploadedKeys: ["key-1"],
      });
      expect(withUploads.success).toBe(false);
    });
  });

  describe("uploadPrescriptionSubmitSchema", () => {
    it("accepts valid upload payload up to 5 keys", () => {
      const ok1 = uploadPrescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: ["key-1"],
      });
      expect(ok1.success).toBe(true);

      const ok5 = uploadPrescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: Array.from({ length: 5 }, (_, i) => `key-${i}`),
      });
      expect(ok5.success).toBe(true);
    });

    it("rejects 0 keys and 6 keys (> MAX_UPLOAD_KEYS)", () => {
      const emptyKeys = uploadPrescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: [],
      });
      expect(emptyKeys.success).toBe(false);

      const sixKeys = uploadPrescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: Array.from({ length: 6 }, (_, i) => `key-${i}`),
      });
      expect(sixKeys.success).toBe(false);
    });

    it("forbids manual prescription in upload submissions", () => {
      const fail = uploadPrescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: ["key-1"],
        prescription: validPrescription,
      });
      expect(fail.success).toBe(false);
    });
  });

  describe("prescriptionSubmitSchema", () => {
    it("enforces mutual exclusivity between manual and upload fields", () => {
      // Ambiguous: both manual Rx and upload fields
      const ambiguous = prescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        prescription: validPrescription,
        draftId: "draft-1",
        uploadedKeys: ["key-1"],
      });
      expect(ambiguous.success).toBe(false);
      expect(ambiguous.error?.issues.some((i) => "params" in i && (i.params as { code?: string })?.code === "AMBIGUOUS_RX_SOURCE")).toBe(true);

      // Neither manual nor upload provided
      const empty = prescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
      });
      expect(empty.success).toBe(false);
    });

    it("enforces MAX_UPLOAD_KEYS cap (accepts 5, rejects 6)", () => {
      const ok5 = prescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: Array.from({ length: 5 }, (_, i) => `key-${i}`),
      });
      expect(ok5.success).toBe(true);

      const fail6 = prescriptionSubmitSchema.safeParse({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: Array.from({ length: 6 }, (_, i) => `key-${i}`),
      });
      expect(fail6.success).toBe(false);
    });

    it("rejects NON_PRESCRIPTION rxType", () => {
      const fail = prescriptionSubmitSchema.safeParse({
        rxType: "NON_PRESCRIPTION",
        prescription: validPrescription,
      });
      expect(fail.success).toBe(false);
      expect(fail.error?.issues.some((i) => "params" in i && (i.params as { code?: string })?.code === "UNSUPPORTED_RX_TYPE")).toBe(true);
    });
  });

  describe("parsePrescriptionSubmitBody", () => {
    it("parses valid manual prescription", () => {
      const result = parsePrescriptionSubmitBody({
        rxType: "SINGLE_VISION",
        prescription: validPrescription,
      });
      expect(result.rxType).toBe("SINGLE_VISION");
      expect(result.prescription).toBeDefined();
    });

    it("parses valid upload prescription (1 to 5 keys)", () => {
      const result = parsePrescriptionSubmitBody({
        rxType: "SINGLE_VISION",
        draftId: "draft-1",
        uploadedKeys: ["key-1", "key-2"],
      });
      expect(result.rxType).toBe("SINGLE_VISION");
      expect(result.draftId).toBe("draft-1");
      expect(result.uploadedKeys).toEqual(["key-1", "key-2"]);
    });

    it("rejects 6 uploaded keys with 400 BAD_REQUEST", () => {
      expect(() =>
        parsePrescriptionSubmitBody({
          rxType: "SINGLE_VISION",
          draftId: "draft-1",
          uploadedKeys: Array.from({ length: 6 }, (_, i) => `key-${i}`),
        }),
      ).toThrowError(BadRequestError);
    });

    it("rejects ambiguous input (both manual and upload) with AMBIGUOUS_RX_SOURCE", () => {
      try {
        parsePrescriptionSubmitBody({
          rxType: "SINGLE_VISION",
          prescription: validPrescription,
          draftId: "draft-1",
          uploadedKeys: ["key-1"],
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect((err as BadRequestError).code).toBe("AMBIGUOUS_RX_SOURCE");
      }
    });

    it("rejects upload missing draftId with DRAFT_REQUIRED", () => {
      try {
        parsePrescriptionSubmitBody({
          rxType: "SINGLE_VISION",
          uploadedKeys: ["key-1"],
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect((err as BadRequestError).code).toBe("DRAFT_REQUIRED");
      }
    });

    it("rejects upload with empty uploadedKeys with UPLOAD_REQUIRED", () => {
      try {
        parsePrescriptionSubmitBody({
          rxType: "SINGLE_VISION",
          draftId: "draft-1",
          uploadedKeys: [],
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect((err as BadRequestError).code).toBe("UPLOAD_REQUIRED");
      }
    });

    it("rejects NON_PRESCRIPTION with UNSUPPORTED_RX_TYPE", () => {
      try {
        parsePrescriptionSubmitBody({
          rxType: "NON_PRESCRIPTION",
          prescription: validPrescription,
        });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect((err as BadRequestError).code).toBe("UNSUPPORTED_RX_TYPE");
      }
    });
  });
});
