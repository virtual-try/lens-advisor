import { z } from "zod";

/** Shopify can send every order id for one customer. Above this the webhook is rejected. */
export const MAX_ORDER_IDS = 10_000;

export const COMPLIANCE_TOPICS = [
  "customers/redact",
  "customers/data_request",
  "shop/redact",
] as const;

export type ComplianceTopic = (typeof COMPLIANCE_TOPICS)[number];

const STORAGE_TOPIC: Record<string, ComplianceTopic> = {
  CUSTOMERS_REDACT: "customers/redact",
  "customers/redact": "customers/redact",
  CUSTOMERS_DATA_REQUEST: "customers/data_request",
  "customers/data_request": "customers/data_request",
  SHOP_REDACT: "shop/redact",
  "shop/redact": "shop/redact",
};

/** `authenticate.webhook` reports the storage form (`CUSTOMERS_REDACT`). */
export function complianceTopic(topic: string): ComplianceTopic | undefined {
  return STORAGE_TOPIC[topic];
}

const idValue = z.union([
  z.string().min(1).max(64),
  z.number().int().nonnegative(),
]);

const orderIdList = z.array(idValue).max(MAX_ORDER_IDS);

export const customersRedactBody = z.object({
  customer: z
    .object({
      id: idValue,
    })
    .optional(),
  orders_to_redact: orderIdList,
});

export const customersDataRequestBody = z.object({
  customer: z
    .object({
      id: idValue,
    })
    .optional(),
  orders_requested: orderIdList,
});

export const shopRedactBody = z.object({
  shop_id: z.union([z.string(), z.number()]).optional(),
  shop_domain: z.string().optional(),
});

export type CustomersRedactBody = z.infer<typeof customersRedactBody>;
export type CustomersDataRequestBody = z.infer<typeof customersDataRequestBody>;

export function toId(value: string | number): string {
  return String(value);
}

export function orderIdsFrom(values: readonly (string | number)[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = toId(value);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Job payloads carry ids only (INV-2). Topic is chosen by which job is enqueued,
 * so it is not a string field on the payload.
 */
export const customersRedactJobSchema = z.object({
  complianceRequestId: z.string(),
  shopId: z.string(),
  orderIds: z.array(z.string()),
  customerId: z.string().optional(),
});

export const customersDataRequestJobSchema = customersRedactJobSchema;

export const shopRedactJobSchema = z.object({
  complianceRequestId: z.string(),
  shopId: z.string(),
});

export type CustomersRedactPayload = z.infer<typeof customersRedactJobSchema>;
export type CustomersDataRequestPayload = z.infer<typeof customersDataRequestJobSchema>;
export type ShopRedactPayload = z.infer<typeof shopRedactJobSchema>;

const mailbox = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isMailbox(value: string): boolean {
  return value.length <= 320 && mailbox.test(value);
}

/**
 * Shop contact from an Admin `shop { contactEmail email }` payload.
 * `contactEmail` wins. Anything that is not a single mailbox is ignored.
 */
export function readShopContactEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const shop = (data as { shop?: unknown }).shop;
  if (typeof shop !== "object" || shop === null) return null;
  const record = shop as { contactEmail?: unknown; email?: unknown };
  for (const candidate of [record.contactEmail, record.email]) {
    if (typeof candidate === "string" && isMailbox(candidate)) return candidate;
  }
  return null;
}
