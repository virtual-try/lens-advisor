import type { ActionFunctionArgs } from "react-router";

import {
  authenticationErrorResponse,
  handleComplianceWebhook,
} from "../features/compliance/webhook-handler.server";
import { BadRequestError, errorResponse } from "../shared/http/errors.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop, webhookId, payload } = await authenticate.webhook(request);
    return await handleComplianceWebhook({ topic, shop, webhookId, payload });
  } catch (error) {
    const authenticationFailure = authenticationErrorResponse(error);
    if (authenticationFailure) return authenticationFailure;
    if (error instanceof Response) throw error;
    if (error instanceof SyntaxError) {
      return errorResponse(new BadRequestError("Invalid webhook payload", "INVALID_WEBHOOK"));
    }
    return errorResponse(error);
  }
};
