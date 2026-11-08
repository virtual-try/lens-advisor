# Inventory fragment — Spec 07 (Mailer adapter (Resend))

### `mailer`
`app/shared/mail/mailer.server.ts` — Factory `createResendMailer({ client, from, logger })` producing a `Mailer` adapter that sends emails with attachments up to 10 MB, passes idempotency keys to Resend, maps provider responses to `MailRejectedError` (4xx) and `MailTransientError` (429/5xx/network), and logs only provider id, recipient domain, and subject length (INV-2).
**Use instead of:** Instantiating Resend clients directly in feature code or sending emails without idempotency and error mapping.
**Added by:** spec 07.

### `mailer-container`
`app/shared/container/mailer.server.ts` — Composition root lazy singleton getter `getMailer()` providing the shared `Mailer` instance configured from `config.server.ts` (`RESEND_API_KEY`, `MAIL_FROM`).
**Use instead of:** Reading Resend environment variables or constructing `Resend` in route loaders, actions, or background workers.
**Added by:** spec 07.
