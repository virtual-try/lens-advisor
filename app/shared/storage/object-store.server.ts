import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type S3Client,
  type ListObjectsV2CommandOutput,
  type DeleteObjectsCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "../http/errors.server";

export class UnsupportedTypeError extends AppError {
  constructor(message = "Unsupported content type") {
    super(400, "UNSUPPORTED_TYPE", message);
    this.name = "UnsupportedTypeError";
  }
}

export class TooLargeError extends AppError {
  constructor(message = "File size exceeds maximum allowed size") {
    super(400, "TOO_LARGE", message);
    this.name = "TooLargeError";
  }
}

export class InvalidKeyError extends AppError {
  constructor(message = "Invalid object key or prefix") {
    super(400, "INVALID_KEY", message);
    this.name = "InvalidKeyError";
  }
}

export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/pdf",
] as const;

export type AllowedUploadContentType = (typeof ALLOWED_UPLOAD_CONTENT_TYPES)[number];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const UPLOAD_URL_EXPIRATION_SECONDS = 300; // 5 minutes
export const DOWNLOAD_URL_EXPIRATION_SECONDS = 60; // 60 seconds

export interface PresignUploadParams {
  key: string;
  contentType: string;
  maxBytes?: number;
}

export interface PutObjectParams {
  key: string;
  body: unknown;
  contentType?: string;
}

export interface PresignDownloadOptions {
  expiresIn?: number;
}

export interface HeadObjectResult {
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  eTag?: string;
  lastModified?: Date;
  serverSideEncryption?: string;
  sseKmsKeyId?: string;
}

export type S3ClientLike = Pick<S3Client, "send">;

export type PresignerFn = (
  client: S3ClientLike,
  command: PutObjectCommand | GetObjectCommand,
  options?: { expiresIn?: number; hoistableHeaders?: Set<string> }
) => Promise<string>;

export interface CreateObjectStoreOptions {
  client: S3ClientLike;
  bucket: string;
  kmsKeyId: string;
  presigner?: PresignerFn;
  onCommand?: (command: unknown, type: "send" | "presign") => void;
}

export interface ObjectStore {
  readonly bucket: string;
  readonly kmsKeyId: string;
  presignUpload(params: PresignUploadParams): Promise<string>;
  putObject(params: PutObjectParams): Promise<void>;
  presignDownload(
    keyOrParams: string | { key: string; expiresIn?: number },
    options?: PresignDownloadOptions
  ): Promise<string>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  objectExists(key: string): Promise<boolean>;
  deletePrefix(prefix: string): Promise<number>;
}

export function assertValidId(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidKeyError(`Invalid ${name}: must be a non-empty string`);
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new InvalidKeyError(`Invalid ${name} '${value}': cannot contain '/' or '\\'`);
  }
  if (value.includes("..")) {
    throw new InvalidKeyError(`Invalid ${name} '${value}': cannot contain '..'`);
  }
  if (value.includes("\0")) {
    throw new InvalidKeyError(`Invalid ${name}: cannot contain null bytes`);
  }
}

export function assertValidExtension(ext: string): void {
  if (typeof ext !== "string" || ext.trim().length === 0) {
    throw new InvalidKeyError("Invalid extension: must be a non-empty string");
  }
  if (ext.includes("/") || ext.includes("\\")) {
    throw new InvalidKeyError(`Invalid extension '${ext}': cannot contain '/' or '\\'`);
  }
  if (ext.includes("..")) {
    throw new InvalidKeyError(`Invalid extension '${ext}': cannot contain '..'`);
  }
  if (ext.includes("\0")) {
    throw new InvalidKeyError("Invalid extension: cannot contain null bytes");
  }
}

export function validateShopScopedPrefix(prefix: string): void {
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new InvalidKeyError("Prefix must not be empty");
  }
  if (prefix.includes("..") || prefix.includes("\0") || prefix.includes("\\")) {
    throw new InvalidKeyError("Prefix cannot contain '..', '\\', or null bytes");
  }
  const match = prefix.match(/^shops\/([^/]+)\/(.*)$/);
  if (!match) {
    throw new InvalidKeyError(
      `Prefix '${prefix}' is not under 'shops/<id>/'. All operations must be shop-scoped.`
    );
  }
  const shopId = match[1];
  assertValidId("shopId", shopId);
}

