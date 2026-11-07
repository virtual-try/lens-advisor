import { describe, expect, it } from "vitest";
import { formatAxis, formatDiopter, formatPd } from "../format/index.js";
import {
  RX_ERROR_CODES,
  parseAddText,
  parseAxis,
  parseCylText,
  parseDiopter,
  parseDiopterText,
  parseDualPd,
  parsePd,
  parseSphText,
} from "./parse.js";

describe("Spec 10 — Rx parser", () => {
  describe("parseDiopterText (Examples table)", () => {
    it("parses normal negative diopter '-2.25' to -225", () => {
      const res = parseDiopterText("-2.25");
      expect(res).toEqual({ ok: true, value: -225 });
    });

    it("parses Unicode minus '−2.25' (U+2212) to -225", () => {
      const res = parseDiopterText("−2.25");
      expect(res).toEqual({ ok: true, value: -225 });
    });

    it("parses comma decimal '-2,25' to -225", () => {
      const res = parseDiopterText("-2,25");
      expect(res).toEqual({ ok: true, value: -225 });
    });

    it("parses plano inputs 'PL', 'plano', '0' to 0", () => {
      expect(parseDiopterText("PL")).toEqual({ ok: true, value: 0 });
      expect(parseDiopterText("plano")).toEqual({ ok: true, value: 0 });
      expect(parseDiopterText("0")).toEqual({ ok: true, value: 0 });
      expect(parseDiopterText("pl")).toEqual({ ok: true, value: 0 });
      expect(parseDiopterText("Plano")).toEqual({ ok: true, value: 0 });
      expect(parseDiopterText("0.00")).toEqual({ ok: true, value: 0 });
    });

    it("rejects non-quarter step '2.3' with SPH_STEP", () => {
      const res = parseDiopterText("2.3");
      expect(res).toEqual({ ok: false, error: RX_ERROR_CODES.SPH_STEP });
    });

    it("accepts boundary '+20.00' and rejects '+20.25' with SPH_RANGE", () => {
      expect(parseDiopterText("+20.00")).toEqual({ ok: true, value: 2000 });
      expect(parseDiopterText("+20.25")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.SPH_RANGE,
      });
      expect(parseDiopterText("-20.00")).toEqual({ ok: true, value: -2000 });
      expect(parseDiopterText("-20.25")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.SPH_RANGE,
      });
    });

    it("returns INVALID on hostile inputs ('', 'abc', 500 chars) without throwing", () => {
      expect(parseDiopterText("")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
      expect(parseDiopterText("abc")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
      const hostileLong = "9".repeat(500);
      expect(parseDiopterText(hostileLong)).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
      expect(parseDiopterText("   ")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
      expect(parseDiopterText("++1.00")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
      expect(parseDiopterText("--1.00")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
    });
  });

  describe("PD parsing (Examples table)", () => {
    it("parses single PD '63.5' to 635", () => {
      const res = parsePd("63.5");
      expect(res).toEqual({ ok: true, value: 635 });
    });

    it("rejects single PD non-half step '63.3' with PD_STEP", () => {
      const res = parsePd("63.3");
      expect(res).toEqual({ ok: false, error: RX_ERROR_CODES.PD_STEP });
    });
  });

  describe("Self-check 1 — float error avoidance and -0.75", () => {
    it("parses '-0.75' via string parsing without float drift", () => {
      const res = parseDiopterText("-0.75");
      expect(res).toEqual({ ok: true, value: -75 });
      if (res.ok) {
        expect(res.value).toBe(-75);
        expect(Number.isInteger(res.value)).toBe(true);
      }
    });

    it("parses leading decimal '-.75' and '.75'", () => {
      expect(parseDiopterText("-.75")).toEqual({ ok: true, value: -75 });
      expect(parseDiopterText(".75")).toEqual({ ok: true, value: 75 });
      expect(parseDiopterText("+0.50")).toEqual({ ok: true, value: 50 });
      expect(parseDiopterText("2.5")).toEqual({ ok: true, value: 250 });
    });
  });

  describe("Self-check 2 — '-0' and '-0.00' parse to 0, not -0", () => {
    it("parses '-0' to +0 (Object.is check)", () => {
      const res = parseDiopterText("-0");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe(0);
        expect(Object.is(res.value, -0)).toBe(false);
        expect(Object.is(res.value, 0)).toBe(true);
        expect(1 / res.value).toBe(Infinity);
      }
    });

    it("parses '-0.00' to +0 (Object.is check)", () => {
      const res = parseDiopterText("-0.00");
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe(0);
        expect(Object.is(res.value, -0)).toBe(false);
        expect(Object.is(res.value, 0)).toBe(true);
        expect(1 / res.value).toBe(Infinity);
      }
    });

    it("parses '−0.00' (Unicode minus) and '-0,00' (comma) to +0", () => {
      const uRes = parseDiopterText("−0.00");
      expect(uRes.ok).toBe(true);
      if (uRes.ok) {
        expect(Object.is(uRes.value, -0)).toBe(false);
      }

      const cRes = parseDiopterText("-0,00");
      expect(cRes.ok).toBe(true);
      if (cRes.ok) {
        expect(Object.is(cRes.value, -0)).toBe(false);
      }
    });
  });

  describe("Round-trip property test over all legal SPH values", () => {
    it("round-trips parse(formatDiopter(x)) == x for every legal SPH hundredths (-2000 to +2000)", () => {
      let count = 0;
      for (let sph = -2000; sph <= 2000; sph += 25) {
        const formatted = formatDiopter(sph);
        const parsed = parseDiopterText(formatted);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(parsed.value).toBe(sph);
          expect(Number.isInteger(parsed.value)).toBe(true);
        }
        count++;
      }
      expect(count).toBe(161);
    });

    it("alias parseDiopter behaves identically to parseDiopterText", () => {
      expect(parseDiopter("-2.25")).toEqual(parseDiopterText("-2.25"));
      expect(parseDiopter("PL")).toEqual(parseDiopterText("PL"));
    });
  });

  describe("parseAxis", () => {
    it("parses legal axis 1–180", () => {
      expect(parseAxis("1")).toEqual({ ok: true, value: 1 });
      expect(parseAxis("90")).toEqual({ ok: true, value: 90 });
      expect(parseAxis("090")).toEqual({ ok: true, value: 90 });
      expect(parseAxis("180")).toEqual({ ok: true, value: 180 });
    });

    it("round-trips axis formatted by formatAxis", () => {
      for (let deg = 1; deg <= 180; deg++) {
        const formatted = formatAxis(deg);
        const parsed = parseAxis(formatted);
        expect(parsed).toEqual({ ok: true, value: deg });
        if (parsed.ok) {
          expect(Number.isInteger(parsed.value)).toBe(true);
        }
      }
    });

    it("rejects axis out of range 1–180 with AXIS_RANGE", () => {
      expect(parseAxis("0")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.AXIS_RANGE,
      });
      expect(parseAxis("181")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.AXIS_RANGE,
      });
      expect(parseAxis("-10")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
    });

    it("rejects hostile and non-integer axis with INVALID", () => {
      expect(parseAxis("")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
      expect(parseAxis("abc")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
      expect(parseAxis("90.5")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.INVALID,
      });
    });
  });

  describe("parsePd and parseDualPd", () => {
    it("parses single PD range 50.0–80.0 mm in 0.5 mm steps", () => {
      expect(parsePd("50.0")).toEqual({ ok: true, value: 500 });
      expect(parsePd("80.0")).toEqual({ ok: true, value: 800 });
      expect(parsePd("63.0")).toEqual({ ok: true, value: 630 });
      expect(parsePd("63")).toEqual({ ok: true, value: 630 });
      expect(parsePd("63,5")).toEqual({ ok: true, value: 635 });
    });

    it("rejects single PD outside 50.0–80.0 with PD_RANGE", () => {
      expect(parsePd("49.5")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.PD_RANGE,
      });
      expect(parsePd("80.5")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.PD_RANGE,
      });
    });

    it("parses dual PD range 25.0–40.0 mm in 0.5 mm steps", () => {
      expect(parsePd("25.0", { dual: true })).toEqual({ ok: true, value: 250 });
      expect(parsePd("40.0", { dual: true })).toEqual({ ok: true, value: 400 });
      expect(parsePd("32.5", { dual: true })).toEqual({ ok: true, value: 325 });
    });

    it("rejects dual PD outside 25.0–40.0 with PD_RANGE", () => {
      expect(parsePd("24.5", { dual: true })).toEqual({
        ok: false,
        error: RX_ERROR_CODES.PD_RANGE,
      });
      expect(parsePd("40.5", { dual: true })).toEqual({
        ok: false,
        error: RX_ERROR_CODES.PD_RANGE,
      });
    });

    it("parses dual PD pair via parseDualPd", () => {
      const res = parseDualPd("32.5", "31.0");
      expect(res).toEqual({
        ok: true,
        value: { od: 325, os: 310 },
      });
    });

    it("round-trips PD formatted by formatPd", () => {
      for (let tenths = 500; tenths <= 800; tenths += 5) {
        const formatted = formatPd({ single: tenths });
        const parsed = parsePd(formatted);
        expect(parsed).toEqual({ ok: true, value: tenths });
        if (parsed.ok) {
          expect(Number.isInteger(parsed.value)).toBe(true);
        }
      }
    });
  });

  describe("Field helpers: parseSphText, parseCylText, parseAddText", () => {
    it("parseSphText enforces SPH limits", () => {
      expect(parseSphText("-2.25")).toEqual({ ok: true, value: -225 });
      expect(parseSphText("+20.25")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.SPH_RANGE,
      });
      expect(parseSphText("1.3")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.SPH_STEP,
      });
    });

    it("parseCylText enforces CYL limits (−6.00..+6.00 in 0.25 steps)", () => {
      expect(parseCylText("-1.25")).toEqual({ ok: true, value: -125 });
      expect(parseCylText("+6.00")).toEqual({ ok: true, value: 600 });
      expect(parseCylText("-6.00")).toEqual({ ok: true, value: -600 });
      expect(parseCylText("0")).toEqual({ ok: true, value: 0 });
      expect(parseCylText("-6.25")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.CYL_RANGE,
      });
      expect(parseCylText("+6.25")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.CYL_RANGE,
      });
      expect(parseCylText("-1.10")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.CYL_STEP,
      });
    });

    it("parseAddText enforces ADD limits (+0.75..+3.50 in 0.25 steps)", () => {
      expect(parseAddText("+0.75")).toEqual({ ok: true, value: 75 });
      expect(parseAddText("+3.50")).toEqual({ ok: true, value: 350 });
      expect(parseAddText("2.25")).toEqual({ ok: true, value: 225 });
      expect(parseAddText("+0.50")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
      expect(parseAddText("+3.75")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
      expect(parseAddText("-1.00")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
      expect(parseAddText("+2.30")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_STEP,
      });
    });

    it("parseAddText rejects plano and zero inputs with ADD_RANGE (R1-F1)", () => {
      expect(parseAddText("PL")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
      expect(parseAddText("plano")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
      expect(parseAddText("0")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
      expect(parseAddText("0.00")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
      expect(parseAddText("+0")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
      expect(parseAddText("-0")).toEqual({
        ok: false,
        error: RX_ERROR_CODES.ADD_RANGE,
      });
    });
  });

  describe("INV-5 — parsers return integers only", () => {
    it("asserts Number.isInteger on every parsed output", () => {
      const outputs = [
        parseDiopterText("-2.25"),
        parseDiopterText("PL"),
        parseDiopterText("+20.00"),
        parseDiopterText("-0.75"),
        parseSphText("-3.50"),
        parseCylText("-1.75"),
        parseAddText("+2.50"),
        parseAxis("90"),
        parseAxis("180"),
        parsePd("63.5"),
        parsePd("32.5", { dual: true }),
      ];

      for (const res of outputs) {
        expect(res.ok).toBe(true);
        if (res.ok) {
          expect(Number.isInteger(res.value)).toBe(true);
        }
      }

      const dualRes = parseDualPd("32.0", "31.5");
      expect(dualRes.ok).toBe(true);
      if (dualRes.ok) {
        expect(Number.isInteger(dualRes.value.od)).toBe(true);
        expect(Number.isInteger(dualRes.value.os)).toBe(true);
      }
    });
  });
});
