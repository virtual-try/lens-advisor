import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse,
} from "resend";
import { AppError } from "../http/errors.server";

export const MAX_ATTACHMENTS_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: MailAttachment[];
  idempotencyKey?: string;
  from?: string;
}

export interface SendMailResult {
  providerId: string;
}

export interface MailerLogger {
  info(message: string, ...args: unknown[]): void;
}

export interface ResendEmailsClient {
  send(
    payload: CreateEmailOptions,
    requestOptions?: CreateEmailRequestOptions
  ): Promise<CreateEmailResponse>;
}

export interface ResendClientLike {
  emails: ResendEmailsClient;
}

export class MailRejectedError extends AppError {
  public readonly cause?: unknown;
  public readonly statusCode?: number;

  constructor(
    message = "Mail delivery rejected",
    options?: { cause?: unknown; status?: number } | unknown
  ) {
    const isOptions =
      typeof options === "object" &&
      options !== null &&
      ("cause" in options || "status" in options);
    const opts = isOptions
      ? (options as { cause?: unknown; status?: number })
      : undefined;
    const cause = opts ? opts.cause : options;
    const status = opts?.status ?? 422;

    super(status, "MAIL_REJECTED", message);
    this.name = "MailRejectedError";
    this.cause = cause;
    this.statusCode = status;
  }
}

export class MailTransientError extends AppError {
  public readonly cause?: unknown;
  public readonly statusCode?: number;

  constructor(
    message = "Mail delivery transient error",
    options?: { cause?: unknown; status?: number } | unknown
  ) {
    const isOptions =
      typeof options === "object" &&
      options !== null &&
      ("cause" in options || "status" in options);
    const opts = isOptions
      ? (options as { cause?: unknown; status?: number })
      : undefined;
    const cause = opts ? opts.cause : options;
    const status = opts?.status ?? 503;

    super(status, "MAIL_TRANSIENT", message);
    this.name = "MailTransientError";
    this.cause = cause;
    this.statusCode = status;
  }
}

export class MailTooLargeError extends AppError {
  public readonly totalBytes?: number;

  constructor(
    message = "Total attachment size exceeds maximum allowed size of 10 MB",
    options?: { totalBytes?: number }
  ) {
    super(400, "MAIL_TOO_LARGE", message);
    this.name = "MailTooLargeError";
    this.totalBytes = options?.totalBytes;
  }
}

export function extractRecipientDomains(to: string | string[]): string {
  const addresses = Array.isArray(to) ? to : to.split(",");
  const domains = addresses
    .map((addr) => {
      const match = addr.match(/<([^>]+)>/);
      const email = (match ? match[1] : addr).trim();
      const atIdx = email.lastIndexOf("@");
      if (atIdx === -1) return "";
      return email.slice(atIdx + 1).trim().toLowerCase();
    })
    .filter(Boolean);

  return domains.length > 0 ? domains.join(",") : "unknown";
}

function getSafeIdentifier(name?: string, code?: string): string {
  const candidate =
    name && name !== "Error" && name !== "TypeError" && name !== "RangeError" && name !== "Object"
      ? name
      : code;
  if (candidate && /^[a-zA-Z0-9_-]+$/.test(candidate) && candidate.length <= 64) {
    return candidate;
  }
  return "";
}

export function mapToMailError(error: unknown): Error {
  if (
    error instanceof MailRejectedError ||
    error instanceof MailTransientError ||
    error instanceof MailTooLargeError
  ) {
    return error;
  }

  const errObj =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const message =
    typeof errObj.message === "string" ? errObj.message : String(error);
  const code = typeof errObj.code === "string" ? errObj.code : "";
  const name = typeof errObj.name === "string" ? errObj.name : "";

  const rawStatus =
    errObj.statusCode ??
    errObj.status ??
    (errObj.$metadata as Record<string, unknown> | undefined)?.httpStatusCode;
  const parsedStatus =
    typeof rawStatus === "number"
      ? rawStatus
      : typeof rawStatus === "string"
        ? parseInt(rawStatus, 10)
        : undefined;
  const statusCode =
    parsedStatus !== undefined && !isNaN(parsedStatus)
      ? parsedStatus
      : undefined;

  const id = getSafeIdentifier(name, code);

  // 1. Status is authoritative when present:
  //    429 and 5xx -> transient; every other 4xx (408 included) -> MailRejectedError
  if (statusCode !== undefined) {
    if (statusCode === 429) {
      return new MailTransientError(
        `Mail provider rate limit exceeded (429${id ? `: ${id}` : ""})`,
        { status: 429 }
      );
    }

    if (statusCode >= 500 && statusCode < 600) {
      return new MailTransientError(
        `Mail provider server error (${statusCode}${id ? `: ${id}` : ""})`,
        { status: statusCode }
      );
    }

    if (statusCode >= 400 && statusCode < 500) {
      return new MailRejectedError(
        `Mail provider rejected the message (${statusCode}${id ? `: ${id}` : ""})`,
        { status: statusCode }
      );
    }

    return new MailTransientError(
      `Mail provider error (${statusCode}${id ? `: ${id}` : ""})`,
      { status: statusCode }
    );
  }

  // 2. Text matching applies only when there is no HTTP status (thrown fetch/socket errors, ECONNRESET)
  const lowerMsg = message.toLowerCase();
  const isNetwork =
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    name === "TimeoutError" ||
    name === "AbortError" ||
    lowerMsg.includes("econnreset") ||
    lowerMsg.includes("etimedout") ||
    lowerMsg.includes("econnrefused") ||
    lowerMsg.includes("enotfound") ||
    lowerMsg.includes("fetch failed") ||
    lowerMsg.includes("network") ||
    lowerMsg.includes("socket") ||
    lowerMsg.includes("timeout");

  if (isNetwork) {
    return new MailTransientError(
      `Mail provider network error${id ? ` (${id})` : ""}`,
      { status: 503 }
    );
  }

  // 3. Provider error name heuristics when no HTTP status exists
  if (name === "rate_limit_exceeded") {
    return new MailTransientError(
      "Mail provider rate limit exceeded (429: rate_limit_exceeded)",
      { status: 429 }
    );
  }

  if (
    name === "validation_error" ||
    name === "invalid_parameter" ||
    name === "missing_required_field"
  ) {
    return new MailRejectedError(
      `Mail provider rejected the message (422: ${name})`,
      { status: 422 }
    );
  }

  if (name === "internal_server_error" || name === "application_error") {
    return new MailTransientError(
      `Mail provider server error (500: ${name})`,
      { status: 500 }
    );
  }

  // 4. Unexpected error fallback
  return new MailTransientError(
    `Mail provider unexpected error${id ? ` (${id})` : ""}`,
    { status: 500 }
  );
}

