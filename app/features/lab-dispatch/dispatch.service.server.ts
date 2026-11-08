import type { FieldCipher } from "../../shared/crypto/field-cipher.server";
import { getCipher } from "../../shared/container/cipher.server";
import { getMailer } from "../../shared/container/mailer.server";
import { getObjectStore } from "../../shared/container/object-store.server";
import { getPrisma } from "../../shared/container/prisma.server";
import { getQueue } from "../../shared/container/queue.server";
import { NotFoundError } from "../../shared/http/errors.server";
import type { MailAttachment, Mailer, SendMailResult } from "../../shared/mail/mailer.server";
import type { Queue } from "../../shared/queue/queue";
import {
  buildTicketKey,
  type ObjectStore,
} from "../../shared/storage/object-store.server";
import { DISPATCH_JOB_NAME } from "../lab-orders/constants";
import { renderCsv } from "../lab-orders/ticket/csv-renderer";
import { renderPdf } from "../lab-orders/ticket/pdf-renderer";
import type { TicketData } from "../lab-orders/ticket/types";
import { getSettings } from "../settings/settings.service.server";
import {
  getLabOrder,
  getPrescription,
  markFailed,
  markSent,
  resetLabOrderStatus,
  transitionToSending,
  type LabDispatchDb,
} from "./lab-dispatch.repository.server";
import { loadTicketData, RxDecryptError } from "./load-ticket-data.server";

export interface DispatchLogger {
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
}

export const defaultDispatchLogger: DispatchLogger = {
  info(event, meta) {
    console.info(`[lab-dispatch] ${event}`, meta ? JSON.stringify(meta) : "");
  },
  warn(event, meta) {
    console.warn(`[lab-dispatch] ${event}`, meta ? JSON.stringify(meta) : "");
  },
  error(event, meta) {
    console.error(`[lab-dispatch] ${event}`, meta ? JSON.stringify(meta) : "");
  },
};

export interface DispatchServiceDeps {
  db?: LabDispatchDb;
  cipher?: FieldCipher;
  objectStore?: ObjectStore;
  mailer?: Mailer;
  logger?: DispatchLogger;
  queue?: Queue;
  fetch?: typeof fetch;
  s3Reader?: (key: string) => Promise<Buffer>;
}

export interface DispatchResult {
  status: "SENT" | "FAILED" | "SKIPPED";
  providerId?: string;
  lastErrorCode?: string;
  reason?: string;
}

function detectContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "heic":
      return "image/heic";
    case "csv":
      return "text/csv";
    default:
      return "application/octet-stream";
  }
}

/**
 * Executes lab order dispatch flow (Spec 30 Scope):
 * 1. Status SENDING (conditional update from PENDING/FAILED — a second worker loses, INV-8)
 * 2. Validate lab emails from shop settings (Spec 15)
 * 3. loadTicketData (Spec 24 data + decrypted Rx, archived rows readable)
 * 4. Render ticket per ticketFormat (PDF, CSV, BOTH) -> putObject in S3 (Spec 06)
 * 5. Read uploaded prescription files if source is UPLOAD
 * 6. Mailer.send with idempotencyKey = labOrder.id + ':' + attempts (Spec 07)
 * 7. Mark SENT + providerId, sentAt
 * Errors: record lastErrorCode (NO_LAB_EMAIL, MAIL_FAILED, STORAGE_FAILED, RX_DECRYPT_FAILED),
 * status FAILED, rethrow for retry except NO_LAB_EMAIL (permanent).
 * INV-2: Messages and logs never carry Rx values.
 */
