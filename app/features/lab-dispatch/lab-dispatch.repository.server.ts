import type {
  AddOn,
  LabOrder,
  LabOrderStatus,
  Lens,
  OptionValue,
  Prescription,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { getPrisma } from "../../shared/container/prisma.server";

export type LabDispatchDb = PrismaClient | Prisma.TransactionClient;

export interface MarkSentData {
  providerId: string;
  ticketKeys: string[];
  sentAt?: Date;
}

/**
 * Gets a LabOrder by id, strictly scoped to shopId (INV-1).
 */
export async function getLabOrder(
  shopId: string,
  labOrderId: string,
  db?: LabDispatchDb,
): Promise<LabOrder | null> {
  const client = db ?? getPrisma();
  return client.labOrder.findFirst({
    where: { shopId, id: labOrderId },
  });
}

/**
 * Transitions LabOrder to SENDING status via a single conditional UPDATE
 * WHERE status IN ('PENDING', 'FAILED') and increments attempts (Self-check 1).
 * Checks the returned update count: a second worker loses and receives transitioned: false.
 */
export async function transitionToSending(
  shopId: string,
  labOrderId: string,
  db?: LabDispatchDb,
): Promise<{ transitioned: boolean; attempts: number }> {
  const client = db ?? getPrisma();
  const result = await client.labOrder.updateMany({
    where: {
      shopId,
      id: labOrderId,
      status: { in: ["PENDING", "FAILED"] },
    },
    data: {
      status: "SENDING",
      attempts: { increment: 1 },
    },
  });

  if (result.count === 0) {
    return { transitioned: false, attempts: 0 };
  }

  const updated = await client.labOrder.findFirst({
    where: { shopId, id: labOrderId },
    select: { attempts: true },
  });

  return { transitioned: true, attempts: updated?.attempts ?? 1 };
}

/**
 * Marks a LabOrder as SENT, updating providerId, ticketKeys, sentAt, and clearing lastErrorCode.
 * Strictly scoped to shopId (INV-1).
 */
export async function markSent(
  shopId: string,
  labOrderId: string,
  data: MarkSentData,
  db?: LabDispatchDb,
): Promise<LabOrder | null> {
  const client = db ?? getPrisma();
  const updated = await client.labOrder.updateMany({
    where: { shopId, id: labOrderId },
    data: {
      status: "SENT",
      providerId: data.providerId,
      ticketKeys: data.ticketKeys,
      sentAt: data.sentAt ?? new Date(),
      lastErrorCode: null,
    },
  });

  if (updated.count === 0) return null;

  return client.labOrder.findFirst({
    where: { shopId, id: labOrderId },
  });
}

/**
 * Marks a LabOrder as FAILED, recording lastErrorCode.
 * Strictly scoped to shopId (INV-1).
 */
export async function markFailed(
  shopId: string,
  labOrderId: string,
  errorCode: string,
  db?: LabDispatchDb,
): Promise<LabOrder | null> {
  const client = db ?? getPrisma();
  const updated = await client.labOrder.updateMany({
    where: { shopId, id: labOrderId },
    data: {
      status: "FAILED",
      lastErrorCode: errorCode,
    },
  });

  if (updated.count === 0) return null;

  return client.labOrder.findFirst({
    where: { shopId, id: labOrderId },
  });
}

/**
 * Resets a LabOrder status (e.g. to PENDING for resend) and clears lastErrorCode.
 * Strictly scoped to shopId (INV-1).
 */
export async function resetLabOrderStatus(
  shopId: string,
  labOrderId: string,
  status: LabOrderStatus = "PENDING",
  db?: LabDispatchDb,
): Promise<LabOrder | null> {
  const client = db ?? getPrisma();
  const updated = await client.labOrder.updateMany({
    where: { shopId, id: labOrderId },
    data: {
      status,
      lastErrorCode: null,
    },
  });

  if (updated.count === 0) return null;

  return client.labOrder.findFirst({
    where: { shopId, id: labOrderId },
  });
}

/**
 * Fetches Prescription row strictly scoped to shopId (INV-1).
 */
export async function getPrescription(
  shopId: string,
  prescriptionId: string,
  db?: LabDispatchDb,
): Promise<Prescription | null> {
  const client = db ?? getPrisma();
  return client.prescription.findFirst({
    where: { shopId, id: prescriptionId },
  });
}

/**
 * Fetches Lens row strictly scoped to shopId (INV-1).
 * Archived lenses are still readable so old orders can be rendered (Self-check 3).
 */
export async function getLens(
  shopId: string,
  lensId: string,
  db?: LabDispatchDb,
): Promise<Lens | null> {
  const client = db ?? getPrisma();
  return client.lens.findFirst({
    where: { shopId, id: lensId },
  });
}

/**
 * Fetches OptionValue rows strictly scoped to shopId (INV-1).
 * Archived rows are still readable.
 */
export async function getOptionValues(
  shopId: string,
  optionValueIds: string[],
  db?: LabDispatchDb,
): Promise<OptionValue[]> {
  const client = db ?? getPrisma();
  if (optionValueIds.length === 0) return [];
  return client.optionValue.findMany({
    where: {
      shopId,
      id: { in: optionValueIds },
    },
    orderBy: { position: "asc" },
  });
}

/**
 * Fetches AddOn rows strictly scoped to shopId (INV-1).
 * Archived rows are still readable.
 */
export async function getAddOns(
  shopId: string,
  addOnIds: string[],
  db?: LabDispatchDb,
): Promise<AddOn[]> {
  const client = db ?? getPrisma();
  if (addOnIds.length === 0) return [];
  return client.addOn.findMany({
    where: {
      shopId,
      id: { in: addOnIds },
    },
    orderBy: { position: "asc" },
  });
}