export interface Mailer {
  send(options: SendMailOptions): Promise<SendMailResult>;
}

export interface CreateResendMailerOptions {
  client: ResendClientLike;
  from?: string;
  logger?: MailerLogger;
}

export function createResendMailer(options: CreateResendMailerOptions): Mailer {
  const { client, from: defaultFrom = "Lens Advisor <orders@mail.lensadvisor.io>", logger = console } = options;

  if (!client || !client.emails || typeof client.emails.send !== "function") {
    throw new Error("createResendMailer: client must have an emails.send function");
  }

  return {
    async send(sendOptions: SendMailOptions): Promise<SendMailResult> {
      // 1. Check attachments size before calling provider
      if (sendOptions.attachments && sendOptions.attachments.length > 0) {
        let totalBytes = 0;
        for (const attachment of sendOptions.attachments) {
          if (!attachment.content) continue;
          const byteLength =
            typeof attachment.content.byteLength === "number"
              ? attachment.content.byteLength
              : Buffer.isBuffer(attachment.content)
                ? (attachment.content as Buffer).length
                : 0;
          totalBytes += byteLength;
        }

        if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
          throw new MailTooLargeError(
            `Total attachment size of ${totalBytes} bytes exceeds maximum allowed size of ${MAX_ATTACHMENTS_TOTAL_BYTES} bytes (10 MB)`,
            { totalBytes }
          );
        }
      }

      // 2. Prepare Resend payload
      const basePayload = {
        from: sendOptions.from ?? defaultFrom,
        to: sendOptions.to,
        subject: sendOptions.subject,
        ...(sendOptions.attachments && sendOptions.attachments.length > 0
          ? {
              attachments: sendOptions.attachments.map((att) => ({
                filename: att.filename,
                content: att.content,
                contentType: att.contentType,
              })),
            }
          : {}),
      };

      const payload: CreateEmailOptions =
        sendOptions.html !== undefined
          ? {
              ...basePayload,
              html: sendOptions.html,
              ...(sendOptions.text !== undefined ? { text: sendOptions.text } : {}),
            }
          : {
              ...basePayload,
              text: sendOptions.text ?? "",
            };

      // 3. Prepare request options (idempotencyKey)
      const requestOptions: CreateEmailRequestOptions | undefined =
        sendOptions.idempotencyKey
          ? { idempotencyKey: sendOptions.idempotencyKey }
          : undefined;

      // 4. Call Resend provider
      let response: CreateEmailResponse;
      try {
        response = await client.emails.send(payload, requestOptions);
      } catch (err: unknown) {
        throw mapToMailError(err);
      }

      // 5. Handle provider error response
      if (response.error) {
        throw mapToMailError(response.error);
      }

      if (!response.data?.id) {
        throw new MailTransientError("Provider response missing message id", {
          status: 500,
        });
      }

      const providerId = response.data.id;

      // 6. Log line on send (INV-2: never body or attachment, only provider id, recipient domain, subject length)
      const recipientDomain = extractRecipientDomains(sendOptions.to);
      const subjectLength = sendOptions.subject ? sendOptions.subject.length : 0;
      logger.info(
        `[Mailer] email sent: providerId=${providerId} recipientDomain=${recipientDomain} subjectLength=${subjectLength}`
      );

      return { providerId };
    },
  };
}
