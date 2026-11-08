import { z } from "zod";

import {
  idSchema,
  MAX_UPLOAD_KEYS,
  prescriptionSchema,
  prescriptionSubmitBodySchema,
  rxTypeSchema,
  type PrescriptionSubmitBody,
} from "../../../packages/rx-core/src/schemas/index.js";
import {
  BadRequestError,
  type FieldError,
} from "../../shared/http/errors.server";

/**
 * MANUAL prescription submission schema (R4-F1):
 * Requires prescription, forbids draftId and uploadedKeys.
 */
export const manualPrescriptionSubmitSchema = z.object({
  rxType: rxTypeSchema,
  prescription: prescriptionSchema,
  draftId: z
    .never({
      invalid_type_error: "draftId is forbidden for manual prescription submissions",
    })
    .optional(),
  uploadedKeys: z
    .never({
      invalid_type_error: "uploadedKeys is forbidden for manual prescription submissions",
    })
    .optional(),
});

/**
 * UPLOAD prescription submission schema (R4-F1):
 * Requires draftId + uploadedKeys (1..MAX_UPLOAD_KEYS), forbids prescription.
 */
export const uploadPrescriptionSubmitSchema = z.object({
  rxType: rxTypeSchema,
  draftId: idSchema,
  uploadedKeys: z
    .array(idSchema)
    .min(1, "At least one uploadedKey is required")
    .max(MAX_UPLOAD_KEYS),
  prescription: z
    .never({
      invalid_type_error: "prescription is forbidden for upload prescription submissions",
    })
    .optional(),
});

export type ManualPrescriptionSubmit = z.infer<
  typeof manualPrescriptionSubmitSchema
>;
export type UploadPrescriptionSubmit = z.infer<
  typeof uploadPrescriptionSubmitSchema
>;
export type PrescriptionSubmitPayload =
  | ManualPrescriptionSubmit
  | UploadPrescriptionSubmit;

/**
 * Validates prescription submission body at spec 22's boundary (R4-F1).
 * Enforces mutual exclusion:
 * - MANUAL requires prescription and forbids draftId/uploadedKeys.
 * - UPLOAD requires draftId + uploadedKeys and forbids prescription.
 * - Ambiguous input returns 400 AMBIGUOUS_RX_SOURCE without modifying drafts.
 */
export function parsePrescriptionSubmitBody(
  body: unknown,
): PrescriptionSubmitBody {
  const parsed = prescriptionSubmitBodySchema.safeParse(body);
  if (!parsed.success) {
    const fields: FieldError[] = parsed.error.issues.map((i) => ({
      path: i.path.join(".") || "body",
      code: i.code === "custom" ? i.message : "INVALID",
    }));
    throw new BadRequestError(
      "Invalid prescription submission body",
      "BAD_REQUEST",
      fields,
    );
  }

  // Prescriptions endpoint accepts only MANUAL and UPLOAD prescription types (R3-F2)
  if (parsed.data.rxType === "NON_PRESCRIPTION") {
    throw new BadRequestError(
      "Prescriptions endpoint does not accept NON_PRESCRIPTION",
      "UNSUPPORTED_RX_TYPE",
    );
  }

  const hasManual = parsed.data.prescription !== undefined;
  const hasUpload =
    parsed.data.draftId !== undefined || parsed.data.uploadedKeys !== undefined;

  // Mutual exclusion check: cannot combine manual prescription and upload fields (R4-F1)
  if (hasManual && hasUpload) {
    throw new BadRequestError(
      "Ambiguous prescription submission: cannot mix manual prescription and upload fields",
      "AMBIGUOUS_RX_SOURCE",
    );
  }

  if (hasManual) {
    const manualResult = manualPrescriptionSubmitSchema.safeParse(parsed.data);
    if (!manualResult.success) {
      const fields: FieldError[] = manualResult.error.issues.map((i) => ({
        path: i.path.join(".") || "body",
        code: i.code === "custom" ? i.message : "INVALID",
      }));
      throw new BadRequestError(
        "Invalid manual prescription submission",
        "BAD_REQUEST",
        fields,
      );
    }
    return manualResult.data;
  }

  if (hasUpload) {
    const uploadResult = uploadPrescriptionSubmitSchema.safeParse(parsed.data);
    if (!uploadResult.success) {
      if (!parsed.data.draftId) {
        throw new BadRequestError(
          "draftId is required for upload prescriptions",
          "DRAFT_REQUIRED",
        );
      }
      if (
        !parsed.data.uploadedKeys ||
        parsed.data.uploadedKeys.length === 0
      ) {
        throw new BadRequestError(
          "At least one uploadedKey is required",
          "UPLOAD_REQUIRED",
        );
      }
      const fields: FieldError[] = uploadResult.error.issues.map((i) => ({
        path: i.path.join(".") || "body",
        code: i.code === "custom" ? i.message : "INVALID",
      }));
      throw new BadRequestError(
        "Invalid upload prescription submission",
        "BAD_REQUEST",
        fields,
      );
    }
    return uploadResult.data;
  }

  // Neither manual nor upload fields present
  throw new BadRequestError(
    "Invalid prescription submission: must provide either prescription or draftId with uploadedKeys",
    "BAD_REQUEST",
    [{ path: "prescription", code: "REQUIRED" }],
  );
}
