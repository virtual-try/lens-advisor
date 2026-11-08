import type { OptionValue } from "../types/index.js";
import {
  LAB_CODE_WARNING_CODES,
  type CompileLabCodeResult,
  type LabCodeSelectionItem,
  type LabCodeSelectionsInput,
  type LensOrTemplate,
} from "./types.js";
import { validateTemplate } from "./validator.js";

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

  function recordOverride(target: string, code: string) {
    overrideMap.set(target.toLowerCase(), code);
  }

  function processItem(item: OptionValue | LabCodeSelectionItem) {
    if (!item || typeof item !== "object") return;
    const sel = item as LabCodeSelectionItem;

    if (sel.overrideCode) {
      const target = sel.segment !== undefined ? String(sel.segment).toLowerCase() : "material";
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

  const hasMaterialToken = validation.tokens.some(
    (t) => t.key.toLowerCase() === "material",
  );
  const materialOverride =
    overrideMap.get("material") ?? overrideMap.get("first") ?? overrideMap.get("0");

  const firstToken = validation.tokens[0];
  const prefixRaw = template.slice(0, firstToken.startIndex);

  let prefix = prefixRaw;
  if (!hasMaterialToken && materialOverride !== undefined && prefixRaw.length > 0) {
    if (prefixRaw.endsWith("-")) {
      prefix = materialOverride + "-";
    } else {
      prefix = materialOverride;
    }
  }

  let result = prefix;

  for (let i = 0; i < validation.tokens.length; i++) {
    const tok = validation.tokens[i];
    let tokenVal: string;

    const overrideVal =
      overrideMap.get(tok.key.toLowerCase()) ??
      (i === 0 && hasMaterialToken ? materialOverride : undefined);

    if (overrideVal !== undefined) {
      // Override wins over token targeting the same segment
      tokenVal = overrideVal;
    } else if (tokenMap.has(tok.key)) {
      tokenVal = tokenMap.get(tok.key)!;
    } else {
      tokenVal = tok.defaultValue;
    }

    result += tokenVal;

    if (i < validation.tokens.length - 1) {
      // Literal text between tokens, copied byte-for-byte
      result += template.slice(tok.endIndex, validation.tokens[i + 1].startIndex);
    } else {
      // Literal text after the last token, copied byte-for-byte
      result += template.slice(tok.endIndex);
    }
  }

  return { code: result, warnings };
}
