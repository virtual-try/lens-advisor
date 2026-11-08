import { randomUUID } from "node:crypto";
import type { PrismaClient, RxType } from "@prisma/client";

import {
  normalizePrescription,
  validatePrescription,
} from "../../../packages/rx-core/src/rx/validate.js";
import {
  MAX_UPLOAD_KEYS,
  type PrescriptionSubmitBody,
  type UploadUrlRequest,
} from "../../../packages/rx-core/src/schemas/catalog.js";
import { getCipher } from "../../shared/container/cipher.server";
import { getObjectStore } from "../../shared/container/object-store.server";
import { getPrisma } from "../../shared/container/prisma.server";
import type { FieldCipher } from "../../shared/crypto/field-cipher.server";
import {
  BadRequestError,
  type FieldError,
  NotFoundError,
} from "../../shared/http/errors.server";
import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  buildRxKey,
  type HeadObjectResult,
  InvalidKeyError,
  MAX_UPLOAD_BYTES,
  type ObjectStore,
} from "../../shared/storage/object-store.server";
import {
  createPrescription,
  getPrescriptionById,
  updatePrescriptionUpload,
  type PrescriptionRecord,
} from "./prescriptions.repository.server";

export { MAX_UPLOAD_KEYS };

export interface PrescriptionsServiceDeps {
  db?: PrismaClient;
  cipher?: FieldCipher;
  objectStore?: ObjectStore;
  idGenerator?: () => string;
}

export interface UploadUrlResponse {
  draftId: string;
  uploadUrl: string;
  key: string;
}

