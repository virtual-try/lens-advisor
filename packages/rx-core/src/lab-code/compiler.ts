import type { OptionValue } from "../types/index.js";
import {
  LAB_CODE_WARNING_CODES,
  type CompileLabCodeResult,
  type LabCodeSelectionItem,
  type LabCodeSelectionsInput,
  type LensOrTemplate,
} from "./types.js";
import { validateTemplate } from "./validator.js";

interface TemplateSegment {
  index: number;
  positionName?: string;
  tokenKey?: string;
  defaultValue?: string;
  literalText?: string;
  separatorBefore: string;
}

function parseSelections(
  selections: LabCodeSelectionsInput | undefined,
  knownTokenKeys: Set<string>,
): {
  tokenMap: Map<string, string>;
  overrideMap: Map<string, string>;
  warnings: string[];
} {
  const tokenMap = new Map<string, string>();
  const overrideMap = new Map<string, string>();
  const warnings: string[] = [];

  function recordToken(key: string, value: string) {
    tokenMap.set(key, value);
    if (!knownTokenKeys.has(key)) {
      const warn = `${LAB_CODE_WARNING_CODES.UNKNOWN_TOKEN} ${key}`;
      if (!warnings.includes(warn)) {
        warnings.push(warn);
      }
    }
  }

  function recordOverride(target: string | number, code: string) {
    overrideMap.set(String(target).toLowerCase(), code);
  }

  function processItem(item: OptionValue | LabCodeSelectionItem) {
    if (!item || typeof item !== "object") return;
    const sel = item as LabCodeSelectionItem;

    if (sel.overrideCode) {
      let target: string | number = "material";
      if (sel.position !== undefined) {
        target = sel.position;
      } else if (sel.segment !== undefined) {
        target = sel.segment;
      } else if (sel.groupKind) {
        const k = String(sel.groupKind).toUpperCase();
        if (k === "MATERIAL") target = "material";
        else if (k === "TINT_TYPE") target = "lens_type";
        else if (k === "COLOR") target = "lens_color";
        else target = k.toLowerCase();
      } else if (sel.tokenKey) {
        target = sel.tokenKey;
      } else if (sel.key) {
        target = sel.key;
      }
      recordOverride(target, sel.overrideCode);
    }

    const tokenKey = sel.tokenKey ?? sel.key;
    const tokenVal = sel.tokenValue ?? sel.value;
    if (tokenKey !== undefined && tokenVal !== undefined) {
      recordToken(tokenKey, String(tokenVal));
    }
  }

  if (Array.isArray(selections)) {
    for (const item of selections) {
      processItem(item as OptionValue | LabCodeSelectionItem);
    }
  } else if (selections && typeof selections === "object") {
    const selObj = selections as Record<string, unknown>;

    if (Array.isArray(selObj.options)) {
      for (const item of selObj.options) {
        processItem(item as OptionValue | LabCodeSelectionItem);
      }
    }
    if (Array.isArray(selObj.optionValues)) {
      for (const item of selObj.optionValues) {
        processItem(item as OptionValue | LabCodeSelectionItem);
      }
    }

    if (selObj.tokens && typeof selObj.tokens === "object") {
      for (const [k, v] of Object.entries(selObj.tokens as Record<string, unknown>)) {
        if (v !== undefined && v !== null) {
          recordToken(k, String(v));
        }
      }
    }

    if (selObj.overrides && typeof selObj.overrides === "object") {
      for (const [k, v] of Object.entries(selObj.overrides as Record<string, unknown>)) {
        if (v !== undefined && v !== null) {
          recordOverride(k, String(v));
        }
      }
    }

    for (const [k, v] of Object.entries(selObj)) {
      if (k === "tokens" || k === "overrides" || k === "options" || k === "optionValues") {
        continue;
      }
      if (typeof v === "string") {
        if (k.toLowerCase() === "material" && !knownTokenKeys.has("material")) {
          recordOverride("material", v);
        } else {
          recordToken(k, v);
        }
      }
    }
  }

  return { tokenMap, overrideMap, warnings };
}

