import type { LabOrder, PrismaClient } from "@prisma/client";
import type { FieldCipher } from "../../shared/crypto/field-cipher.server";
import { getCipher } from "../../shared/container/cipher.server";
import { getMailer } from "../../shared/container/mailer.server";
import { getObjectStore } from "../../shared/container/object-store.server";
import { getPrisma } from "../../shared/container/prisma.server";
import { getQueue } from "../../shared/container/queue.server";
import { AppError, ConflictError, NotFoundError } from "../../shared/http/errors.server";
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
  SENDING_STALE_TIMEOUT_MS,
  type LabDispatchErrorCode,
} from "./lab-dispatch.repository.server";
import { loadTicketData, RxDecryptError } from "./load-ticket-data.server";

export const UPLOAD_DOWNLOAD_TIMEOUT_MS = 15_000; // 15s timeout for S3 presigned downloads (R1-F12)
export const UPLOAD_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB size cap for S3 uploads (R1-F12)
export const DELAY_MARGIN_MS = 5_000; // 5s margin beyond lease expiry (R3-F1)

export function getDelayedDispatchParams(
  labOrderId: string,
  leaseStart: Date,
  staleTimeoutMs = SENDING_STALE_TIMEOUT_MS,
  marginMs = DELAY_MARGIN_MS,
): { startAfter: Date; singletonKey: string } {
  const leaseExpiry = new Date(leaseStart.getTime() + staleTimeoutMs);
  const startAfter = new Date(leaseExpiry.getTime() + marginMs);
  const singletonKey = `${labOrderId}:delayed:${leaseStart.getTime()}`;
  return { startAfter, singletonKey };
}

