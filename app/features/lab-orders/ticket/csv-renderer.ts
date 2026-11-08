import { formatDiopter, formatPd } from "../../../../packages/rx-core/src/format/index.js";
import { compileLabCode } from "../../../../packages/rx-core/src/lab-code/index.js";
import type { TicketData } from "./types.js";

/**
 * Escapes a single CSV cell according to RFC 4180 and CSV formula injection rules.
 *
 * CSV injection prevention:
 * - A string starting with `=`, `+`, `-`, or `@` is prefixed with `'`
 * - EXCEPT numeric diopter columns (`sph`, `cyl`, `add`), which are emitted by
 *   the rx-core formatter and are safe numbers.
 *
 * RFC 4180 quoting:
 * - If the value contains `"`, `,`, `\r`, or `\n`, it is enclosed in double quotes
 *   and internal quotes are doubled.
 */
export function escapeCsvCell(
  value: unknown,
  isNumericDiopter = false,
): string {
  if (value === null || value === undefined) {
    return "";
  }
  let str = String(value);

  if (!isNumericDiopter && str.length > 0) {
    const first = str[0];
    if (first === "=" || first === "+" || first === "-" || first === "@") {
      str = "'" + str;
    }
  }

  if (
    str.includes('"') ||
    str.includes(",") ||
    str.includes("\r") ||
    str.includes("\n")
  ) {
    return `"${str.replaceAll('"', '""')}"`;
  }

  return str;
}

/**
 * Standard CSV header columns.
 */
export const CSV_HEADERS = [
  "order_name",
  "frame_title",
  "frame_sku",
  "lens_name",
  "lab_code",
  "options",
  "add_ons",
  "source",
  "rx_out_of_limits",
  "files",
  "eye",
  "sph",
  "cyl",
  "axis",
  "add",
  "pd",
  "notes",
] as const;

/**
 * Renders lab job ticket as an RFC 4180 compliant CSV buffer (UTF-8).
 * Contains a header row and one row per eye (OD and OS).
 */
export function renderCsv(data: TicketData): Buffer {
  try {
    const selections = data.optionSelections ?? data.options;
    const { code: labCode } = compileLabCode(data.labCodeTemplate, selections);

    const frameTitle =
      data.frameTitle ??
      (data as unknown as { frame?: { title?: string } }).frame?.title ??
      "";
    const frameSku =
      data.frameSku ??
      (data as unknown as { frame?: { sku?: string } }).frame?.sku ??
      "";

    const optionsStr = (data.optionLabels ?? []).join("; ");
    const addOnsStr = (data.addOnNames ?? []).join("; ");
    const filesStr = (data.uploadFileNames ?? data.fileNames ?? []).join("; ");
    const rxOutOfLimitsStr = data.rxOutOfLimits ? "true" : "false";
    const notesStr = data.notes ?? data.prescription?.notes ?? "";

    const rx = data.prescription;

    // Helper to format PD per eye
    function formatEyePd(eye: "OD" | "OS"): string {
      if (!rx?.pd) return "";
      if ("single" in rx.pd) {
        return formatPd(rx.pd);
      }
      const half = eye === "OD" ? rx.pd.od : rx.pd.os;
      return formatPd({ single: half });
    }

    // Build common row cells
    const commonCells = [
      escapeCsvCell(data.orderName),
      escapeCsvCell(frameTitle),
      escapeCsvCell(frameSku),
      escapeCsvCell(data.lensName),
      escapeCsvCell(labCode),
      escapeCsvCell(optionsStr),
      escapeCsvCell(addOnsStr),
      escapeCsvCell(data.source),
      escapeCsvCell(rxOutOfLimitsStr),
      escapeCsvCell(filesStr),
    ];

    // OD row
    const odEye = rx?.od;
    const odRow = [
      ...commonCells,
      "OD",
      odEye?.sph !== undefined ? escapeCsvCell(formatDiopter(odEye.sph), true) : "",
      odEye?.cyl !== undefined ? escapeCsvCell(formatDiopter(odEye.cyl), true) : "",
      odEye?.axis !== undefined ? escapeCsvCell(String(odEye.axis)) : "",
      odEye?.add !== undefined ? escapeCsvCell(formatDiopter(odEye.add), true) : "",
      escapeCsvCell(formatEyePd("OD")),
      escapeCsvCell(notesStr),
    ].join(",");

    // OS row
    const osEye = rx?.os;
    const osRow = [
      ...commonCells,
      "OS",
      osEye?.sph !== undefined ? escapeCsvCell(formatDiopter(osEye.sph), true) : "",
      osEye?.cyl !== undefined ? escapeCsvCell(formatDiopter(osEye.cyl), true) : "",
      osEye?.axis !== undefined ? escapeCsvCell(String(osEye.axis)) : "",
      osEye?.add !== undefined ? escapeCsvCell(formatDiopter(osEye.add), true) : "",
      escapeCsvCell(formatEyePd("OS")),
      escapeCsvCell(notesStr),
    ].join(",");

    const headerLine = CSV_HEADERS.join(",");
    const csvContent = `${headerLine}\r\n${odRow}\r\n${osRow}\r\n`;

    return Buffer.from(csvContent, "utf-8");
  } catch (err: unknown) {
    // INV-2: Error message must never contain prescription values
    const safeMsg =
      err instanceof Error
        ? err.message.replace(/[-+]?\d+(\.\d+)?/g, "[NUM]")
        : "Unknown render error";
    throw new Error(`Failed to render CSV ticket: ${safeMsg}`);
  }
}
