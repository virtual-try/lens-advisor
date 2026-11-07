import { S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "../config.server";
import {
  createObjectStore,
  type ObjectStore,
} from "../storage/object-store.server";

declare global {
  var __objectStore: ObjectStore | undefined;
}

export function getObjectStore(): ObjectStore {
  if (!global.__objectStore) {
    const config = getConfig();
    const s3Config = config.s3;
    const client = new S3Client({
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey,
      },
    });

    global.__objectStore = createObjectStore({
      client,
      bucket: s3Config.bucket,
      kmsKeyId: s3Config.kmsKeyId,
    });
  }

  return global.__objectStore;
}

export function resetObjectStore(): void {
  global.__objectStore = undefined;
}
