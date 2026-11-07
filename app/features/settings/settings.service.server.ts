import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../../shared/container/prisma.server";
import { InternalServerError, NotFoundError } from "../../shared/http/errors.server";
import {
  applySettingsPatch,
  assertAtLeastOneRxInput,
  defaultShopSettings,
  isFullSettingsPatch,
  parseSettingsPatch,
  readStoredSettings,
  type SettingsPatch,
  type SetupComplete,
  type ShopSettings,
} from "./schema";
import {
  findShopSettings,
  lockShop,
  upsertShopSettings,
  type ShopSettingsRow,
} from "./settings.repository.server";

export type { SetupComplete, ShopSettings } from "./schema";
export { ValidationError } from "./schema";

/**
 * Defaults when this shop has no settings row. Does not insert.
 * `storeRxInOrder` is false (INV-3).
 */
export async function getSettings(
  shopId: string,
  db: PrismaClient = getPrisma(),
): Promise<ShopSettings> {
  const row = await findShopSettings(db, shopId);
  if (!row) return defaultShopSettings();
  const settings = readStoredSettings(row);
  if (!settings) {
    throw corruptSettings();
  }
  return settings;
}

/**
 * Merges `patch` onto the shop's saved settings, or onto the defaults when
 * no row exists, and writes one row. A failed check writes nothing.
 * The optional client is for tests; requests omit it and use the container.
 */
export async function updateSettings(
  shopId: string,
  patch: unknown,
  db: PrismaClient = getPrisma(),
): Promise<ShopSettings> {
  const parsed = parseSettingsPatch(patch);
  return db.$transaction(async (tx) => {
    const locked = await lockShop(tx, shopId);
    if (!locked) {
      throw new NotFoundError("Shop not found");
    }

    const row = await findShopSettings(tx, shopId);
    const next = resolveNext(row, parsed);
    assertAtLeastOneRxInput(next);
    await upsertShopSettings(tx, shopId, next);

    const written = await findShopSettings(tx, shopId);
    if (!written) {
      throw new InternalServerError(
        "Shop settings were not saved.",
        "SETTINGS_NOT_SAVED",
      );
    }
    const saved = readStoredSettings(written);
    if (!saved) {
      throw corruptSettings();
    }
    return saved;
  });
}

/**
 * Lab-email step of the setup checklist (spec 31). Does not insert.
 * Check `labEmail` on the result; the object itself is always present.
 * Spec 31 names this `isComplete`.
 */
export async function isSetupComplete(
  shopId: string,
  db: PrismaClient = getPrisma(),
): Promise<SetupComplete> {
  const settings = await getSettings(shopId, db);
  return { labEmail: settings.labEmail.length > 0 };
}

export const isComplete = isSetupComplete;

function resolveNext(
  row: ShopSettingsRow | null,
  patch: SettingsPatch,
): ShopSettings {
  if (!row) {
    return applySettingsPatch(defaultShopSettings(), patch);
  }
  const current = readStoredSettings(row);
  if (!current) {
    if (!isFullSettingsPatch(patch)) {
      throw corruptSettings();
    }
    return applySettingsPatch(defaultShopSettings(), patch);
  }
  return applySettingsPatch(current, patch);
}

function corruptSettings(): InternalServerError {
  return new InternalServerError(
    "Stored shop settings are invalid.",
    "CORRUPT_SETTINGS",
  );
}
