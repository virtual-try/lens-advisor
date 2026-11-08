import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import { fromOrderGid } from "../features/lab-orders/intake.service.server";
import { INTAKE_JOB_NAME } from "../features/lab-orders/jobs.server";
import { getQueue } from "../shared/container/queue.server";
import {
  BadRequestError,
  errorResponse,
  UnauthorizedError,
} from "../shared/http/errors.server";
import { authenticate } from "../shopify.server";

export const orderWebhookPayloadSchema = z
  .object({
    id: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
    admin_graphql_api_id: z.string().startsWith("gid://shopify/Order/").optional(),
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
  } catch {
    return errorResponse(
      new UnauthorizedError("Webhook verification failed", "UNAUTHORIZED"),
    );
  }

  const { shop, payload } = webhookContext;

  // 2. Strictly validate webhook payload with Zod (R1-F4)
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

  // 3. Enqueue lab-orders.intake with { shopId, shopifyOrderId } only (INV-2, INV-8)
  // No DB calls or Admin API work performed inside the request handler.
  const queue = await getQueue();
  await queue.enqueue(
    INTAKE_JOB_NAME,
    {
      shopId: shop,
      shopifyOrderId: orderId,
    },
    {
      singletonKey: orderId,
    },
  );

  return new Response(null, { status: 200 });
};
