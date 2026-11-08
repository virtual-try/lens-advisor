import type { RxSource, RxType } from "@prisma/client";

export interface PrescriptionSummaryInput {
  id?: string;
  rxType: RxType;
  source: RxSource;
  uploadKeys: string[];
  createdAt?: Date;
}

/**
 * Formats a prescription summary line without exposing clinical Rx values (INV-2).
 * Examples:
 * - "Prescription: on file (typed)"
 * - "Prescription: on file (uploaded, 2 files)"
 * - "None" / "Non-prescription"
 */
export function formatPrescriptionSummary(
  prescription: PrescriptionSummaryInput | null | undefined,
): string {
  if (!prescription) {
    return "None";
  }

  if (prescription.rxType === "NON_PRESCRIPTION") {
    return "Non-prescription";
  }

  if (prescription.source === "MANUAL") {
    return "Prescription: on file (typed)";
  }

  if (prescription.source === "UPLOAD") {
    const count = prescription.uploadKeys.length;
    const filesLabel = count === 1 ? "1 file" : `${count} files`;
    return `Prescription: on file (uploaded, ${filesLabel})`;
  }

  return "Prescription: on file";
}
