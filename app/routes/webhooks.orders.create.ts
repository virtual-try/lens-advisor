import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import { fromOrderGid, INTAKE_JOB_NAME } from "../features/lab-orders/constants";
import { getQueue } from "../shared/container/queue.server";
import {
  BadRequestError,
  errorResponse,
  UnauthorizedError,
} from "../shared/http/errors.server";
import { authenticate } from "../shopify.server";

export const orderWebhookPayloadSchema = z
  .object({
    id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
    admin_graphql_api_id: z.string().regex(/^gid:\/\/shopify\/Order\/\d+$/).optional(),
  })
  .passthrough()
  .refine(
    (data) => data.id !== undefined || data.admin_graphql_api_id !== undefined,
    { message: "Missing order id" },
  );

export const action = async ({ request }: ActionFunctionArgs) => {
  // 1. Authenticate webhook request first (INV-6)
  let webhookContext;
  try {
    webhookContext = await authenticate.webhook(request);
  } catch (error: unknown) {
    if (error instanceof Response) {
      if (error.status === 401) {
        return errorResponse(
          new UnauthorizedError("Webhook verification failed", "UNAUTHORIZED"),
        );
      }
      return error;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status: unknown }).status === 401
    ) {
      return errorResponse(
        new UnauthorizedError("Webhook verification failed", "UNAUTHORIZED"),
      );
    }
    throw error;
  }

  const { shop, payload } = webhookContext;

  // 2. Strictly validate webhook payload with Zod (R1-F4, R2-F8)
  const parseResult = orderWebhookPayloadSchema.safeParse(payload);
  if (!parseResult.success) {
    // Log error code only, never the payload (INV-2)
    console.error("[webhooks.orders.create] MALFORMED_PAYLOAD");
    return errorResponse(
      new BadRequestError("Invalid webhook payload", "MALFORMED_PAYLOAD"),
    );
  }

  const rawOrderId =
    parseResult.data.id !== undefined
      ? String(parseResult.data.id)
      : parseResult.data.admin_graphql_api_id!;
  const orderId = fromOrderGid(rawOrderId);

  // 3. Enqueue lab-orders.intake with { shopDomain, shopifyOrderId } only (INV-2, INV-8, R2-F9)
  // No DB calls or Admin API work performed inside the request handler.
  const queue = await getQueue();
  await queue.enqueue(
    INTAKE_JOB_NAME,
    {
      shopDomain: shop,
      shopifyOrderId: orderId,
    },
    {
      singletonKey: orderId,
    },
  );

  return new Response(null, { status: 200 });
};
