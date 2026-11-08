import type { ActionFunctionArgs } from "react-router";

import { uploadUrlRequestSchema } from "../../packages/rx-core/src/schemas/catalog.js";
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
  if (request.method !== "POST") {
    return errorResponse(
      new BadRequestError("Method not allowed", "METHOD_NOT_ALLOWED"),
    );
  }

  try {
    // 1. Authenticate app proxy request (INV-6)
    let context;
    try {
      context = await authenticate.public.appProxy(request);
    } catch {
      throw new UnauthorizedError(
        "App proxy verification failed",
        "UNAUTHORIZED",
      );
    }

    const url = new URL(request.url);
    const shopDomain = context.session?.shop ?? url.searchParams.get("shop");
    if (!shopDomain) {
      throw new UnauthorizedError(
        "Missing shop parameter in app proxy request",
        "UNAUTHORIZED",
      );
    }

    // 2. Resolve shop from verified domain (INV-1)
    const db = getPrisma();
    const shop = await findShopByDomain(db, shopDomain);
    if (!shop) {
      throw new UnauthorizedError("Shop not found", "UNAUTHORIZED");
    }

    // 3. Rate limit: 20 req/min/shop+IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("cf-connecting-ip") ||
      "127.0.0.1";
    prescriptionRateLimiter.assertAllowed(`${shop.id}:${ip}`);

    // 4. Parse request body with zod schema from packages/rx-core (INV-6)
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

    // 5. Call service
    const service = createPrescriptionsService({ db });
    const result = await service.requestUploadUrl(shop.id, parsed.data);

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
