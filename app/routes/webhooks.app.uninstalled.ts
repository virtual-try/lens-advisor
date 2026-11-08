import type { ActionFunctionArgs } from "react-router";

import { markShopUninstalled } from "../features/compliance/webhook-handler.server";
import { BadRequestError, errorResponse } from "../shared/http/errors.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { topic, shop } = await authenticate.webhook(request);
    if (topic !== "APP_UNINSTALLED" && topic !== "app/uninstalled") {
      return errorResponse(new BadRequestError("Unknown webhook topic", "UNKNOWN_TOPIC"));
    }
    await markShopUninstalled(shop);
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof SyntaxError) {
      return errorResponse(new BadRequestError("Invalid webhook payload", "INVALID_WEBHOOK"));
    }
    return errorResponse(error);
  }
};
