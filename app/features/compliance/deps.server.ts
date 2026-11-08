import type { PrismaClient } from "@prisma/client";

import { getCipher } from "../../shared/container/cipher.server";
import { getMailer } from "../../shared/container/mailer.server";
import { getObjectStore } from "../../shared/container/object-store.server";
import { getPrisma } from "../../shared/container/prisma.server";
import { getQueue } from "../../shared/container/queue.server";
import type { FieldCipher } from "../../shared/crypto/field-cipher.server";
import type { Mailer } from "../../shared/mail/mailer.server";
import type { Queue } from "../../shared/queue/queue";
import type { ObjectStore } from "../../shared/storage/object-store.server";
import { shopContactEmailFromAdmin } from "./shop-contact.server";

/** Ids only. Callers must not pass prescription values or mailboxes. */
export type ComplianceLogFields = {
  shopId: string;
  complianceRequestId: string;
  customerId?: string;
  orderIds: readonly string[];
  prescriptionIds: readonly string[];
};

export type ComplianceLogger = {
  info(event: string, fields: ComplianceLogFields): void;
};

export type ShopContactEmail = (shopDomain: string) => Promise<string | null>;

export type ComplianceDeps = {
  prisma: PrismaClient;
  queue: Queue;
  objectStore: ObjectStore;
  mailer: Mailer;
  cipher: FieldCipher;
  logger: ComplianceLogger;
  shopContactEmail: ShopContactEmail;
};

const complianceLogger: ComplianceLogger = {
  info(event, fields) {
    console.info(event, {
      shopId: fields.shopId,
      complianceRequestId: fields.complianceRequestId,
      customerId: fields.customerId,
      orderIds: fields.orderIds,
      prescriptionIds: fields.prescriptionIds,
    });
  },
};

let overrides: Partial<ComplianceDeps> | undefined;

/** Tests inject the fake mailer, object store, and throwaway database. */
export function setComplianceDepsForTests(next: Partial<ComplianceDeps> | undefined): void {
  overrides = next;
}

export function resolveCompliancePrisma(): PrismaClient {
  return overrides?.prisma ?? getPrisma();
}

export async function resolveComplianceDeps(): Promise<ComplianceDeps> {
  const queue = overrides?.queue ?? (await getQueue());
  return {
    prisma: overrides?.prisma ?? getPrisma(),
    queue,
    objectStore: overrides?.objectStore ?? getObjectStore(),
    mailer: overrides?.mailer ?? getMailer(),
    cipher: overrides?.cipher ?? getCipher(),
    logger: overrides?.logger ?? complianceLogger,
    shopContactEmail: overrides?.shopContactEmail ?? shopContactEmailFromAdmin,
  };
}
