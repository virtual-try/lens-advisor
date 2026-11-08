/**
 * Error-code mapping table for lab orders admin (Spec 32 Self-check 2).
 * Maps machine error codes to plain English sentences.
 * Unknown codes fallback to UNKNOWN_ERROR_MESSAGE ("Something went wrong").
 */
export const LAB_ORDER_ERROR_MESSAGES: Record<string, string> = {
  NO_LAB_EMAIL: "No lab email set",
  MAIL_FAILED: "Failed to send email to the lab",
  STORAGE_FAILED: "Failed to store or retrieve lab ticket files",
  RX_DECRYPT_FAILED: "Failed to decrypt prescription data",
  LOAD_FAILED: "Failed to load order catalog or prescription data",
  TICKET_RENDER_FAILED: "Failed to generate lab ticket",
  NO_LENS_IN_BUNDLE: "No lens found in order bundle",
  LENS_NOT_FOUND: "Lens not found in catalog",
  OPTION_NOT_FOUND: "Selected option not found in catalog",
  RX_NOT_FOUND: "Prescription not found",
  IN_PROGRESS: "Dispatch is currently in progress",
};

export const UNKNOWN_ERROR_MESSAGE = "Something went wrong";

/**
 * Formats a lab order error code into a human-readable sentence.
 * Unknown codes return "Something went wrong".
 */
export function formatLabOrderError(code: string | null | undefined): string {
  if (!code) return "";
  return LAB_ORDER_ERROR_MESSAGES[code] ?? UNKNOWN_ERROR_MESSAGE;
}
