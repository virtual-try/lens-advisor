import { getPrisma } from "../../shared/container/prisma.server";
import { defineJob } from "../../shared/queue/define-job";
import {
  DISPATCH_JOB_NAME,
  dispatchJobPayloadSchema,
  type DispatchJobPayload,
} from "../lab-orders/constants";
import {
  DispatchInProgressError,
  processDispatch,
  type DispatchServiceDeps,
} from "./dispatch.service.server";
import { getLabOrderShopId } from "./lab-dispatch.repository.server";

export { DISPATCH_JOB_NAME, dispatchJobPayloadSchema, type DispatchJobPayload };

/**
 * Creates the dispatch job worker handler with optional injected dependencies.
 * Consumes { shopId, labOrderId } from verified job payload (INV-1).
 * Verifies tenant ownership via getLabOrderShopId(shopId, labOrderId, db)
 * before processing the dispatch.
 */
export function createDispatchHandler(deps: DispatchServiceDeps = {}) {
  return async (payload: DispatchJobPayload): Promise<void> => {
    const db = deps.db ?? getPrisma();

    // Verify tenant ownership via scoped query { id, shopId } (INV-1)
    const targetShopId = await getLabOrderShopId(
      payload.shopId,
      payload.labOrderId,
      db,
    );
    if (!targetShopId) {
      // Lab order not found for this shop: log IDs only (INV-2)
      console.warn(
        `[lab-dispatch] labOrder ${payload.labOrderId} not found for shop ${payload.shopId}`,
      );
      return;
    }

    try {
      await processDispatch(payload.shopId, payload.labOrderId, deps);
    } catch (err: unknown) {
      if (err instanceof DispatchInProgressError) {
        // R3-F1: Worker met fresh SENDING lease. Delayed dispatch was enqueued
        // with startAfter = lease expiry + margin. Complete without burning retries.
        return;
      }
      throw err;
    }
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