export class DispatchInProgressError extends AppError {
  constructor(message = "Dispatch is already in progress") {
    super(409, "IN_PROGRESS", message);
    this.name = "DispatchInProgressError";
  }
}

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
  db?: PrismaClient;
  cipher?: FieldCipher;
  objectStore?: ObjectStore;
  mailer?: Mailer;
  logger?: DispatchLogger;
  queue?: Pick<Queue, "enqueue">;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface DispatchResult {
  status: "SENT" | "FAILED" | "SKIPPED";
  providerId?: string;
  lastErrorCode?: LabDispatchErrorCode;
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

async function enqueueDelayedDispatch(
  labOrderId: string,
  leaseStart: Date,
  deps: DispatchServiceDeps,
  logger: DispatchLogger,
  shopId: string,
): Promise<void> {
  const { startAfter, singletonKey } = getDelayedDispatchParams(labOrderId, leaseStart);
  try {
    const queue = deps.queue ?? (await getQueue());
    await queue.enqueue(
      DISPATCH_JOB_NAME,
      { labOrderId },
      { startAfter, singletonKey },
    );
    logger.info("lab_dispatch.delayed_enqueued", {
      shopId,
      labOrderId,
      startAfter: startAfter.toISOString(),
      singletonKey,
    });
  } catch {
    logger.error("lab_dispatch.delayed_enqueue_failed", { shopId, labOrderId });
  }
}

/**
 * Executes lab order dispatch flow (Spec 30 Scope):
 * 1. Status SENDING (atomic conditional update from PENDING/FAILED or stale SENDING lease, INV-8, R1-F2, R1-F9)
 * 2. Validate lab emails from shop settings (Spec 15)
 * 3. loadTicketData (Spec 24 data + decrypted Rx, archived rows readable)
 * 4. Render ticket per ticketFormat (PDF, CSV, BOTH) -> putObject in S3 (Spec 06)
 * 5. Read uploaded prescription files if source is UPLOAD (bounded download, R1-F12)
 * 6. Mailer.send with idempotencyKey = labOrder.id + ':' + attempts (Spec 07)
 * 7. Mark SENT + providerId, sentAt
 * Errors: record lastErrorCode (NO_LAB_EMAIL, MAIL_FAILED, STORAGE_FAILED, RX_DECRYPT_FAILED, LOAD_FAILED, TICKET_RENDER_FAILED).
 * R1-F2: Every step after SENDING transition is wrapped so any throw calls markFailed before rethrowing.
 * INV-2: Messages, errors, and logs never carry Rx values.
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
  const now = deps.now ? deps.now() : new Date();

  // 1. Status SENDING: atomic conditional update from PENDING/FAILED or stale SENDING (INV-8, Self-check 1, R1-F2, R1-F9)
  const { transitioned, attempts } = await transitionToSending(
    shopId,
    labOrderId,
    db,
    SENDING_STALE_TIMEOUT_MS,
    now,
  );
  if (!transitioned) {
    const existing = await getLabOrder(shopId, labOrderId, db);
    if (!existing) {
      logger.info("lab_dispatch.skipped", { shopId, labOrderId, reason: "order_not_found" });
      return { status: "SKIPPED", reason: "order_not_found" };
    }
    if (existing.status === "SENT") {
      logger.info("lab_dispatch.skipped", { shopId, labOrderId, reason: "already_sent" });
      return { status: "SKIPPED", reason: "already_sent" };
    }
    if (existing.status === "SENDING") {
      // R2-F4 & R3-F1: Fresh SENDING lease met. Enqueue delayed dispatch for lease expiry plus margin
      // so the stale lease can be reclaimed after expiration without burning retries.
      logger.info("lab_dispatch.in_progress", { shopId, labOrderId });
      await enqueueDelayedDispatch(labOrderId, existing.updatedAt, deps, logger, shopId);
      throw new DispatchInProgressError(`Dispatch for order ${labOrderId} is currently in progress`);
    }
    logger.info("lab_dispatch.skipped", { shopId, labOrderId, reason: "not_transitioned" });
    return { status: "SKIPPED", reason: "not_transitioned" };
  }

  let failureRecorded = false;
  // R3-F4: Helper to record failure; returns false if worker lost lease (markFailed returned null)
  const recordFailure = async (errorCode: LabDispatchErrorCode): Promise<boolean> => {
    try {
      const failed = await markFailed(shopId, labOrderId, errorCode, db);
      if (!failed) {
        logger.warn("lab_dispatch.lost_lease", {
          shopId,
          labOrderId,
          reason: "mark_failed_lost_lease",
          errorCode,
        });
        return false;
      }
      failureRecorded = true;
      return true;
    } catch {
      return true;
    }
  };

  let sendResult: SendMailResult | undefined;
  // R1-F2: Wrap the entire body after transition so a row never sticks in SENDING
  try {
    // 2. Fetch shop settings and check lab emails (Spec 15)
    let settings;
    try {
      settings = await getSettings(shopId, db);
    } catch (err: unknown) {
      const retained = await recordFailure("LOAD_FAILED");
      if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
      logger.error("lab_dispatch.settings_failed", { shopId, labOrderId, attempts });
      throw err;
    }

    const labEmails = settings.labEmail ?? [];
    if (labEmails.length === 0) {
      const retained = await recordFailure("NO_LAB_EMAIL");
      if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
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
        const retained = await recordFailure("RX_DECRYPT_FAILED");
        if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
        logger.error("lab_dispatch.rx_decrypt_failed", { shopId, labOrderId, attempts });
        throw new Error("RX_DECRYPT_FAILED");
      }
      const retained = await recordFailure("LOAD_FAILED");
      if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
      logger.error("lab_dispatch.load_failed", { shopId, labOrderId, attempts });
      throw err;
    }

    // 4. Render per ticketFormat and putObject at shops/<shopId>/tickets/<labOrderId>.<ext>
    const ticketFormat = settings.ticketFormat ?? "PDF";
    const attachments: MailAttachment[] = [];
    const ticketKeys: string[] = [];

    let pdfBuffer: Buffer | undefined;
    let csvBuffer: Buffer | undefined;

    try {
      if (ticketFormat === "PDF" || ticketFormat === "BOTH") {
        pdfBuffer = await renderPdf(ticketData);
      }
      if (ticketFormat === "CSV" || ticketFormat === "BOTH") {
        csvBuffer = renderCsv(ticketData);
      }
    } catch (err: unknown) {
      const retained = await recordFailure("TICKET_RENDER_FAILED");
      if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
      logger.error("lab_dispatch.render_failed", { shopId, labOrderId, attempts });
      throw err;
    }

    try {
      if (pdfBuffer) {
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

      if (csvBuffer) {
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
      const retained = await recordFailure("STORAGE_FAILED");
      if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
      logger.error("lab_dispatch.storage_failed", { shopId, labOrderId, attempts });
      throw err;
    }

    // 5. Read upload files if prescription source is UPLOAD (R1-F12: bounded download, drop getObject duck typing)
    if (ticketData.source === "UPLOAD") {
      let labOrder;
      try {
        labOrder = await getLabOrder(shopId, labOrderId, db);
      } catch (err: unknown) {
        const retained = await recordFailure("LOAD_FAILED");
        if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
        logger.error("lab_dispatch.load_failed", { shopId, labOrderId, attempts });
        throw err;
      }

      if (labOrder?.prescriptionId) {
        let prescription;
        try {
          prescription = await getPrescription(shopId, labOrder.prescriptionId, db);
        } catch (err: unknown) {
          const retained = await recordFailure("LOAD_FAILED");
          if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
          logger.error("lab_dispatch.load_failed", { shopId, labOrderId, attempts });
          throw err;
        }

        if (prescription && prescription.uploadKeys.length > 0) {
          for (const key of prescription.uploadKeys) {
            try {
              let fileBuffer: Buffer;
              // R2-F7 & R2-F8: Presign download, stream with running size cap, drop dead s3Reader hook
              const downloadUrl = await objectStore.presignDownload(key);
              const fetchFn = deps.fetch ?? globalThis.fetch;
              const res = await fetchFn(downloadUrl, {
                signal: AbortSignal.timeout(UPLOAD_DOWNLOAD_TIMEOUT_MS),
              });
              if (!res.ok) {
                throw new Error(`S3 download failed with status ${res.status}`);
              }

              const contentLength = res.headers?.get("content-length");
              if (contentLength && parseInt(contentLength, 10) > UPLOAD_MAX_FILE_SIZE_BYTES) {
                throw new Error(
                  `Prescription upload file exceeds maximum allowed size of ${UPLOAD_MAX_FILE_SIZE_BYTES} bytes`,
                );
              }

              if (res.body) {
                const reader = res.body.getReader();
                const chunks: Uint8Array[] = [];
                let totalBytes = 0;
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                      totalBytes += value.byteLength;
                      if (totalBytes > UPLOAD_MAX_FILE_SIZE_BYTES) {
                        throw new Error(
                          `Prescription upload file exceeds maximum allowed size of ${UPLOAD_MAX_FILE_SIZE_BYTES} bytes`,
                        );
                      }
                      chunks.push(value);
                    }
                  }
                } catch (streamErr) {
                  await reader.cancel().catch(() => {});
                  throw streamErr;
                }
                fileBuffer = Buffer.concat(chunks);
              } else {
                const arrayBuf = await res.arrayBuffer();
                if (arrayBuf.byteLength > UPLOAD_MAX_FILE_SIZE_BYTES) {
                  throw new Error(
                    `Prescription upload file exceeds maximum allowed size of ${UPLOAD_MAX_FILE_SIZE_BYTES} bytes`,
                  );
                }
                fileBuffer = Buffer.from(arrayBuf);
              }

              const filename = key.split("/").pop() ?? "prescription-file";
              const contentType = detectContentType(filename);
              attachments.push({
                filename,
                content: fileBuffer,
                contentType,
              });
            } catch (err: unknown) {
              const retained = await recordFailure("STORAGE_FAILED");
              if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
              logger.error("lab_dispatch.storage_failed", { shopId, labOrderId, attempts });
              throw err;
            }
          }
        }
      }
    }

    // 6. Mailer.send with idempotencyKey = labOrder.id + ':' + attempts
    const idempotencyKey = `${labOrderId}:${attempts}`;
    try {
      sendResult = await mailer.send({
        to: labEmails,
        subject: `Lab Job Ticket - ${ticketData.orderName}`,
        text: `Please find attached the lab job ticket for order ${ticketData.orderName}.`,
        attachments,
        idempotencyKey,
      });
    } catch (err: unknown) {
      const retained = await recordFailure("MAIL_FAILED");
      if (!retained) return { status: "SKIPPED", reason: "lost_lease" };
      logger.error("lab_dispatch.mail_failed", { shopId, labOrderId, attempts });
      throw err;
    }

    // 7. SENT + providerId, sentAt
    // R2-F3, R3-F1, R3-F4: Once Mailer.send has succeeded, a markSent failure must NOT mark FAILED or increment attempts.
    // Leave the row SENDING and enqueue delayed dispatch so it reclaims after lease with same attempts and idempotency key.
    let sentOrder: LabOrder | null = null;
    try {
      sentOrder = await markSent(
        shopId,
        labOrderId,
        {
          providerId: sendResult.providerId,
          ticketKeys,
          sentAt: now,
        },
        db,
      );
    } catch (err: unknown) {
      logger.error("lab_dispatch.mark_sent_failed", { shopId, labOrderId, attempts });
      await enqueueDelayedDispatch(labOrderId, now, deps, logger, shopId);
      throw err;
    }

    // R3-F4: If markSent returns null (count 0, e.g. lost lease / slow worker), return SKIPPED, never SENT
    if (!sentOrder) {
      logger.warn("lab_dispatch.lost_lease", {
        shopId,
        labOrderId,
        reason: "mark_sent_lost_lease",
      });
      return { status: "SKIPPED", reason: "lost_lease" };
    }

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
  } catch (err: unknown) {
    // R1-F2 & R2-F3: Safety net marks FAILED only if email was not yet sent and failure not yet recorded.
    // If email was already sent (sendResult defined), leave row in SENDING so retry reclaims with same attempts.
    if (!sendResult && !failureRecorded) {
      try {
        const failed = await markFailed(shopId, labOrderId, "LOAD_FAILED", db);
        if (!failed) {
          logger.warn("lab_dispatch.lost_lease", {
            shopId,
            labOrderId,
            reason: "mark_failed_lost_lease",
            errorCode: "LOAD_FAILED",
          });
          return { status: "SKIPPED", reason: "lost_lease" };
        }
      } catch {
        // secondary DB failure ignored
      }
    }
    throw err;
  }
}

/**
 * Resends a lab order (Spec 30 Scope):
 * Checks tenancy (INV-1), resets status to PENDING and clears lastErrorCode, then re-enqueues dispatch.
 * Refuses PENDING or SENDING with ConflictError (R1-F5).
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

  // Reset status to PENDING and clear lastErrorCode (refuses PENDING or SENDING with ConflictError, R1-F5)
  // R2-F6: Check reset result; throw ConflictError if reset returned null
  const resetResult = await resetLabOrderStatus(shopId, labOrderId, "PENDING", db);
  if (!resetResult) {
    throw new ConflictError("Lab order could not be reset for resend", "CONFLICT");
  }

  try {
    await queue.enqueue(
      DISPATCH_JOB_NAME,
      { labOrderId },
      { singletonKey: labOrderId },
    );
  } catch (err: unknown) {
    // R2-F6: If enqueue fails, revert status and lastErrorCode so the row is not stranded in PENDING with no job
    try {
      await db.labOrder.updateMany({
        where: { shopId, id: labOrderId, status: "PENDING" },
        data: {
          status: order.status,
          lastErrorCode: order.lastErrorCode,
        },
      });
    } catch {
      // rollback failure ignored
    }
    throw err;
  }

  return { enqueued: true, labOrderId };
}
