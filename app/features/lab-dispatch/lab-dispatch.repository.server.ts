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
import { ConflictError } from "../../shared/http/errors.server";

export type LabDispatchDb = PrismaClient | Prisma.TransactionClient;

export type LabDispatchErrorCode =
  | "NO_LAB_EMAIL"
  | "RX_DECRYPT_FAILED"
  | "LOAD_FAILED"
  | "TICKET_RENDER_FAILED"
  | "STORAGE_FAILED"
  | "MAIL_FAILED";

export const SENDING_STALE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes lease timeout (R1-F2)

export interface MarkSentData {
  providerId: string;
  ticketKeys: string[];
  sentAt?: Date;
}

/**
 * Resolves the owning shopId for a labOrderId (R1-F4).
 * This is the only unscoped id-to-shop resolver, used for internal job processing
 * where the job queue payload contains only { labOrderId } without shopId.
 * All subsequent repository calls must be strictly scoped to the resolved shopId (INV-1).
 */
export async function getLabOrderShopId(
  labOrderId: string,
  db?: LabDispatchDb,
): Promise<string | null> {
  const client = db ?? getPrisma();
  const order = await client.labOrder.findUnique({
    where: { id: labOrderId },
    select: { shopId: true },
  });
  return order?.shopId ?? null;
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
 * Transitions LabOrder to SENDING status via a single atomic UPDATE ... RETURNING (R1-F2, R1-F9).
 * - Transitions from PENDING or FAILED with attempts incremented by 1.
 * - Reclaims a stale SENDING row (updatedAt older than staleTimeoutMs) reusing the same attempts value.
 * - Single conditional UPDATE returning attempts atomically prevents race conditions (INV-8, R1-F9).
 * - Returns { transitioned: false, attempts: 0 } if another worker holds an active lease or order is SENT.
 */
export async function transitionToSending(
  shopId: string,
  labOrderId: string,
  db?: LabDispatchDb,
  staleTimeoutMs = SENDING_STALE_TIMEOUT_MS,
): Promise<{ transitioned: boolean; attempts: number }> {
  const client = db ?? getPrisma();
  const staleCutoff = new Date(Date.now() - staleTimeoutMs);

  const rows = await client.$queryRaw<Array<{ attempts: number }>>`
    UPDATE "LabOrder"
    SET
      "status" = 'SENDING'::"LabOrderStatus",
      "attempts" = CASE
        WHEN "status" = 'SENDING'::"LabOrderStatus" THEN "attempts"
        ELSE "attempts" + 1
      END,
      "updatedAt" = NOW()
    WHERE "shopId" = ${shopId}
      AND "id" = ${labOrderId}
      AND (
        "status" IN ('PENDING'::"LabOrderStatus", 'FAILED'::"LabOrderStatus")
        OR ("status" = 'SENDING'::"LabOrderStatus" AND "updatedAt" <= ${staleCutoff})
      )
    RETURNING "attempts"
  `;

  if (!rows || rows.length === 0) {
    return { transitioned: false, attempts: 0 };
  }

  return { transitioned: true, attempts: rows[0].attempts };
}

/**
 * Marks a LabOrder as SENT, updating providerId, ticketKeys, sentAt, and clearing lastErrorCode.
 * Strictly scoped to shopId (INV-1) and guarded with status = 'SENDING' (R1-F5).
 * Late workers cannot overwrite a row they no longer own.
 */
export async function markSent(
  shopId: string,
  labOrderId: string,
  data: MarkSentData,
  db?: LabDispatchDb,
): Promise<LabOrder | null> {
  const client = db ?? getPrisma();
  const updated = await client.labOrder.updateMany({
    where: {
      shopId,
      id: labOrderId,
      status: "SENDING",
    },
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
 * Strictly scoped to shopId (INV-1) and guarded with status = 'SENDING' (R1-F5).
 * Late workers cannot overwrite a row they no longer own.
 */
export async function markFailed(
  shopId: string,
  labOrderId: string,
  errorCode: LabDispatchErrorCode,
  db?: LabDispatchDb,
): Promise<LabOrder | null> {
  const client = db ?? getPrisma();
  const updated = await client.labOrder.updateMany({
    where: {
      shopId,
      id: labOrderId,
      status: "SENDING",
    },
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
 * Resets a LabOrder status to PENDING for resend and clears lastErrorCode.
 * Strictly scoped to shopId (INV-1).
 * Conditional update: only moves FAILED or SENT to PENDING; refuses PENDING or SENDING with ConflictError (R1-F5).
 */
export async function resetLabOrderStatus(
  shopId: string,
  labOrderId: string,
  status: LabOrderStatus = "PENDING",
  db?: LabDispatchDb,
): Promise<LabOrder | null> {
  const client = db ?? getPrisma();

  const existing = await client.labOrder.findFirst({
    where: { shopId, id: labOrderId },
    select: { id: true, status: true },
  });

  if (!existing) {
    return null;
  }

  if (existing.status === "PENDING" || existing.status === "SENDING") {
    throw new ConflictError(
      `Cannot resend lab order in ${existing.status} status`,
      "CONFLICT",
    );
  }

  const updated = await client.labOrder.updateMany({
    where: {
      shopId,
      id: labOrderId,
      status: { in: ["FAILED", "SENT"] },
    },
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
