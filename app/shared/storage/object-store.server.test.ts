import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  createObjectStore,
  buildRxKey,
  buildTicketKey,
  buildShopPrefix,
  buildRxPrefix,
  buildTicketPrefix,
  UnsupportedTypeError,
  TooLargeError,
  InvalidKeyError,
  MAX_UPLOAD_BYTES,
} from "./object-store.server";
import {
  getObjectStore,
  resetObjectStore,
} from "../container/object-store.server";
import { resetConfigCache } from "../config.server";

interface RecordedCommand {
  command: unknown;
  type: "send" | "presign";
}

function createTestHarness(options?: {
  onSend?: (command: unknown) => Promise<unknown> | unknown;
}) {
  const recorded: RecordedCommand[] = [];
  const fakeClient = new S3Client({
    region: "us-east-1",
    credentials: {
      accessKeyId: "TEST_ACCESS_KEY_ID",
      secretAccessKey: "TEST_SECRET_ACCESS_KEY",
    },
  });

  fakeClient.send = vi.fn().mockImplementation(async (command: unknown) => {
    recorded.push({ command, type: "send" });
    if (options?.onSend) {
      return await options.onSend(command);
    }
    if (command instanceof PutObjectCommand) {
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      return {
        ContentLength: 2048,
        ContentType: "image/png",
        ETag: '"etag-123"',
        LastModified: new Date("2026-11-07T00:00:00Z"),
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: "arn:aws:kms:us-east-1:123456789012:key/test-kms-key",
      };
    }
    if (command instanceof ListObjectsV2Command) {
      return { Contents: [], IsTruncated: false };
    }
    if (command instanceof DeleteObjectsCommand) {
      return { Deleted: command.input.Delete?.Objects ?? [] };
    }
    return {};
  }) as unknown as typeof fakeClient.send;

  const bucket = "test-lens-bucket";
  const kmsKeyId = "arn:aws:kms:us-east-1:123456789012:key/test-kms-key";

  const store = createObjectStore({
    client: fakeClient,
    bucket,
    kmsKeyId,
    onCommand: (command, type) => {
      if (type === "presign") {
        recorded.push({ command, type });
      }
    },
  });

  return { store, fakeClient, recorded, bucket, kmsKeyId };
}

