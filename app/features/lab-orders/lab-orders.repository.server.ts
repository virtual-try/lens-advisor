import type { LabOrderStatus, Prisma, PrismaClient } from "@prisma/client";

/** Full client or transaction client. */
export type LabOrderDb = PrismaClient | Prisma.TransactionClient;

export interface LabOrderRecord {
  id: string;
  shopId: string;
  shopifyOrderId: string;
  orderName: string;
  bundleId: string;
  prescriptionId: string | null;
  lensId: string;
  optionValueIds: string[];
  addOnIds: string[];
  frameTitle: string;
  frameSku: string | null;
  rxOutOfLimits: boolean;
  status: LabOrderStatus;
  attempts: number;
  lastErrorCode: string | null;
  ticketKeys: string[];
  providerId: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

export interface UpsertLabOrderInput {
  shopifyOrderId: string;
  orderName: string;
  bundleId: string;
  prescriptionId?: string | null;
  lensId: string;
  optionValueIds?: string[];
  addOnIds?: string[];
  frameTitle: string;
  frameSku?: string | null;
  rxOutOfLimits?: boolean;
  status?: LabOrderStatus;
  lastErrorCode?: string | null;
}

function toLabOrderRecord(row: {
  id: string;
  shopId: string;
  shopifyOrderId: string;
  orderName: string;
  bundleId: string;
  prescriptionId: string | null;
  lensId: string;
  optionValueIds: string[];
  addOnIds: string[];
  frameTitle: string;
  frameSku: string | null;
  rxOutOfLimits: boolean;
  status: LabOrderStatus;
  attempts: number;
  lastErrorCode: string | null;
  ticketKeys: string[];
  providerId: string | null;
  sentAt: Date | null;
  createdAt: Date;
}): LabOrderRecord {
  return {
    id: row.id,
    shopId: row.shopId,
    shopifyOrderId: row.shopifyOrderId,
    orderName: row.orderName,
    bundleId: row.bundleId,
    prescriptionId: row.prescriptionId,
    lensId: row.lensId,
    optionValueIds: [...row.optionValueIds],
    addOnIds: [...row.addOnIds],
    frameTitle: row.frameTitle,
    frameSku: row.frameSku,
    rxOutOfLimits: row.rxOutOfLimits,
    status: row.status,
    attempts: row.attempts,
    lastErrorCode: row.lastErrorCode,
    ticketKeys: [...row.ticketKeys],
    providerId: row.providerId,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  };
}

/**
 * Upserts a LabOrder row using a single atomic statement on the unique key
 * `(shopId, shopifyOrderId, bundleId)` (INV-1, Self-check 2).
 * A concurrent duplicate cannot create two rows.
 */
export async function upsertLabOrder(
  db: LabOrderDb,
  shopId: string,
  input: UpsertLabOrderInput,
): Promise<LabOrderRecord> {
  const row = await db.labOrder.upsert({
    where: {
      shopId_shopifyOrderId_bundleId: {
        shopId,
        shopifyOrderId: input.shopifyOrderId,
        bundleId: input.bundleId,
      },
    },
    create: {
      shopId,
      shopifyOrderId: input.shopifyOrderId,
      orderName: input.orderName,
      bundleId: input.bundleId,
      prescriptionId: input.prescriptionId ?? null,
      lensId: input.lensId,
      optionValueIds: input.optionValueIds ? [...input.optionValueIds] : [],
      addOnIds: input.addOnIds ? [...input.addOnIds] : [],
      frameTitle: input.frameTitle,
      frameSku: input.frameSku ?? null,
      rxOutOfLimits: input.rxOutOfLimits ?? false,
      status: input.status ?? "PENDING",
      lastErrorCode: input.lastErrorCode ?? null,
      attempts: 0,
      ticketKeys: [],
    },
    update: {
      orderName: input.orderName,
      // On conflict, preserve terminal/workflow-owned fields (status, lastErrorCode, attempts, ticketKeys, providerId, sentAt) (R1-F3)
    },
  });

  return toLabOrderRecord(row);
}

/**
 * Gets a LabOrder by id, strictly scoped to shopId (INV-1).
 */
export async function getLabOrderById(
  db: LabOrderDb,
  shopId: string,
  id: string,
): Promise<LabOrderRecord | null> {
  const row = await db.labOrder.findFirst({
    where: {
      shopId,
      id,
    },
  });

  return row ? toLabOrderRecord(row) : null;
}

/**
 * Gets a LabOrder by shopifyOrderId and bundleId, strictly scoped to shopId (INV-1).
 */
export async function getLabOrderByShopifyOrderAndBundle(
  db: LabOrderDb,
  shopId: string,
  shopifyOrderId: string,
  bundleId: string,
): Promise<LabOrderRecord | null> {
  const row = await db.labOrder.findUnique({
    where: {
      shopId_shopifyOrderId_bundleId: {
        shopId,
        shopifyOrderId,
        bundleId,
      },
    },
  });

  return row ? toLabOrderRecord(row) : null;
}

/**
 * Lists all lab orders for a shop, strictly scoped to shopId (INV-1).
 */
export async function listLabOrdersByShop(
  db: LabOrderDb,
  shopId: string,
): Promise<LabOrderRecord[]> {
  const rows = await db.labOrder.findMany({
    where: { shopId },
    orderBy: { createdAt: "asc" },
  });

  return rows.map(toLabOrderRecord);
}
