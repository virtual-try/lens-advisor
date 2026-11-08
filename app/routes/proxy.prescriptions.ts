import type { ActionFunctionArgs } from "react-router";

import { createPrescriptionsService } from "../features/prescriptions/prescriptions.service.server";
import { prescriptionRateLimiter } from "../features/prescriptions/rate-limiter.server";
import { parsePrescriptionSubmitBody } from "../features/prescriptions/schema";
import {
  BadRequestError,
  errorResponse,
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

    // 2. Tenancy strictly from verified offline session context (INV-1, R1-F3)
    const shopDomain = context.session?.shop;
    if (!shopDomain) {
      throw new UnauthorizedError(
        "No verified session found for shop",
        "UNAUTHORIZED",
      );
    }

    // 3. Rate limit: 20 req/min/shop+IP immediately after verified tenancy, before method/body validation and DB lookup (R2-F2)
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("cf-connecting-ip") ||
      "127.0.0.1";
    prescriptionRateLimiter.assertAllowed(`${shopDomain}:${ip}`);

    // 4. Request method validation runs AFTER authentication and rate limit (R1-F2, R2-F2)
    if (request.method !== "POST") {
      throw new BadRequestError("Method not allowed", "METHOD_NOT_ALLOWED");
    }

    // 5. Parse request body before any service calls (R1-F7, R4-F1)
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new BadRequestError(
        "Malformed JSON in request body",
        "BAD_REQUEST",
      );
    }

    const parsed = parsePrescriptionSubmitBody(body);

    // 6. Call service (resolves verified domain inside service boundary, INV-1, R4-F2)
    const service = createPrescriptionsService();
    const result = await service.submitPrescriptionByDomain(shopDomain, parsed);

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
