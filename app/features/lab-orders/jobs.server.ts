import { z } from "zod";
import { defineJob } from "../../shared/queue/define-job";
import {
  DISPATCH_JOB_NAME,
  dispatchJobPayloadSchema,
  type DispatchJobPayload,
  INTAKE_JOB_NAME,
} from "./constants";
import { createIntakeService } from "./intake.service.server";

export {
  DISPATCH_JOB_NAME,
  dispatchJobPayloadSchema,
  type DispatchJobPayload,
  INTAKE_JOB_NAME,
};

/**
 * Payload schema for lab-orders.intake.
 * INV-2: Payloads carry only ids/enums. Numeric order id required (R2-F8).
 * shopDomain carries the verified shop domain (R2-F9).
 */
export const intakeJobPayloadSchema = z.object({
  shopDomain: z.string().min(1),
  shopifyOrderId: z.string().regex(/^\d+$/),
});
export type IntakeJobPayload = z.infer<typeof intakeJobPayloadSchema>;

export const intakeJob = defineJob({
  name: INTAKE_JOB_NAME,
  schema: intakeJobPayloadSchema,
  allowStringFields: ["shopDomain"],
  retry: {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
  },
  handler: async (payload) => {
    const service = createIntakeService();
    const result = await service.processOrderIntake(
      payload.shopDomain,
      payload.shopifyOrderId,
    );
    if (!result.ok) {
      throw new Error(`Order intake failed: ${result.reason}`);
    }
  },
});

/**
 * Producer definition for lab-orders.dispatch.
 * Registers the queue and validates payloads on enqueue; the executable handler
 * is exported by spec 30 (app/features/lab-dispatch/jobs.server.ts).
 */
export const dispatchJob = defineJob({
  name: DISPATCH_JOB_NAME,
  schema: dispatchJobPayloadSchema,
  retry: {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
  },
});
