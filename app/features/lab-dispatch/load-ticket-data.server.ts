import type { Prescription } from "../../../packages/rx-core/src/types/index.js";
import { getCipher } from "../../shared/container/cipher.server";
import { getPrisma } from "../../shared/container/prisma.server";
import type { FieldCipher } from "../../shared/crypto/field-cipher.server";
import { AppError, NotFoundError } from "../../shared/http/errors.server";
import type { PrescriptionSource, TicketData } from "../lab-orders/ticket/types";
import {
  getAddOns,
  getLabOrder,
  getLens,
  getOptionValues,
  getPrescription,
  type LabDispatchDb,
} from "./lab-dispatch.repository.server";

export class RxDecryptError extends AppError {
  constructor(message = "Prescription decryption failed") {
    super(500, "RX_DECRYPT_FAILED", message);
    this.name = "RxDecryptError";
  }
}

export interface LoadTicketDataDeps {
  db?: LabDispatchDb;
  cipher?: FieldCipher;
}

/**
 * Loads and decrypts ticket data for a lab order (Spec 30 Scope):
 * - LabOrder + lens/options/add-ons from catalog (archived rows still readable, Self-check 3)
 * - Prescription decrypted with AAD `shopId:prescriptionId` (INV-2)
 * - Returns structured TicketData for PDF/CSV renderers (Spec 24)
 * - Fails with RxDecryptError ("RX_DECRYPT_FAILED") if decryption or integrity check fails
 */
export async function loadTicketData(
  shopId: string,
  labOrderId: string,
  deps: LoadTicketDataDeps = {},
): Promise<TicketData> {
  const db = deps.db ?? getPrisma();
  const cipher = deps.cipher ?? getCipher();

  const labOrder = await getLabOrder(shopId, labOrderId, db);
  if (!labOrder) {
    throw new NotFoundError("Lab order not found", "NOT_FOUND");
  }

  // Load lens (archived rows still readable per Self-check 3)
  const lens = labOrder.lensId ? await getLens(shopId, labOrder.lensId, db) : null;

  // Load option values (archived rows still readable)
  const optionValues =
    labOrder.optionValueIds.length > 0
      ? await getOptionValues(shopId, labOrder.optionValueIds, db)
      : [];

  // Load add-ons (archived rows still readable)
  const addOns =
    labOrder.addOnIds.length > 0
      ? await getAddOns(shopId, labOrder.addOnIds, db)
      : [];

  // Prescription resolution & decryption
  let prescriptionData: Prescription | null = null;
  let source: PrescriptionSource = "MANUAL";
  let uploadFileNames: string[] = [];

  if (labOrder.prescriptionId) {
    const rxRow = await getPrescription(shopId, labOrder.prescriptionId, db);
    if (!rxRow) {
      throw new NotFoundError("Prescription not found", "RX_NOT_FOUND");
    }

    source = rxRow.source as PrescriptionSource;
    const aad = `${shopId}:${rxRow.id}`;

    let decrypted: unknown;
    try {
      decrypted = cipher.decrypt(rxRow.cipher, aad);
    } catch {
      // INV-2: Ensure fixed data-free error with no plaintext Rx
      throw new RxDecryptError("Prescription decryption failed");
    }

    if (source === "MANUAL") {
      prescriptionData = decrypted as Prescription;
    } else if (source === "UPLOAD") {
      prescriptionData = null;
      uploadFileNames = rxRow.uploadKeys.map((k) => k.split("/").pop() ?? k);
    }
  }

  // Map option values into selection items for compileLabCode
  const optionSelections = optionValues.map((v) => ({
    id: v.id,
    label: v.label,
    tokenKey: v.tokenKey ?? undefined,
    tokenValue: v.tokenValue ?? undefined,
    overrideCode: v.overrideCode ?? undefined,
    position: v.position,
  }));

  return {
    orderName: labOrder.orderName,
    orderNumber: labOrder.shopifyOrderId,
    frameTitle: labOrder.frameTitle,
    frameSku: labOrder.frameSku,
    lensName: lens?.name ?? "",
    labCodeTemplate: lens?.labCodeTemplate ?? "",
    options: optionSelections,
    optionSelections,
    optionLabels: optionValues.map((v) => v.label),
    addOnNames: addOns.map((a) => a.name),
    prescription: prescriptionData,
    source,
    uploadFileNames,
    fileNames: uploadFileNames,
    rxOutOfLimits: labOrder.rxOutOfLimits,
    notes: prescriptionData?.notes ?? null,
    createdAt: labOrder.createdAt,
  };
}