/**
 * Compiles a lab code from a base lens template and customer selections.
 *
 * - Bracketed tokens `[key=DEFAULT]` are replaced with selected token values or default.
 * - Dash-separated segment overrides (e.g. `material` -> the first segment) replace whole segments.
 * - Override wins over token targeting the same segment.
 * - Unknown token keys are reported in `warnings` as `UNKNOWN_TOKEN <key>`.
 * - Token values are inserted literally and never interpreted as regex.
 * - A template with no tokens compiles to itself for any selections.
 */
export function compileLabCode(
  lensOrTemplate: LensOrTemplate,
  selections?: LabCodeSelectionsInput,
): CompileLabCodeResult {
  const template =
    typeof lensOrTemplate === "string"
      ? lensOrTemplate
      : (lensOrTemplate?.labCodeTemplate ?? "");

  if (template.trim().length === 0) {
    return { code: template, warnings: [] };
  }

  const validation = validateTemplate(template);
  if (!validation.valid) {
    throw new Error(`Invalid lab code template: ${validation.error}`);
  }

  const knownTokenKeys = new Set(validation.tokens.map((t) => t.key));
  const { tokenMap, overrideMap, warnings } = parseSelections(selections, knownTokenKeys);

  // Property: a template with no tokens compiles to itself for any selections
  if (validation.tokens.length === 0) {
    return { code: template, warnings };
  }

  const segments: TemplateSegment[] = [];

  // Prefix before the first token
  const prefixRaw = template.slice(0, validation.tokens[0].startIndex);
  if (prefixRaw.length > 0) {
    const trimmed = prefixRaw.endsWith("-") ? prefixRaw.slice(0, -1) : prefixRaw;
    segments.push({
      index: 0,
      positionName: "material",
      literalText: trimmed,
      separatorBefore: "",
    });
  }

  // Tokens and intermediate segments
  for (let i = 0; i < validation.tokens.length; i++) {
    if (i > 0) {
      const middleRaw = template.slice(
        validation.tokens[i - 1].endIndex,
        validation.tokens[i].startIndex,
      );
      if (middleRaw !== "-" && middleRaw.length > 0) {
        const trimmed = middleRaw.replace(/^-/, "").replace(/-$/, "");
        if (trimmed.length > 0) {
          segments.push({
            index: segments.length,
            literalText: trimmed,
            separatorBefore: "-",
          });
        }
      }
    }

    const tok = validation.tokens[i];
    const segIndex = segments.length;
    const sep = segIndex === 0 ? "" : "-";
    segments.push({
      index: segIndex,
      positionName: tok.key,
      tokenKey: tok.key,
      defaultValue: tok.defaultValue,
      separatorBefore: sep,
    });
  }

  // Suffix after the last token
  const suffixRaw = template.slice(validation.tokens[validation.tokens.length - 1].endIndex);
  if (suffixRaw.length > 0) {
    const trimmed = suffixRaw.startsWith("-") ? suffixRaw.slice(1) : suffixRaw;
    if (trimmed.length > 0) {
      segments.push({
        index: segments.length,
        literalText: trimmed,
        separatorBefore: "-",
      });
    }
  }

  // Compile segments
  let result = "";
  for (const seg of segments) {
    let segVal: string;

    // Check if an override matches this segment
    let overrideVal: string | undefined;

    if (overrideMap.has(String(seg.index))) {
      overrideVal = overrideMap.get(String(seg.index));
    } else if (seg.index === 0 && overrideMap.has("material")) {
      overrideVal = overrideMap.get("material");
    } else if (seg.index === 0 && overrideMap.has("first")) {
      overrideVal = overrideMap.get("first");
    } else if (seg.positionName && overrideMap.has(seg.positionName.toLowerCase())) {
      overrideVal = overrideMap.get(seg.positionName.toLowerCase());
    } else if (seg.tokenKey && overrideMap.has(seg.tokenKey.toLowerCase())) {
      overrideVal = overrideMap.get(seg.tokenKey.toLowerCase());
    }

    if (overrideVal !== undefined) {
      // Override wins over token for the same segment
      segVal = overrideVal;
    } else if (seg.tokenKey) {
      if (tokenMap.has(seg.tokenKey)) {
        segVal = tokenMap.get(seg.tokenKey)!;
      } else {
        segVal = seg.defaultValue ?? "";
      }
    } else {
      segVal = seg.literalText ?? "";
    }

    result += seg.separatorBefore + segVal;
  }

  return { code: result, warnings };
}
