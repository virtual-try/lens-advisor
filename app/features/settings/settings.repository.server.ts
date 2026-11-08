import type { Prisma, PrismaClient } from "@prisma/client";

import type { ShopSettings } from "./schema";

/** Full client or the client inside `prisma.$transaction`. */
export type SettingsDb = PrismaClient | Prisma.TransactionClient;

export type ShopSettingsRow = {
  shopId: string;
  labEmails: string[];
  ticketFormat: string;
  storeRxInOrder: boolean;
  rxUploadEnabled: boolean;
  manualRxEnabled: boolean;
};

/**
 * Every function takes the shop id and filters by it (INV-1).
 * None of these functions insert on their own except `upsertShopSettings`.
 */
export async function findShopSettings(
  db: SettingsDb,
  shopId: string,
): Promise<ShopSettingsRow | null> {
  return db.shopSettings.findUnique({
    where: { shopId },
    select: {
      shopId: true,
      labEmails: true,
      ticketFormat: true,
      storeRxInOrder: true,
      rxUploadEnabled: true,
      manualRxEnabled: true,
    },
  });
}

/**
 * Locks the shop row so two partial patches for the same shop cannot
 * overwrite each other. Returns false when that shop does not exist.
 */
export async function lockShop(db: SettingsDb, shopId: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE
  `;
  return rows.length > 0;
}

export async function upsertShopSettings(
  db: SettingsDb,
  shopId: string,
  settings: ShopSettings,
): Promise<void> {
  const data = {
    labEmails: [...settings.labEmail],
    ticketFormat: settings.ticketFormat,
    storeRxInOrder: settings.storeRxInOrder,
    rxUploadEnabled: settings.rxUploadEnabled,
    manualRxEnabled: settings.manualRxEnabled,
  };
  await db.shopSettings.upsert({
    where: { shopId },
    create: { shopId, ...data },
    update: data,
  });
}