export function validateKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError("Key must not be empty");
  }
  if (key.startsWith("/") || key.startsWith("\\")) {
    throw new InvalidKeyError("Key cannot start with '/' or '\\'");
  }
  if (key.includes("..") || key.includes("\0") || key.includes("\\")) {
    throw new InvalidKeyError("Key cannot contain '..', '\\', or null bytes");
  }
  const match = key.match(/^shops\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new InvalidKeyError(
      `Key '${key}' is not under 'shops/<id>/'. All operations must be shop-scoped.`
    );
  }
  const shopId = match[1];
  assertValidId("shopId", shopId);
  const remainder = match[2];
  if (!remainder || remainder.trim().length === 0) {
    throw new InvalidKeyError(`Key '${key}' missing path after shop id`);
  }
}

export function buildRxKey(
  shopId: string,
  prescriptionId: string,
  fileId: string,
  ext: string
): string;
export function buildRxKey(params: {
  shopId: string;
  prescriptionId: string;
  fileId: string;
  ext: string;
}): string;
export function buildRxKey(
  shopIdOrParams:
    | string
    | {
        shopId: string;
        prescriptionId: string;
        fileId: string;
        ext: string;
      },
  prescriptionId?: string,
  fileId?: string,
  ext?: string
): string {
  let shopId: string;
  let pId: string;
  let fId: string;
  let extension: string;

  if (typeof shopIdOrParams === "object") {
    shopId = shopIdOrParams.shopId;
    pId = shopIdOrParams.prescriptionId;
    fId = shopIdOrParams.fileId;
    extension = shopIdOrParams.ext;
  } else {
    shopId = shopIdOrParams;
    pId = prescriptionId!;
    fId = fileId!;
    extension = ext!;
  }

  assertValidId("shopId", shopId);
  assertValidId("prescriptionId", pId);
  assertValidId("fileId", fId);
  assertValidExtension(extension);

  const cleanExt = extension.replace(/^\.+/, "").toLowerCase();
  return `shops/${shopId}/rx/${pId}/${fId}.${cleanExt}`;
}

export function buildTicketKey(
  shopId: string,
  labOrderId: string,
  ext: "pdf" | "csv" | string
): string;
export function buildTicketKey(params: {
  shopId: string;
  labOrderId: string;
  ext: "pdf" | "csv" | string;
}): string;
export function buildTicketKey(
  shopIdOrParams:
    | string
    | {
        shopId: string;
        labOrderId: string;
        ext: "pdf" | "csv" | string;
      },
  labOrderId?: string,
  ext?: string
): string {
  let shopId: string;
  let oId: string;
  let extension: string;

  if (typeof shopIdOrParams === "object") {
    shopId = shopIdOrParams.shopId;
    oId = shopIdOrParams.labOrderId;
    extension = shopIdOrParams.ext;
  } else {
    shopId = shopIdOrParams;
    oId = labOrderId!;
    extension = ext!;
  }

  assertValidId("shopId", shopId);
  assertValidId("labOrderId", oId);
  assertValidExtension(extension);

  const cleanExt = extension.replace(/^\.+/, "").toLowerCase();
  return `shops/${shopId}/tickets/${oId}.${cleanExt}`;
}

export function buildShopPrefix(shopId: string): string {
  assertValidId("shopId", shopId);
  return `shops/${shopId}/`;
}

export function buildRxPrefix(shopId: string, prescriptionId?: string): string {
  assertValidId("shopId", shopId);
  if (prescriptionId !== undefined) {
    assertValidId("prescriptionId", prescriptionId);
    return `shops/${shopId}/rx/${prescriptionId}/`;
  }
  return `shops/${shopId}/rx/`;
}

export function buildTicketPrefix(shopId: string): string {
  assertValidId("shopId", shopId);
  return `shops/${shopId}/tickets/`;
}

