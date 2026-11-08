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

export const ALLOWED_TICKET_EXTENSIONS = ["pdf", "csv"] as const;
export type AllowedTicketExtension = (typeof ALLOWED_TICKET_EXTENSIONS)[number];

export interface PresignUploadParams {
  key: string;
  contentType: string;
  maxBytes?: number;
  contentLength?: number;
}

export interface PutObjectParams {
  key: string;
  body: unknown;
  contentType?: string;
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
  options?: {
    expiresIn?: number;
    hoistableHeaders?: Set<string>;
    signableHeaders?: Set<string>;
    unhoistableHeaders?: Set<string>;
  }
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
  presignDownload(keyOrParams: string | { key: string }): Promise<string>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  objectExists(key: string): Promise<boolean>;
  deletePrefix(prefix: string): Promise<number>;
}

export function assertValidId(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidKeyError(`Invalid ${name}: must be a non-empty string`);
  }
  if (/\s/.test(value)) {
    throw new InvalidKeyError(`Invalid ${name} '${value}': cannot contain whitespace`);
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
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new InvalidKeyError(`Invalid ${name}: contains malformed percent-encoding`);
  }
  if (
    decoded.includes("..") ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    /\s/.test(decoded)
  ) {
    throw new InvalidKeyError(`Invalid ${name} '${value}': contains encoded traversal or separators`);
  }
}

export function assertValidExtension(ext: string): void {
  if (typeof ext !== "string" || ext.trim().length === 0) {
    throw new InvalidKeyError("Invalid extension: must be a non-empty string");
  }
  if (/\s/.test(ext)) {
    throw new InvalidKeyError(`Invalid extension '${ext}': cannot contain whitespace`);
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
  let decoded = ext;
  try {
    decoded = decodeURIComponent(ext);
  } catch {
    throw new InvalidKeyError("Invalid extension: contains malformed percent-encoding");
  }
  if (
    decoded.includes("..") ||
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    /\s/.test(decoded)
  ) {
    throw new InvalidKeyError(`Invalid extension '${ext}': contains encoded traversal or separators`);
  }
}

export function validateShopScopedPrefix(prefix: string): void {
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new InvalidKeyError("Prefix must not be empty");
  }
  if (prefix.startsWith("/") || prefix.startsWith("\\")) {
    throw new InvalidKeyError("Prefix cannot start with '/' or '\\'");
  }
  if (!prefix.endsWith("/")) {
    throw new InvalidKeyError("Prefix must end with '/'");
  }
  if (prefix.includes("//") || prefix.includes("\\")) {
    throw new InvalidKeyError("Prefix cannot contain '//' or '\\'");
  }
  if (prefix.includes("..") || prefix.includes("\0")) {
    throw new InvalidKeyError("Prefix cannot contain '..' or null bytes");
  }
  if (/\s/.test(prefix)) {
    throw new InvalidKeyError("Prefix cannot contain whitespace");
  }

  let decoded = prefix;
  try {
    decoded = decodeURIComponent(prefix);
  } catch {
    throw new InvalidKeyError("Prefix contains malformed percent-encoding");
  }

  if (
    decoded.includes("..") ||
    decoded.includes("//") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    /\s/.test(decoded)
  ) {
    throw new InvalidKeyError("Prefix cannot contain encoded traversal, whitespace, or empty segments");
  }

  if (decoded.split("/").length !== prefix.split("/").length) {
    throw new InvalidKeyError("Prefix cannot contain encoded path separators");
  }

  const match = prefix.match(/^shops\/([^/]+)\/(.*)$/);
  if (!match) {
    throw new InvalidKeyError(
      `Prefix '${prefix}' is not under 'shops/<id>/'. All operations must be shop-scoped.`
    );
  }
  const shopId = match[1];
  assertValidId("shopId", shopId);

  const remainder = match[2];
  if (remainder === "" || remainder === "tickets/" || remainder === "rx/") {
    return;
  }

  const rxMatch = remainder.match(/^rx\/([^/]+)\/$/);
  if (rxMatch) {
    assertValidId("prescriptionId", rxMatch[1]);
    return;
  }

  throw new InvalidKeyError(
    `Prefix '${prefix}' is not an allowed canonical prefix shape. Allowed prefix shapes: 'shops/<id>/', 'shops/<id>/rx/', 'shops/<id>/rx/<prescriptionId>/', or 'shops/<id>/tickets/'.`
  );
}

