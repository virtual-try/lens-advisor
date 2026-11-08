import { randomUUID } from "node:crypto";
import type { PrismaClient, RxType } from "@prisma/client";

import {
  normalizePrescription,
  validatePrescription,
} from "../../../packages/rx-core/src/rx/validate.js";
import type {
  PrescriptionSubmitBody,
  UploadUrlRequest,
} from "../../../packages/rx-core/src/schemas/catalog.js";
import { getCipher } from "../../shared/container/cipher.server";
import { getObjectStore } from "../../shared/container/object-store.server";
import { getPrisma } from "../../shared/container/prisma.server";
import type { FieldCipher } from "../../shared/crypto/field-cipher.server";
import {
  BadRequestError,
  type FieldError,
} from "../../shared/http/errors.server";
import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  buildRxKey,
  MAX_UPLOAD_BYTES,
  type ObjectStore,
} from "../../shared/storage/object-store.server";
import {
  createPrescription,
  getPrescriptionById,
  updatePrescriptionUpload,
  type PrescriptionRecord,
} from "./prescriptions.repository.server";

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
        `Unsupported content type: ${input.contentType}`,
        "UNSUPPORTED_TYPE",
      );
    }

    // 2. Size check
    if (input.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestError(
        `File size ${input.size} exceeds maximum allowed size of ${MAX_UPLOAD_BYTES} bytes`,
        "TOO_LARGE",
      );
    }

    // 3. Draft Prescription lifecycle
    let draftId: string;
    if (input.draftId) {
      const existing = await getPrescriptionById(this.db, shopId, input.draftId);
      if (!existing || existing.source !== "UPLOAD") {
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

    // Verify draft prescription exists for this shop (INV-1)
    const draft = await getPrescriptionById(this.db, shopId, input.draftId);
    if (!draft || draft.source !== "UPLOAD") {
      throw new BadRequestError("Draft prescription not found", "DRAFT_NOT_FOUND");
    }

    const expectedPrefix = `shops/${shopId}/rx/${input.draftId}/`;

    for (const key of input.uploadedKeys) {
      // Cross-shop / draft key integrity check (INV-1)
      if (!key.startsWith(expectedPrefix)) {
        throw new BadRequestError(
          `Uploaded key '${key}' does not belong to shop '${shopId}' and draft '${input.draftId}'`,
          "INVALID_UPLOAD_KEY",
        );
      }

      // Check object exists in S3 storage (integrity check)
      const head = await this.objectStore.headObject(key);
      if (!head || !head.exists) {
        throw new BadRequestError(
          `Uploaded file '${key}' not found in storage`,
          "UPLOAD_MISSING",
        );
      }
    }

    // Update draft prescription with final rxType and uploadKeys
    await updatePrescriptionUpload(this.db, shopId, input.draftId, {
      rxType: input.rxType as RxType,
      uploadKeys: input.uploadedKeys,
    });

    return {
      rxRef: draft.id,
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
