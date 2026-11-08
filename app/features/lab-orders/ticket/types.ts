import type { Prescription } from "../../../../packages/rx-core/src/types/index.js";
import type { LabCodeSelectionsInput } from "../../../../packages/rx-core/src/lab-code/types.js";

export type PrescriptionSource = "MANUAL" | "UPLOAD";

export interface TicketData {
  orderName: string;
  orderNumber?: string;
  frameTitle: string;
  frameSku?: string | null;
  lensName: string;
  labCodeTemplate: string;
  options?: LabCodeSelectionsInput;
  optionSelections?: LabCodeSelectionsInput;
  optionLabels?: string[];
  addOnNames?: string[];
  prescription?: Prescription | null;
  source: PrescriptionSource;
  uploadFileNames?: string[];
  fileNames?: string[];
  rxOutOfLimits?: boolean;
  notes?: string | null;
  createdAt?: Date | string;
}
