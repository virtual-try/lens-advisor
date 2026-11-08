import { buildRxPrefix, buildShopPrefix } from "../../shared/storage/object-store.server";
import type { ComplianceDeps } from "./deps.server";
import { shopOwnedModelDeleteOrder } from "./models.server";
import {
  complianceRequestHandled,
  deletePrescriptions,
  findPrescriptionsForOrders,
  findShopById,
  markComplianceRequestHandled,
  nullLabOrderPrescriptions,
  type ComplianceDb,
} from "./repository.server";
import type { CustomersRedactPayload, ShopRedactPayload } from "./schema";

type ShopDeleter = {
  deleteMany(args: { where: { shopId: string } }): Promise<unknown>;
};

/**
 * Deletes one shop's rows in FK order, then its sessions, inside the caller's
 * transaction. Session is keyed by domain, not shopId.
 */
export async function deleteShopOwnedRows(
  tx: ComplianceDb,
  shopId: string,
  domain: string,
): Promise<void> {
  for (const modelName of shopOwnedModelDeleteOrder()) {
    if (modelName === "Shop") {
      await tx.shop.deleteMany({ where: { id: shopId } });
      continue;
    }
    await shopDelegate(tx, modelName).deleteMany({ where: { shopId } });
  }
  await tx.session.deleteMany({ where: { shop: domain } });
}

export async function runCustomersRedact(
  deps: ComplianceDeps,
  payload: CustomersRedactPayload,
): Promise<void> {
  const { prisma, objectStore } = deps;
  const { shopId, orderIds, complianceRequestId } = payload;
  if (await complianceRequestHandled(prisma, shopId, complianceRequestId)) return;

  const prescriptions = await findPrescriptionsForOrders(prisma, shopId, orderIds);
  // Objects go first. A crash here leaves the rows, so a retry deletes the same
  // prefixes (already-deleted objects are a no-op) and then commits the database.
  // handledAt flips only in that transaction: the job is unfinished until both succeed.
  for (const prescription of prescriptions) {
    await objectStore.deletePrefix(buildRxPrefix(shopId, prescription.id));
  }

  const prescriptionIds = prescriptions.map((prescription) => prescription.id);
  await prisma.$transaction(async (tx) => {
    await nullLabOrderPrescriptions(tx, shopId, orderIds, prescriptionIds);
    await deletePrescriptions(tx, shopId, prescriptionIds);
    await markComplianceRequestHandled(tx, shopId, complianceRequestId);
  });
}

export async function runShopRedact(deps: ComplianceDeps, payload: ShopRedactPayload): Promise<void> {
  const shop = await findShopById(deps.prisma, payload.shopId);
  // Rows commit first. If the prefix delete then throws, the shop row is gone
  // and a retry skips this transaction and deletes the prefix. Deleting an
  // already-deleted prefix is a no-op. The handler returns only after both succeed.
  if (shop) {
    await deps.prisma.$transaction(async (tx) => {
      await deleteShopOwnedRows(tx, shop.id, shop.domain);
    });
  }
  await deps.objectStore.deletePrefix(buildShopPrefix(payload.shopId));
}

function shopDelegate(tx: ComplianceDb, modelName: string): ShopDeleter {
  const key = modelName.slice(0, 1).toLowerCase() + modelName.slice(1);
  const delegate = (tx as unknown as Record<string, ShopDeleter | undefined>)[key];
  if (!delegate || typeof delegate.deleteMany !== "function") {
    throw new Error("Shop redaction model is not available");
  }
  return delegate;
}
