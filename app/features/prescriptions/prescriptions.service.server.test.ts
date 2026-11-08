// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { getCipher } from "../../shared/container/cipher.server";
import { DecryptError } from "../../shared/crypto/field-cipher.server";
import { BadRequestError } from "../../shared/http/errors.server";
import {
  type HeadObjectResult,
  InvalidKeyError,
  type ObjectStore,
  type PresignUploadParams,
  type PutObjectParams,
  validateKey,
} from "../../shared/storage/object-store.server";
import {
  createPrescriptionsService,
  PrescriptionsService,
  type PrescriptionSubmitResponse,
} from "./prescriptions.service.server";

const DB_TIMEOUT = 120_000;

class FakeObjectStore implements ObjectStore {
  readonly bucket = "lens-test-bucket";
  readonly kmsKeyId = "arn:aws:kms:test-key";
  public existingObjects = new Set<string>();
  public presignedCalls: PresignUploadParams[] = [];
  public customHeadResults = new Map<string, Partial<HeadObjectResult>>();

  async presignUpload(params: PresignUploadParams): Promise<string> {
    validateKey(params.key);
    this.presignedCalls.push(params);
    return `https://${this.bucket}.s3.amazonaws.com/${params.key}?signed=true`;
  }

  async putObject(params: PutObjectParams): Promise<void> {
    validateKey(params.key);
    // no-op
  }

  async presignDownload(keyOrParams: string | { key: string }): Promise<string> {
    const key = typeof keyOrParams === "string" ? keyOrParams : keyOrParams.key;
    validateKey(key);
    return "https://download.fake";
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    validateKey(key);
    if (this.customHeadResults.has(key)) {
      return {
        exists: true,
        contentLength: 1024,
        contentType: "image/png",
        serverSideEncryption: "aws:kms",
        sseKmsKeyId: this.kmsKeyId,
        ...this.customHeadResults.get(key)!,
      };
    }
    if (this.existingObjects.has(key)) {
      return {
        exists: true,
        contentLength: 1024,
        contentType: "image/png",
        serverSideEncryption: "aws:kms",
        sseKmsKeyId: this.kmsKeyId,
      };
    }
    return { exists: false };
  }

  async objectExists(key: string): Promise<boolean> {
    return this.existingObjects.has(key);
  }

  async deletePrefix(_prefix: string): Promise<number> {
    return 0;
  }
}

