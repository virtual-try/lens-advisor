import { z } from "zod";

import { BadRequestError, UnauthorizedError, errorResponse } from "../../shared/http/errors.server";
import { registerJob, type AnyJobDefinition } from "../../shared/queue/define-job";
import { resolveComplianceDeps, resolveCompliancePrisma } from "./deps.server";
import {
  customersDataRequestJob,
  customersRedactJob,
  shopRedactJob,
} from "./jobs.server";
import {
  complianceRequestHandled,
  deleteUnfinishedComplianceRequest,
  findShopByDomain,
  insertComplianceRequest,
} from "./repository.server";
import {
  complianceTopic,
  customersDataRequestBody,
  customersRedactBody,
  orderIdsFrom,
  shopRedactBody,
  toId,
  type ComplianceTopic,
} from "./schema";

const WEBHOOK_ID = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export type VerifiedWebhook = {
  topic: string;
  shop: string;
  webhookId: string;
  payload: unknown;
};

/**
 * `authenticate.webhook` throws an empty Response for a bad signature (401) or
 * other webhook-auth rejection (400). INV-6 requires the canonical error body.
 * Any other Response, including 405, is left untouched.
 */
export function authenticationErrorResponse(error: unknown): Response | undefined {
  if (!(error instanceof Response)) return undefined;
  if (error.status === 401) return errorResponse(new UnauthorizedError());
  if (error.status === 400) return errorResponse(new BadRequestError());
  return undefined;
}

export async function handleComplianceWebhook(input: VerifiedWebhook): Promise<Response> {
  const topic = complianceTopic(input.topic);
  if (!topic) {
    throw new BadRequestError("Unknown webhook topic", "UNKNOWN_TOPIC");
  }

  const webhookId = WEBHOOK_ID.safeParse(input.webhookId);
  if (!webhookId.success) {
    throw new BadRequestError("Invalid webhook payload", "INVALID_WEBHOOK");
  }

  const parsed = parseTopicBody(topic, input.payload);
  const deps = await resolveComplianceDeps();
  const shop = await findShopByDomain(deps.prisma, input.shop);
  if (!shop) {
    return new Response(null, { status: 200 });
  }

  const inserted = await insertComplianceRequest(deps.prisma, {
    shopId: shop.id,
    topic,
    shopifyRequestId: webhookId.data,
  });
  // A duplicate whose row is already handled is a pure no-op. An unfinished
  // duplicate is enqueued again with the same singleton key (INV-8): a crash
  // after insert and before enqueue must not ack the webhook with no job.
  const unfinished =
    inserted.created ||
    (inserted.id.length > 0 &&
      !(await complianceRequestHandled(deps.prisma, shop.id, inserted.id)));
  if (!unfinished) {
    return new Response(null, { status: 200 });
  }

  const job = jobFor(topic);
  registerJob(job.definition);
  try {
    await deps.queue.enqueue(job.definition.name, job.payload(shop.id, inserted.id, parsed), {
      singletonKey: webhookId.data,
    });
  } catch (error) {
    if (inserted.created) {
      await deleteUnfinishedComplianceRequest(deps.prisma, shop.id, inserted.id).catch(
        () => undefined,
      );
    }
    throw error;
  }

  return new Response(null, { status: 200 });
}

/**
 * Marks the shop uninstalled and deletes its sessions. Catalog and prescription
 * rows stay until `shop/redact`. A second delivery does not move `uninstalledAt`.
 */
export async function markShopUninstalled(shopDomain: string): Promise<void> {
  const prisma = resolveCompliancePrisma();
  await prisma.$transaction(async (tx) => {
    await tx.shop.updateMany({
      where: { domain: shopDomain, uninstalledAt: null },
      data: { uninstalledAt: new Date() },
    });
    await tx.session.deleteMany({ where: { shop: shopDomain } });
  });
}

type ParsedBody =
  | { kind: "orders"; orderIds: string[]; customerId?: string }
  | { kind: "shop" };

function parseTopicBody(topic: ComplianceTopic, payload: unknown): ParsedBody {
  if (topic === "customers/redact") {
    const body = parseBody(customersRedactBody, payload);
    return {
      kind: "orders",
      orderIds: orderIdsFrom(body.orders_to_redact),
      ...(body.customer ? { customerId: toId(body.customer.id) } : {}),
    };
  }
  if (topic === "customers/data_request") {
    const body = parseBody(customersDataRequestBody, payload);
    return {
      kind: "orders",
      orderIds: orderIdsFrom(body.orders_requested),
      ...(body.customer ? { customerId: toId(body.customer.id) } : {}),
    };
  }
  parseBody(shopRedactBody, payload);
  return { kind: "shop" };
}

function parseBody<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  throw new BadRequestError(
    "Invalid webhook payload",
    "INVALID_WEBHOOK",
    result.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.join(".") || "payload",
      code: issue.code.toUpperCase(),
    })),
  );
}

function jobFor(topic: ComplianceTopic): {
  definition: AnyJobDefinition;
  payload: (
    shopId: string,
    complianceRequestId: string,
    body: ParsedBody,
  ) => Record<string, unknown>;
} {
  if (topic === "customers/redact") {
    return {
      definition: customersRedactJob,
      payload: (shopId, complianceRequestId, body) => orderPayload(shopId, complianceRequestId, body),
    };
  }
  if (topic === "customers/data_request") {
    return {
      definition: customersDataRequestJob,
      payload: (shopId, complianceRequestId, body) => orderPayload(shopId, complianceRequestId, body),
    };
  }
  return {
    definition: shopRedactJob,
    payload: (shopId, complianceRequestId) => ({ complianceRequestId, shopId }),
  };
}

function orderPayload(
  shopId: string,
  complianceRequestId: string,
  body: ParsedBody,
): Record<string, unknown> {
  if (body.kind !== "orders") {
    throw new BadRequestError("Invalid webhook payload", "INVALID_WEBHOOK");
  }
  return {
    complianceRequestId,
    shopId,
    orderIds: body.orderIds,
    ...(body.customerId ? { customerId: body.customerId } : {}),
  };
}
