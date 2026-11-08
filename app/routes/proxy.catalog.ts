import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  catalogResponseSchema,
  type CatalogResponse,
} from "../../packages/rx-core/src/schemas/catalog.js";
import { getPlanStatus } from "../features/billing/plan.server";
import { getStorefrontCatalog } from "../features/catalog/catalog.service.server";
import { getSettings } from "../features/settings/settings.service.server";
import { getPrisma } from "../shared/container/prisma.server";
import {
  AppError,
  BadRequestError,
  errorResponse,
  InternalServerError,
  UnauthorizedError,
} from "../shared/http/errors.server";
import { authenticate } from "../shopify.server";

async function handleCatalogRequest(
  request: Request,
): Promise<Response> {
  try {
    // 1. Authenticate app proxy request first (INV-6: authenticate before any logic or method check)
    let context;
    try {
      context = await authenticate.public.appProxy(request);
    } catch {
      throw new UnauthorizedError(
        "App proxy verification failed",
        "UNAUTHORIZED",
      );
    }

    // 2. Tenancy strictly from verified offline session context (INV-1)
    const shopDomain = context.session?.shop;
    if (!shopDomain || !context.admin) {
      throw new AppError(
        404,
        "NOT_AVAILABLE",
        "Shop not installed or no active plan",
      );
    }

    // 3. Method check: only GET and HEAD allowed for catalog endpoint
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new BadRequestError("Method not allowed", "METHOD_NOT_ALLOWED");
    }

    // 4. Verify shop exists and is installed in the database (INV-1)
    const prisma = getPrisma();
    const shop = await prisma.shop.findUnique({
      where: { domain: shopDomain },
    });
    if (!shop || shop.uninstalledAt !== null) {
      throw new AppError(
        404,
        "NOT_AVAILABLE",
        "Shop not installed or no active plan",
      );
    }

    // 5. Verify shop's active plan (Spec 09, Spec 21)
    const plan = await getPlanStatus(request, context.admin);
    if (!plan.active) {
      throw new AppError(
        404,
        "NOT_AVAILABLE",
        "Shop not installed or no active plan",
      );
    }

    // 6. Retrieve catalog and settings for this shop (INV-1, INV-3)
    const [catalog, settings] = await Promise.all([
      getStorefrontCatalog(shop.id, { prisma }),
      getSettings(shop.id, prisma),
    ]);

    // 7. Shape response DTO conforming to spec 03 catalog schema (INV-3: no lab emails)
    const responsePayload = {
      lensGroups: catalog.lensGroups,
      optionGroups: catalog.optionGroups,
      addOns: catalog.addOns,
      settings: {
        manualRxEnabled: settings.manualRxEnabled,
        rxUploadEnabled: settings.rxUploadEnabled,
        storeRxInOrder: settings.storeRxInOrder,
      },
    };

    // 8. Validate against catalogResponseSchema before sending (server bug becomes 500)
    let validated: CatalogResponse;
    try {
      validated = catalogResponseSchema.parse(responsePayload);
    } catch {
      throw new InternalServerError(
        "Invalid catalog response",
        "INVALID_CATALOG_RESPONSE",
      );
    }

    // 9. Send response with Cache-Control: private, max-age=60
    return new Response(JSON.stringify(validated), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return handleCatalogRequest(request);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleCatalogRequest(request);
};
