import type { PrismaClient } from "@prisma/client";
import { getConfig } from "../../shared/config.server";
import { getPrisma } from "../../shared/container/prisma.server";
import {
  requireActivePlan,
  type ActivePlanContext,
} from "../billing/require-plan.server";
import { listLenses } from "../catalog/catalog.service.server";
import { isComplete } from "../settings/settings.service.server";

export interface HomeLoaderData {
  hasLens: boolean;
  hasLabEmail: boolean;
  apiKey: string;
  themeDeepLink: string;
}

export interface HomeLoaderDeps {
  requireActivePlan?: (request: Request) => Promise<ActivePlanContext>;
  prisma?: PrismaClient;
  apiKey?: string;
}

async function resolveShopId(
  prisma: PrismaClient,
  sessionShop: string,
): Promise<string> {
  const byDomain = await prisma.shop.findUnique({
    where: { domain: sessionShop },
    select: { id: true },
  });
  if (byDomain) {
    return byDomain.id;
  }

  const byId = await prisma.shop.findUnique({
    where: { id: sessionShop },
    select: { id: true },
  });
  if (byId) {
    return byId.id;
  }

  return sessionShop;
}

export async function loadHomeData(
  request: Request,
  deps?: HomeLoaderDeps,
): Promise<HomeLoaderData> {
  const checkPlan = deps?.requireActivePlan ?? requireActivePlan;
  const context = await checkPlan(request);

  const prisma = deps?.prisma ?? getPrisma();
  const sessionShop = context.session.shop;
  const shopId = await resolveShopId(prisma, sessionShop);

  const [lenses, settingsComplete] = await Promise.all([
    listLenses(shopId, { includeArchived: false }, deps ? { prisma } : undefined),
    isComplete(shopId, prisma),
  ]);

  const apiKey = deps?.apiKey ?? getConfig().shopify.apiKey;
  const themeDeepLink = `/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/select-lenses`;

  return {
    hasLens: lenses.length > 0,
    hasLabEmail: Boolean(settingsComplete.labEmail),
    apiKey,
    themeDeepLink,
  };
}