describe("Prescriptions Service", () => {
  let db: TestDb;
  let shopA: { shopId: string; domain: string };
  let shopB: { shopId: string; domain: string };
  let fakeStore: FakeObjectStore;
  let service: PrescriptionsService;

  beforeAll(async () => {
    db = await createTestDb();
    shopA = await seedShop(db.prisma, "shop-a-srv.myshopify.com");
    shopB = await seedShop(db.prisma, "shop-b-srv.myshopify.com");
    fakeStore = new FakeObjectStore();
    service = createPrescriptionsService({
      db: db.prisma,
      cipher: getCipher(),
      objectStore: fakeStore,
    });
  }, DB_TIMEOUT);

  afterAll(async () => {
    await db?.drop();
  }, DB_TIMEOUT);

  describe("requestUploadUrl", () => {
    it("creates a draft prescription and presigned URL when draftId is omitted", async () => {
      const result = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 2 * 1024 * 1024,
      });

      expect(result.draftId).toBeDefined();
      expect(result.key).toMatch(new RegExp(`^shops/${shopA.shopId}/rx/${result.draftId}/[0-9a-f-]+\\.png$`));
      expect(result.uploadUrl).toContain(result.key);

      // Verify draft row in DB
      const row = await service.getPrescription(shopA.shopId, result.draftId);
      expect(row).not.toBeNull();
      expect(row?.source).toBe("UPLOAD");
      expect(row?.rxType).toBe("SINGLE_VISION");
      expect(row?.uploadKeys).toEqual([]);
    });

    it("reuses existing draft prescription when draftId is provided", async () => {
      const first = await service.requestUploadUrl(shopA.shopId, {
        contentType: "application/pdf",
        size: 1024,
      });

      const second = await service.requestUploadUrl(shopA.shopId, {
        draftId: first.draftId,
        contentType: "image/jpeg",
        size: 2048,
      });

      expect(second.draftId).toBe(first.draftId);
      expect(second.key).toMatch(new RegExp(`^shops/${shopA.shopId}/rx/${first.draftId}/[0-9a-f-]+\\.jpg$`));
    });

    it("throws UNSUPPORTED_TYPE for text/html", async () => {
      await expect(
        service.requestUploadUrl(shopA.shopId, {
          contentType: "text/html",
          size: 1024,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "UNSUPPORTED_TYPE",
        }),
      );
    });

    it("throws TOO_LARGE when size exceeds 10 MB", async () => {
      await expect(
        service.requestUploadUrl(shopA.shopId, {
          contentType: "image/png",
          size: 10 * 1024 * 1024 + 1,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "TOO_LARGE",
        }),
      );
    });

    it("R2-F3: accepts exactly 1 byte for upload-url (lower boundary)", async () => {
      const result = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1,
      });
      expect(result.draftId).toBeDefined();
      expect(result.uploadUrl).toBeDefined();
    });

    it("R2-F3: accepts exactly 10 MB for upload-url (upper boundary, MAX_UPLOAD_BYTES)", async () => {
      const result = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 10 * 1024 * 1024,
      });
      expect(result.draftId).toBeDefined();
      expect(result.uploadUrl).toBeDefined();
    });

    it("R2-F1: rejects reuse of already finalized draftId with DRAFT_NOT_FOUND", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.existingObjects.add(draft.key);

      // Finalize the draft
      await service.submitPrescription(shopA.shopId, {
        rxType: "SINGLE_VISION",
        draftId: draft.draftId,
        uploadedKeys: [draft.key],
      });

      // Attempting to reuse the finalized draftId must be rejected
      await expect(
        service.requestUploadUrl(shopA.shopId, {
          draftId: draft.draftId,
          contentType: "image/png",
          size: 1024,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "DRAFT_NOT_FOUND",
        }),
      );
    });

    it("R1-F4: rejects zero-byte request before any DB write and leaves row count unchanged", async () => {
      const countBefore = await db.prisma.prescription.count();

      await expect(
        service.requestUploadUrl(shopA.shopId, {
          contentType: "image/png",
          size: 0,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "INVALID_SIZE",
        }),
      );

      const countAfter = await db.prisma.prescription.count();
      expect(countAfter).toBe(countBefore);
    });

    it("throws DRAFT_NOT_FOUND if draftId belongs to another shop (INV-1)", async () => {
      const shopADraft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      await expect(
        service.requestUploadUrl(shopB.shopId, {
          draftId: shopADraft.draftId,
          contentType: "image/png",
          size: 1024,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "DRAFT_NOT_FOUND",
        }),
      );
    });
  });

  describe("submitPrescription — MANUAL", () => {
    it("submits valid MANUAL Rx, encrypts cipher with AAD shopId:id, and stores no plaintext (INV-2)", async () => {
      const SPH_DISTINCTIVE = -775; // -7.75 D
      const inputRx = {
        od: { sph: SPH_DISTINCTIVE, cyl: -125, axis: 90 },
        os: { sph: -500, cyl: 0 },
        pd: { single: 630 },
        notes: "SECRET_PATIENT_NOTES_12345",
      };

      const result = await service.submitPrescription(shopA.shopId, {
        rxType: "SINGLE_VISION",
        prescription: inputRx,
      });

      expect(result.rxRef).toBeDefined();

      // Read raw DB column
      const row = await db.prisma.prescription.findUnique({
        where: { id: result.rxRef },
      });
      expect(row).not.toBeNull();
      expect(row?.source).toBe("MANUAL");
      expect(row?.rxType).toBe("SINGLE_VISION");

      // INV-2: DB cipher column MUST NOT contain plaintext
      expect(row?.cipher).not.toContain("-775");
      expect(row?.cipher).not.toContain("-7.75");
      expect(row?.cipher).not.toContain("SECRET_PATIENT_NOTES_12345");
      expect(row?.cipher).not.toContain('"od"');

      // Verify AAD: shopId:prescriptionId decrypts
      const cipher = getCipher();
      const aadA = `${shopA.shopId}:${result.rxRef}`;
      const decrypted = cipher.decrypt(row!.cipher, aadA) as typeof inputRx;
      expect(decrypted.od.sph).toBe(SPH_DISTINCTIVE);
      expect(decrypted.notes).toBe("SECRET_PATIENT_NOTES_12345");

      // Cross-shop AAD failure (spec 05 proof)
      const aadB = `${shopB.shopId}:${result.rxRef}`;
      expect(() => cipher.decrypt(row!.cipher, aadB)).toThrowError(DecryptError);
    });

    it("re-validates prescription and throws 400 with fields on error (MANUAL with CYL and no AXIS)", async () => {
      try {
        await service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          prescription: {
            od: { sph: -200, cyl: -100 }, // CYL present, axis missing!
            os: { sph: -200, cyl: 0 },
            pd: { single: 630 },
          },
        });
        expect.unreachable("should have thrown BadRequestError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(BadRequestError);
        const badReq = err as BadRequestError;
        expect(badReq.status).toBe(400);
        expect(badReq.fields).toEqual([
          { path: "od.axis", code: "AXIS_REQUIRED" },
        ]);
      }
    });

    it("R3-F2: rejects rxType: 'NON_PRESCRIPTION' at boundary with 400 UNSUPPORTED_RX_TYPE and writes nothing", async () => {
      const countBefore = await db.prisma.prescription.count();

      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "NON_PRESCRIPTION",
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "UNSUPPORTED_RX_TYPE",
        }),
      );

      const countAfter = await db.prisma.prescription.count();
      expect(countAfter).toBe(countBefore);
    });
  });

  describe("submitPrescription — UPLOAD", () => {
    it("refuses UPLOAD with key under another shop's prefix (INVALID_UPLOAD_KEY, INV-1)", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      const foreignKey = `shops/${shopB.shopId}/rx/${draft.draftId}/fake.png`;

      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft.draftId,
          uploadedKeys: [foreignKey],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "INVALID_UPLOAD_KEY",
        }),
      );
    });

    it("R1-F1: never interpolates upload keys, shop ids, or draft ids into error messages", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      const phiKey = `shops/${shopA.shopId}/rx/${draft.draftId}/SPH_-7.75_PATIENT.pdf`;
      try {
        await service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft.draftId,
          uploadedKeys: [phiKey],
        });
        expect.unreachable("should have thrown BadRequestError");
      } catch (err: unknown) {
        const error = err as BadRequestError;
        expect(error.status).toBe(400);
        expect(error.code).toBe("UPLOAD_MISSING");
        expect(error.message).toBe("Uploaded file not found in storage");
        expect(error.message).not.toContain("SPH_-7.75_PATIENT.pdf");
        expect(error.message).not.toContain(shopA.shopId);
        expect(error.message).not.toContain(draft.draftId);
      }

      const foreignPhiKey = `shops/${shopB.shopId}/rx/${draft.draftId}/SPH_-7.75_PATIENT.pdf`;
      try {
        await service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft.draftId,
          uploadedKeys: [foreignPhiKey],
        });
        expect.unreachable("should have thrown BadRequestError");
      } catch (err: unknown) {
        const error = err as BadRequestError;
        expect(error.status).toBe(400);
        expect(error.code).toBe("INVALID_UPLOAD_KEY");
        expect(error.message).toBe("Uploaded key does not belong to this shop or draft");
        expect(error.message).not.toContain("SPH_-7.75_PATIENT.pdf");
        expect(error.message).not.toContain(shopB.shopId);
      }
    });

    it("R3-F1: rejects upload key with trailing slash before headObject and exposes no key or PHI in error (INV-2, R110)", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      const phiFilename = "SPH_-7.75_PATIENT.pdf";
      const trailingSlashKey = `shops/${shopA.shopId}/rx/${draft.draftId}/${phiFilename}/`;

      try {
        await service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft.draftId,
          uploadedKeys: [trailingSlashKey],
        });
        expect.unreachable("should have thrown BadRequestError");
      } catch (err: unknown) {
        const error = err as BadRequestError;
        expect(error.status).toBe(400);
        expect(error.code).toBe("INVALID_UPLOAD_KEY");
        expect(error.message).toBe("Uploaded key does not belong to this shop or draft");
        expect(error.message).not.toContain(phiFilename);
        expect(error.message).not.toContain("-7.75");
        expect(error.message).not.toContain(shopA.shopId);
        expect(error.message).not.toContain(draft.draftId);
      }
    });

    it("R3-F1: rejects non-canonical key shapes: empty segment, multiple segments, traversal (..)", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      const malformedKeys = [
        `shops/${shopA.shopId}/rx/${draft.draftId}/`,
        `shops/${shopA.shopId}/rx/${draft.draftId}/nested/file.png`,
        `shops/${shopA.shopId}/rx/${draft.draftId}/../outside.png`,
        `shops/${shopA.shopId}/rx/${draft.draftId}/file..png`,
      ];

      for (const badKey of malformedKeys) {
        await expect(
          service.submitPrescription(shopA.shopId, {
            rxType: "SINGLE_VISION",
            draftId: draft.draftId,
            uploadedKeys: [badKey],
          }),
        ).rejects.toThrowError(
          expect.objectContaining({
            status: 400,
            code: "INVALID_UPLOAD_KEY",
            message: "Uploaded key does not belong to this shop or draft",
          }),
        );
      }
    });

    it("R3-F1: maps storage InvalidKeyError from headObject to fixed INVALID_UPLOAD_KEY message", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      const origHead = fakeStore.headObject.bind(fakeStore);
      fakeStore.headObject = async () => {
        throw new InvalidKeyError("Key 'shops/.../SECRET_DIOPTER_-9.00.pdf' contains empty segments");
      };

      try {
        await expect(
          service.submitPrescription(shopA.shopId, {
            rxType: "SINGLE_VISION",
            draftId: draft.draftId,
            uploadedKeys: [draft.key],
          }),
        ).rejects.toThrowError(
          expect.objectContaining({
            status: 400,
            code: "INVALID_UPLOAD_KEY",
            message: "Uploaded key does not belong to this shop or draft",
          }),
        );
      } finally {
        fakeStore.headObject = origHead;
      }
    });

    it("R3-F2: rejects UPLOAD submission with rxType: 'NON_PRESCRIPTION' and leaves row unchanged", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.existingObjects.add(draft.key);

      const countBefore = await db.prisma.prescription.count();

      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "NON_PRESCRIPTION",
          draftId: draft.draftId,
          uploadedKeys: [draft.key],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "UNSUPPORTED_RX_TYPE",
        }),
      );

      const countAfter = await db.prisma.prescription.count();
      expect(countAfter).toBe(countBefore);

      const row = await service.getPrescription(shopA.shopId, draft.draftId);
      expect(row?.uploadKeys).toEqual([]);
    });

    it("refuses UPLOAD with key never uploaded (UPLOAD_MISSING integrity)", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      const missingKey = `shops/${shopA.shopId}/rx/${draft.draftId}/missing-file.png`;
      // Not added to fakeStore.existingObjects!

      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft.draftId,
          uploadedKeys: [missingKey],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "UPLOAD_MISSING",
        }),
      );
    });

    describe("R1-F5: denied-path tests for S3 metadata validation", () => {
      it("rejects zero-byte object in storage", async () => {
        const draft = await service.requestUploadUrl(shopA.shopId, {
          contentType: "image/png",
          size: 1024,
        });
        fakeStore.customHeadResults.set(draft.key, { contentLength: 0 });

        await expect(
          service.submitPrescription(shopA.shopId, {
            rxType: "SINGLE_VISION",
            draftId: draft.draftId,
            uploadedKeys: [draft.key],
          }),
        ).rejects.toThrowError(
          expect.objectContaining({
            status: 400,
            code: "INVALID_UPLOAD",
          }),
        );
      });

      it("rejects oversized object in storage", async () => {
        const draft = await service.requestUploadUrl(shopA.shopId, {
          contentType: "image/png",
          size: 1024,
        });
        fakeStore.customHeadResults.set(draft.key, { contentLength: 11 * 1024 * 1024 });

        await expect(
          service.submitPrescription(shopA.shopId, {
            rxType: "SINGLE_VISION",
            draftId: draft.draftId,
            uploadedKeys: [draft.key],
          }),
        ).rejects.toThrowError(
          expect.objectContaining({
            status: 400,
            code: "INVALID_UPLOAD",
          }),
        );
      });

      it("rejects unsupported contentType in storage", async () => {
        const draft = await service.requestUploadUrl(shopA.shopId, {
          contentType: "image/png",
          size: 1024,
        });
        fakeStore.customHeadResults.set(draft.key, { contentType: "text/plain" });

        await expect(
          service.submitPrescription(shopA.shopId, {
            rxType: "SINGLE_VISION",
            draftId: draft.draftId,
            uploadedKeys: [draft.key],
          }),
        ).rejects.toThrowError(
          expect.objectContaining({
            status: 400,
            code: "INVALID_UPLOAD",
          }),
        );
      });

      it("rejects unencrypted or non-KMS object in storage", async () => {
        const draft = await service.requestUploadUrl(shopA.shopId, {
          contentType: "image/png",
          size: 1024,
        });
        fakeStore.customHeadResults.set(draft.key, { serverSideEncryption: "AES256" });

        await expect(
          service.submitPrescription(shopA.shopId, {
            rxType: "SINGLE_VISION",
            draftId: draft.draftId,
            uploadedKeys: [draft.key],
          }),
        ).rejects.toThrowError(
          expect.objectContaining({
            status: 400,
            code: "INVALID_UPLOAD",
          }),
        );
      });

      it("rejects object encrypted with wrong KMS key", async () => {
        const draft = await service.requestUploadUrl(shopA.shopId, {
          contentType: "image/png",
          size: 1024,
        });
        fakeStore.customHeadResults.set(draft.key, { sseKmsKeyId: "arn:aws:kms:wrong-key" });

        await expect(
          service.submitPrescription(shopA.shopId, {
            rxType: "SINGLE_VISION",
            draftId: draft.draftId,
            uploadedKeys: [draft.key],
          }),
        ).rejects.toThrowError(
          expect.objectContaining({
            status: 400,
            code: "INVALID_UPLOAD",
          }),
        );
      });
    });

    it("R1-F6: fails with NotFoundError when draft disappears before upload update", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.existingObjects.add(draft.key);

      // Simulate draft disappearing between initial lookup and updatePrescriptionUpload
      // by deleting the draft inside headObject hook
      const origHead = fakeStore.headObject.bind(fakeStore);
      fakeStore.headObject = async (key: string) => {
        // Disappear the draft from the DB right before upload update
        await db.prisma.prescription.delete({ where: { id: draft.draftId } });
        return origHead(key);
      };

      try {
        await expect(
          service.submitPrescription(shopA.shopId, {
            rxType: "SINGLE_VISION",
            draftId: draft.draftId,
            uploadedKeys: [draft.key],
          }),
        ).rejects.toThrowError(
          expect.objectContaining({
            status: 404,
            code: "DRAFT_NOT_FOUND",
          }),
        );
      } finally {
        fakeStore.headObject = origHead;
      }
    });

    it("R1-F9: enforces uploadedKeys cap: accepts exactly 5, rejects 6", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      const keys5: string[] = [];
      for (let i = 0; i < 5; i++) {
        const k = `shops/${shopA.shopId}/rx/${draft.draftId}/file-${i}.png`;
        fakeStore.existingObjects.add(k);
        keys5.push(k);
      }

      // Exactly 5 at cap -> succeeds
      const res5 = await service.submitPrescription(shopA.shopId, {
        rxType: "SINGLE_VISION",
        draftId: draft.draftId,
        uploadedKeys: keys5,
      });
      expect(res5.rxRef).toBe(draft.draftId);

      // 6 keys (one above cap) -> rejects with 400 TOO_MANY_UPLOADS
      const keys6 = [...keys5, `shops/${shopA.shopId}/rx/${draft.draftId}/file-5.png`];
      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft.draftId,
          uploadedKeys: keys6,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "TOO_MANY_UPLOADS",
        }),
      );
    });

    it("finalizes UPLOAD when keys exist in storage with valid KMS metadata", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });

      // Mark object as existing in S3
      fakeStore.existingObjects.add(draft.key);

      const submitted = await service.submitPrescription(shopA.shopId, {
        rxType: "PROGRESSIVE",
        draftId: draft.draftId,
        uploadedKeys: [draft.key],
      });

      expect(submitted.rxRef).toBe(draft.draftId);

      // Verify DB row updated
      const row = await service.getPrescription(shopA.shopId, draft.draftId);
      expect(row?.rxType).toBe("PROGRESSIVE");
      expect(row?.uploadKeys).toEqual([draft.key]);
    });

    it("R2-F1: rejects re-submission of already finalized draft and leaves row unchanged", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.existingObjects.add(draft.key);

      const firstSubmit = await service.submitPrescription(shopA.shopId, {
        rxType: "SINGLE_VISION",
        draftId: draft.draftId,
        uploadedKeys: [draft.key],
      });
      expect(firstSubmit.rxRef).toBe(draft.draftId);

      // Prepare a second key
      const secondKey = `shops/${shopA.shopId}/rx/${draft.draftId}/second.png`;
      fakeStore.existingObjects.add(secondKey);

      // Re-submission must be rejected
      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "PROGRESSIVE",
          draftId: draft.draftId,
          uploadedKeys: [secondKey],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "DRAFT_NOT_FOUND",
        }),
      );

      // Row and its rxRef and uploadKeys must remain unchanged
      const row = await service.getPrescription(shopA.shopId, draft.draftId);
      expect(row?.rxType).toBe("SINGLE_VISION");
      expect(row?.uploadKeys).toEqual([draft.key]);
    });

    it("R2-F1: two concurrent finalizations on same draft: exactly one succeeds, row and rxRef unchanged by second", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      const key1 = draft.key;
      const key2 = `shops/${shopA.shopId}/rx/${draft.draftId}/second.png`;
      fakeStore.existingObjects.add(key1);
      fakeStore.existingObjects.add(key2);

      const results = await Promise.allSettled([
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft.draftId,
          uploadedKeys: [key1],
        }),
        service.submitPrescription(shopA.shopId, {
          rxType: "PROGRESSIVE",
          draftId: draft.draftId,
          uploadedKeys: [key2],
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const winnerResult = (fulfilled[0] as PromiseFulfilledResult<PrescriptionSubmitResponse>).value;
      expect(winnerResult.rxRef).toBe(draft.draftId);

      // Verify row is unchanged by the loser
      const row = await service.getPrescription(shopA.shopId, draft.draftId);
      expect(row).not.toBeNull();
      if (row?.rxType === "SINGLE_VISION") {
        expect(row.uploadKeys).toEqual([key1]);
      } else {
        expect(row?.rxType).toBe("PROGRESSIVE");
        expect(row?.uploadKeys).toEqual([key2]);
      }
    });

    it("R2-F3: S3 object metadata accepts exactly 1 byte and exactly 10 MB; rejects 0 and 10 MB + 1", async () => {
      // 1. Boundary: exactly 1 byte in S3 -> accepted
      const draft1 = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.customHeadResults.set(draft1.key, { contentLength: 1 });
      const res1 = await service.submitPrescription(shopA.shopId, {
        rxType: "SINGLE_VISION",
        draftId: draft1.draftId,
        uploadedKeys: [draft1.key],
      });
      expect(res1.rxRef).toBe(draft1.draftId);

      // 2. Boundary: exactly 10 MB (MAX_UPLOAD_BYTES) in S3 -> accepted
      const draft2 = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.customHeadResults.set(draft2.key, { contentLength: 10 * 1024 * 1024 });
      const res10MB = await service.submitPrescription(shopA.shopId, {
        rxType: "SINGLE_VISION",
        draftId: draft2.draftId,
        uploadedKeys: [draft2.key],
      });
      expect(res10MB.rxRef).toBe(draft2.draftId);

      // 3. Boundary: exactly 0 bytes in S3 -> rejected with INVALID_UPLOAD
      const draft3 = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.customHeadResults.set(draft3.key, { contentLength: 0 });
      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft3.draftId,
          uploadedKeys: [draft3.key],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "INVALID_UPLOAD",
        }),
      );

      // 4. Boundary: 10 MB + 1 byte in S3 -> rejected with INVALID_UPLOAD
      const draft4 = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.customHeadResults.set(draft4.key, { contentLength: 10 * 1024 * 1024 + 1 });
      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          draftId: draft4.draftId,
          uploadedKeys: [draft4.key],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "INVALID_UPLOAD",
        }),
      );
    });

    it("R4-F1: ambiguous input (manual prescription + draftId/uploadedKeys) returns 400 AMBIGUOUS_RX_SOURCE and leaves draft unchanged", async () => {
      const draft = await service.requestUploadUrl(shopA.shopId, {
        contentType: "image/png",
        size: 1024,
      });
      fakeStore.existingObjects.add(draft.key);

      const validRx = {
        od: { sph: -200, cyl: -100, axis: 90 },
        os: { sph: -200, cyl: 0 },
        pd: { single: 630 },
      };

      // 1. Both manual prescription AND draftId + uploadedKeys
      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          prescription: validRx,
          draftId: draft.draftId,
          uploadedKeys: [draft.key],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "AMBIGUOUS_RX_SOURCE",
        }),
      );

      // Verify draft row in DB is completely unchanged (still empty uploadKeys, unfinalized)
      const draftRow = await db.prisma.prescription.findUnique({
        where: { id: draft.draftId },
      });
      expect(draftRow).not.toBeNull();
      expect(draftRow?.uploadKeys).toEqual([]);
      expect(draftRow?.source).toBe("UPLOAD");

      // 2. Manual prescription + draftId alone (no uploadedKeys)
      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          prescription: validRx,
          draftId: draft.draftId,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "AMBIGUOUS_RX_SOURCE",
        }),
      );

      // 3. Manual prescription + uploadedKeys alone (no draftId)
      await expect(
        service.submitPrescription(shopA.shopId, {
          rxType: "SINGLE_VISION",
          prescription: validRx,
          uploadedKeys: [draft.key],
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 400,
          code: "AMBIGUOUS_RX_SOURCE",
        }),
      );
    });
  });

  describe("R4-F2: verified-domain shop resolution inside prescription service", () => {
    it("resolveShopByDomain returns shop for known domain and throws 401 UNAUTHORIZED for unknown", async () => {
      const shop = await service.resolveShopByDomain(shopA.domain);
      expect(shop.id).toBe(shopA.shopId);
      expect(shop.domain).toBe(shopA.domain);

      await expect(
        service.resolveShopByDomain("nonexistent.myshopify.com"),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 401,
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("requestUploadUrlByDomain resolves domain and delegates to requestUploadUrl", async () => {
      const result = await service.requestUploadUrlByDomain(shopA.domain, {
        contentType: "image/png",
        size: 1024,
      });
      expect(result.draftId).toBeDefined();
      expect(result.uploadUrl).toContain(result.draftId);
      expect(result.key).toContain(`shops/${shopA.shopId}/rx/${result.draftId}/`);

      await expect(
        service.requestUploadUrlByDomain("nonexistent.myshopify.com", {
          contentType: "image/png",
          size: 1024,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 401,
          code: "UNAUTHORIZED",
        }),
      );
    });

    it("submitPrescriptionByDomain resolves domain and delegates to submitPrescription", async () => {
      const validRx = {
        od: { sph: -300, cyl: 0 },
        os: { sph: -300, cyl: 0 },
        pd: { single: 600 },
      };

      const result = await service.submitPrescriptionByDomain(shopA.domain, {
        rxType: "SINGLE_VISION",
        prescription: validRx,
      });
      expect(result.rxRef).toBeDefined();

      await expect(
        service.submitPrescriptionByDomain("nonexistent.myshopify.com", {
          rxType: "SINGLE_VISION",
          prescription: validRx,
        }),
      ).rejects.toThrowError(
        expect.objectContaining({
          status: 401,
          code: "UNAUTHORIZED",
        }),
      );
    });
  });
});
