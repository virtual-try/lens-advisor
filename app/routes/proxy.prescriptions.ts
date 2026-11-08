import type { ActionFunctionArgs } from "react-router";

import { prescriptionSubmitBodySchema } from "../../packages/rx-core/src/schemas/catalog.js";
import { findShopByDomain } from "../features/prescriptions/prescriptions.repository.server";
import { createPrescriptionsService } from "../features/prescriptions/prescriptions.service.server";
import { prescriptionRateLimiter } from "../features/prescriptions/rate-limiter.server";
import { getPrisma } from "../shared/container/prisma.server";
import {
  BadRequestError,
  errorResponse,
  type FieldError,
  UnauthorizedError,
} from "../shared/http/errors.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // 1. Authenticate app proxy request (INV-6: authentication-first)
    let context;
    try {
      context = await authenticate.public.appProxy(request);
    } catch {
      throw new UnauthorizedError(
        "App proxy verification failed",
        "UNAUTHORIZED",
      );
    }

    // 2. Request method validation runs AFTER authentication (R1-F2)
    if (request.method !== "POST") {
      throw new BadRequestError("Method not allowed", "METHOD_NOT_ALLOWED");
    }

    // 3. Tenancy strictly from verified offline session context (INV-1, R1-F3)
    const shopDomain = context.session?.shop;
    if (!shopDomain) {
      throw new UnauthorizedError(
        "No verified session found for shop",
        "UNAUTHORIZED",
      );
    }

    // 4. Parse request body before any repository calls (R1-F7)
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new BadRequestError(
        "Malformed JSON in request body",
        "BAD_REQUEST",
      );
    }

    const parsed = prescriptionSubmitBodySchema.safeParse(body);
    if (!parsed.success) {
      const fields: FieldError[] = parsed.error.issues.map((i) => ({
        path: i.path.join(".") || "body",
        code: i.code === "custom" ? i.message : "INVALID",
      }));
      throw new BadRequestError(
        "Invalid prescription submission body",
        "BAD_REQUEST",
        fields,
      );
    }

    // 5. Resolve shop from verified domain (INV-1)
    const db = getPrisma();
    const shop = await findShopByDomain(db, shopDomain);
    if (!shop) {
      throw new UnauthorizedError("Shop not found", "UNAUTHORIZED");
    }

    // 6. Rate limit: 20 req/min/shop+IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("cf-connecting-ip") ||
      "127.0.0.1";
    prescriptionRateLimiter.assertAllowed(`${shop.id}:${ip}`);

    // 7. Call service
    const service = createPrescriptionsService({ db });
    const result = await service.submitPrescription(shop.id, parsed.data);

    return new Response(JSON.stringify(result), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const loader = action;
