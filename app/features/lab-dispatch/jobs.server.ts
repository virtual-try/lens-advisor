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
 * Production path enqueues { labOrderId } without shopId (R1-F4).
 * Uses repository function getLabOrderShopId to resolve the owning shop by id,
 * then scopes all subsequent repository calls strictly to that shopId (INV-1).
 */
export function createDispatchHandler(deps: DispatchServiceDeps = {}) {
  return async (payload: DispatchJobPayload): Promise<void> => {
    const db = deps.db ?? getPrisma();

    // R1-F4: Resolve owning shop by id through repository function
    const targetShopId = await getLabOrderShopId(payload.labOrderId, db);
    if (!targetShopId) {
      // Lab order not found: log ID only (INV-2)
      console.warn(`[lab-dispatch] labOrder ${payload.labOrderId} not found`);
      return;
    }

    try {
      await processDispatch(targetShopId, payload.labOrderId, deps);
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
