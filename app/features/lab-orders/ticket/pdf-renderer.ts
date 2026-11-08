import { createRequire } from "module";
import path from "path";
import PDFDocument from "pdfkit";
import { formatAxis, formatDiopter, formatPd } from "../../../../packages/rx-core/src/format/index.js";
import { compileLabCode } from "../../../../packages/rx-core/src/lab-code/index.js";
import { TICKET_RENDER_FAILED, type TicketData } from "./types.js";

const req = createRequire(import.meta.url);
const pkgPath = req.resolve("dejavu-fonts-ttf/package.json");
const FONT_REGULAR = path.join(path.dirname(pkgPath), "ttf/DejaVuSans.ttf");
const FONT_BOLD = path.join(path.dirname(pkgPath), "ttf/DejaVuSans-Bold.ttf");

// Fixed metadata timestamp for deterministic PDF output
const FIXED_PDF_DATE = new Date("2026-01-01T00:00:00.000Z");

function formatTruncatedList(
  items: string[],
  maxItems = 5,
  maxItemLen = 50,
): string {
  if (items.length === 0) {
    return "None";
  }
  const slice = items.slice(0, maxItems).map((item) => {
    const trimmed = String(item).trim();
    return trimmed.length > maxItemLen
      ? `${trimmed.slice(0, maxItemLen - 1)}…`
      : trimmed;
  });
  if (items.length > maxItems) {
    const remaining = items.length - maxItems;
    return `${slice.join(", ")} (+${remaining} more)`;
  }
  return slice.join(", ");
}

