import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponse,
} from "resend";
import {
  createResendMailer,
  extractRecipientDomains,
  mapToMailError,
  MailRejectedError,
  MailTransientError,
  MailTooLargeError,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  type ResendClientLike,
} from "./mailer.server";
import { getMailer, resetMailer } from "../container/mailer.server";
import { resetConfigCache, ConfigError } from "../config.server";
import { errorResponse } from "../http/errors.server";

interface MockClientHarness {
  fakeClient: ResendClientLike;
  calls: Array<{
    payload: CreateEmailOptions;
    requestOptions?: CreateEmailRequestOptions;
  }>;
}

function createMockClient(
  sendImpl?: (
    payload: CreateEmailOptions,
    requestOptions?: CreateEmailRequestOptions
  ) => Promise<CreateEmailResponse>
): MockClientHarness {
  const calls: MockClientHarness["calls"] = [];
  const fakeClient: ResendClientLike = {
    emails: {
      send: vi.fn(
        async (
          payload: CreateEmailOptions,
          requestOptions?: CreateEmailRequestOptions
        ): Promise<CreateEmailResponse> => {
          calls.push({ payload, requestOptions });
          if (sendImpl) {
            return await sendImpl(payload, requestOptions);
          }
          return {
            data: { id: "msg_default_123" },
            error: null,
            headers: null,
          };
        }
      ),
    },
  };

  return { fakeClient, calls };
}

const silentLogger = { info: () => {} };

function createTestMailer(options: {
  client: ResendClientLike;
  from?: string;
  logger?: { info: (msg: string) => void };
}) {
  return createResendMailer({
    client: options.client,
    from: options.from,
    logger: options.logger ?? silentLogger,
  });
}

