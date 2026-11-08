# Spec 07 — Mailer adapter (Resend)

**Status:** Done
**Depends on:** Spec 01
**Model:** Light — `claude-haiku-5-5` · `gpt-6-luna` · `gemini-3.5-flash-lite`
**Issue:** —
**Owns:** `app/shared/mail/mailer.server.ts`, `app/shared/mail/mailer.server.test.ts`, `app/shared/container/mailer.server.ts`, `specs/inventory/07-mailer.md`
**Reuses:** `app/shared/config.server.ts` (spec 01)
**Kind:** integration
**Invariants:** INV-2

## Goal

A `Mailer` interface with one Resend implementation that sends a message with attachments and returns
the provider's message id, so the dispatch job (30) and data-request handler (25) never touch Resend
directly.

## Scope

- `Mailer.send({ to, subject, text, attachments: [{ filename, content: Buffer, contentType }], idempotencyKey })`
  → `{ providerId }`.
- Resend client injected; `idempotencyKey` passed through to Resend's idempotency header (confirm the
  option name in `docs/research/libraries.md`).
- Errors mapped: 4xx → `MailRejectedError` (not retried), 429/5xx/network → `MailTransientError` (retried
  by the job).
- Attachments over 10 MB total → `MailTooLargeError` before calling the provider.
- Log line on send: provider id, recipient domain only, subject length — never body or attachment.

- Add the lazy getter in `app/shared/container/` (see `ARCHITECTURE.md#hot-files--designed-out`), reading config once.

## Explicit non-scope

- Message content → spec 30 / 25. Retries → the queue (spec 08).

## Reuse first

- Named in detail: `app/shared/config.server.ts` (spec 01: `RESEND_API_KEY`, `MAIL_FROM`)
- Resend Node SDK. Config from spec 01.

## Wiring

Real, used now: config. In tests: fake Resend client. Stubbed: none. Consumers: 25, 30.

## Examples

| Provider result | Expected | Why this row |
| --- | --- | --- |
| 200 `{id}` | `{ providerId: id }` | normal |
| 422 | `MailRejectedError` | permanent |
| 429 / 503 / ECONNRESET | `MailTransientError` | retryable |
| attachments 11 MB | `MailTooLargeError`, provider not called | size |

## Steps

1. Implement; 2. every Examples row a test with the fake client.

## Self-check

1. Error mapping: a 429 must be transient, not rejected.
2. INV-2: logs contain no body or attachment content.

## Done when

- [x] `pnpm vitest run app/shared/mail/mailer.server.test.ts` passes: every Examples row is a case; idempotency key reaches the client call. [unit]
- [x] INV-2: a test captures log output for a send with an Rx-bearing attachment and asserts the content is absent. [unit]
- [ ] A real email with a PDF attachment arrives at a test inbox. [requires: Resend account, verified sending domain — owner provides]
- [x] `pnpm test` passes with 0 failures. [unit]
- [x] `specs/inventory/07-mailer.md` lists `Mailer` and `createResendMailer`. [static]
- [x] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [x] `pnpm build` passes. [static]

## Log

- **2026-11-08** — Spec 07 implemented by coder agy-1 (engine agy) in worktree `spec-07` on branch `spec/07-mailer`. No git writes (lead commits). GitHub issue skipped: dispatch brief forbids git writes.
- **2026-11-08** — Installed `resend` 6.37.0 to workspace root (`package.json`, `pnpm-lock.yaml`).
- **2026-11-08** — Implemented `app/shared/mail/mailer.server.ts`:
  - `Mailer` interface and `createResendMailer({ client, from, logger })` factory returning `{ send(options): Promise<SendMailResult> }`.
  - Injected Resend client with `emails.send` support and passed `idempotencyKey` through `requestOptions` to Resend's idempotency header (`Idempotency-Key`).
  - Error classes `MailRejectedError`, `MailTransientError`, and `MailTooLargeError` extending `AppError` from `app/shared/http/errors.server.ts`.
  - Comprehensive error mapping via `mapToMailError`:
    - 4xx errors (except 429, including 408) → `MailRejectedError` (permanent, not retried).
    - 429 (rate limited) → `MailTransientError` (retryable).
    - 5xx (server errors) → `MailTransientError` (retryable).
    - Network errors (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `fetch failed`) → `MailTransientError` (retryable).
  - Pre-flight total attachment size verification against 10 MB limit (`MAX_ATTACHMENTS_TOTAL_BYTES` = 10,485,760 bytes); throws `MailTooLargeError` before invoking provider.
  - Logging on send (INV-2): logs only `providerId`, recipient domain (parsed via `extractRecipientDomains`), and `subjectLength`; never logs body text, attachment content, or filenames.
