import type { PrismaClient } from "@prisma/client";

import { readBundleProperties } from "../../../packages/rx-core/src/cart/bundle-properties.js";
import { checkLens } from "../../../packages/rx-core/src/limits/index.js";
import type { Prescription, RxType } from "../../../packages/rx-core/src/types/index.js";
import { getCipher } from "../../shared/container/cipher.server";
import { getPrisma } from "../../shared/container/prisma.server";
import { getQueue } from "../../shared/container/queue.server";
import type { FieldCipher } from "../../shared/crypto/field-cipher.server";
import type { Queue } from "../../shared/queue/queue";
import { unauthenticated } from "../../shopify.server";
import {
  attachOrder,
  getPrescriptionById,
  type PrescriptionRecord,
} from "../prescriptions/prescriptions.repository.server";
import {
  DISPATCH_JOB_NAME,
  fromOrderGid,
  toOrderGid,
} from "./constants";
import {
  type LabOrderRecord,
  upsertLabOrder,
} from "./lab-orders.repository.server";

export { fromOrderGid, toOrderGid };

export const ORDER_INTAKE_QUERY = `#graphql
query getOrderForIntake($id: ID!, $cursor: String) {
  order(id: $id) {
    id
    name
    lineItems(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        sku
        customAttributes {
          key
          value
        }
      }
    }
  }
}
`;

export interface RawCustomAttribute {
  key?: string;
  name?: string;
  value?: unknown;
}

export interface RawLineItem {
  id?: string;
  title?: string;
  sku?: string | null;
  customAttributes?: RawCustomAttribute[] | { nodes?: RawCustomAttribute[] };
  properties?: RawCustomAttribute[] | Record<string, unknown>;
}

export function extractAttributesRecord(item: RawLineItem): Record<string, string> {
  const result: Record<string, string> = {};

  if (item.properties && !Array.isArray(item.properties) && typeof item.properties === "object") {
    for (const [key, val] of Object.entries(item.properties)) {
      if (val !== undefined && val !== null) {
        result[key] = String(val);
      }
    }
  }

  const customAttrs = Array.isArray(item.customAttributes)
    ? item.customAttributes
    : (item.customAttributes?.nodes ?? []);

  for (const attr of customAttrs) {
    const k = attr.key ?? attr.name;
    if (k && attr.value !== undefined && attr.value !== null) {
      result[k] = String(attr.value);
    }
  }

  if (Array.isArray(item.properties)) {
    for (const prop of item.properties) {
      const k = prop.name ?? prop.key;
      if (k && prop.value !== undefined && prop.value !== null) {
        result[k] = String(prop.value);
      }
    }
  }

  return result;
}

export interface GraphQLAdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<unknown>;
}

export interface IntakeServiceDeps {
  db?: PrismaClient;
  cipher?: FieldCipher;
  queue?: Queue;
  adminClient?: GraphQLAdminClient;
}

export interface ProcessOrderIntakeResult {
  ok: boolean;
  labOrders: LabOrderRecord[];
  reason?: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function executeGraphQL<T>(
  admin: GraphQLAdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  let json: GraphQLResponse<T>;
  if (typeof (response as { json?: () => Promise<GraphQLResponse<T>> }).json === "function") {
    json = await (response as { json: () => Promise<GraphQLResponse<T>> }).json();
  } else {
    json = response as GraphQLResponse<T>;
  }

  if (json.errors && json.errors.length > 0) {
    throw new Error(json.errors[0]?.message ?? "GraphQL error");
  }
  if (!json.data) {
    throw new Error("No data returned from Shopify GraphQL");
  }
  return json.data;
}

export class IntakeService {
  private readonly db: PrismaClient;
  private readonly cipher: FieldCipher;
  private queue: Queue | null;
  private readonly customAdminClient?: GraphQLAdminClient;