export async function processDispatch(
  shopId: string,
  labOrderId: string,
  deps: DispatchServiceDeps = {},
): Promise<DispatchResult> {
  const db = deps.db ?? getPrisma();
  const cipher = deps.cipher ?? getCipher();
  const objectStore = deps.objectStore ?? getObjectStore();
  const mailer = deps.mailer ?? getMailer();
  const logger = deps.logger ?? defaultDispatchLogger;

  // 1. Status SENDING: conditional update from PENDING/FAILED — a second worker loses (INV-8, Self-check 1)
  const { transitioned, attempts } = await transitionToSending(shopId, labOrderId, db);
  if (!transitioned) {
    logger.info("lab_dispatch.skipped", { shopId, labOrderId, reason: "not_transitioned" });
    return { status: "SKIPPED", reason: "not_transitioned" };
  }

  // 2. Fetch shop settings and check lab emails (Spec 15)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings = await getSettings(shopId, db as any);
  const labEmails = settings.labEmail ?? [];
  if (labEmails.length === 0) {
    await markFailed(shopId, labOrderId, "NO_LAB_EMAIL", db);
    logger.warn("lab_dispatch.no_lab_email", { shopId, labOrderId, attempts });
    // Permanent failure: DO NOT rethrow, no retry
    return { status: "FAILED", lastErrorCode: "NO_LAB_EMAIL" };
  }

  // 3. Load ticket data
  let ticketData: TicketData;
  try {
    ticketData = await loadTicketData(shopId, labOrderId, { db, cipher });
  } catch (err: unknown) {
    if (
      err instanceof RxDecryptError ||
      (typeof err === "object" && err !== null && (err as { code?: string }).code === "RX_DECRYPT_FAILED") ||
      (typeof err === "object" && err !== null && (err as { name?: string }).name === "DecryptError")
    ) {
      await markFailed(shopId, labOrderId, "RX_DECRYPT_FAILED", db);
      logger.error("lab_dispatch.rx_decrypt_failed", { shopId, labOrderId, attempts });
      throw new Error("RX_DECRYPT_FAILED");
    }
    await markFailed(shopId, labOrderId, "RX_DECRYPT_FAILED", db);
    logger.error("lab_dispatch.load_failed", { shopId, labOrderId, attempts });
    throw err;
  }

  // 4. Render per ticketFormat and putObject at shops/<shopId>/tickets/<labOrderId>.<ext>
  const ticketFormat = settings.ticketFormat ?? "PDF";
  const attachments: MailAttachment[] = [];
  const ticketKeys: string[] = [];

  try {
    if (ticketFormat === "PDF" || ticketFormat === "BOTH") {
      const pdfBuffer = await renderPdf(ticketData);
      const pdfKey = buildTicketKey(shopId, labOrderId, "pdf");
      await objectStore.putObject({
        key: pdfKey,
        body: pdfBuffer,
        contentType: "application/pdf",
      });
      ticketKeys.push(pdfKey);
      attachments.push({
        filename: `${labOrderId}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      });
    }

    if (ticketFormat === "CSV" || ticketFormat === "BOTH") {
      const csvBuffer = renderCsv(ticketData);
      const csvKey = buildTicketKey(shopId, labOrderId, "csv");
      await objectStore.putObject({
        key: csvKey,
        body: csvBuffer,
        contentType: "text/csv",
      });
      ticketKeys.push(csvKey);
      attachments.push({
        filename: `${labOrderId}.csv`,
        content: csvBuffer,
        contentType: "text/csv",
      });
    }
  } catch (err: unknown) {
    await markFailed(shopId, labOrderId, "STORAGE_FAILED", db);
    logger.error("lab_dispatch.storage_failed", { shopId, labOrderId, attempts });
    throw err;
  }

  // 5. Read upload files if prescription source is UPLOAD
  if (ticketData.source === "UPLOAD") {
    const labOrder = await getLabOrder(shopId, labOrderId, db);
    if (labOrder?.prescriptionId) {
      const prescription = await getPrescription(shopId, labOrder.prescriptionId, db);
      if (prescription && prescription.uploadKeys.length > 0) {
        for (const key of prescription.uploadKeys) {
          try {
            let fileBuffer: Buffer;
            if (deps.s3Reader) {
              fileBuffer = await deps.s3Reader(key);
            } else if (
              typeof (objectStore as unknown as { getObject?: (k: string) => Promise<Buffer> })
                .getObject === "function"
            ) {
              fileBuffer = await (
                objectStore as unknown as { getObject: (k: string) => Promise<Buffer> }
              ).getObject(key);
            } else {
              const downloadUrl = await objectStore.presignDownload(key);
              const fetchFn = deps.fetch ?? globalThis.fetch;
              const res = await fetchFn(downloadUrl);
              if (!res.ok) {
                throw new Error(`S3 download failed with status ${res.status}`);
              }
              fileBuffer = Buffer.from(await res.arrayBuffer());
            }

            const filename = key.split("/").pop() ?? "prescription-file";
            const contentType = detectContentType(filename);
            attachments.push({
              filename,
              content: fileBuffer,
              contentType,
            });
          } catch (err: unknown) {
            await markFailed(shopId, labOrderId, "STORAGE_FAILED", db);
            logger.error("lab_dispatch.storage_failed", { shopId, labOrderId, attempts });
            throw err;
          }
        }
      }
    }
  }

  // 6. Mailer.send with idempotencyKey = labOrder.id + ':' + attempts
  const idempotencyKey = `${labOrderId}:${attempts}`;
  let sendResult: SendMailResult;
  try {
    sendResult = await mailer.send({
      to: labEmails,
      subject: `Lab Job Ticket - ${ticketData.orderName}`,
      text: `Please find attached the lab job ticket for order ${ticketData.orderName}.`,
      attachments,
      idempotencyKey,
    });
  } catch (err: unknown) {
    await markFailed(shopId, labOrderId, "MAIL_FAILED", db);
    logger.error("lab_dispatch.mail_failed", { shopId, labOrderId, attempts });
    throw err;
  }

  // 7. SENT + providerId, sentAt
  await markSent(
    shopId,
    labOrderId,
    {
      providerId: sendResult.providerId,
      ticketKeys,
      sentAt: new Date(),
    },
    db,
  );

  logger.info("lab_dispatch.sent", {
    shopId,
    labOrderId,
    providerId: sendResult.providerId,
    attempts,
    ticketKeys,
  });

  return {
    status: "SENT",
    providerId: sendResult.providerId,
  };
}

/**
 * Resends a lab order (Spec 30 Scope):
 * Checks tenancy (INV-1), resets status to PENDING and clears lastErrorCode, then re-enqueues dispatch.
 * Used by Spec 32 admin lab orders.
 */
export async function resend(
  shopId: string,
  labOrderId: string,
  deps: DispatchServiceDeps = {},
): Promise<{ enqueued: boolean; labOrderId: string }> {
  const db = deps.db ?? getPrisma();
  const queue = deps.queue ?? (await getQueue());

  const order = await getLabOrder(shopId, labOrderId, db);
  if (!order) {
    throw new NotFoundError("Lab order not found", "NOT_FOUND");
  }

  // Reset status to PENDING and clear lastErrorCode
  await resetLabOrderStatus(shopId, labOrderId, "PENDING", db);

  await queue.enqueue(
    DISPATCH_JOB_NAME,
    { labOrderId, shopId },
    { singletonKey: labOrderId },
  );

  return { enqueued: true, labOrderId };
}
