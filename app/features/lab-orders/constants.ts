import { z } from "zod";

export const INTAKE_JOB_NAME = "lab-orders.intake";
export const DISPATCH_JOB_NAME = "lab-orders.dispatch";

export function toOrderGid(id: string): string {
  if (id.startsWith("gid://shopify/Order/")) {
    return id;
  }
  return `gid://shopify/Order/${id}`;
}

export function fromOrderGid(gidOrId: string): string {
  if (gidOrId.startsWith("gid://shopify/Order/")) {
    return gidOrId.replace("gid://shopify/Order/", "");
  }
  return gidOrId;
}

/**
 * Payload schema for lab-orders.dispatch.
 * INV-2: Payloads carry only ids/enums. All string fields end in *Id.
 */
export const dispatchJobPayloadSchema = z.object({
  labOrderId: z.string(),
});
export type DispatchJobPayload = z.infer<typeof dispatchJobPayloadSchema>;
