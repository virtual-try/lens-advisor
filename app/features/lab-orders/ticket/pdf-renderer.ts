import PDFDocument from "pdfkit";
import { formatAxis, formatDiopter, formatPd } from "../../../../packages/rx-core/src/format/index.js";
import { compileLabCode } from "../../../../packages/rx-core/src/lab-code/index.js";
import type { TicketData } from "./types.js";

/**
 * Renders a one-page A4 PDF lab job ticket in memory as a Buffer.
 *
 * Layout includes:
 * - Header with order name and ticket title
 * - Warning band if rxOutOfLimits is true
 * - Job metadata: frame title/SKU, lens name, compiled lab code
 * - Compiler warnings (e.g. UNKNOWN_TOKEN) printed directly under the lab code
 * - Chosen option labels and add-on names
 * - Prescription section:
 *   - If source is UPLOAD: "Prescription file attached" and file list
 *   - Both eyes (OD, OS) formatted with spec 03 formatters
 *   - PD formatted with formatPd
 *   - Notes if provided
 */
export async function renderPdf(data: TicketData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
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
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => {
        // INV-2: Ensure no Rx is in error message
        reject(new Error(`PDF generation stream error: ${err.message}`));
      });

      const pageWidth = 595.28;
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;

      // 1. Header
      doc.fontSize(20).font("Helvetica-Bold").text("LAB JOB TICKET", {
        align: "center",
      });
      doc.moveDown(0.3);

      doc.fontSize(12).font("Helvetica-Bold").text(`Order: ${data.orderName}`, {
        align: "center",
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
          .font("Helvetica-Bold")
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
      doc.fontSize(13).font("Helvetica-Bold").text("Order & Frame Details");
      doc.moveDown(0.3);

      doc.fontSize(10).font("Helvetica");
      const frameText = frameSku
        ? `Frame: ${frameTitle} (SKU: ${frameSku})`
        : `Frame: ${frameTitle}`;
      doc.text(frameText);
      doc.text(`Lens: ${data.lensName}`);
      doc.moveDown(0.3);

      // Lab code
      doc.font("Helvetica-Bold").text(`Lab Code: ${labCode}`);

      // Lab code compiler warnings (printed directly under the code)
      if (labCodeWarnings && labCodeWarnings.length > 0) {
        doc
          .fontSize(9)
          .font("Helvetica-Bold")
          .fillColor("#C0392B")
          .text(`Warning: ${labCodeWarnings.join("; ")}`);
        doc.fillColor("#000000").fontSize(10);
      }
      doc.moveDown(0.3);

      // Options & Add-ons
      doc
        .font("Helvetica")
        .text(`Options: ${optionLabels.length > 0 ? optionLabels.join(", ") : "None"}`);
      doc.text(`Add-ons: ${addOnNames.length > 0 ? addOnNames.join(", ") : "None"}`);
      doc.moveDown(0.6);

      // Divider line
      doc
        .moveTo(margin, doc.y)
        .lineTo(margin + contentWidth, doc.y)
        .strokeColor("#CCCCCC")
        .stroke();
      doc.moveDown(0.5);

      // 4. Prescription Details
      doc.fontSize(13).font("Helvetica-Bold").text("Prescription Details");
      doc.moveDown(0.4);

      if (data.source === "UPLOAD") {
        doc.fontSize(11).font("Helvetica-Bold").text("Prescription file attached");
        doc.fontSize(10).font("Helvetica");
        if (files.length > 0) {
          doc.text(`Attached files: ${files.join(", ")}`);
        } else {
          doc.text("Attached files: (Document attached to dispatch email)");
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
          .font("Helvetica-Bold")
          .fillColor("#333333")
          .text("Eye", colEye + 8, tableTop + 4)
          .text("SPH", colSph, tableTop + 4)
          .text("CYL", colCyl, tableTop + 4)
          .text("AXIS", colAxis, tableTop + 4)
          .text("ADD", colAdd, tableTop + 4);

        doc.fillColor("#000000").font("Helvetica");
        let rowY = tableTop + 22;

        // OD Row
        const od = rx.od;
        const odSph = formatDiopter(od.sph);
        const odCyl = od.cyl !== undefined ? formatDiopter(od.cyl) : "—";
        const odAxis = od.axis !== undefined ? formatAxis(od.axis) : "—";
        const odAdd = od.add !== undefined ? formatDiopter(od.add) : "—";

        doc
          .font("Helvetica-Bold")
          .text("OD (Right)", colEye + 8, rowY)
          .font("Helvetica")
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
          .font("Helvetica-Bold")
          .text("OS (Left)", colEye + 8, rowY)
          .font("Helvetica")
          .text(osSph, colSph, rowY)
          .text(osCyl, colCyl, rowY)
          .text(osAxis, colAxis, rowY)
          .text(osAdd, colAdd, rowY);

        doc.y = rowY + 24;

        // PD
        doc
          .font("Helvetica-Bold")
          .text("Pupillary Distance (PD): ", margin, doc.y, { continued: true })
          .font("Helvetica")
          .text(`${formatPd(rx.pd)} mm`);
        doc.moveDown(0.3);
      }

      // Notes
      const notes = data.notes ?? rx?.notes;
      if (notes) {
        doc.moveDown(0.3);
        doc
          .font("Helvetica-Bold")
          .text("Notes: ", margin, doc.y, { continued: true })
          .font("Helvetica")
          .text(notes);
      }

      // End of PDF
      doc.end();
    } catch (err: unknown) {
      // INV-2: Ensure no Rx value is leaked in error message
      const safeMsg =
        err instanceof Error
          ? err.message.replace(/[-+]?\d+(\.\d+)?/g, "[NUM]")
          : "Unknown error";
      reject(new Error(`Failed to render PDF ticket: ${safeMsg}`));
    }
  });
}