  constructor(deps: IntakeServiceDeps = {}) {
    this.db = deps.db ?? getPrisma();
    this.cipher = deps.cipher ?? getCipher();
    this.queue = deps.queue ?? null;
    this.customAdminClient = deps.adminClient;
  }

  private async getQueueInstance(): Promise<Queue> {
    if (!this.queue) {
      this.queue = await getQueue();
    }
    return this.queue;
  }

  /**
   * Processes an order intake for a shop domain and Shopify order ID.
   * Resolves shop tenancy by domain only (INV-1, R2-F9), fetches line items via Admin GraphQL,
   * groups by _bundle_id, verifies prescription and lens/options tenancy (INV-1, R2-F1),
   * checks Rx limits, upserts LabOrder rows, and enqueues dispatch jobs.
   */
  async processOrderIntake(
    shopDomain: string,
    shopifyOrderId: string,
  ): Promise<ProcessOrderIntakeResult> {
    // 1. Resolve Shop by domain only (INV-1, R2-F9)
    const shop = await this.db.shop.findUnique({
      where: { domain: shopDomain },
    });

    if (!shop) {
      return { ok: false, reason: "SHOP_NOT_FOUND", labOrders: [] };
    }

    // 2. Resolve Admin API client
    let admin = this.customAdminClient;
    if (!admin) {
      const { admin: unauthAdmin } = await unauthenticated.admin(shop.domain);
      admin = unauthAdmin;
    }

    // 3. Fetch Order from Shopify Admin GraphQL (with cursor pagination)
    const orderGid = toOrderGid(shopifyOrderId);
    const rawLineItems: RawLineItem[] = [];
    let orderName: string | undefined;
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const variables: Record<string, unknown> = { id: orderGid };
      if (cursor) {
        variables.cursor = cursor;
      }

      const data = await executeGraphQL<{
        order?: {
          id?: string;
          name?: string;
          lineItems?: {
            pageInfo?: {
              hasNextPage?: boolean;
              endCursor?: string | null;
            };
            nodes?: Array<RawLineItem>;
          } | Array<RawLineItem>;
          line_items?: Array<RawLineItem>;
        };
      }>(admin, ORDER_INTAKE_QUERY, variables);

      const order = data.order;
      if (!order) {
        if (rawLineItems.length === 0) {
          return { ok: false, reason: "ORDER_NOT_FOUND", labOrders: [] };
        }
        // Null order on page two or later must throw so pg-boss retries (R2-F10)
        throw new Error("Order returned null during pagination");
      }

      if (!orderName && order.name) {
        orderName = order.name;
      }

      const connection = order.lineItems;
      if (Array.isArray(connection)) {
        rawLineItems.push(...connection);
        hasNextPage = false;
      } else if (connection && "nodes" in connection && Array.isArray(connection.nodes)) {
        rawLineItems.push(...connection.nodes);
        const pageInfo = connection.pageInfo;
        if (pageInfo?.hasNextPage && pageInfo.endCursor) {
          cursor = pageInfo.endCursor;
          hasNextPage = true;
        } else {
          hasNextPage = false;
        }
      } else if (Array.isArray(order.line_items)) {
        rawLineItems.push(...order.line_items);
        hasNextPage = false;
      } else {
        hasNextPage = false;
      }
    }

    orderName = orderName ?? `#${fromOrderGid(shopifyOrderId)}`;

    // 4. Group lines by _bundle_id
    const bundleMap = new Map<string, RawLineItem[]>();
    for (const item of rawLineItems) {
      const attrs = extractAttributesRecord(item);
      const parsed = readBundleProperties(attrs);
      if (parsed.bundleId) {
        const existing = bundleMap.get(parsed.bundleId) ?? [];
        existing.push(item);
        bundleMap.set(parsed.bundleId, existing);
      }
    }

    // If no bundle lines found, no rows written, job completes (Row 6)
    if (bundleMap.size === 0) {
      return { ok: true, labOrders: [] };
    }

