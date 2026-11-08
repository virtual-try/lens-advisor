import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../shared/container/prisma.server";
import { getObjectStore } from "../../shared/container/object-store.server";
import { getQueue } from "../../shared/container/queue.server";
import type { ObjectStore } from "../../shared/storage/object-store.server";
import type { Queue } from "../../shared/queue/queue";
import { BadRequestError, NotFoundError } from "../../shared/http/errors.server";
import { resend } from "../lab-dispatch/dispatch.service.server";
import {
  getLabOrderDetail,
  listLabOrders,
  type LabOrderDetail,
  type ListLabOrdersOptions,
  type ListLabOrdersResult,
} from "./lab-orders-admin.repository.server";

export interface LabOrdersAdminDeps {
  db?: PrismaClient;
  objectStore?: ObjectStore;
  queue?: Pick<Queue, "enqueue">;
}

/**
 * Service to list lab orders for a merchant shop (INV-1).
 */
export async function listLabOrdersService(
  shopId: string,
  options: ListLabOrdersOptions = {},
  deps: LabOrdersAdminDeps = {},
): Promise<ListLabOrdersResult> {
  const db = deps.db ?? getPrisma();
  return listLabOrders(shopId, options, db);
}

/**
 * Service to retrieve full lab order details for a merchant shop (INV-1, INV-2).
 * Returns null if not found or belongs to another shop.
 */
export async function getLabOrderDetailService(
  shopId: string,
  labOrderId: string,
  deps: LabOrdersAdminDeps = {},
): Promise<LabOrderDetail | null> {
  const db = deps.db ?? getPrisma();
  return getLabOrderDetail(shopId, labOrderId, db);
}

/**
 * Service to resend a failed or sent lab order (Spec 30 reuse).
 * Refuses orders from another shop (INV-1) and resets status to PENDING.
 */
export async function resendLabOrderService(
  shopId: string,
  labOrderId: string,
  deps: LabOrdersAdminDeps = {},
): Promise<{ enqueued: boolean; labOrderId: string }> {
  const db = deps.db ?? getPrisma();
  const queue = deps.queue ?? (await getQueue());
  return resend(shopId, labOrderId, { db, queue });
}

/**
 * Generates a presigned 60-second download URL for a lab ticket (Spec 06, Self-check 1).
 * Verifies that the requested ticketKey belongs to the caller's shop and order (INV-1).
 */
export async function getTicketDownloadUrlService(
  shopId: string,
  labOrderId: string,
  ticketKey: string,
  deps: LabOrdersAdminDeps = {},
): Promise<{ downloadUrl: string }> {
  if (!ticketKey || typeof ticketKey !== "string") {
    throw new BadRequestError("Ticket key is required", "INVALID_TICKET_KEY");
  }

  // Strict tenancy check (INV-1): ticketKey must be scoped to shops/<shopId>/tickets/<labOrderId>.<ext>
  const expectedPrefix = `shops/${shopId}/tickets/${labOrderId}.`;
  if (!ticketKey.startsWith(expectedPrefix)) {
    throw new BadRequestError(
      "Ticket key does not belong to the specified shop and lab order",
      "FORBIDDEN_TICKET_KEY",
    );
  }

  // Check valid ticket extension (pdf or csv)
  const ext = ticketKey.slice(expectedPrefix.length);
  if (ext !== "pdf" && ext !== "csv") {
    throw new BadRequestError(
      "Unsupported ticket format extension",
      "INVALID_TICKET_KEY",
    );
  }

  // Verify order exists and belongs to this shop
  const db = deps.db ?? getPrisma();
  const order = await getLabOrderDetail(shopId, labOrderId, db);
  if (!order) {
    throw new NotFoundError("Lab order not found", "NOT_FOUND");
  }

  // Refuse any ticket key not in order.ticketKeys (R1-F4)
  if (!order.ticketKeys || !order.ticketKeys.includes(ticketKey)) {
    throw new BadRequestError(
      "Ticket key does not belong to this order's generated tickets",
      "FORBIDDEN_TICKET_KEY",
    );
  }

  const objectStore = deps.objectStore ?? getObjectStore();
  const downloadUrl = await objectStore.presignDownload(ticketKey);

  return { downloadUrl };
}

export {
  formatPrescriptionSummary,
  type PrescriptionSummaryInput,
} from "./summary";
