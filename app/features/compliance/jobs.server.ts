import { defineJob } from "../../shared/queue/define-job";
import { runCustomersDataRequest } from "./data-request.server";
import { resolveComplianceDeps } from "./deps.server";
import { runCustomersRedact, runShopRedact } from "./redact.server";
import {
  customersDataRequestJobSchema,
  customersRedactJobSchema,
  shopRedactJobSchema,
} from "./schema";

export const customersRedactJob = defineJob({
  name: "compliance.customers-redact",
  schema: customersRedactJobSchema,
  handler: async (payload) => {
    await runCustomersRedact(await resolveComplianceDeps(), payload);
  },
});

export const customersDataRequestJob = defineJob({
  name: "compliance.customers-data-request",
  schema: customersDataRequestJobSchema,
  handler: async (payload) => {
    await runCustomersDataRequest(await resolveComplianceDeps(), payload);
  },
});

export const shopRedactJob = defineJob({
  name: "compliance.shop-redact",
  schema: shopRedactJobSchema,
  handler: async (payload) => {
    await runShopRedact(await resolveComplianceDeps(), payload);
  },
});
