import { Prisma, type PrismaClient } from "@prisma/client";

import type { ComplianceTopic } from "./schema";

export type ComplianceDb = PrismaClient | Prisma.TransactionClient;

export type ShopRow = {
  id: string;
  domain: string;
};

export type PrescriptionRef = {
  id: string;
  orderId: string | null;
  cipher: string;
  rxType: string;
  source: string;
};

const prescriptionSelect = {
  id: true,
  orderId: true,
  cipher: true,
  rxType: true,
  source: true,
} as const;

export async function findShopByDomain(
  db: ComplianceDb,
  domain: string,
): Promise<ShopRow | null> {
  return db.shop.findUnique({
    where: { domain },
    select: { id: true, domain: true },
  });
}

export async function findShopById(db: ComplianceDb, shopId: string): Promise<ShopRow | null> {
  return db.shop.findFirst({
    where: { id: shopId },
    select: { id: true, domain: true },
  });
}

export type InsertedComplianceRequest = {
  id: string;
  created: boolean;
};

/**
 * One row per Shopify webhook id. A duplicate id is not an error: the caller
 * must not enqueue a second job (INV-8).
 */
export async function insertComplianceRequest(
  db: ComplianceDb,
  input: { shopId: string; topic: ComplianceTopic; shopifyRequestId: string },
): Promise<InsertedComplianceRequest> {
  try {
    const row = await db.complianceRequest.create({
      data: {
        shopId: input.shopId,
        topic: input.topic,
        shopifyRequestId: input.shopifyRequestId,
      },
      select: { id: true },
    });
    return { id: row.id, created: true };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await db.complianceRequest.findUnique({
      where: { shopifyRequestId: input.shopifyRequestId },
      select: { id: true, shopId: true },
    });
    if (!existing || existing.shopId !== input.shopId) {
      return { id: "", created: false };
    }
    return { id: existing.id, created: false };
  }
}

export async function deleteUnfinishedComplianceRequest(
  db: ComplianceDb,
  shopId: string,
  id: string,
): Promise<void> {
  await db.complianceRequest.deleteMany({
    where: { id, shopId, handledAt: null },
  });
}

export async function complianceRequestHandled(
  db: ComplianceDb,
  shopId: string,
  id: string,
): Promise<boolean> {
  const row = await db.complianceRequest.findFirst({
    where: { id, shopId },
    select: { handledAt: true },
  });
  if (!row) return true;
  return row.handledAt !== null;
}

export async function markComplianceRequestHandled(
  db: ComplianceDb,
  shopId: string,
  id: string,
): Promise<void> {
  await db.complianceRequest.updateMany({
    where: { id, shopId, handledAt: null },
    data: { handledAt: new Date() },
  });
}

/**
 * Prescriptions for this shop whose order id is listed, plus prescriptions
 * linked from this shop's lab orders for those Shopify orders.
 */
export async function findPrescriptionsForOrders(
  db: ComplianceDb,
  shopId: string,
  orderIds: readonly string[],
): Promise<PrescriptionRef[]> {
  if (orderIds.length === 0) return [];

  const direct = await db.prescription.findMany({
    where: { shopId, orderId: { in: [...orderIds] } },
    select: prescriptionSelect,
  });
  const seen = new Set(direct.map((row) => row.id));

  const linked = await db.labOrder.findMany({
    where: {
      shopId,
      shopifyOrderId: { in: [...orderIds] },
      prescriptionId: { not: null },
    },
    select: { prescriptionId: true },
  });
  const extraIds = linked
    .map((row) => row.prescriptionId)
    .filter((id): id is string => id !== null && !seen.has(id));

  if (extraIds.length === 0) return direct;

  const extra = await db.prescription.findMany({
    where: { shopId, id: { in: extraIds } },
    select: prescriptionSelect,
  });
  return [...direct, ...extra];
}

export async function nullLabOrderPrescriptions(
  db: ComplianceDb,
  shopId: string,
  orderIds: readonly string[],
  prescriptionIds: readonly string[],
): Promise<void> {
  if (orderIds.length === 0 && prescriptionIds.length === 0) return;
  await db.labOrder.updateMany({
    where: {
      shopId,
      OR: [
        ...(orderIds.length > 0 ? [{ shopifyOrderId: { in: [...orderIds] } }] : []),
        ...(prescriptionIds.length > 0 ? [{ prescriptionId: { in: [...prescriptionIds] } }] : []),
      ],
    },
    data: { prescriptionId: null },
  });
}

export async function deletePrescriptions(
  db: ComplianceDb,
  shopId: string,
  prescriptionIds: readonly string[],
): Promise<void> {
  if (prescriptionIds.length === 0) return;
  await db.prescription.deleteMany({
    where: { shopId, id: { in: [...prescriptionIds] } },
  });
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
