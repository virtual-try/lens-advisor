import { describe, expect, it, vi } from "vitest";
import { PDFParse } from "pdf-parse";
import {
  escapeCsvCell,
  renderCsv,
  renderPdf,
  type TicketData,
} from "./index.js";

async function extractPdfText(buffer: Buffer): Promise<string> {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const parser = new PDFParse(new Uint8Array(buffer));
    const res = await parser.getText();
    return res.text;
  } finally {
    console.warn = origWarn;
  }
}

describe("Spec 24: Lab job ticket renderer", () => {
  const baseFixture: TicketData = {
    orderName: "#1001",
    frameTitle: "Classic Rectangle",
    frameSku: "CR-01",
    lensName: "Single Vision High Index 1.67",
    labCodeTemplate: "PO-58-[lens_type=NONE]-[lens_color=NONE]-00",
    optionLabels: ["Anti-Reflective Coating", "Thin & Light"],
    addOnNames: ["Edge Polish"],
    source: "MANUAL",
    rxOutOfLimits: false,
    prescription: {
      od: { sph: -225, cyl: -50, axis: 180 },
      os: { sph: -200 },
      pd: { single: 635 },
      notes: "Patient prefers thinner edges",
    },
  };

  // --- Examples rows from spec 24 ---

  describe("Examples table cases", () => {
    it("row 1: typed Rx OD −2.25/−0.50×180, OS −2.00, PD 63.5 -> CSV rows and PDF text", async () => {
      const data: TicketData = {
        ...baseFixture,
        prescription: {
          od: { sph: -225, cyl: -50, axis: 180 },
          os: { sph: -200 },
          pd: { single: 635 },
        },
      };

      // CSV checks
      const csvBuffer = renderCsv(data);
      const csvText = csvBuffer.toString("utf-8");
      const lines = csvText.split("\r\n").filter(Boolean);

      expect(lines).toHaveLength(3); // Header, OD, OS
      // OD row should have -2.25,-0.50,180
      expect(lines[1]).toContain(",OD,-2.25,-0.50,180,,63.5,");
      // OS row should have -2.00,,
      expect(lines[2]).toContain(",OS,-2.00,,,,63.5,");

      // PDF text extraction asserts both eyes and the lab code
      const pdfBuffer = await renderPdf(data);
      expect(pdfBuffer.subarray(0, 5).toString("utf-8")).toBe("%PDF-");

      const pdfText = await extractPdfText(pdfBuffer);
      // Both eyes present
      expect(pdfText).toContain("OD (Right)");
      expect(pdfText).toContain("-2.25");
      expect(pdfText).toContain("-0.50");
      expect(pdfText).toContain("180");
      expect(pdfText).toContain("OS (Left)");
      expect(pdfText).toContain("-2.00");
      expect(pdfText).toContain("63.5");
      // Lab code compiled
      expect(pdfText).toContain("PO-58-NONE-NONE-00");
    });

    it("row 2: frame title Ava, \"Tortoise\" -> CSV field \"Ava, \"\"Tortoise\"\"\"", () => {
      const data: TicketData = {
        ...baseFixture,
        frameTitle: 'Ava, "Tortoise"',
      };

      const csvText = renderCsv(data).toString("utf-8");
      expect(csvText).toContain('"Ava, ""Tortoise"""');

      // Test escapeCsvCell directly as well
      expect(escapeCsvCell('Ava, "Tortoise"')).toBe('"Ava, ""Tortoise"""');
    });

    it("row 3: uploaded-file Rx -> PDF text 'Prescription file attached'", async () => {
      const data: TicketData = {
        ...baseFixture,
        source: "UPLOAD",
        prescription: null,
        uploadFileNames: ["dr_prescription_scan.pdf", "rx_card.jpg"],
      };

      const pdfBuffer = await renderPdf(data);
      const pdfText = await extractPdfText(pdfBuffer);

      expect(pdfText).toContain("Prescription file attached");
      expect(pdfText).toContain("dr_prescription_scan.pdf");
      expect(pdfText).toContain("rx_card.jpg");

      // Also verify CSV emits UPLOAD and file list
      const csvText = renderCsv(data).toString("utf-8");
      expect(csvText).toContain("UPLOAD");
      expect(csvText).toContain("dr_prescription_scan.pdf; rx_card.jpg");
    });

    it("row 4: rxOutOfLimits=true -> PDF warning band text; CSV column rx_out_of_limits=true", async () => {
      const dataOutOfLimits: TicketData = {
        ...baseFixture,
        rxOutOfLimits: true,
      };

      // CSV contains rx_out_of_limits=true
      const csvText = renderCsv(dataOutOfLimits).toString("utf-8");
      expect(csvText).toContain(",true,");

      // PDF text contains warning band text
      const pdfBuffer = await renderPdf(dataOutOfLimits);
      const pdfText = await extractPdfText(pdfBuffer);
      expect(pdfText).toContain("WARNING");
      expect(pdfText).toContain("Out of limits");

      // Compare with rxOutOfLimits=false
      const dataInLimits: TicketData = {
        ...baseFixture,
        rxOutOfLimits: false,
      };
      const csvInLimits = renderCsv(dataInLimits).toString("utf-8");
      expect(csvInLimits).toContain(",false,");

      const pdfInLimits = await extractPdfText(await renderPdf(dataInLimits));
      expect(pdfInLimits).not.toContain("WARNING: Prescription parameters exceed standard lab limits");
    });

    it("row 5: lab-code warning UNKNOWN_TOKEN -> printed under the code on the PDF", async () => {
      const data: TicketData = {
        ...baseFixture,
        options: {
          lens_tint: "PHOT", // unknown token key
        },
      };

      const pdfBuffer = await renderPdf(data);
      const pdfText = await extractPdfText(pdfBuffer);

      // Lab code is compiled with default tokens
      expect(pdfText).toContain("PO-58-NONE-NONE-00");
      // Warning is printed under the code
      expect(pdfText).toContain("Warning: UNKNOWN_TOKEN lens_tint");
    });
  });

  // --- INV-2: Prescription data is encrypted at rest and never logged ---

  describe("INV-2: Privacy & Error Logging", () => {
    it("forces a render error and asserts the thrown message and captured logs contain no Rx value", async () => {
      const sensitiveNotes = "SensitivePatientDiagnosis-998877";
      const sensitiveData: TicketData = {
        ...baseFixture,
        labCodeTemplate: "PO-[unclosed_token", // Invalid template causing compileLabCode to throw
        prescription: {
          od: { sph: -775, cyl: -125, axis: 137, add: 250 },
          os: { sph: -625, cyl: -75, axis: 42, add: 250 },
          pd: { single: 645 },
          notes: sensitiveNotes,
        },
      };

      const spyLog = vi.spyOn(console, "log");
      const spyError = vi.spyOn(console, "error");
      const spyWarn = vi.spyOn(console, "warn");

      // Test renderCsv error safety
      expect(() => renderCsv(sensitiveData)).toThrow();
      try {
        renderCsv(sensitiveData);
      } catch (err: unknown) {
        const msg = (err as Error).message;
        expect(msg).not.toContain("-7.75");
        expect(msg).not.toContain("-775");
        expect(msg).not.toContain("-1.25");
        expect(msg).not.toContain("-125");
        expect(msg).not.toContain("137");
        expect(msg).not.toContain("+2.50");
        expect(msg).not.toContain("-6.25");
        expect(msg).not.toContain("64.5");
        expect(msg).not.toContain(sensitiveNotes);
      }

      // Test renderPdf error safety
      await expect(renderPdf(sensitiveData)).rejects.toThrow();
      try {
        await renderPdf(sensitiveData);
      } catch (err: unknown) {
        const msg = (err as Error).message;
        expect(msg).not.toContain("-7.75");
        expect(msg).not.toContain("-775");
        expect(msg).not.toContain("-1.25");
        expect(msg).not.toContain("-125");
        expect(msg).not.toContain("137");
        expect(msg).not.toContain("+2.50");
        expect(msg).not.toContain("-6.25");
        expect(msg).not.toContain("64.5");
        expect(msg).not.toContain(sensitiveNotes);
      }

      // Verify no logs occurred containing sensitive Rx data
      for (const spy of [spyLog, spyError, spyWarn]) {
        for (const call of spy.mock.calls) {
          const joined = call.map(String).join(" ");
          expect(joined).not.toContain("-7.75");
          expect(joined).not.toContain("-1.25");
          expect(joined).not.toContain("137");
          expect(joined).not.toContain(sensitiveNotes);
        }
      }

      spyLog.mockRestore();
      spyError.mockRestore();
      spyWarn.mockRestore();
    });
  });

  // --- Self-check 1: CSV injection ---

  describe("Self-check 1: CSV Injection protection", () => {
    it("prefixes values starting with =, +, -, @ with ' on non-diopter fields", () => {
      // Equals
      expect(escapeCsvCell("=1+1", false)).toBe("'=1+1");
      expect(escapeCsvCell("=CMD('calc')", false)).toBe("'=CMD('calc')");
      expect(escapeCsvCell('=CMD("calc")', false)).toBe('"\'=CMD(""calc"")"');

      // Plus
      expect(escapeCsvCell("+SUM(A1:A5)", false)).toBe("'+SUM(A1:A5)");
      expect(escapeCsvCell("+Special Frame", false)).toBe("'+Special Frame");

      // Minus
      expect(escapeCsvCell("-Frame SKU", false)).toBe("'-Frame SKU");
      expect(escapeCsvCell("-50mm", false)).toBe("'-50mm");

      // At
      expect(escapeCsvCell("@admin", false)).toBe("'@admin");
      expect(escapeCsvCell("@special", false)).toBe("'@special");
    });

    it("does NOT prefix numeric diopter columns even when starting with - or +", () => {
      // Negative diopter SPH
      expect(escapeCsvCell("-2.25", true)).toBe("-2.25");
      // Positive diopter SPH / ADD
      expect(escapeCsvCell("+0.25", true)).toBe("+0.25");
      expect(escapeCsvCell("+2.00", true)).toBe("+2.00");
      // Plano SPH
      expect(escapeCsvCell("PL", true)).toBe("PL");
      // Negative CYL
      expect(escapeCsvCell("-0.50", true)).toBe("-0.50");
    });

    it("verifies CSV injection in renderCsv for frame title and notes vs diopters", () => {
      const data: TicketData = {
        ...baseFixture,
        frameTitle: "-HostileFrame",
        notes: "@Attn: Lab Lead",
        prescription: {
          od: { sph: -225, cyl: -50, axis: 180, add: 200 },
          os: { sph: 25, add: 200 },
          pd: { single: 635 },
        },
      };

      const csv = renderCsv(data).toString("utf-8");

      // frameTitle is prefixed with '
      expect(csv).toContain("'-HostileFrame");
      // notes is prefixed with '
      expect(csv).toContain("'@Attn: Lab Lead");
      // diopter values are NOT prefixed with '
      expect(csv).toContain("-2.25");
      expect(csv).not.toContain("'-2.25");
      expect(csv).toContain("+0.25");
      expect(csv).not.toContain("'+0.25");
      expect(csv).toContain("+2.00");
      expect(csv).not.toContain("'+2.00");
    });
  });

  // --- Additional edge cases & logic checklist ---

  describe("Additional edge cases and formatting", () => {
    it("handles plano SPH (0 hundredths) as PL", async () => {
      const data: TicketData = {
        ...baseFixture,
        prescription: {
          od: { sph: 0 },
          os: { sph: 0 },
          pd: { single: 620 },
        },
      };

      const csv = renderCsv(data).toString("utf-8");
      expect(csv).toContain(",OD,PL,,,,62.0,");
      expect(csv).toContain(",OS,PL,,,,62.0,");

      const pdfText = await extractPdfText(await renderPdf(data));
      expect(pdfText).toContain("PL");
    });

    it("handles dual PD correctly per eye in CSV and PDF", async () => {
      const data: TicketData = {
        ...baseFixture,
        prescription: {
          od: { sph: -150 },
          os: { sph: -175 },
          pd: { od: 315, os: 320 },
        },
      };

      const csv = renderCsv(data).toString("utf-8");
      // OD has 31.5, OS has 32.0
      expect(csv).toContain(",OD,-1.50,,,,31.5,");
      expect(csv).toContain(",OS,-1.75,,,,32.0,");

      const pdfText = await extractPdfText(await renderPdf(data));
      expect(pdfText).toContain("31.5/32.0");
    });

    it("compiles options tokens and segment overrides into lab code", async () => {
      const data: TicketData = {
        ...baseFixture,
        labCodeTemplate: "PO-58-[lens_type=NONE]-[lens_color=NONE]-00",
        options: [
          { tokenKey: "lens_type", tokenValue: "POLR" },
          { tokenKey: "lens_color", tokenValue: "GREY" },
          { segment: "material", overrideCode: "PO-67" },
        ],
      };

      const csv = renderCsv(data).toString("utf-8");
      expect(csv).toContain("PO-67-POLR-GREY-00");

      const pdfText = await extractPdfText(await renderPdf(data));
      expect(pdfText).toContain("PO-67-POLR-GREY-00");
    });

    it("handles non-ASCII characters and long strings safely", async () => {
      const longTitle = "Frame-".repeat(100) + "メガネ";
      const data: TicketData = {
        ...baseFixture,
        frameTitle: longTitle,
        notes: "日本語の処方箋ノート",
      };

      const csv = renderCsv(data).toString("utf-8");
      expect(csv).toContain(longTitle);
      expect(csv).toContain("日本語の処方箋ノート");

      const pdfBuf = await renderPdf(data);
      expect(pdfBuf.length).toBeGreaterThan(1000);
    });

    it("handles missing optional fields cleanly without throwing", async () => {
      const minimalData: TicketData = {
        orderName: "#2000",
        frameTitle: "Basic Frame",
        lensName: "Basic Lens",
        labCodeTemplate: "BASIC-CODE",
        source: "MANUAL",
      };

      const csv = renderCsv(minimalData).toString("utf-8");
      expect(csv).toContain("#2000");
      expect(csv).toContain("BASIC-CODE");

      const pdfBuf = await renderPdf(minimalData);
      expect(pdfBuf.length).toBeGreaterThan(1000);
      const pdfText = await extractPdfText(pdfBuf);
      expect(pdfText).toContain("BASIC-CODE");
      expect(pdfText).toContain("Order: #2000");
    });
  });
});
