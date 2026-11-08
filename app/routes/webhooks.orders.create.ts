import type { ActionFunctionArgs } from "react-router";

import { fromOrderGid } from "../features/lab-orders/intake.service.server";
import { INTAKE_JOB_NAME } from "../features/lab-orders/jobs.server";
import { getQueue } from "../shared/container/queue.server";
import { errorResponse, UnauthorizedError } from "../shared/http/errors.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // 1. Authenticate webhook request first (INV-6)
  let webhookContext;
  try {
    webhookContext = await authenticate.webhook(request);
  } catch (err: unknown) {
    if (err instanceof Response) {
      return err;
    }
    return errorResponse(
      new UnauthorizedError("Webhook verification failed", "UNAUTHORIZED"),
    );
  }

  const { shop, payload } = webhookContext;
  const orderId =
    payload?.id != null
      ? String(payload.id)
      : payload?.admin_graphql_api_id
        ? fromOrderGid(payload.admin_graphql_api_id)
        : undefined;

  // If no order ID could be resolved, return 200 fast
  if (!orderId) {
    return new Response(null, { status: 200 });
  }

  // 2. Enqueue lab-orders.intake with { shopId, shopifyOrderId } only (INV-2, INV-8)
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