describe("Spec 07 — Mailer adapter (Resend)", () => {
  describe("Examples table verification", () => {
    it("Row 1: 200 {id} -> { providerId: id } (normal)", async () => {
      const { fakeClient, calls } = createMockClient(async () => ({
        data: { id: "msg_success_456" },
        error: null,
        headers: null,
      }));

      const mailer = createTestMailer({
        client: fakeClient,
        from: "Lens Advisor <orders@mail.lensadvisor.io>",
      });

      const result = await mailer.send({
        to: "lab@lenslab.com",
        subject: "Order #1001",
        text: "Please find lab ticket attached.",
      });

      expect(result).toEqual({ providerId: "msg_success_456" });
      expect(calls).toHaveLength(1);
      expect(calls[0].payload.to).toBe("lab@lenslab.com");
      expect(calls[0].payload.subject).toBe("Order #1001");
      expect(calls[0].payload.text).toBe("Please find lab ticket attached.");
      expect(calls[0].payload.from).toBe("Lens Advisor <orders@mail.lensadvisor.io>");
    });

    it("Row 2: 422 -> MailRejectedError (permanent)", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: {
          statusCode: 422,
          message: "The 'to' field contains an invalid email address",
          name: "validation_error",
        },
        headers: null,
      }));

      const mailer = createTestMailer({ client: fakeClient });

      await expect(
        mailer.send({
          to: "invalid-recipient",
          subject: "Order #1002",
          text: "Test content",
        })
      ).rejects.toThrow(MailRejectedError);

      try {
        await mailer.send({
          to: "invalid-recipient",
          subject: "Order #1002",
          text: "Test content",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(MailRejectedError);
        expect((err as MailRejectedError).statusCode).toBe(422);
        expect((err as MailRejectedError).message).toContain("422");
      }
    });

    it("Row 3a: 429 -> MailTransientError (retryable, rate limited)", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: {
          statusCode: 429,
          message: "Too many requests. Please wait before retrying.",
          name: "rate_limit_exceeded",
        },
        headers: null,
      }));

      const mailer = createTestMailer({ client: fakeClient });

      await expect(
        mailer.send({
          to: "lab@lenslab.com",
          subject: "Order #1003",
          text: "Rate limit test",
        })
      ).rejects.toThrow(MailTransientError);

      try {
        await mailer.send({
          to: "lab@lenslab.com",
          subject: "Order #1003",
          text: "Rate limit test",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(MailTransientError);
        expect(err).not.toBeInstanceOf(MailRejectedError);
        expect((err as MailTransientError).statusCode).toBe(429);
      }
    });

    it("Row 3b: 503 -> MailTransientError (retryable, server error)", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: {
          statusCode: 503,
          message: "Service Unavailable. Down for maintenance.",
          name: "internal_server_error",
        },
        headers: null,
      }));

      const mailer = createTestMailer({ client: fakeClient });

      await expect(
        mailer.send({
          to: "lab@lenslab.com",
          subject: "Order #1004",
          text: "503 test",
        })
      ).rejects.toThrow(MailTransientError);

      try {
        await mailer.send({
          to: "lab@lenslab.com",
          subject: "Order #1004",
          text: "503 test",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(MailTransientError);
        expect((err as MailTransientError).statusCode).toBe(503);
      }
    });

    it("Row 3c: ECONNRESET -> MailTransientError (retryable, network error)", async () => {
      const networkError = Object.assign(new Error("read ECONNRESET"), {
        code: "ECONNRESET",
      });
      const { fakeClient } = createMockClient(async () => {
        throw networkError;
      });

      const mailer = createTestMailer({ client: fakeClient });

      await expect(
        mailer.send({
          to: "lab@lenslab.com",
          subject: "Order #1005",
          text: "ECONNRESET test",
        })
      ).rejects.toThrow(MailTransientError);

      try {
        await mailer.send({
          to: "lab@lenslab.com",
          subject: "Order #1005",
          text: "ECONNRESET test",
        });
      } catch (err) {
        expect(err).toBeInstanceOf(MailTransientError);
        expect((err as MailTransientError).cause).toBeUndefined();
      }
    });

    it("Row 4: attachments 11 MB -> MailTooLargeError, provider not called (size)", async () => {
      const { fakeClient, calls } = createMockClient();
      const mailer = createTestMailer({ client: fakeClient });

      // 11 MB = 11 * 1024 * 1024 bytes
      const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 0);

      await expect(
        mailer.send({
          to: "lab@lenslab.com",
          subject: "Order #1006 with large attachment",
          text: "Please find attached ticket",
          attachments: [
            {
              filename: "huge-ticket.pdf",
              content: bigBuffer,
              contentType: "application/pdf",
            },
          ],
        })
      ).rejects.toThrow(MailTooLargeError);

      // Verify provider was never called
      expect(calls).toHaveLength(0);
      expect(fakeClient.emails.send).not.toHaveBeenCalled();
    });
  });

  describe("Idempotency key handling", () => {
    it("passes idempotencyKey to client requestOptions when provided", async () => {
      const { fakeClient, calls } = createMockClient();
      const mailer = createTestMailer({ client: fakeClient });

      const result = await mailer.send({
        to: "lab@lenslab.com",
        subject: "Order #2001",
        text: "Idempotent send test",
        idempotencyKey: "lab_order_req_unique_999",
      });

      expect(result).toEqual({ providerId: "msg_default_123" });
      expect(calls).toHaveLength(1);
      expect(calls[0].requestOptions).toEqual({
        idempotencyKey: "lab_order_req_unique_999",
      });
    });

    it("passes undefined requestOptions when idempotencyKey is not provided", async () => {
      const { fakeClient, calls } = createMockClient();
      const mailer = createTestMailer({ client: fakeClient });

      await mailer.send({
        to: "lab@lenslab.com",
        subject: "Order #2002",
        text: "Non-idempotent send test",
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].requestOptions).toBeUndefined();
    });
  });

  describe("Attachments handling & boundary checks", () => {
    it("allows attachments totaling exactly 10 MB and calls provider", async () => {
      const { fakeClient, calls } = createMockClient();
      const mailer = createTestMailer({ client: fakeClient });

      // Exactly 10 MB = 10 * 1024 * 1024 bytes
      const exact10MBBuffer = Buffer.alloc(MAX_ATTACHMENTS_TOTAL_BYTES, 0);

      const result = await mailer.send({
        to: "lab@lenslab.com",
        subject: "Order with 10 MB attachment",
        text: "Attached exactly 10 MB",
        attachments: [
          {
            filename: "max-allowed.pdf",
            content: exact10MBBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      expect(result.providerId).toBe("msg_default_123");
      expect(calls).toHaveLength(1);
      expect(calls[0].payload.attachments).toHaveLength(1);
      expect(calls[0].payload.attachments?.[0].filename).toBe("max-allowed.pdf");
    });

    it("rejects attachments exceeding 10 MB by 1 byte without calling provider", async () => {
      const { fakeClient, calls } = createMockClient();
      const mailer = createTestMailer({ client: fakeClient });

      // 10 MB + 1 byte
      const overBuffer = Buffer.alloc(MAX_ATTACHMENTS_TOTAL_BYTES + 1, 0);

      await expect(
        mailer.send({
          to: "lab@lenslab.com",
          subject: "Order with 10 MB + 1 byte",
          text: "Too large",
          attachments: [
            {
              filename: "too-large.pdf",
              content: overBuffer,
              contentType: "application/pdf",
            },
          ],
        })
      ).rejects.toThrow(MailTooLargeError);

      expect(calls).toHaveLength(0);
    });

    it("rejects multiple attachments whose combined sum exceeds 10 MB", async () => {
      const { fakeClient, calls } = createMockClient();
      const mailer = createTestMailer({ client: fakeClient });

      // 6 MB + 5 MB = 11 MB > 10 MB
      const buf1 = Buffer.alloc(6 * 1024 * 1024, 0);
      const buf2 = Buffer.alloc(5 * 1024 * 1024, 0);

      await expect(
        mailer.send({
          to: "lab@lenslab.com",
          subject: "Multiple attachments",
          text: "Two attachments totaling 11 MB",
          attachments: [
            { filename: "part1.pdf", content: buf1, contentType: "application/pdf" },
            { filename: "part2.pdf", content: buf2, contentType: "application/pdf" },
          ],
        })
      ).rejects.toThrow(MailTooLargeError);

      expect(calls).toHaveLength(0);
    });

    it("accepts multiple attachments whose combined sum is under 10 MB", async () => {
      const { fakeClient, calls } = createMockClient();
      const mailer = createTestMailer({ client: fakeClient });

      // 4 MB + 3 MB = 7 MB <= 10 MB
      const buf1 = Buffer.alloc(4 * 1024 * 1024, 0);
      const buf2 = Buffer.alloc(3 * 1024 * 1024, 0);

      const res = await mailer.send({
        to: "lab@lenslab.com",
        subject: "Multiple attachments ok",
        text: "Two attachments totaling 7 MB",
        attachments: [
          { filename: "ticket.pdf", content: buf1, contentType: "application/pdf" },
          { filename: "manifest.csv", content: buf2, contentType: "text/csv" },
        ],
      });

      expect(res.providerId).toBe("msg_default_123");
      expect(calls).toHaveLength(1);
      expect(calls[0].payload.attachments).toHaveLength(2);
    });
  });

  describe("Error mapping comprehensiveness", () => {
    it("returns the same error if already an instance of domain mail error", () => {
      const rejected = new MailRejectedError("rejected");
      expect(mapToMailError(rejected)).toBe(rejected);
      const transient = new MailTransientError("transient");
      expect(mapToMailError(transient)).toBe(transient);
      const tooLarge = new MailTooLargeError("too large");
      expect(mapToMailError(tooLarge)).toBe(tooLarge);
    });

    it("maps 400 Bad Request to MailRejectedError", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: { statusCode: 400, message: "Bad request payload", name: "invalid_parameter" },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailRejectedError);
    });

    it("maps 401 Unauthorized to MailRejectedError", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: { statusCode: 401, message: "Invalid API key", name: "invalid_api_key" },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailRejectedError);
    });

    it("maps 403 Forbidden to MailRejectedError", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: { statusCode: 403, message: "Domain not verified", name: "invalid_access" },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailRejectedError);
    });

    it("maps 404 Not Found to MailRejectedError", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: { statusCode: 404, message: "Resource not found", name: "not_found" },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailRejectedError);
    });

    it("maps 500 Internal Server Error to MailTransientError", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: { statusCode: 500, message: "Internal server error", name: "internal_server_error" },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailTransientError);
    });

    it("maps 502 Bad Gateway to MailTransientError", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: { statusCode: 502, message: "Bad Gateway", name: "internal_server_error" },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailTransientError);
    });

    it("maps 504 Gateway Timeout to MailTransientError", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: { statusCode: 504, message: "Gateway Timeout", name: "internal_server_error" },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailTransientError);
    });

    it("maps 408 Request Timeout to MailRejectedError (4xx rule is authoritative over timeout)", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: { statusCode: 408, message: "Request Timeout", name: "invalid_parameter" },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailRejectedError);

      try {
        await mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" });
      } catch (err) {
        expect(err).toBeInstanceOf(MailRejectedError);
        expect((err as MailRejectedError).statusCode).toBe(408);
      }
    });

    it("maps 400 Bad Request with message mentioning 'timeout' to MailRejectedError (status is authoritative over message)", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: {
          statusCode: 400,
          message: "Request parameter 'timeout' is invalid",
          name: "invalid_parameter",
        },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailRejectedError);

      try {
        await mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" });
      } catch (err) {
        expect(err).toBeInstanceOf(MailRejectedError);
        expect((err as MailRejectedError).statusCode).toBe(400);
      }
    });

    it("maps 422 Unprocessable Entity with message mentioning 'network' to MailRejectedError (status is authoritative over message)", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: {
          statusCode: 422,
          message: "Network address is unreachable",
          name: "validation_error",
        },
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailRejectedError);

      try {
        await mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" });
      } catch (err) {
        expect(err).toBeInstanceOf(MailRejectedError);
        expect((err as MailRejectedError).statusCode).toBe(422);
      }
    });

    it("maps ETIMEDOUT network error to MailTransientError", async () => {
      const { fakeClient } = createMockClient(async () => {
        throw Object.assign(new Error("connect ETIMEDOUT 198.51.100.1"), {
          code: "ETIMEDOUT",
        });
      });
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailTransientError);
    });

    it("maps ECONNREFUSED network error to MailTransientError", async () => {
      const { fakeClient } = createMockClient(async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1"), {
          code: "ECONNREFUSED",
        });
      });
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailTransientError);
    });

    it("maps 'TypeError: fetch failed' to MailTransientError", async () => {
      const { fakeClient } = createMockClient(async () => {
        throw new TypeError("fetch failed");
      });
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailTransientError);
    });

    it("throws MailTransientError when response lacks id", async () => {
      const { fakeClient } = createMockClient(async () => ({
        data: {} as unknown as { id: string },
        error: null,
        headers: null,
      }));
      const mailer = createTestMailer({ client: fakeClient });
      await expect(
        mailer.send({ to: "lab@lenslab.com", subject: "Test", text: "Hi" })
      ).rejects.toThrow(MailTransientError);
    });
  });

  describe("Recipient domain extraction", () => {
    it("extracts plain domain from simple email address", () => {
      expect(extractRecipientDomains("orders@lenslab.com")).toBe("lenslab.com");
    });

    it("extracts domain from email address with display name in angle brackets", () => {
      expect(extractRecipientDomains("Lab Dispatch <dispatch@rx-grinding.org>")).toBe(
        "rx-grinding.org"
      );
    });

    it("extracts and joins domains for array of recipients", () => {
      expect(
        extractRecipientDomains([
          "lab@alpha.com",
          "Auditor <audit@beta.org>",
          "notify@gamma.net",
        ])
      ).toBe("alpha.com,beta.org,gamma.net");
    });

    it("extracts and joins domains for comma-separated recipient string", () => {
      expect(extractRecipientDomains("lab@alpha.com, audit@beta.org")).toBe(
        "alpha.com,beta.org"
      );
    });

    it("handles invalid or empty recipient gracefully", () => {
      expect(extractRecipientDomains("invalid-address")).toBe("unknown");
      expect(extractRecipientDomains("")).toBe("unknown");
    });
  });

  describe("INV-2 Invariant — No Rx values, body, or attachment in logs", () => {
    it("captures log output for a send with an Rx-bearing attachment and asserts content is absent", async () => {
      const capturedLogs: string[] = [];
      const mockLogger = {
        info: vi.fn((msg: string) => {
          capturedLogs.push(msg);
        }),
      };

      const { fakeClient } = createMockClient(async () => ({
        data: { id: "resend_msg_secure_inv2" },
        error: null,
        headers: null,
      }));

      const mailer = createResendMailer({
        client: fakeClient,
        from: "Lens Advisor <orders@mail.lensadvisor.io>",
        logger: mockLogger,
      });

      // Sensitive clinical Rx prescription data
      const sensitiveRxBody =
        "Patient Prescription Details: SPH -3.75, CYL -1.25, AXIS 180, ADD +2.00, PD 63.5mm, Prism 1.5 BU";
      const sensitiveAttachmentName = "Jane_Doe_Rx_Prescription_Card.pdf";
      const sensitiveAttachmentContent =
        "CONFIDENTIAL_HEALTH_DATA_PATIENT_SSN_123_SPH_-375_CYL_-125_AXIS_180";

      const recipient = "Lab Fulfillment <order-dept@optical-grind-house.com>";
      const subject = "Urgent Progressive Prescription Order #98765";

      const result = await mailer.send({
        to: recipient,
        subject,
        text: sensitiveRxBody,
        attachments: [
          {
            filename: sensitiveAttachmentName,
            content: Buffer.from(sensitiveAttachmentContent),
            contentType: "application/pdf",
          },
        ],
      });

      // 1. Send was successful
      expect(result.providerId).toBe("resend_msg_secure_inv2");

      // 2. Logger was invoked exactly once
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      const combinedLog = capturedLogs.join("\n");

      // 3. Provider id is logged
      expect(combinedLog).toContain("resend_msg_secure_inv2");

      // 4. Recipient domain ONLY is logged (not mailbox name)
      expect(combinedLog).toContain("optical-grind-house.com");
      expect(combinedLog).not.toContain("order-dept");
      expect(combinedLog).not.toContain("Lab Fulfillment");

      // 5. Subject length is logged, NOT the subject text
      expect(combinedLog).toContain(`subjectLength=${subject.length}`);
      expect(combinedLog).not.toContain("Urgent Progressive Prescription");
      expect(combinedLog).not.toContain("#98765");

      // 6. INV-2: Body text is NEVER logged
      expect(combinedLog).not.toContain(sensitiveRxBody);
      expect(combinedLog).not.toContain("SPH");
      expect(combinedLog).not.toContain("CYL");
      expect(combinedLog).not.toContain("AXIS");
      expect(combinedLog).not.toContain("-3.75");
      expect(combinedLog).not.toContain("63.5");
      expect(combinedLog).not.toContain("Prism");

      // 7. INV-2: Attachment content and filename are NEVER logged
      expect(combinedLog).not.toContain(sensitiveAttachmentContent);
      expect(combinedLog).not.toContain("CONFIDENTIAL_HEALTH_DATA");
      expect(combinedLog).not.toContain(sensitiveAttachmentName);
      expect(combinedLog).not.toContain("Jane_Doe");
    });

    it("verifies console.info spy captures only providerId, recipient domain, and subject length", async () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      const { fakeClient } = createMockClient(async () => ({
        data: { id: "msg_console_spy_test" },
        error: null,
        headers: null,
      }));

      // Default logger uses console
      const mailer = createResendMailer({
        client: fakeClient,
        from: "Lens Advisor <orders@mail.lensadvisor.io>",
      });

      const sensitiveText = "SECRET_RX_SPH_-500";
      const sensitiveAttachment = "SECRET_PATIENT_ATTACHMENT_BYTES";

      try {
        await mailer.send({
          to: "technician@lab-partner.com",
          subject: "Rx Job #54321",
          text: sensitiveText,
          attachments: [
            {
              filename: "rx.pdf",
              content: Buffer.from(sensitiveAttachment),
              contentType: "application/pdf",
            },
          ],
        });

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        const loggedText = consoleSpy.mock.calls[0][0];

        expect(loggedText).toContain("providerId=msg_console_spy_test");
        expect(loggedText).toContain("recipientDomain=lab-partner.com");
        expect(loggedText).toContain(`subjectLength=${"Rx Job #54321".length}`);

        // INV-2 asserts
        expect(loggedText).not.toContain(sensitiveText);
        expect(loggedText).not.toContain(sensitiveAttachment);
        expect(loggedText).not.toContain("technician@");
        expect(loggedText).not.toContain("Rx Job");
        expect(loggedText).not.toContain("rx.pdf");
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it("ensures an Rx-bearing and email-bearing provider error never appears in error message, cause, or logs (INV-2)", async () => {
      const sensitiveEmail = "patient.secret@privateclinic.org";
      const sensitiveRx = "SPH -4.25 CYL +1.75 AXIS 090 ADD +2.50";
      const rawErrorMessage = `Invalid recipient ${sensitiveEmail}: rejected clinical prescription payload with ${sensitiveRx}`;

      const capturedLogs: string[] = [];
      const mockLogger = {
        info: vi.fn((msg: string) => capturedLogs.push(msg)),
        error: vi.fn((msg: string) => capturedLogs.push(msg)),
      };

      const { fakeClient } = createMockClient(async () => ({
        data: null,
        error: {
          statusCode: 422,
          name: "validation_error",
          message: rawErrorMessage,
        },
        headers: null,
      }));

      const mailer = createResendMailer({
        client: fakeClient,
        logger: mockLogger,
      });

      let caughtError: unknown;
      try {
        await mailer.send({
          to: sensitiveEmail,
          subject: "Your prescription",
          text: sensitiveRx,
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(MailRejectedError);
      const err = caughtError as MailRejectedError;

      // 1. AppError.message must be a fixed, data-free string (status code and name/code only)
      expect(err.message).not.toContain(sensitiveEmail);
      expect(err.message).not.toContain(sensitiveRx);
      expect(err.message).not.toContain(rawErrorMessage);
      expect(err.message).toBe("Mail provider rejected the message (422: validation_error)");

      // 2. cause must not contain the raw error or sensitive text
      expect(err.cause).toBeUndefined();

      // 3. Serialized error / errorResponse does not contain sensitive data
      const jsonResponse = errorResponse(err);
      const body = await jsonResponse.json();
      expect(JSON.stringify(body)).not.toContain(sensitiveEmail);
      expect(JSON.stringify(body)).not.toContain(sensitiveRx);

      // 4. Logs do not contain sensitive data
      const allLogs = capturedLogs.join("\n");
      expect(allLogs).not.toContain(sensitiveEmail);
      expect(allLogs).not.toContain(sensitiveRx);
    });

    it("ensures thrown network errors containing sensitive Rx/email never appear in message or cause (INV-2)", async () => {
      const sensitiveEmail = "patient.secret@privateclinic.org";
      const sensitiveRx = "SPH -4.25 CYL +1.75 AXIS 090";
      const thrownError = Object.assign(
        new Error(
          `Network timeout connecting to provider for ${sensitiveEmail} with data ${sensitiveRx}`
        ),
        { code: "ETIMEDOUT" }
      );

      const { fakeClient } = createMockClient(async () => {
        throw thrownError;
      });

      const mailer = createResendMailer({
        client: fakeClient,
      });

      let caughtError: unknown;
      try {
        await mailer.send({
          to: sensitiveEmail,
          subject: "Prescription",
          text: sensitiveRx,
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(MailTransientError);
      const transientErr = caughtError as MailTransientError;
      expect(transientErr.message).not.toContain(sensitiveEmail);
      expect(transientErr.message).not.toContain(sensitiveRx);
      expect(transientErr.message).toBe("Mail provider network error (ETIMEDOUT)");
      expect(transientErr.cause).toBeUndefined();
    });
  });

  describe("Composition root container getMailer()", () => {
    beforeEach(() => {
      resetMailer();
      resetConfigCache();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      resetMailer();
      resetConfigCache();
    });

    it("throws ConfigError when RESEND_API_KEY is missing upon first getMailer() call", () => {
      vi.stubEnv("RESEND_API_KEY", "");
      expect(() => getMailer()).toThrow(ConfigError);
      expect(() => getMailer()).toThrow(/RESEND_API_KEY/);
    });

    it("returns a singleton Mailer instance when configured", () => {
      vi.stubEnv("RESEND_API_KEY", "re_test_dummy_key_12345");
      vi.stubEnv("MAIL_FROM", "Custom Sender <custom@example.com>");

      const mailer1 = getMailer();
      expect(mailer1).toBeDefined();
      expect(typeof mailer1.send).toBe("function");

      const mailer2 = getMailer();
      expect(mailer2).toBe(mailer1); // singleton reference equality

      resetMailer();
      const mailer3 = getMailer();
      expect(mailer3).not.toBe(mailer1); // new instance after reset
    });
  });
});
