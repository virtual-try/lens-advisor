import type { ActionFunctionArgs } from "react-router";

import { uploadUrlRequestSchema } from "../../packages/rx-core/src/schemas/catalog.js";
import { createPrescriptionsService } from "../features/prescriptions/prescriptions.service.server";
import { prescriptionRateLimiter } from "../features/prescriptions/rate-limiter.server";
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

    // 5. Parse request body before any service calls (R1-F7)
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new BadRequestError(
        "Malformed JSON in request body",
        "BAD_REQUEST",
      );
    }

    const parsed = uploadUrlRequestSchema.safeParse(body);
    if (!parsed.success) {
      const fields: FieldError[] = parsed.error.issues.map((i) => ({
        path: i.path.join(".") || "body",
        code: i.code === "custom" ? i.message : "INVALID",
      }));
      throw new BadRequestError(
        "Invalid upload-url request body",
        "BAD_REQUEST",
        fields,
      );
    }

    // 6. Call service (resolves verified domain inside service boundary, INV-1, R4-F2)
    const service = createPrescriptionsService();
    const result = await service.requestUploadUrlByDomain(
      shopDomain,
      parsed.data,
    );

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const loader = action;