export function validateKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError("Key must not be empty");
  }
  if (key.startsWith("/") || key.startsWith("\\")) {
    throw new InvalidKeyError("Key cannot start with '/' or '\\'");
  }
  if (key.includes("..") || key.includes("\0") || key.includes("\\") || key.includes("//")) {
    throw new InvalidKeyError("Key cannot contain '..', '\\', '//', or null bytes");
  }
  if (/\s/.test(key)) {
    throw new InvalidKeyError("Key cannot contain whitespace");
  }

  let decoded = key;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    throw new InvalidKeyError("Key contains malformed percent-encoding");
  }

  if (
    decoded.includes("..") ||
    decoded.includes("//") ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    /\s/.test(decoded)
  ) {
    throw new InvalidKeyError("Key contains encoded traversal, whitespace, or empty segments");
  }

  if (decoded.split("/").length !== key.split("/").length) {
    throw new InvalidKeyError("Key cannot contain encoded path separators");
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
  const segments = remainder.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new InvalidKeyError(`Key '${key}' contains empty segments`);
    }
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
  ext: AllowedTicketExtension | (string & {})
): string;
export function buildTicketKey(params: {
  shopId: string;
  labOrderId: string;
  ext: AllowedTicketExtension | (string & {});
}): string;
export function buildTicketKey(
  shopIdOrParams:
    | string
    | {
        shopId: string;
        labOrderId: string;
        ext: AllowedTicketExtension | (string & {});
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
  if (cleanExt !== "pdf" && cleanExt !== "csv") {
    throw new InvalidKeyError(
      `Invalid ticket extension '${extension}': must be 'pdf' or 'csv'`
    );
  }

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

  if (
    !options.presigner &&
    typeof (client as unknown as S3Client)?.middlewareStack?.clone !== "function"
  ) {
    throw new Error(
      "createObjectStore: client requires middlewareStack for presigning, or an explicit presigner must be provided"
    );
  }

  const presigner: PresignerFn =
    options.presigner ??
    ((s3Client, command, opts) =>
      getSignedUrl(s3Client as unknown as S3Client, command, {
        expiresIn: opts?.expiresIn,
        hoistableHeaders: opts?.hoistableHeaders,
        signableHeaders: opts?.signableHeaders,
        unhoistableHeaders: opts?.unhoistableHeaders,
      }));

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

      if (params.contentLength !== undefined) {
        if (
          typeof params.contentLength !== "number" ||
          isNaN(params.contentLength) ||
          params.contentLength <= 0
        ) {
          throw new TooLargeError("Invalid contentLength: must be a positive number");
        }
        if (params.contentLength > MAX_UPLOAD_BYTES) {
          throw new TooLargeError(
            `File size ${params.contentLength} exceeds maximum allowed size of ${MAX_UPLOAD_BYTES} bytes (10 MB)`
          );
        }
        if (params.maxBytes !== undefined && params.contentLength > params.maxBytes) {
          throw new TooLargeError(
            `Declared contentLength ${params.contentLength} exceeds maxBytes ${params.maxBytes}`
          );
        }
      }

      const length = params.contentLength ?? params.maxBytes ?? MAX_UPLOAD_BYTES;

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        ContentType: normalizedType,
        ContentLength: length,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: kmsKeyId,
      });

      options.onCommand?.(command, "presign");

      const hoistableHeaders = new Set([
        "x-amz-server-side-encryption",
        "x-amz-server-side-encryption-aws-kms-key-id",
      ]);

      const signableHeaders = new Set(["content-type", "content-length"]);

      return await presigner(client, command, {
        expiresIn: UPLOAD_URL_EXPIRATION_SECONDS,
        hoistableHeaders,
        signableHeaders,
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
      keyOrParams: string | { key: string }
    ): Promise<string> {
      const key = typeof keyOrParams === "string" ? keyOrParams : keyOrParams.key;

      validateKey(key);

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      options.onCommand?.(command, "presign");

      return await presigner(client, command, {
        expiresIn: DOWNLOAD_URL_EXPIRATION_SECONDS,
      });
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
