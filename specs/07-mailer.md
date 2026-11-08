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

- [ ] `pnpm vitest run app/shared/mail/mailer.server.test.ts` passes: every Examples row is a case; idempotency key reaches the client call. [unit]
- [ ] INV-2: a test captures log output for a send with an Rx-bearing attachment and asserts the content is absent. [unit]
- [ ] A real email with a PDF attachment arrives at a test inbox. [requires: Resend account, verified sending domain — owner provides]
- [ ] `pnpm test` passes with 0 failures. [unit]
- [ ] `specs/inventory/07-mailer.md` lists `Mailer` and `createResendMailer`. [static]
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors, 0 warnings. [static]
- [ ] `pnpm build` passes. [static]
