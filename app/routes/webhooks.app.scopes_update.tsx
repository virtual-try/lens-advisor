import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";

import {
  BadRequestError,
  errorResponse,
  UnauthorizedError,
} from "../shared/http/errors.server";
import { updateSessionScope } from "../shared/session/session.service.server";
import { authenticate } from "../shopify.server";

export const scopesUpdateWebhookPayloadSchema = z
  .object({
    current: z.array(z.string()),
    previous: z.array(z.string()).optional(),
  })
  .passthrough();

export const appScopesUpdateWebhookPayloadSchema = scopesUpdateWebhookPayloadSchema;
export type ScopesUpdateWebhookPayload = z.infer<typeof scopesUpdateWebhookPayloadSchema>;

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

  const { payload, session, topic, shop } = webhookContext;

  const parseResult = scopesUpdateWebhookPayloadSchema.safeParse(payload);
  if (!parseResult.success) {
    console.error(`[webhooks.app.scopes_update] MALFORMED_PAYLOAD for ${shop}`);
    return errorResponse(
      new BadRequestError("Invalid scopes update payload", "MALFORMED_PAYLOAD"),
    );
  }

  console.log(`Received ${topic} webhook for ${shop}`);

  const { current } = parseResult.data;
  if (session) {
    await updateSessionScope(session.id, current, { shop });
  }

  return new Response(null, { status: 200 });
};