export interface PrescriptionSubmitResponse {
  rxRef: string;
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export class PrescriptionsService {
  private readonly db: PrismaClient;
  private readonly cipher: FieldCipher;
  private readonly objectStore: ObjectStore;
  private readonly idGenerator: () => string;

  constructor(deps: PrescriptionsServiceDeps = {}) {
    this.db = deps.db ?? getPrisma();
    this.cipher = deps.cipher ?? getCipher();
    this.objectStore = deps.objectStore ?? getObjectStore();
    this.idGenerator = deps.idGenerator ?? (() => randomUUID());
  }

  /**
   * Generates a presigned S3 upload URL for prescription images or PDFs.
   * If no draftId is passed, creates a draft Prescription row with source UPLOAD.
   */
  async requestUploadUrl(
    shopId: string,
    input: UploadUrlRequest,
  ): Promise<UploadUrlResponse> {
    // 1. Content-type check
    if (!ALLOWED_UPLOAD_CONTENT_TYPES.includes(input.contentType as (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number])) {
      throw new BadRequestError(
        "Unsupported content type",
        "UNSUPPORTED_TYPE",
      );
    }

    // 2. Size check before any DB write (R1-F4)
    if (typeof input.size !== "number" || isNaN(input.size) || input.size <= 0) {
      throw new BadRequestError(
        "File size must be greater than 0 bytes",
        "INVALID_SIZE",
      );
    }
    if (input.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestError(
        "File size exceeds maximum allowed size",
        "TOO_LARGE",
      );
    }

    // 3. Draft Prescription lifecycle
    let draftId: string;
    if (input.draftId) {
      const existing = await getPrescriptionById(this.db, shopId, input.draftId);
      if (!existing || existing.source !== "UPLOAD" || existing.uploadKeys.length > 0) {
        throw new BadRequestError("Draft prescription not found", "DRAFT_NOT_FOUND");
      }
      draftId = existing.id;
    } else {
      draftId = this.idGenerator();
      // AAD binds shopId:draftId before insert
      const aad = `${shopId}:${draftId}`;
      const emptyCipher = this.cipher.encrypt({}, aad);
      await createPrescription(this.db, shopId, {
        id: draftId,
        rxType: "SINGLE_VISION",
        source: "UPLOAD",
        cipher: emptyCipher,
        uploadKeys: [],
      });
    }

    // 4. Construct S3 key layout: shops/<shopId>/rx/<draftId>/<uuid>.<ext>
    const ext = CONTENT_TYPE_EXTENSIONS[input.contentType] ?? "bin";
    const fileId = this.idGenerator();
    const key = buildRxKey({
      shopId,
      prescriptionId: draftId,
      fileId,
      ext,
    });

    // 5. Presign upload via object store
    const uploadUrl = await this.objectStore.presignUpload({
      key,
      contentType: input.contentType,
      contentLength: input.size,
      maxBytes: MAX_UPLOAD_BYTES,
    });

    return {
      draftId,
      uploadUrl,
      key,
    };
  }

  /**
   * Submits and finalizes a prescription.
   * - For MANUAL: re-validates via Spec 10, encrypts with AAD shopId:prescriptionId, returns rxRef.
   * - For UPLOAD: verifies keys belong to shops/<shopId>/rx/<draftId>/ and exist in S3 (headObject).
   */
  async submitPrescription(
    shopId: string,
    input: PrescriptionSubmitBody,
  ): Promise<PrescriptionSubmitResponse> {
    // Non-prescription lenses do not accept a prescription submission (R3-F2)
    if (input.rxType === "NON_PRESCRIPTION") {
      throw new BadRequestError(
        "Prescriptions endpoint does not accept NON_PRESCRIPTION",
        "UNSUPPORTED_RX_TYPE",
      );
    }

    const isUpload = Boolean(
      input.draftId || (input.uploadedKeys && input.uploadedKeys.length > 0),
    );

    if (isUpload) {
      return this.submitUploadPrescription(shopId, input);
    }

    return this.submitManualPrescription(shopId, input);
  }

  private async submitUploadPrescription(
    shopId: string,
    input: PrescriptionSubmitBody,
  ): Promise<PrescriptionSubmitResponse> {
    if (!input.draftId) {
      throw new BadRequestError("draftId is required for upload prescriptions", "DRAFT_REQUIRED");
    }

    if (!input.uploadedKeys || input.uploadedKeys.length === 0) {
      throw new BadRequestError("At least one uploadedKey is required", "UPLOAD_REQUIRED");
    }

    // Boundary cap on uploadedKeys (R1-F9)
    if (input.uploadedKeys.length > MAX_UPLOAD_KEYS) {
      throw new BadRequestError("Too many uploaded keys", "TOO_MANY_UPLOADS");
    }

    // Verify draft prescription exists for this shop and is not finalized (INV-1, R2-F1)
    const draft = await getPrescriptionById(this.db, shopId, input.draftId);
    if (!draft || draft.source !== "UPLOAD" || draft.uploadKeys.length > 0) {
      throw new BadRequestError("Draft prescription not found", "DRAFT_NOT_FOUND");
    }

    const expectedPrefix = `shops/${shopId}/rx/${input.draftId}/`;

    for (const key of input.uploadedKeys) {
      // Cross-shop / draft key integrity check (INV-1, R1-F1: no interpolated key or shopId)
      if (!key.startsWith(expectedPrefix)) {
        throw new BadRequestError(
          "Uploaded key does not belong to this shop or draft",
          "INVALID_UPLOAD_KEY",
        );
      }

      // Canonical key shape validation (R3-F1):
      // Must be `shops/<shopId>/rx/<draftId>/<one non-empty filename segment>`,
      // with no trailing slash, no multiple segments, no '..', and no whitespace/null bytes.
      const filename = key.slice(expectedPrefix.length);
      if (
        !filename ||
        filename.includes("/") ||
        filename.includes("\\") ||
        filename.includes("..") ||
        filename.includes("\0") ||
        /\s/.test(filename)
      ) {
        throw new BadRequestError(
          "Uploaded key does not belong to this shop or draft",
          "INVALID_UPLOAD_KEY",
        );
      }

      let decodedFilename = filename;
      try {
        decodedFilename = decodeURIComponent(filename);
      } catch {
        throw new BadRequestError(
          "Uploaded key does not belong to this shop or draft",
          "INVALID_UPLOAD_KEY",
        );
      }

      if (
        decodedFilename.includes("/") ||
        decodedFilename.includes("\\") ||
        decodedFilename.includes("..") ||
        decodedFilename.includes("\0") ||
        /\s/.test(decodedFilename)
      ) {
        throw new BadRequestError(
          "Uploaded key does not belong to this shop or draft",
          "INVALID_UPLOAD_KEY",
        );
      }

      // Check object exists and metadata in S3 storage (integrity & KMS check, R1-F5, R3-F1)
      let head: HeadObjectResult | null;
      try {
        head = await this.objectStore.headObject(key);
      } catch (err: unknown) {
        if (
          err instanceof InvalidKeyError ||
          (typeof err === "object" &&
            err !== null &&
            (("code" in err && (err as { code: string }).code === "INVALID_KEY") ||
              ("name" in err && (err as { name: string }).name === "InvalidKeyError")))
        ) {
          throw new BadRequestError(
            "Uploaded key does not belong to this shop or draft",
            "INVALID_UPLOAD_KEY",
          );
        }
        throw err;
      }
      if (!head || !head.exists) {
        throw new BadRequestError(
          "Uploaded file not found in storage",
          "UPLOAD_MISSING",
        );
      }

      if (
        typeof head.contentLength !== "number" ||
        head.contentLength <= 0 ||
        head.contentLength > MAX_UPLOAD_BYTES
      ) {
        throw new BadRequestError(
          "Uploaded file has invalid size",
          "INVALID_UPLOAD",
        );
      }

      if (
        !head.contentType ||
        !ALLOWED_UPLOAD_CONTENT_TYPES.includes(
          head.contentType as (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number],
        )
      ) {
        throw new BadRequestError(
          "Uploaded file has unsupported content type",
          "INVALID_UPLOAD",
        );
      }

      if (head.serverSideEncryption !== "aws:kms") {
        throw new BadRequestError(
          "Uploaded file is not KMS encrypted",
          "INVALID_UPLOAD",
        );
      }

      if (head.sseKmsKeyId !== this.objectStore.kmsKeyId) {
        throw new BadRequestError(
          "Uploaded file has incorrect KMS key",
          "INVALID_UPLOAD",
        );
      }
    }

    // Update draft prescription with final rxType and uploadKeys atomically (R1-F6)
    const updated = await updatePrescriptionUpload(this.db, shopId, input.draftId, {
      rxType: input.rxType as RxType,
      uploadKeys: input.uploadedKeys,
    });

    if (!updated) {
      throw new NotFoundError("Draft prescription not found", "DRAFT_NOT_FOUND");
    }

    return {
      rxRef: updated.id,
    };
  }

  private async submitManualPrescription(
    shopId: string,
    input: PrescriptionSubmitBody,
  ): Promise<PrescriptionSubmitResponse> {
    // Re-validate with spec 10 (never trust the browser)
    const errors = validatePrescription(
      input.prescription,
      input.rxType,
    );

    if (errors.length > 0) {
      const fields: FieldError[] = errors.map((err) => ({
        path: err.path ?? err.field,
        code: err.code,
      }));

      throw new BadRequestError(
        "Prescription validation failed",
        "BAD_REQUEST",
        fields,
      );
    }

    const normalized = normalizePrescription(
      input.prescription,
      input.rxType,
    );

    // Generate unguessable UUID for the prescription
    const prescriptionId = this.idGenerator();

    // AAD uses the server-generated id created BEFORE encryption (no race)
    const aad = `${shopId}:${prescriptionId}`;
    const cipherText = this.cipher.encrypt(normalized, aad);

    await createPrescription(this.db, shopId, {
      id: prescriptionId,
      rxType: input.rxType as RxType,
      source: "MANUAL",
      cipher: cipherText,
      uploadKeys: [],
    });

    return {
      rxRef: prescriptionId,
    };
  }

  /**
   * Helper to retrieve a prescription record for tests or consumers (INV-1 shop-scoped).
   */
  async getPrescription(
    shopId: string,
    id: string,
  ): Promise<PrescriptionRecord | null> {
    return getPrescriptionById(this.db, shopId, id);
  }
}

export function createPrescriptionsService(
  deps: PrescriptionsServiceDeps = {},
): PrescriptionsService {
  return new PrescriptionsService(deps);
}