export function createObjectStore(options: CreateObjectStoreOptions): ObjectStore {
  const { client, bucket, kmsKeyId } = options;

  if (!bucket || bucket.trim().length === 0) {
    throw new Error("createObjectStore: bucket is required");
  }
  if (!kmsKeyId || kmsKeyId.trim().length === 0) {
    throw new Error("createObjectStore: kmsKeyId is required");
  }

  const presigner: PresignerFn =
    options.presigner ??
    (typeof (client as unknown as S3Client)?.middlewareStack?.clone === "function"
      ? (s3Client, command, opts) =>
          getSignedUrl(s3Client as unknown as S3Client, command, {
            expiresIn: opts?.expiresIn,
            hoistableHeaders: opts?.hoistableHeaders,
          })
      : async (_s3Client, command) => {
          const key = command.input.Key;
          return `https://${bucket}.s3.amazonaws.com/${key}`;
        });

  return {
    bucket,
    kmsKeyId,

    async presignUpload(params: PresignUploadParams): Promise<string> {
      validateKey(params.key);

      const normalizedType = params.contentType?.trim().toLowerCase();
      if (
        !ALLOWED_UPLOAD_CONTENT_TYPES.includes(
          normalizedType as AllowedUploadContentType
        )
      ) {
        throw new UnsupportedTypeError(
          `Content type '${params.contentType}' is not supported. Allowed types: ${ALLOWED_UPLOAD_CONTENT_TYPES.join(", ")}`
        );
      }

      if (params.maxBytes !== undefined) {
        if (typeof params.maxBytes !== "number" || isNaN(params.maxBytes) || params.maxBytes <= 0) {
          throw new TooLargeError("Invalid maxBytes: must be a positive number");
        }
        if (params.maxBytes > MAX_UPLOAD_BYTES) {
          throw new TooLargeError(
            `File size ${params.maxBytes} exceeds maximum allowed size of ${MAX_UPLOAD_BYTES} bytes (10 MB)`
          );
        }
      }

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        ContentType: normalizedType,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: kmsKeyId,
      });

      options.onCommand?.(command, "presign");

      const hoistableHeaders = new Set([
        "x-amz-server-side-encryption",
        "x-amz-server-side-encryption-aws-kms-key-id",
      ]);

      return await presigner(client, command, {
        expiresIn: UPLOAD_URL_EXPIRATION_SECONDS,
        hoistableHeaders,
      });
    },

    async putObject(params: PutObjectParams): Promise<void> {
      validateKey(params.key);

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.body as PutObjectCommand["input"]["Body"],
        ContentType: params.contentType,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: kmsKeyId,
      });

      options.onCommand?.(command, "send");

      await client.send(command);
    },

    async presignDownload(
      keyOrParams: string | { key: string; expiresIn?: number },
      downloadOptions?: PresignDownloadOptions
    ): Promise<string> {
      const key = typeof keyOrParams === "string" ? keyOrParams : keyOrParams.key;
      const expiresIn =
        (typeof keyOrParams === "object" ? keyOrParams.expiresIn : undefined) ??
        downloadOptions?.expiresIn ??
        DOWNLOAD_URL_EXPIRATION_SECONDS;

      validateKey(key);

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      options.onCommand?.(command, "presign");

      return await presigner(client, command, { expiresIn });
    },

    async headObject(key: string): Promise<HeadObjectResult | null> {
      validateKey(key);

      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      options.onCommand?.(command, "send");

      try {
        const result = await client.send(command);

        return {
          exists: true,
          contentLength: result.ContentLength,
          contentType: result.ContentType,
          eTag: result.ETag,
          lastModified: result.LastModified,
          serverSideEncryption: result.ServerSideEncryption,
          sseKmsKeyId: result.SSEKMSKeyId,
        };
      } catch (error: unknown) {
        const err = error as {
          name?: string;
          message?: string;
          $metadata?: { httpStatusCode?: number };
        };
        if (
          err?.name === "NotFound" ||
          err?.name === "NoSuchKey" ||
          err?.$metadata?.httpStatusCode === 404 ||
          err?.message?.includes("NotFound")
        ) {
          return null;
        }
        throw error;
      }
    },

    async objectExists(key: string): Promise<boolean> {
      const head = await this.headObject(key);
      return head !== null;
    },

    async deletePrefix(prefix: string): Promise<number> {
      validateShopScopedPrefix(prefix);

      let totalDeleted = 0;
      let continuationToken: string | undefined = undefined;

      do {
        const listCommand: ListObjectsV2Command = new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        options.onCommand?.(listCommand, "send");

        const listResult: ListObjectsV2CommandOutput = await client.send(listCommand);

        const objects = (listResult.Contents ?? []).filter(
          (item): item is { Key: string } =>
            typeof item.Key === "string" && item.Key.length > 0
        );

        if (objects.length > 0) {
          const chunkSize = 1000;
          for (let i = 0; i < objects.length; i += chunkSize) {
            const chunk = objects.slice(i, i + chunkSize);
            const deleteCommand: DeleteObjectsCommand = new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: {
                Objects: chunk.map((obj) => ({ Key: obj.Key })),
                Quiet: true,
              },
            });

            options.onCommand?.(deleteCommand, "send");

            const deleteResult: DeleteObjectsCommandOutput =
              await client.send(deleteCommand);

            if (deleteResult.Errors && deleteResult.Errors.length > 0) {
              const firstErr = deleteResult.Errors[0];
              throw new Error(
                `Failed to delete object '${firstErr.Key}': ${firstErr.Code} - ${firstErr.Message}`
              );
            }

            totalDeleted += chunk.length;
          }
        }

        continuationToken = listResult.IsTruncated
          ? listResult.NextContinuationToken
          : undefined;
      } while (continuationToken);

      return totalDeleted;
    },
  };
}
