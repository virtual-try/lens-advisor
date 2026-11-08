// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, seedShop, type TestDb } from "../../../test/db";
import { getCipher } from "../../shared/container/cipher.server";
import { DecryptError } from "../../shared/crypto/field-cipher.server";
import { BadRequestError } from "../../shared/http/errors.server";
import type {
  HeadObjectResult,
  ObjectStore,
  PresignUploadParams,
  PutObjectParams,
} from "../../shared/storage/object-store.server";
import {
  createPrescriptionsService,
  PrescriptionsService,
} from "./prescriptions.service.server";

const DB_TIMEOUT = 120_000;

class FakeObjectStore implements ObjectStore {
  readonly bucket = "lens-test-bucket";
  readonly kmsKeyId = "arn:aws:kms:test-key";
  public existingObjects = new Set<string>();
  public presignedCalls: PresignUploadParams[] = [];

  async presignUpload(params: PresignUploadParams): Promise<string> {
    this.presignedCalls.push(params);
    return `https://${this.bucket}.s3.amazonaws.com/${params.key}?signed=true`;
  }

  async putObject(_params: PutObjectParams): Promise<void> {
    // no-op
  }

  async presignDownload(_keyOrParams: string | { key: string }): Promise<string> {
    return "https://download.fake";
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    if (this.existingObjects.has(key)) {
      return {
        exists: true,
        contentLength: 1024,
        contentType: "image/png",
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
      expect(row?.cipher).not.toContain("od");

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

    it("finalizes UPLOAD when keys exist in storage", async () => {
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
  });
});
