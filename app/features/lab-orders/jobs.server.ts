import { z } from "zod";
import { defineJob } from "../../shared/queue/define-job";
import { createIntakeService } from "./intake.service.server";

export const INTAKE_JOB_NAME = "lab-orders.intake";
export const DISPATCH_JOB_NAME = "lab-orders.dispatch";

/**
 * Payload schema for lab-orders.intake.
 * INV-2: Payloads carry only ids/enums. All string fields end in *Id.
 */
export const intakeJobPayloadSchema = z.object({
  shopId: z.string(),
  shopifyOrderId: z.string(),
});
export type IntakeJobPayload = z.infer<typeof intakeJobPayloadSchema>;

/**
 * Payload schema for lab-orders.dispatch.
 * INV-2: Payloads carry only ids/enums. All string fields end in *Id.
 */
export const dispatchJobPayloadSchema = z.object({
  labOrderId: z.string(),
});
export type DispatchJobPayload = z.infer<typeof dispatchJobPayloadSchema>;

export const intakeJob = defineJob({
  name: INTAKE_JOB_NAME,
  schema: intakeJobPayloadSchema,
  retry: {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
  },
  handler: async (payload) => {
    const service = createIntakeService();
    await service.processOrderIntake(payload.shopId, payload.shopifyOrderId);
  },
});

export const dispatchJob = defineJob({
  name: DISPATCH_JOB_NAME,
  schema: dispatchJobPayloadSchema,
  retry: {
    retryLimit: 3,
    retryDelay: 2,
    retryBackoff: true,
  },
  handler: async () => {
    // Stubbed until spec 30 — test code only: the lab-orders.dispatch handler; tests assert it was enqueued.
  },
});