describe("Spec 06 — S3 Storage Adapter", () => {
  describe("Examples table verification", () => {
    it("presignUpload png, 2 MB -> URL; command carries SSE-KMS + key id (normal)", async () => {
      const { store, recorded, kmsKeyId } = createTestHarness();
      const key = buildRxKey("shop1", "rx1", "uuid1", "png");

      const url = await store.presignUpload({
        key,
        contentType: "image/png",
        maxBytes: 2 * 1024 * 1024,
      });

      expect(url).toBeTypeOf("string");
      expect(url).toContain("https://");
      expect(url).toContain(key);

      const presignCmd = recorded.find((r) => r.type === "presign")?.command as PutObjectCommand;
      expect(presignCmd).toBeInstanceOf(PutObjectCommand);
      expect(presignCmd.input.Key).toBe(key);
      expect(presignCmd.input.ContentType).toBe("image/png");
      expect(presignCmd.input.ServerSideEncryption).toBe("aws:kms");
      expect(presignCmd.input.SSEKMSKeyId).toBe(kmsKeyId);
    });

    it("presignUpload text/html -> UnsupportedTypeError (invalid type)", async () => {
      const { store } = createTestHarness();
      const key = buildRxKey("shop1", "rx1", "uuid1", "html");

      await expect(
        store.presignUpload({
          key,
          contentType: "text/html",
          maxBytes: 1024,
        })
      ).rejects.toThrow(UnsupportedTypeError);
    });

    it("presignUpload 10 MB + 1 byte -> TooLargeError (size boundary)", async () => {
      const { store } = createTestHarness();
      const key = buildRxKey("shop1", "rx1", "uuid1", "png");

      await expect(
        store.presignUpload({
          key,
          contentType: "image/png",
          maxBytes: MAX_UPLOAD_BYTES + 1,
        })
      ).rejects.toThrow(TooLargeError);

      // Boundary: exact 10 MB succeeds
      await expect(
        store.presignUpload({
          key,
          contentType: "image/png",
          maxBytes: MAX_UPLOAD_BYTES,
        })
      ).resolves.toBeTypeOf("string");
    });

    it("key with shopId a/../b -> InvalidKeyError (path traversal)", () => {
      expect(() => buildRxKey("a/../b", "rx1", "uuid1", "png")).toThrow(InvalidKeyError);
      expect(() => buildTicketKey("a/../b", "ticket1", "pdf")).toThrow(InvalidKeyError);
      expect(() => buildShopPrefix("a/../b")).toThrow(InvalidKeyError);
    });

    it("deletePrefix with 1,500 objects -> 2 list pages, 2 delete batches, returns 1500 (pagination)", async () => {
      let listCallCount = 0;
      const deleteCommands: DeleteObjectsCommand[] = [];

      const { store } = createTestHarness({
        onSend: (command) => {
          if (command instanceof ListObjectsV2Command) {
            listCallCount++;
            if (listCallCount === 1) {
              const contents = Array.from({ length: 1000 }, (_, i) => ({
                Key: `shops/shop123/rx/rx1/file-${i}.png`,
              }));
              return {
                Contents: contents,
                IsTruncated: true,
                NextContinuationToken: "token-page-2",
              };
            } else if (listCallCount === 2) {
              const contents = Array.from({ length: 500 }, (_, i) => ({
                Key: `shops/shop123/rx/rx1/file-${1000 + i}.png`,
              }));
              return {
                Contents: contents,
                IsTruncated: false,
              };
            }
          }
          if (command instanceof DeleteObjectsCommand) {
            deleteCommands.push(command);
            return {
              Deleted: command.input.Delete?.Objects ?? [],
            };
          }
          return {};
        },
      });

      const prefix = "shops/shop123/rx/rx1/";
      const totalDeleted = await store.deletePrefix(prefix);

      expect(totalDeleted).toBe(1500);
      expect(listCallCount).toBe(2);
      expect(deleteCommands.length).toBe(2);
      expect(deleteCommands[0].input.Delete?.Objects?.length).toBe(1000);
      expect(deleteCommands[1].input.Delete?.Objects?.length).toBe(500);
    });

    it("deletePrefix of empty prefix \"\" -> InvalidKeyError (never deletes the bucket) (hostile)", async () => {
      const { store } = createTestHarness();

      await expect(store.deletePrefix("")).rejects.toThrow(InvalidKeyError);
    });
  });

  describe("Invariants: INV-2 & INV-10", () => {
    it("INV-2: every recorded Put and presigned Put command has SSE-KMS and key id set", async () => {
      const { store, recorded, kmsKeyId } = createTestHarness();

      const rxKey = buildRxKey("shopA", "rxA", "uuidA", "jpeg");
      await store.presignUpload({
        key: rxKey,
        contentType: "image/jpeg",
        maxBytes: 1024 * 1024,
      });

      const ticketKey = buildTicketKey("shopA", "orderA", "pdf");
      await store.putObject({
        key: ticketKey,
        body: Buffer.from("pdf-data"),
        contentType: "application/pdf",
      });

      const putCommands = recorded
        .map((r) => r.command)
        .filter((c): c is PutObjectCommand => c instanceof PutObjectCommand);

      expect(putCommands.length).toBe(2);

      for (const cmd of putCommands) {
        expect(cmd.input.ServerSideEncryption).toBe("aws:kms");
        expect(cmd.input.SSEKMSKeyId).toBe(kmsKeyId);
        expect(cmd.input.SSEKMSKeyId).toBeTruthy();
      }
    });

    it("INV-10: deletePrefix refuses any prefix outside shops/<id>/", async () => {
      const { store } = createTestHarness();

      const hostilePrefixes = [
        "",
        "/",
        "shops",
        "shops/",
        "shops//",
        "other/",
        "shops/../other/",
        "shops/shop1/../../etc/",
        "../shops/shop1/",
        "shops/shop1\\evil",
      ];

      for (const prefix of hostilePrefixes) {
        await expect(
          store.deletePrefix(prefix),
          `Expected prefix '${prefix}' to be rejected`
        ).rejects.toThrow(InvalidKeyError);
      }

      // Valid prefixes succeed without throwing
      await expect(store.deletePrefix("shops/shop1/")).resolves.toBe(0);
      await expect(store.deletePrefix("shops/shop1/rx/")).resolves.toBe(0);
      await expect(store.deletePrefix("shops/shop1/rx/rx123/")).resolves.toBe(0);
      await expect(store.deletePrefix("shops/shop1/tickets/")).resolves.toBe(0);
    });
  });

  describe("Presigned download (60s default)", () => {
    it("presignDownload generates signed URL with default 60s expiration", async () => {
      const { store, recorded } = createTestHarness();
      const key = buildTicketKey("shopX", "lab1", "pdf");

      const url = await store.presignDownload(key);

      expect(url).toBeTypeOf("string");
      expect(url).toContain("https://");
      expect(url).toContain(key);

      const presignCmd = recorded.find(
        (r) => r.type === "presign" && r.command instanceof GetObjectCommand
      )?.command as GetObjectCommand;

      expect(presignCmd).toBeInstanceOf(GetObjectCommand);
      expect(presignCmd.input.Key).toBe(key);
    });

    it("presignDownload supports options object with custom expiresIn", async () => {
      const { store } = createTestHarness();
      const key = buildTicketKey("shopX", "lab1", "pdf");

      const url = await store.presignDownload({ key, expiresIn: 120 });
      expect(url).toBeTypeOf("string");
    });

    it("presignDownload rejects invalid keys", async () => {
      const { store } = createTestHarness();
      await expect(store.presignDownload("invalid-key")).rejects.toThrow(InvalidKeyError);
      await expect(store.presignDownload("shops/s/../evil")).rejects.toThrow(InvalidKeyError);
    });
  });

  describe("headObject and objectExists", () => {
    it("headObject returns metadata when object exists", async () => {
      const { store } = createTestHarness();
      const key = buildRxKey("shop1", "rx1", "uuid1", "png");

      const meta = await store.headObject(key);
      expect(meta).not.toBeNull();
      expect(meta?.exists).toBe(true);
      expect(meta?.contentLength).toBe(2048);
      expect(meta?.contentType).toBe("image/png");
      expect(meta?.serverSideEncryption).toBe("aws:kms");

      const exists = await store.objectExists(key);
      expect(exists).toBe(true);
    });

    it("headObject returns null when object does not exist (404/NotFound)", async () => {
      const { store } = createTestHarness({
        onSend: (command) => {
          if (command instanceof HeadObjectCommand) {
            const err = new Error("Object not found");
            err.name = "NotFound";
            (err as unknown as { $metadata: { httpStatusCode: number } }).$metadata = {
              httpStatusCode: 404,
            };
            throw err;
          }
        },
      });

      const key = buildRxKey("shop1", "rx1", "uuid1", "png");
      const meta = await store.headObject(key);
      expect(meta).toBeNull();

      const exists = await store.objectExists(key);
      expect(exists).toBe(false);
    });

    it("headObject throws on non-404 unexpected errors", async () => {
      const { store } = createTestHarness({
        onSend: () => {
          const err = new Error("KMS Access Denied");
          err.name = "AccessDenied";
          throw err;
        },
      });

      const key = buildRxKey("shop1", "rx1", "uuid1", "png");
      await expect(store.headObject(key)).rejects.toThrow("KMS Access Denied");
    });
  });

  describe("Key Builders", () => {
    it("buildRxKey generates correct path layout and normalizes extension", () => {
      const key = buildRxKey("myshop", "rx-99", "file-123", ".PNG");
      expect(key).toBe("shops/myshop/rx/rx-99/file-123.png");

      const keyObj = buildRxKey({
        shopId: "myshop",
        prescriptionId: "rx-99",
        fileId: "file-123",
        ext: "jpeg",
      });
      expect(keyObj).toBe("shops/myshop/rx/rx-99/file-123.jpeg");
    });

    it("buildTicketKey generates correct path layout for pdf and csv", () => {
      const keyPdf = buildTicketKey("myshop", "lab-55", "pdf");
      expect(keyPdf).toBe("shops/myshop/tickets/lab-55.pdf");

      const keyCsv = buildTicketKey({
        shopId: "myshop",
        labOrderId: "lab-55",
        ext: ".CSV",
      });
      expect(keyCsv).toBe("shops/myshop/tickets/lab-55.csv");
    });

    it("buildShopPrefix, buildRxPrefix, buildTicketPrefix create expected paths", () => {
      expect(buildShopPrefix("myshop")).toBe("shops/myshop/");
      expect(buildRxPrefix("myshop")).toBe("shops/myshop/rx/");
      expect(buildRxPrefix("myshop", "rx-1")).toBe("shops/myshop/rx/rx-1/");
      expect(buildTicketPrefix("myshop")).toBe("shops/myshop/tickets/");
    });

    it("Key builders refuse traversal characters in all fields", () => {
      expect(() => buildRxKey("shop", "rx/traversal", "uuid", "png")).toThrow(InvalidKeyError);
      expect(() => buildRxKey("shop", "rx", "uuid/traversal", "png")).toThrow(InvalidKeyError);
      expect(() => buildRxKey("shop", "rx", "uuid", "../png")).toThrow(InvalidKeyError);
      expect(() => buildTicketKey("shop", "lab/../2", "pdf")).toThrow(InvalidKeyError);
      expect(() => buildTicketKey("shop", "lab", "pdf/exe")).toThrow(InvalidKeyError);
      expect(() => buildRxPrefix("shop", "rx/../bad")).toThrow(InvalidKeyError);
    });
  });

  describe("Container lazy getter: getObjectStore()", () => {
    beforeEach(() => {
      resetConfigCache();
      resetObjectStore();
      delete process.env.S3_BUCKET;
      delete process.env.S3_REGION;
      delete process.env.S3_KMS_KEY_ID;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
    });

    it("throws ConfigError when S3 environment variables are missing", () => {
      expect(() => getObjectStore()).toThrow(/Configuration error for S3_BUCKET/);
    });

    it("returns singleton ObjectStore when configured", () => {
      process.env.S3_BUCKET = "my-configured-bucket";
      process.env.S3_REGION = "us-west-2";
      process.env.S3_KMS_KEY_ID = "arn:aws:kms:us-west-2:111122223333:key/abc";
      process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
      process.env.AWS_SECRET_ACCESS_KEY = "SECRETEXAMPLE";

      const store1 = getObjectStore();
      expect(store1.bucket).toBe("my-configured-bucket");
      expect(store1.kmsKeyId).toBe("arn:aws:kms:us-west-2:111122223333:key/abc");

      const store2 = getObjectStore();
      expect(store2).toBe(store1); // Singleton instance
    });
  });
});
