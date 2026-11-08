import type {
  Mailer,
  SendMailOptions,
  SendMailResult,
} from "../../app/shared/mail/mailer.server";
import type {
  HeadObjectResult,
  ObjectStore,
  PresignUploadParams,
  PutObjectParams,
} from "../../app/shared/storage/object-store.server";

export interface MockObjectStore extends ObjectStore {
  storedObjects: Map<string, { body: unknown; contentType?: string }>;
  deletedPrefixes: string[];
}

export function createMockObjectStore(): MockObjectStore {
  const storedObjects = new Map<string, { body: unknown; contentType?: string }>();
  const deletedPrefixes: string[] = [];

  return {
    bucket: "test-bucket",
    kmsKeyId: "test-kms-key",
    storedObjects,
    deletedPrefixes,
    async presignUpload(params: PresignUploadParams): Promise<string> {
      return `https://s3.test/upload/${params.key}`;
    },
    async putObject(params: PutObjectParams): Promise<void> {
      storedObjects.set(params.key, {
        body: params.body,
        contentType: params.contentType,
      });
    },
    async presignDownload(
      keyOrParams: string | { key: string }
    ): Promise<string> {
      const key = typeof keyOrParams === "string" ? keyOrParams : keyOrParams.key;
      return `https://s3.test/download/${key}`;
    },
    async headObject(key: string): Promise<HeadObjectResult | null> {
      const found = storedObjects.get(key);
      if (!found) return null;
      return {
        exists: true,
        contentType: found.contentType,
      };
    },
    async objectExists(key: string): Promise<boolean> {
      return storedObjects.has(key);
    },
    async deletePrefix(prefix: string): Promise<number> {
      deletedPrefixes.push(prefix);
      let count = 0;
      for (const key of Array.from(storedObjects.keys())) {
        if (key.startsWith(prefix)) {
          storedObjects.delete(key);
          count++;
        }
      }
      return count;
    },
  };
}

export interface MockMailer extends Mailer {
  sentMails: SendMailOptions[];
}

export function createMockMailer(): MockMailer {
  const sentMails: SendMailOptions[] = [];
  return {
    sentMails,
    async send(opts: SendMailOptions): Promise<SendMailResult> {
      sentMails.push(opts);
      return { providerId: `msg_${Date.now()}` };
    },
  };
}

export function setupStorageAndMailerMocks(): {
  mockStore: MockObjectStore;
  mockMailer: MockMailer;
} {
  const mockStore = createMockObjectStore();
  const mockMailer = createMockMailer();

  (globalThis as Record<string, unknown>).__objectStore = mockStore;
  (globalThis as Record<string, unknown>).__mailer = mockMailer;

  return { mockStore, mockMailer };
}

export function teardownStorageAndMailerMocks(): void {
  delete (globalThis as Record<string, unknown>).__objectStore;
  delete (globalThis as Record<string, unknown>).__mailer;
}
