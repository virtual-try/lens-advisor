import type { PrismaClient } from "@prisma/client";
import { getConfig } from "../../app/shared/config.server";
import * as catalogService from "../../app/features/catalog/catalog.service.server";
import * as settingsService from "../../app/features/settings/settings.service.server";
import type { SettingsPatch } from "../../app/features/settings/schema";
import { syncItem } from "../../app/features/product-sync";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export interface SeededShopContext {
  shopId: string;
  domain: string;
}

export async function seedShop(
  prisma: PrismaClient,
  domain: string
): Promise<SeededShopContext> {
  const config = getConfig().shopify;

  let shop = await prisma.shop.findUnique({
    where: { domain },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        domain,
        installedAt: new Date(),
      },
    });
  }

  // Create or update offline session for authenticate.admin
  await prisma.session.upsert({
    where: { id: `offline_${domain}` },
    create: {
      id: `offline_${domain}`,
      shop: domain,
      state: "active",
      isOnline: false,
      accessToken: "test_offline_token",
      scope: config.scopes.join(","),
    },
    update: {
      state: "active",
      accessToken: "test_offline_token",
      scope: config.scopes.join(","),
    },
  });

  return {
    shopId: shop.id,
    domain,
  };
}

export async function seedLensGroup(
  shopId: string,
  data: { name: string; description?: string }
) {
  return catalogService.createLensGroup(shopId, data);
}

export async function seedLens(
  shopId: string,
  data: {
    groupId: string;
    name: string;
    description?: string;
    priceMinor: number;
    currency: string;
    rxTypes: Array<"SINGLE_VISION" | "PROGRESSIVE" | "READING" | "NON_PRESCRIPTION">;
    sphMin: number;
    sphMax: number;
    cylMin: number;
    cylMax: number;
    addMin?: number | null;
    addMax?: number | null;
    labCodeTemplate?: string;
  },
  options?: {
    admin?: AdminApiContext;
    sync?: boolean;
  }
) {
  const lens = await catalogService.createLens(shopId, data);
  if (options?.sync && options.admin) {
    await syncItem(options.admin, shopId, "lens", lens.id);
  }
  return lens;
}

export async function seedOptionGroup(
  shopId: string,
  data: {
    kind: "MATERIAL" | "TINT_TYPE" | "COLOR";
    name: string;
  }
) {
  return catalogService.createOptionGroup(shopId, data);
}

export async function seedOptionValue(
  shopId: string,
  data: {
    optionGroupId: string;
    label: string;
    priceDeltaMinor: number;
    currency?: string;
    tokenKey?: string | null;
    tokenValue?: string | null;
    overrideCode?: string | null;
    swatch?: string | null;
  },
  options?: {
    admin?: AdminApiContext;
    sync?: boolean;
  }
) {
  const optVal = await catalogService.createOptionValue(shopId, data);
  if (options?.sync && options.admin) {
    await syncItem(options.admin, shopId, "optionValue", optVal.id);
  }
  return optVal;
}

export async function seedAddOn(
  shopId: string,
  data: {
    name: string;
    priceMinor: number;
    currency?: string;
  },
  options?: {
    admin?: AdminApiContext;
    sync?: boolean;
  }
) {
  const addOn = await catalogService.createAddOn(shopId, data);
  if (options?.sync && options.admin) {
    await syncItem(options.admin, shopId, "addOn", addOn.id);
  }
  return addOn;
}

export async function seedSettings(
  shopId: string,
  patch: SettingsPatch,
  prisma?: PrismaClient
) {
  const db = prisma ?? ((globalThis as Record<string, unknown>).__prismaClient as PrismaClient);
  return settingsService.updateSettings(shopId, patch, db);
}