- **2026-11-08** — Implemented lazy composition root singleton getter `getMailer()` and resetter `resetMailer()` in `app/shared/container/mailer.server.ts` consuming `getConfig().resend` (`RESEND_API_KEY`, `MAIL_FROM`).
- **2026-11-08** — Created inventory fragment `specs/inventory/07-mailer.md` documenting `mailer` and `mailer-container`.
- **2026-11-08** — Added test suite in `app/shared/mail/mailer.server.test.ts` (34 tests):
  - Every Examples row verified: Row 1 (200 {id}), Row 2 (422), Row 3a (429), Row 3b (503), Row 3c (ECONNRESET), Row 4 (attachments 11 MB).
  - Idempotency key pass-through verified.
  - Attachment size boundaries (exact 10 MB, 10 MB + 1 byte, multi-file totals) verified.
  - Error mapping comprehensiveness (400, 401, 403, 404, 500, 502, 504, 408, ETIMEDOUT, ECONNREFUSED, fetch failed, missing id) verified.
  - Recipient domain parsing tested across formats.
  - INV-2 verified: captured logger output asserts absence of clinical Rx values, body text, attachment filename, and attachment content.
  - Container getter `getMailer()` verified with env validation and singleton caching.
- **2026-11-08** — Self-check items verified:
  1. Error mapping: a 429 must be transient, not rejected — verified in test suite (`MailTransientError` with status 429). Holds.
  2. INV-2: logs contain no body or attachment content — verified in test suite with custom logger and console spy. Holds.
- **2026-11-08** — Owner-gated Done-when item left unticked: "A real email with a PDF attachment arrives at a test inbox" requires a live Resend account and verified domain provided by owner (per Ruling R7).
- **2026-11-08** — Gates verified:
  - `pnpm vitest run app/shared/mail/mailer.server.test.ts` → 34/34 passed
  - `pnpm test` → 18 test files, 313/313 passed
  - `pnpm typecheck` → 0 errors
  - `pnpm lint` → 0 errors, 0 warnings
  - `pnpm build` → client and SSR server build passed
- **2026-11-08** — Review round R1 fixes applied by coder agy-1:
  - R1-F1: Sanitized error reporting to prevent data leaks under INV-2. `AppError.message` is now a fixed, data-free string with status code and safe identifier only; `cause` is no longer set with the raw provider error. Added tests ensuring clinical Rx text and recipient email never appear in error message, cause, serialized error response, or logs.
  - R1-F2: Made HTTP status authoritative: 429 and 5xx are transient; every other 4xx (including 408) is classified as `MailRejectedError`. Text matching for network/timeout heuristics is only applied when no HTTP status code exists. Added tests for 408, 400 with "timeout" message, and 422 with "network" message.
  - Gates: `pnpm vitest run app/shared/mail/mailer.server.test.ts` (38/38 passed), `pnpm test` (18 files, 317/317 passed), `pnpm typecheck` (0 errors), `pnpm lint` (0 errors), `pnpm build` (passed).
- **2026-11-07** — Evidence (orchestro spec verify, tree d70dbd7d): install pass · typecheck pass · lint pass · build pass · test pass 393/0/0
