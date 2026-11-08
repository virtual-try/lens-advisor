import type { Prisma, PrismaClient, RxSource, RxType } from "@prisma/client";

/** Full client or transaction client. */
export type PrescriptionDb = PrismaClient | Prisma.TransactionClient;

export interface PrescriptionRecord {
  id: string;
  shopId: string;
  rxType: RxType;
  source: RxSource;
  cipher: string;
  uploadKeys: string[];
  createdAt: Date;
  orderId: string | null;
}

export interface CreatePrescriptionInput {
  id: string;
  rxType: RxType;
  source: RxSource;
  cipher: string;
  uploadKeys?: string[];
  orderId?: string | null;
}

export interface UpdatePrescriptionUploadInput {
  rxType?: RxType;
  uploadKeys?: string[];
  cipher?: string;
}

function toPrescriptionRecord(row: {
  id: string;
  shopId: string;
  rxType: RxType;
  source: RxSource;
  cipher: string;
  uploadKeys: string[];
  createdAt: Date;
  orderId: string | null;
}): PrescriptionRecord {
  return {
    id: row.id,
    shopId: row.shopId,
    rxType: row.rxType,
    source: row.source,
    cipher: row.cipher,
    uploadKeys: [...row.uploadKeys],
    createdAt: row.createdAt,
    orderId: row.orderId,
  };
}

/**
 * Finds a shop by domain.
 */
export async function findShopByDomain(
  db: PrescriptionDb,
  domain: string,
): Promise<{ id: string; domain: string } | null> {
  return db.shop.findUnique({
    where: { domain },
    select: {
      id: true,
      domain: true,
    },
  });
}

/**
 * Creates a prescription scoped to the shop (INV-1).
 */
export async function createPrescription(
  db: PrescriptionDb,
  shopId: string,
  input: CreatePrescriptionInput,
): Promise<PrescriptionRecord> {
  const row = await db.prescription.create({
    data: {
      id: input.id,
      shopId,
      rxType: input.rxType,
      source: input.source,
      cipher: input.cipher,
      uploadKeys: input.uploadKeys ? [...input.uploadKeys] : [],
      orderId: input.orderId ?? null,
    },
  });

  return toPrescriptionRecord(row);
}

/**
 * Gets a prescription by id, strictly scoped to shopId (INV-1).
 * Returns null if the prescription belongs to another shop or does not exist.
 */
export async function getPrescriptionById(
  db: PrescriptionDb,
  shopId: string,
  id: string,
): Promise<PrescriptionRecord | null> {
  const row = await db.prescription.findUnique({
    where: {
      shopId_id: {
        shopId,
        id,
      },
    },
  });

  return row ? toPrescriptionRecord(row) : null;
}

/**
 * Attaches a Shopify order id to a prescription, strictly scoped to shopId (INV-1).
 * Uses an atomic conditional update and returns null if the prescription does not belong to the shop.
 */
export async function attachOrder(
  db: PrescriptionDb,
  shopId: string,
  prescriptionId: string,
  orderId: string,
): Promise<PrescriptionRecord | null> {
  const result = await db.prescription.updateMany({
    where: {
      shopId,
      id: prescriptionId,
    },
    data: {
      orderId,
    },
  });

  if (result.count === 0) {
    return null;
  }

  return getPrescriptionById(db, shopId, prescriptionId);
}

/**
 * Updates a draft prescription for UPLOAD, strictly scoped to shopId and unfinalized draft state (INV-1, R1-F6, R2-F1).
 * Uses an atomic conditional update and returns null if the prescription does not belong to the shop
 * or is already finalized (uploadKeys not empty).
 */
export async function updatePrescriptionUpload(
  db: PrescriptionDb,
  shopId: string,
  id: string,
  data: UpdatePrescriptionUploadInput,
): Promise<PrescriptionRecord | null> {
  const result = await db.prescription.updateMany({
    where: {
      shopId,
      id,
      source: "UPLOAD",
      uploadKeys: { isEmpty: true },
    },
    data: {
      ...(data.rxType ? { rxType: data.rxType } : {}),
      ...(data.uploadKeys ? { uploadKeys: [...data.uploadKeys] } : {}),
      ...(data.cipher !== undefined ? { cipher: data.cipher } : {}),
    },
  });

  if (result.count === 0) {
    return null;
  }

  return getPrescriptionById(db, shopId, id);
}
