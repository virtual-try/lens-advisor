import { z } from "zod";

import {
  BadRequestError,
  type FieldError,
} from "../../shared/http/errors.server";

export const TICKET_FORMATS = ["PDF", "CSV", "BOTH"] as const;

export type TicketFormat = (typeof TICKET_FORMATS)[number];

export interface ShopSettings {
  /** One or more lab addresses. Empty means setup is not complete. */
  labEmail: string[];
  ticketFormat: TicketFormat;
  /** Off unless the merchant turns it on. INV-3. */
  storeRxInOrder: boolean;
  rxUploadEnabled: boolean;
  manualRxEnabled: boolean;
}

export interface SettingsPatch {
  labEmail?: string[];
  ticketFormat?: TicketFormat;
  storeRxInOrder?: boolean;
  rxUploadEnabled?: boolean;
  manualRxEnabled?: boolean;
}

/** `labEmail` is true when at least one address is saved. */
export interface SetupComplete {
  labEmail: boolean;
}

const EMAIL_MAX_LENGTH = 254;

const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  labEmail: [],
  ticketFormat: "PDF",
  storeRxInOrder: false,
  rxUploadEnabled: true,
  manualRxEnabled: true,
};

const ticketFormatSchema = z.enum(["PDF", "CSV", "BOTH"]);

const settingsPatchSchema = z
  .object({
    labEmail: z.union([z.string(), z.array(z.string())]).optional(),
    ticketFormat: ticketFormatSchema.optional(),
    storeRxInOrder: z.boolean().optional(),
    rxUploadEnabled: z.boolean().optional(),
    manualRxEnabled: z.boolean().optional(),
  })
  .strict();

const storedSettingsSchema = z
  .object({
    labEmail: z.array(z.string().max(EMAIL_MAX_LENGTH).email()),
    ticketFormat: ticketFormatSchema,
    storeRxInOrder: z.boolean(),
    rxUploadEnabled: z.boolean(),
    manualRxEnabled: z.boolean(),
  })
  .superRefine((settings, ctx) => {
    if (!settings.rxUploadEnabled && !settings.manualRxEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rxUploadEnabled"],
        message: "AT_LEAST_ONE_RX_INPUT",
      });
    }
  });

export class ValidationError extends BadRequestError {
  constructor(code: string, message: string, fields: FieldError[]) {
    super(message, code, fields);
    this.name = "ValidationError";
  }
}

/** Fresh object. Callers can mutate the array without changing the next read. */
export function defaultShopSettings(): ShopSettings {
  return {
    ...DEFAULT_SHOP_SETTINGS,
    labEmail: [],
  };
}

export function parseSettingsPatch(input: unknown): SettingsPatch {
  const parsed = settingsPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      "INVALID",
      "Shop settings patch is invalid.",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "patch",
        code: "INVALID",
      })),
    );
  }

  const patch: SettingsPatch = {};
  if (parsed.data.ticketFormat !== undefined) {
    patch.ticketFormat = parsed.data.ticketFormat;
  }
  if (parsed.data.storeRxInOrder !== undefined) {
    patch.storeRxInOrder = parsed.data.storeRxInOrder;
  }
  if (parsed.data.rxUploadEnabled !== undefined) {
    patch.rxUploadEnabled = parsed.data.rxUploadEnabled;
  }
  if (parsed.data.manualRxEnabled !== undefined) {
    patch.manualRxEnabled = parsed.data.manualRxEnabled;
  }
  if (parsed.data.labEmail !== undefined) {
    patch.labEmail = normalizeLabEmail(parsed.data.labEmail);
  }
  return patch;
}

export function isFullSettingsPatch(
  patch: SettingsPatch,
): patch is Required<SettingsPatch> {
  return (
    patch.labEmail !== undefined &&
    patch.ticketFormat !== undefined &&
    patch.storeRxInOrder !== undefined &&
    patch.rxUploadEnabled !== undefined &&
    patch.manualRxEnabled !== undefined
  );
}

export function applySettingsPatch(
  current: ShopSettings,
  patch: SettingsPatch,
): ShopSettings {
  return {
    labEmail: [...(patch.labEmail ?? current.labEmail)],
    ticketFormat: patch.ticketFormat ?? current.ticketFormat,
    storeRxInOrder: patch.storeRxInOrder ?? current.storeRxInOrder,
    rxUploadEnabled: patch.rxUploadEnabled ?? current.rxUploadEnabled,
    manualRxEnabled: patch.manualRxEnabled ?? current.manualRxEnabled,
  };
}

export function assertAtLeastOneRxInput(settings: ShopSettings): void {
  if (settings.rxUploadEnabled || settings.manualRxEnabled) return;
  throw new ValidationError(
    "AT_LEAST_ONE_RX_INPUT",
    "Keep at least one prescription input on.",
    [
      { path: "rxUploadEnabled", code: "AT_LEAST_ONE_RX_INPUT" },
      { path: "manualRxEnabled", code: "AT_LEAST_ONE_RX_INPUT" },
    ],
  );
}

/**
 * Returns a copy of a stored row, or undefined when the row breaks a rule
 * the database does not enforce (email shape, or both prescription inputs off).
 * Callers report that; they do not trust or rewrite the row on read.
 */
export function readStoredSettings(row: {
  labEmails: string[];
  ticketFormat: string;
  storeRxInOrder: boolean;
  rxUploadEnabled: boolean;
  manualRxEnabled: boolean;
}): ShopSettings | undefined {
  const parsed = storedSettingsSchema.safeParse({
    labEmail: row.labEmails,
    ticketFormat: row.ticketFormat,
    storeRxInOrder: row.storeRxInOrder,
    rxUploadEnabled: row.rxUploadEnabled,
    manualRxEnabled: row.manualRxEnabled,
  });
  if (!parsed.success) return undefined;
  return {
    ...parsed.data,
    labEmail: [...parsed.data.labEmail],
  };
}

function normalizeLabEmail(value: string | string[]): string[] {
  const entries = Array.isArray(value) ? value : [value];
  const fields: FieldError[] = [];
  const emails: string[] = [];
  const seen = new Set<string>();

  entries.forEach((raw, index) => {
    const path = Array.isArray(value) ? `labEmail.${index}` : "labEmail";
    const email = raw.trim().toLowerCase();
    if (!isLabEmail(email)) {
      fields.push({ path, code: "EMAIL" });
      return;
    }
    if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  });

  if (fields.length > 0) {
    throw new ValidationError(
      "EMAIL",
      "Enter a valid lab email address.",
      fields,
    );
  }
  return emails;
}

function isLabEmail(email: string): boolean {
  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return false;
  return z.string().email().safeParse(email).success;
}
