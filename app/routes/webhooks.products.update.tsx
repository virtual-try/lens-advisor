import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import {
  BadRequestError,
  errorResponse,
  UnauthorizedError,
} from "../shared/http/errors.server";
import { authenticate } from "../shopify.server";

export const productUpdateWebhookPayloadSchema = z
  .object({
    id: z.union([z.number().int().positive(), z.string().min(1)]),
    title: z.string().optional(),
    admin_graphql_api_id: z.string().optional(),
  })
  .passthrough();

export const productWebhookPayloadSchema = productUpdateWebhookPayloadSchema;
export const productsUpdateWebhookPayloadSchema = productUpdateWebhookPayloadSchema;
export type ProductUpdateWebhookPayload = z.infer<typeof productUpdateWebhookPayloadSchema>;

export const action = async ({ request }: ActionFunctionArgs) => {
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
      if (error.status === 400) {
        return errorResponse(
          new BadRequestError("Webhook authentication failed", "BAD_REQUEST"),
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

  const { shop, topic, payload } = webhookContext;

  const parseResult = productUpdateWebhookPayloadSchema.safeParse(payload);
  if (!parseResult.success) {
    console.error(`[webhooks.products.update] MALFORMED_PAYLOAD for ${shop}`);
    return errorResponse(
      new BadRequestError("Invalid product update payload", "MALFORMED_PAYLOAD"),
    );
  }

  console.log(`Received ${topic} webhook for ${shop}, product id: ${parseResult.data.id}`);

  return new Response(null, { status: 200 });
};
