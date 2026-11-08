import { z } from "zod";
import { getPrisma } from "../../shared/container/prisma.server";
import { defineJob } from "../../shared/queue/define-job";
import { DISPATCH_JOB_NAME } from "../lab-orders/constants";
import {
  processDispatch,
  type DispatchServiceDeps,
} from "./dispatch.service.server";

export { DISPATCH_JOB_NAME };

/**
 * Payload schema for lab-orders.dispatch.
 * INV-2: Payloads carry only ids/enums. Numeric order id / cuid only.
 * shopId is optional in the payload for backwards-compatibility with spec 23 producer.
 */
export const dispatchJobPayloadSchema = z.object({
  labOrderId: z.string(),
  shopId: z.string().optional(),
});
export type DispatchJobPayload = z.infer<typeof dispatchJobPayloadSchema>;

/**
 * Creates the dispatch job worker handler with optional injected dependencies.
 */
export function createDispatchHandler(deps: DispatchServiceDeps = {}) {
  return async (payload: DispatchJobPayload): Promise<void> => {
    const db = deps.db ?? getPrisma();
    let targetShopId = payload.shopId;

    if (!targetShopId) {
      const order = await db.labOrder.findUnique({
        where: { id: payload.labOrderId },
        select: { shopId: true },
      });
      if (!order) {
        // Lab order not found: log ID only (INV-2)
        console.warn(`[lab-dispatch] labOrder ${payload.labOrderId} not found`);
        return;
      }
      targetShopId = order.shopId;
    } else {
      // Row 6 check: If shopId was specified in the payload (e.g. job for shop A),
      // verify that labOrderId belongs to shop A!
      const order = await db.labOrder.findFirst({
        where: { shopId: targetShopId, id: payload.labOrderId },
        select: { id: true },
      });
      if (!order) {
        // INV-1: labOrderId of shop B in job for shop A -> handler loads nothing, logs id only
        console.warn(
          `[lab-dispatch] labOrderId ${payload.labOrderId} does not belong to shop ${targetShopId}`,
        );
        return;
      }
    }

    await processDispatch(targetShopId, payload.labOrderId, deps);
  };
}

/**
 * Job definition for lab-orders.dispatch (Spec 30 Scope):
 * Registers the executable handler for spec 23's lab-orders.dispatch (payload { labOrderId }),
 * retry 5 with backoff.
 */
export const dispatchJob = defineJob({
  name: DISPATCH_JOB_NAME,
  schema: dispatchJobPayloadSchema,
  retry: {
    retryLimit: 5,
    retryDelay: 2,
    retryBackoff: true,
  },
  handler: createDispatchHandler(),
});
