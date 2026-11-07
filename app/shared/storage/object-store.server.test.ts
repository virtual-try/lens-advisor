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
  type S3ClientLike,
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
    requestChecksumCalculation: "WHEN_REQUIRED",
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

      // R1-F1: verify no empty-body CRC32 parameter in signed URL
      expect(url).not.toContain("x-amz-checksum-crc32");
      expect(url).not.toContain("AAAAAA");

      const presignCmd = recorded.find((r) => r.type === "presign")?.command as PutObjectCommand;
      expect(presignCmd).toBeInstanceOf(PutObjectCommand);
      expect(presignCmd.input.Key).toBe(key);
      expect(presignCmd.input.ContentType).toBe("image/png");
      expect(presignCmd.input.ContentLength).toBe(2 * 1024 * 1024);
      expect(presignCmd.input.ServerSideEncryption).toBe("aws:kms");
      expect(presignCmd.input.SSEKMSKeyId).toBe(kmsKeyId);

      // R1-F2: verify Content-Type and Content-Length are signed
      const parsedUrl = new URL(url);
      const signedHeaders = (parsedUrl.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
      expect(signedHeaders).toContain("content-type");
      expect(signedHeaders).toContain("content-length");
    });

    it("R1-F1: presigned upload URL carries no empty-body CRC32 checksum parameter", async () => {
      const { store } = createTestHarness();
      const key = buildRxKey("shop1", "rx1", "uuid1", "pdf");
      const url = await store.presignUpload({
        key,
        contentType: "application/pdf",
        maxBytes: 10 * 1024 * 1024,
      });

      const parsedUrl = new URL(url);
      expect(parsedUrl.searchParams.has("x-amz-checksum-crc32")).toBe(false);
      expect(url).not.toContain("AAAAAA%3D%3D");
      expect(url).not.toContain("AAAAAA==");
    });

    it("R1-F2: presignUpload binds Content-Type and Content-Length into signed headers for S3 mismatch enforcement", async () => {
      const { store, recorded } = createTestHarness();
      const key = buildRxKey("shop1", "rx1", "doc1", "pdf");

      const url = await store.presignUpload({
        key,
        contentType: "application/pdf",
        maxBytes: 10 * 1024 * 1024,
      });

      const presignCmd = recorded.find((r) => r.type === "presign")?.command as PutObjectCommand;
      expect(presignCmd.input.ContentType).toBe("application/pdf");
      expect(presignCmd.input.ContentLength).toBe(10 * 1024 * 1024);

      const parsed = new URL(url);
      const signedHeaders = (parsed.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";");
      expect(signedHeaders).toContain("content-type");
      expect(signedHeaders).toContain("content-length");
      expect(signedHeaders).toContain("host");
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
      const targetPrefix = "shops/shop123/rx/rx1/";
      let listCallCount = 0;
      const deleteCommands: DeleteObjectsCommand[] = [];

      const page1Objects = Array.from({ length: 1000 }, (_, i) => ({
        Key: `${targetPrefix}file-${i}.png`,
      }));
      const page2Objects = Array.from({ length: 500 }, (_, i) => ({
        Key: `${targetPrefix}file-${1000 + i}.png`,
      }));

      const { store, recorded } = createTestHarness({
        onSend: (command) => {
          if (command instanceof ListObjectsV2Command) {
            listCallCount++;

            // INV-10 proof: Assert both command inputs on every call
            expect(command.input.Prefix).toBe(targetPrefix);
            if (listCallCount === 1) {
              expect(command.input.ContinuationToken).toBeUndefined();
            } else if (listCallCount === 2) {
              expect(command.input.ContinuationToken).toBe("token-page-2");
            } else {
              expect.unreachable(`Unexpected list call #${listCallCount}`);
            }

            // Responses are driven strictly by Prefix and ContinuationToken inputs:
            if (command.input.Prefix !== targetPrefix) {
              return { Contents: [], IsTruncated: false };
            }

            if (command.input.ContinuationToken === undefined) {
              return {
                Contents: page1Objects,
                IsTruncated: true,
                NextContinuationToken: "token-page-2",
              };
            }

            if (command.input.ContinuationToken === "token-page-2") {
              return {
                Contents: page2Objects,
                IsTruncated: false,
              };
            }

            return { Contents: [], IsTruncated: false };
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

      const totalDeleted = await store.deletePrefix(targetPrefix);

      expect(totalDeleted).toBe(1500);
      expect(listCallCount).toBe(2);

      const listCommands = recorded
        .map((r) => r.command)
        .filter((c): c is ListObjectsV2Command => c instanceof ListObjectsV2Command);
      expect(listCommands.length).toBe(2);
      expect(listCommands[0].input.Prefix).toBe(targetPrefix);
      expect(listCommands[0].input.ContinuationToken).toBeUndefined();
      expect(listCommands[1].input.Prefix).toBe(targetPrefix);
      expect(listCommands[1].input.ContinuationToken).toBe("token-page-2");

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

    it("INV-10 / R1-F4: deletePrefix refuses any prefix outside shops/<id>/ and rejects hostile/non-canonical prefixes", async () => {
      const { store } = createTestHarness();

      const hostilePrefixes = [
        "",
        "/",
        "/shops/shop1/",
        "shops",
        "shops/",
        "shops//",
        "shops///",
        "shops/ /",
        "shops/shop 1/",
        "shops/shop1//",
        "shops/shop1//rx/",
        "shops/%2e%2e/",
        "shops/%2E%2E/",
        "shops/shop1/%2e%2e/",
        "shops/shop1/%2e%2e/other/",
        "shops/shop1%2fother/",
        "shops/shop1%2Fother/",
        "shops/shop1%5cother/",
        "shops/shop1%5Cother/",
        "shops/shop1/other",
        "other/",
        "shops/../other/",
        "shops/shop1/../../etc/",
        "../shops/shop1/",
        "shops/shop1\\evil",
        "shops/shop1/evil\0/",
        "shops/shop1/unmanaged/",
        "shops/shop1/rx/rx1/extra/",
        "shops/shop1/tickets/extra/",
        "shops/shop1/arbitrary/",
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

    it("R2-F1: deletePrefix restricts validation to exact key-builder prefix shapes and rejects arbitrary sub-prefixes", async () => {
      const { store } = createTestHarness();

      // Allowed key-builder prefixes:
      // 1. buildShopPrefix: shops/<shopId>/
      await expect(store.deletePrefix("shops/shop1/")).resolves.toBe(0);
      // 2. buildRxPrefix (shop only): shops/<shopId>/rx/
      await expect(store.deletePrefix("shops/shop1/rx/")).resolves.toBe(0);
      // 3. buildRxPrefix (shop + rx): shops/<shopId>/rx/<prescriptionId>/
      await expect(store.deletePrefix("shops/shop1/rx/rx123/")).resolves.toBe(0);
      // 4. buildTicketPrefix: shops/<shopId>/tickets/
      await expect(store.deletePrefix("shops/shop1/tickets/")).resolves.toBe(0);

      // Arbitrary/non-builder sub-prefixes are rejected:
      await expect(store.deletePrefix("shops/shop1/unmanaged/")).rejects.toThrow(InvalidKeyError);
      await expect(store.deletePrefix("shops/shop1/rx/rx1/extra/")).rejects.toThrow(InvalidKeyError);
      await expect(store.deletePrefix("shops/shop1/tickets/lab1/")).rejects.toThrow(InvalidKeyError);
      await expect(store.deletePrefix("shops/shop1/arbitrary/")).rejects.toThrow(InvalidKeyError);
    });
  });

  describe("Presigned download (60s fixed)", () => {
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

    it("R1-F3: presignDownload expiry is fixed at 60s and ignores caller override", async () => {
      const { store } = createTestHarness();
      const key = buildTicketKey("shopX", "lab1", "pdf");

      const url = await store.presignDownload(key);
      const parsed = new URL(url);
      expect(parsed.searchParams.get("X-Amz-Expires")).toBe("60");

      const urlObj = await store.presignDownload({ key });
      expect(new URL(urlObj).searchParams.get("X-Amz-Expires")).toBe("60");

      // Attempting to pass custom expiresIn (e.g. week-long 604800) is ignored
      const urlIgnored = await store.presignDownload({
        key,
        expiresIn: 604800,
      } as unknown as { key: string });
      expect(new URL(urlIgnored).searchParams.get("X-Amz-Expires")).toBe("60");
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

    it("R1-F6: buildTicketKey accepts only pdf or csv and rejects denied extensions", () => {
      expect(buildTicketKey("shop", "order", "pdf")).toBe("shops/shop/tickets/order.pdf");
      expect(buildTicketKey("shop", "order", "csv")).toBe("shops/shop/tickets/order.csv");
      expect(buildTicketKey("shop", "order", ".PDF")).toBe("shops/shop/tickets/order.pdf");
      expect(buildTicketKey("shop", "order", ".CSV")).toBe("shops/shop/tickets/order.csv");

      expect(() => buildTicketKey("shop", "order", "exe")).toThrow(InvalidKeyError);
      expect(() => buildTicketKey("shop", "order", "png")).toThrow(InvalidKeyError);
      expect(() => buildTicketKey("shop", "order", "html")).toThrow(InvalidKeyError);
      expect(() => buildTicketKey({ shopId: "shop", labOrderId: "order", ext: "exe" })).toThrow(InvalidKeyError);
    });
  });

  describe("createObjectStore safeguards", () => {
    it("R1-F5: refuses to create object store without presigner when client lacks middlewareStack (no unsigned fallback)", () => {
      const fakeWithoutMiddleware: S3ClientLike = {
        send: vi.fn() as unknown as S3ClientLike["send"],
      };
      expect(() =>
        createObjectStore({
          client: fakeWithoutMiddleware,
          bucket: "test-bucket",
          kmsKeyId: "arn:aws:kms:us-east-1:123456789012:key/test-kms-key",
        })
      ).toThrow(/client requires middlewareStack/);
    });

    it("R1-F5: allows custom client without middlewareStack if explicit presigner is provided", async () => {
      const fakeWithoutMiddleware: S3ClientLike = {
        send: vi.fn() as unknown as S3ClientLike["send"],
      };
      const customPresigner = vi.fn().mockResolvedValue("https://custom.signed.url");
      const store = createObjectStore({
        client: fakeWithoutMiddleware,
        bucket: "test-bucket",
        kmsKeyId: "arn:aws:kms:us-east-1:123456789012:key/test-kms-key",
        presigner: customPresigner,
      });

      const url = await store.presignDownload("shops/shop1/rx/rx1/file.pdf");
      expect(url).toBe("https://custom.signed.url");
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

    it("R1-F1: getObjectStore() client uses requestChecksumCalculation WHEN_REQUIRED so presigned URLs carry no empty-body CRC32", async () => {
      process.env.S3_BUCKET = "my-configured-bucket";
      process.env.S3_REGION = "us-west-2";
      process.env.S3_KMS_KEY_ID = "arn:aws:kms:us-west-2:111122223333:key/abc";
      process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
      process.env.AWS_SECRET_ACCESS_KEY = "SECRETEXAMPLE";

      const store = getObjectStore();
      const url = await store.presignUpload({
        key: buildRxKey("shop1", "rx1", "uuid1", "pdf"),
        contentType: "application/pdf",
        maxBytes: 10 * 1024 * 1024,
      });

      const parsedUrl = new URL(url);
      expect(parsedUrl.searchParams.has("x-amz-checksum-crc32")).toBe(false);
      expect(url).not.toContain("AAAAAA");
    });
  });
});
