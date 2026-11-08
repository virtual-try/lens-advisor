import type { FieldCipher } from "../../shared/crypto/field-cipher.server";
import type { ComplianceDeps, ComplianceLogFields } from "./deps.server";
import {
  complianceRequestHandled,
  findPrescriptionsForOrders,
  findShopById,
  markComplianceRequestHandled,
} from "./repository.server";
import type { CustomersDataRequestPayload } from "./schema";

const DATA_REQUEST_EVENT = "compliance.customers-data-request";
const DATA_REQUEST_SUBJECT = "Customer data request";
const DATA_REQUEST_TEXT =
  "A customer asked for a copy of their data. The attached JSON file lists the prescriptions stored for the requested orders.";

export async function runCustomersDataRequest(
  deps: ComplianceDeps,
  payload: CustomersDataRequestPayload,
): Promise<void> {
  const { prisma, cipher, mailer, logger, shopContactEmail } = deps;
  const { shopId, complianceRequestId, orderIds } = payload;
  if (await complianceRequestHandled(prisma, shopId, complianceRequestId)) return;

  const shop = await findShopById(prisma, shopId);
  if (!shop) return;

  const email = await shopContactEmail(shop.domain);
  if (!email) {
    throw new Error("Shop contact email is unavailable");
  }

  const prescriptions = await findPrescriptionsForOrders(prisma, shopId, orderIds);
  const exported = prescriptions.map((prescription) => ({
    id: prescription.id,
    orderId: prescription.orderId,
    rxType: prescription.rxType,
    source: prescription.source,
    prescription: readPrescription(cipher, prescription.cipher, `${shopId}:${prescription.id}`),
  }));

  const fields: ComplianceLogFields = {
    shopId,
    complianceRequestId,
    customerId: payload.customerId,
    orderIds,
    prescriptionIds: prescriptions.map((prescription) => prescription.id),
  };
  logger.info(DATA_REQUEST_EVENT, fields);

  const attachment = {
    shopId,
    shopDomain: shop.domain,
    customerId: payload.customerId ?? null,
    orderIds,
    prescriptions: exported,
  };

  await mailer.send({
    to: email,
    subject: DATA_REQUEST_SUBJECT,
    text: DATA_REQUEST_TEXT,
    attachments: [
      {
        filename: "customer-data-request.json",
        content: Buffer.from(JSON.stringify(attachment), "utf8"),
        contentType: "application/json",
      },
    ],
    idempotencyKey: complianceRequestId,
  });

  await markComplianceRequestHandled(prisma, shopId, complianceRequestId);
}

function readPrescription(cipher: FieldCipher, token: string, aad: string): unknown {
  try {
    return cipher.decrypt(token, aad);
  } catch {
    throw new Error("Prescription could not be read");
  }
}
