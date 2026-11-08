import { z } from "zod";

import {
  idSchema,
  prescriptionSchema,
  prescriptionSubmitBodySchema,
  type PrescriptionSubmitBody,
} from "../../../packages/rx-core/src/schemas/index.js";
import {
  BadRequestError,
  type FieldError,
} from "../../shared/http/errors.server";

export const MAX_UPLOAD_KEYS = 5;

/**
 * Local schema extending rx-core's prescriptionSubmitBodySchema with a 5-key cap
 * on uploadedKeys for spec 22's endpoints (R5-F1).
 */
export const localPrescriptionSubmitBodySchema = prescriptionSubmitBodySchema.extend({
  uploadedKeys: z
    .array(idSchema)
    .max(MAX_UPLOAD_KEYS, `At most ${MAX_UPLOAD_KEYS} uploaded keys allowed`)
    .optional(),
});
export type LocalPrescriptionSubmitBody = z.infer<
  typeof localPrescriptionSubmitBodySchema
>;

/**
 * MANUAL prescription submission schema (R4-F1):
 * Requires prescription, forbids draftId and uploadedKeys.
 */
export const manualPrescriptionSubmitSchema = prescriptionSubmitBodySchema.extend({
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
 * UPLOAD prescription submission schema (R4-F1, R5-F1):
 * Requires draftId + uploadedKeys (1..MAX_UPLOAD_KEYS), forbids prescription.
 */
export const uploadPrescriptionSubmitSchema = prescriptionSubmitBodySchema.extend({
  draftId: idSchema,
  uploadedKeys: z
    .array(idSchema)
    .min(1, "At least one uploadedKey is required")
    .max(MAX_UPLOAD_KEYS, `At most ${MAX_UPLOAD_KEYS} uploaded keys allowed`),
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
 * Local prescription submission schema that wraps/extends rx-core's prescriptionSubmitBodySchema,
 * enforcing the 5-key cap and the MANUAL/UPLOAD exclusivity (R4-F1, R5-F1).
 */
export const prescriptionSubmitSchema = localPrescriptionSubmitBodySchema.superRefine(
  (data, ctx) => {
    if (data.rxType === "NON_PRESCRIPTION") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Prescriptions endpoint does not accept NON_PRESCRIPTION",
        params: { code: "UNSUPPORTED_RX_TYPE" },
        path: ["rxType"],
      });
      return;
    }

    const hasManual = data.prescription !== undefined;
    const hasUpload =
      data.draftId !== undefined ||
      (data.uploadedKeys !== undefined && data.uploadedKeys.length > 0);

    if (hasManual && hasUpload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Ambiguous prescription submission: cannot mix manual prescription and upload fields",
        params: { code: "AMBIGUOUS_RX_SOURCE" },
        path: ["prescription"],
      });
      return;
    }

    if (!hasManual && !hasUpload) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Invalid prescription submission: must provide either prescription or draftId with uploadedKeys",
        params: { code: "REQUIRED" },
        path: ["prescription"],
      });
      return;
    }

    if (hasUpload) {
      if (!data.draftId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "draftId is required for upload prescriptions",
          params: { code: "DRAFT_REQUIRED" },
          path: ["draftId"],
        });
      }
      if (!data.uploadedKeys || data.uploadedKeys.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "At least one uploadedKey is required",
          params: { code: "UPLOAD_REQUIRED" },
          path: ["uploadedKeys"],
        });
      }
    }
  },
);

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
  const parsed = localPrescriptionSubmitBodySchema.safeParse(body);
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