    const labOrders: LabOrderRecord[] = [];
    const queue = await this.getQueueInstance();

    // 5. Process each bundle
    for (const [bundleId, bundleLines] of bundleMap.entries()) {
      // Find frame line within bundle using spec 03's readBundleProperties
      const frameLine: RawLineItem | undefined = bundleLines.find((line) => {
        const attrs = extractAttributesRecord(line);
        const parsed = readBundleProperties(attrs);
        return parsed.role === "frame";
      });

      const frameTitle = frameLine?.title ?? bundleLines[0]?.title ?? "Frame";
      const frameSku = frameLine?.sku ?? null;

      // Find lens line
      const lensLine = bundleLines.find((line) => {
        const attrs = extractAttributesRecord(line);
        const parsed = readBundleProperties(attrs);
        return parsed.role === "lens";
      });

      // Bundle with no lens line -> write FAILED row with error code (R2-F2)
      if (!lensLine) {
        const labOrder = await upsertLabOrder(this.db, shop.id, {
          shopifyOrderId,
          orderName,
          bundleId,
          prescriptionId: null,
          lensId: null,
          optionValueIds: [],
          addOnIds: [],
          frameTitle,
          frameSku,
          rxOutOfLimits: false,
          status: "FAILED",
          lastErrorCode: "NO_LENS_IN_BUNDLE",
        });
        labOrders.push(labOrder);
        continue;
      }

      const lensAttrs = extractAttributesRecord(lensLine);
      const lensProps = readBundleProperties(lensAttrs);
      const lensId = lensProps.itemId;

      // Bundle with lens line but no _item_id -> write FAILED row with error code (R2-F2)
      if (!lensId) {
        const labOrder = await upsertLabOrder(this.db, shop.id, {
          shopifyOrderId,
          orderName,
          bundleId,
          prescriptionId: null,
          lensId: null,
          optionValueIds: [],
          addOnIds: [],
          frameTitle,
          frameSku,
          rxOutOfLimits: false,
          status: "FAILED",
          lastErrorCode: "LENS_NOT_FOUND",
        });
        labOrders.push(labOrder);
        continue;
      }

      // Collect option IDs & add-on IDs
      const optionIdsSet = new Set(lensProps.optionIds ?? []);
      const addonIdsSet = new Set(lensProps.addonIds ?? []);

      for (const line of bundleLines) {
        const lineAttrs = extractAttributesRecord(line);
        const lineProps = readBundleProperties(lineAttrs);
        if (lineProps.role === "option" && lineProps.itemId) {
          optionIdsSet.add(lineProps.itemId);
        }
        if (lineProps.role === "addon" && lineProps.itemId) {
          addonIdsSet.add(lineProps.itemId);
        }
      }

      const optionValueIds = Array.from(optionIdsSet);
      const addOnIds = Array.from(addonIdsSet);

      // Verify Lens belongs to this shop (INV-1, R2-F1)
      const lens = await this.db.lens.findUnique({
        where: {
          shopId_id: {
            shopId: shop.id,
            id: lensId,
          },
        },
      });

      if (!lens) {
        const labOrder = await upsertLabOrder(this.db, shop.id, {
          shopifyOrderId,
          orderName,
          bundleId,
          prescriptionId: null,
          lensId: null,
          optionValueIds,
          addOnIds,
          frameTitle,
          frameSku,
          rxOutOfLimits: false,
          status: "FAILED",
          lastErrorCode: "LENS_NOT_FOUND",
        });
        labOrders.push(labOrder);
        continue;
      }

      // Verify Option Values belong to this shop (INV-1, R2-F1)
      if (optionValueIds.length > 0) {
        const validOptions = await this.db.optionValue.findMany({
          where: {
            shopId: shop.id,
            id: { in: optionValueIds },
          },
          select: { id: true },
        });
        if (validOptions.length !== optionValueIds.length) {
          const labOrder = await upsertLabOrder(this.db, shop.id, {
            shopifyOrderId,
            orderName,
            bundleId,
            prescriptionId: null,
            lensId: lens.id,
            optionValueIds,
            addOnIds,
            frameTitle,
            frameSku,
            rxOutOfLimits: false,
            status: "FAILED",
            lastErrorCode: "OPTION_NOT_FOUND",
          });
          labOrders.push(labOrder);
          continue;
        }
      }

      // Verify Add-Ons belong to this shop (INV-1, R2-F1)
      if (addOnIds.length > 0) {
        const validAddons = await this.db.addOn.findMany({
          where: {
            shopId: shop.id,
            id: { in: addOnIds },
          },
          select: { id: true },
        });
        if (validAddons.length !== addOnIds.length) {
          const labOrder = await upsertLabOrder(this.db, shop.id, {
            shopifyOrderId,
            orderName,
            bundleId,
            prescriptionId: null,
            lensId: lens.id,
            optionValueIds,
            addOnIds,
            frameTitle,
            frameSku,
            rxOutOfLimits: false,
            status: "FAILED",
            lastErrorCode: "OPTION_NOT_FOUND",
          });
          labOrders.push(labOrder);
          continue;
        }
      }

      const rxRef = lensProps.rxRef;

      // Check rxRef existence and tenancy (INV-1)
      let prescription: PrescriptionRecord | null = null;
      if (rxRef) {
        prescription = await getPrescriptionById(this.db, shop.id, rxRef);
      }

      // If rxRef is missing, belongs to another shop, or not found:
      if (!prescription) {
        const labOrder = await upsertLabOrder(this.db, shop.id, {
          shopifyOrderId,
          orderName,
          bundleId,
          prescriptionId: null,
          lensId: lens.id,
          optionValueIds,
          addOnIds,
          frameTitle,
          frameSku,
          rxOutOfLimits: false,
          status: "FAILED",
          lastErrorCode: "RX_NOT_FOUND",
        });
        labOrders.push(labOrder);
        // Do NOT dispatch
        continue;
      }

      // Prescription exists and belongs to this shop
      await attachOrder(this.db, shop.id, prescription.id, shopifyOrderId);

      // Evaluate limits check (INV-2, INV-5)
      let rxOutOfLimits = false;
      if (prescription.source === "MANUAL") {
        const aad = `${shop.id}:${prescription.id}`;
        const decryptedRx = this.cipher.decrypt(prescription.cipher, aad);

        const checkResult = checkLens(
          decryptedRx as Prescription,
          prescription.rxType as RxType,
          {
            limits: {
              sphMin: lens.sphMin,
              sphMax: lens.sphMax,
              cylMin: lens.cylMin,
              cylMax: lens.cylMax,
              addMin: lens.addMin ?? undefined,
              addMax: lens.addMax ?? undefined,
              rxTypes: lens.rxTypes as RxType[],
            },
          },
        );
        rxOutOfLimits = !checkResult.available;
      }

      // Upsert LabOrder (atomic unique statement on unique key)
      const labOrder = await upsertLabOrder(this.db, shop.id, {
        shopifyOrderId,
        orderName,
        bundleId,
        prescriptionId: prescription.id,
        lensId: lens.id,
        optionValueIds,
        addOnIds,
        frameTitle,
        frameSku,
        rxOutOfLimits,
        status: "PENDING",
        lastErrorCode: null,
      });

      labOrders.push(labOrder);

      // Enqueue lab-orders.dispatch job only if the order is in PENDING status (R1-F3, Spec 37 INV-1)
      if (labOrder.status === "PENDING") {
        await queue.enqueue(
          DISPATCH_JOB_NAME,
          { shopId: shop.id, labOrderId: labOrder.id },
          { singletonKey: labOrder.id },
        );
      }
    }

    return { ok: true, labOrders };
  }
}

export function createIntakeService(deps: IntakeServiceDeps = {}): IntakeService {
  return new IntakeService(deps);
}
