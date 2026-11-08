import { Resend } from "resend";
import { getConfig } from "../config.server";
import { createResendMailer, type Mailer } from "../mail/mailer.server";

declare global {
  var __mailer: Mailer | undefined;
}

export function getMailer(): Mailer {
  if (!global.__mailer) {
    const config = getConfig();
    const resendConfig = config.resend;
    const client = new Resend(resendConfig.apiKey);

    global.__mailer = createResendMailer({
      client,
      from: resendConfig.mailFrom,
    });
  }

  return global.__mailer;
}

export function resetMailer(): void {
  global.__mailer = undefined;
}