function truncateString(str: string, maxLen = 100): string {
  const trimmed = str.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

/**
 * Renders a one-page A4 PDF lab job ticket in memory as a Buffer.
 *
 * Layout includes:
 * - Header with order name and ticket title
 * - Warning band if rxOutOfLimits is true
 * - Job metadata: frame title/SKU, lens name, compiled lab code
 * - Compiler warnings (e.g. UNKNOWN_TOKEN) printed directly under the lab code
 * - Chosen option labels and add-on names (truncated with '+N more' if excessive)
 * - Prescription section:
 *   - If source is UPLOAD: "Prescription file attached" and file list
 *   - Both eyes (OD, OS) formatted with spec 03 formatters
 *   - PD formatted with formatPd
 *   - Notes if provided
 */
export async function renderPdf(data: TicketData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        reject(new Error(TICKET_RENDER_FAILED));
      }
    };
    const succeed = (buf: Buffer) => {
      if (!settled) {
        settled = true;
        resolve(buf);
      }
    };

    try {
      const selections = data.optionSelections ?? data.options;
      const { code: labCode, warnings: labCodeWarnings } = compileLabCode(
        data.labCodeTemplate,
        selections,
      );

      const frameTitle =
        data.frameTitle ??
        (data as unknown as { frame?: { title?: string } }).frame?.title ??
        "";
      const frameSku =
        data.frameSku ??
        (data as unknown as { frame?: { sku?: string } }).frame?.sku ??
        "";

      const optionLabels = data.optionLabels ?? [];
      const addOnNames = data.addOnNames ?? [];
      const files = data.uploadFileNames ?? data.fileNames ?? [];

      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        info: {
          Title: `Lab Job Ticket - ${data.orderName}`,
          Author: "LensAdvisor",
          CreationDate: FIXED_PDF_DATE,
          ModDate: FIXED_PDF_DATE,
        },
      });

      // Prevent multi-page additions to strictly satisfy the one-page A4 contract
      doc.addPage = () => doc;

      // Register Unicode-capable TrueType fonts
      doc.registerFont("DejaVuSans", FONT_REGULAR);
      doc.registerFont("DejaVuSans-Bold", FONT_BOLD);

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => succeed(Buffer.concat(chunks)));
      doc.on("error", () => {
        // INV-2: Ensure fixed, data-free error with no original message or cause
        fail();
      });

      const pageWidth = 595.28;
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;

      // 1. Header
      doc.fontSize(20).font("DejaVuSans-Bold").text("LAB JOB TICKET", {
        align: "center",
      });
      doc.moveDown(0.3);

      const truncatedOrderName = truncateString(data.orderName ?? "", 60);
      doc.fontSize(12).font("DejaVuSans-Bold").text(`Order: ${truncatedOrderName}`, {
        align: "center",
        width: contentWidth,
        height: 20,
        ellipsis: true,
      });
      doc.moveDown(0.5);

      // 2. Out-of-limits warning band (if rxOutOfLimits=true)
      if (data.rxOutOfLimits) {
        const bandY = doc.y;
        doc
          .rect(margin, bandY, contentWidth, 28)
          .fillAndStroke("#FFF3CD", "#856404");

        doc
          .fontSize(11)
          .font("DejaVuSans-Bold")
          .fillColor("#856404")
          .text(
            "WARNING: Prescription parameters exceed standard lab limits (Out of limits)",
            margin + 10,
            bandY + 8,
            { width: contentWidth - 20, align: "center" },
          );

        doc.fillColor("#000000");
        doc.y = bandY + 36;
      }

      // Divider line
      doc
        .moveTo(margin, doc.y)
        .lineTo(margin + contentWidth, doc.y)
        .strokeColor("#CCCCCC")
        .stroke();
      doc.moveDown(0.5);

      // 3. Frame & Lens Details
      doc.fontSize(13).font("DejaVuSans-Bold").text("Order & Frame Details");
      doc.moveDown(0.3);

      doc.fontSize(10).font("DejaVuSans");
      const truncatedTitle = truncateString(frameTitle, 100);
      const frameText = frameSku
        ? `Frame: ${truncatedTitle} (SKU: ${truncateString(frameSku, 40)})`
        : `Frame: ${truncatedTitle}`;
      doc.text(frameText, { width: contentWidth, height: 28, ellipsis: true });
      doc.text(`Lens: ${truncateString(data.lensName, 100)}`, {
        width: contentWidth,
        height: 18,
        ellipsis: true,
      });
      doc.moveDown(0.3);

      // Lab code (bounded with explicit truncation and fixed box)
      const truncatedLabCode = truncateString(labCode, 100);
      doc.font("DejaVuSans-Bold").text(`Lab Code: ${truncatedLabCode}`, {
        width: contentWidth,
        height: 28,
        ellipsis: true,
      });

      // Lab code compiler warnings (printed directly under the code)
      if (labCodeWarnings && labCodeWarnings.length > 0) {
        doc
          .fontSize(9)
          .font("DejaVuSans-Bold")
          .fillColor("#C0392B")
          .text(`Warning: ${formatTruncatedList(labCodeWarnings, 3)}`, {
            width: contentWidth,
            height: 20,
            ellipsis: true,
          });
        doc.fillColor("#000000").fontSize(10);
      }
      doc.moveDown(0.3);

      // Options & Add-ons
      doc
        .font("DejaVuSans")
        .text(`Options: ${formatTruncatedList(optionLabels, 5)}`, {
          width: contentWidth,
          height: 28,
          ellipsis: true,
        });
      doc.text(`Add-ons: ${formatTruncatedList(addOnNames, 5)}`, {
        width: contentWidth,
        height: 28,
        ellipsis: true,
      });
      doc.moveDown(0.6);

      // Divider line
      doc
        .moveTo(margin, doc.y)
        .lineTo(margin + contentWidth, doc.y)
        .strokeColor("#CCCCCC")
        .stroke();
      doc.moveDown(0.5);

      // 4. Prescription Details
      doc.fontSize(13).font("DejaVuSans-Bold").text("Prescription Details");
      doc.moveDown(0.4);

      if (data.source === "UPLOAD") {
        doc.fontSize(11).font("DejaVuSans-Bold").text("Prescription file attached");
        doc.fontSize(10).font("DejaVuSans");
        if (files.length > 0) {
          doc.text(`Attached files: ${formatTruncatedList(files, 5)}`, {
            width: contentWidth,
            height: 28,
            ellipsis: true,
          });
        } else {
          doc.text("Attached files: (Document attached to dispatch email)", {
            width: contentWidth,
            height: 20,
            ellipsis: true,
          });
        }
        doc.moveDown(0.4);
      }

      const rx = data.prescription;
      if (rx) {
        // Table Header
        const colEye = margin;
        const colSph = margin + 50;
        const colCyl = margin + 140;
        const colAxis = margin + 230;
        const colAdd = margin + 320;

        const tableTop = doc.y;
        doc
          .rect(margin, tableTop, contentWidth, 18)
          .fillAndStroke("#F0F0F0", "#DDDDDD");

        doc
          .fontSize(10)
          .font("DejaVuSans-Bold")
          .fillColor("#333333")
          .text("Eye", colEye + 8, tableTop + 4)
          .text("SPH", colSph, tableTop + 4)
          .text("CYL", colCyl, tableTop + 4)
          .text("AXIS", colAxis, tableTop + 4)
          .text("ADD", colAdd, tableTop + 4);

        doc.fillColor("#000000").font("DejaVuSans");
        let rowY = tableTop + 22;

        // OD Row
        const od = rx.od;
        const odSph = formatDiopter(od.sph);
        const odCyl = od.cyl !== undefined ? formatDiopter(od.cyl) : "—";
        const odAxis = od.axis !== undefined ? formatAxis(od.axis) : "—";
        const odAdd = od.add !== undefined ? formatDiopter(od.add) : "—";

        doc
          .font("DejaVuSans-Bold")
          .text("OD (Right)", colEye + 8, rowY)
          .font("DejaVuSans")
          .text(odSph, colSph, rowY)
          .text(odCyl, colCyl, rowY)
          .text(odAxis, colAxis, rowY)
          .text(odAdd, colAdd, rowY);

        rowY += 18;

        // OS Row
        const os = rx.os;
        const osSph = formatDiopter(os.sph);
        const osCyl = os.cyl !== undefined ? formatDiopter(os.cyl) : "—";
        const osAxis = os.axis !== undefined ? formatAxis(os.axis) : "—";
        const osAdd = os.add !== undefined ? formatDiopter(os.add) : "—";

        doc
          .font("DejaVuSans-Bold")
          .text("OS (Left)", colEye + 8, rowY)
          .font("DejaVuSans")
          .text(osSph, colSph, rowY)
          .text(osCyl, colCyl, rowY)
          .text(osAxis, colAxis, rowY)
          .text(osAdd, colAdd, rowY);

        doc.y = rowY + 24;

        // PD
        doc
          .font("DejaVuSans-Bold")
          .text("Pupillary Distance (PD): ", margin, doc.y, { continued: true })
          .font("DejaVuSans")
          .text(`${formatPd(rx.pd)} mm`);
        doc.moveDown(0.3);
      }

      // Notes
      const notes = data.notes ?? rx?.notes;
      if (notes) {
        doc.moveDown(0.3);
        const normalizedNotes = notes.replace(/\r\n|\r|\n/g, " ").trim();
        const MAX_NOTES_LEN = 250;
        let displayNotes = normalizedNotes;
        if (normalizedNotes.length > MAX_NOTES_LEN) {
          const remaining = normalizedNotes.length - MAX_NOTES_LEN;
          displayNotes = `${normalizedNotes.slice(0, MAX_NOTES_LEN).trimEnd()}… (+${remaining} more)`;
        }
        doc
          .font("DejaVuSans-Bold")
          .text("Notes: ", margin, doc.y, { continued: true })
          .font("DejaVuSans")
          .text(displayNotes, { width: contentWidth - 50, height: 50, ellipsis: true });
      }

      // End of PDF
      doc.end();
    } catch {
      // INV-2: Ensure fixed, data-free error with no original message or cause
      fail();
    }
  });
}
