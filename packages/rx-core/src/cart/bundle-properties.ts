import { formatEye, formatPd } from "../format/index.js";
import type { Prescription } from "../schemas/prescription.js";

export const BUNDLE_ROLES = ["frame", "lens", "option", "addon"] as const;
export type BundleRole = (typeof BUNDLE_ROLES)[number];

export const BUNDLE_PROPERTY_KEYS = {
  bundleId: "_bundle_id",
  bundleRole: "_bundle_role",
  itemId: "_item_id",
  optionIds: "_option_ids",
  addonIds: "_addon_ids",
  rxRef: "_rx_ref",
  rxOd: "_rx_od",
  rxOs: "_rx_os",
  rxPd: "_rx_pd",
  prescription: "Prescription",
} as const;

export const PRESCRIPTION_ON_FILE = "Prescription on file";

const ROLE_SET: ReadonlySet<string> = new Set(BUNDLE_ROLES);

export interface FormattedRxProperties {
  od: string;
  os: string;
  pd: string;
}

export interface BuildBundleLinePropertiesInput {
  role: BundleRole;
  bundleId: string;
  itemId?: string;
  optionIds?: readonly string[];
  addonIds?: readonly string[];
  rxRef?: string;
  storeRxInOrder: boolean;
  /**
   * Typed Rx. Written as `_rx_od` / `_rx_os` / `_rx_pd` on the lens line
   * only when `storeRxInOrder` is true. Ignored (never copied into values)
   * when the setting is off.
   */
  prescription?: Prescription;
  /**
   * Pre-formatted Rx property values for reader round-trip. Used when
   * `prescription` is absent and `storeRxInOrder` is true.
   */
  formattedRx?: FormattedRxProperties;
}

export interface ParsedBundleLineProperties {
  role?: BundleRole;
  bundleId?: string;
  itemId?: string;
  optionIds?: string[];
  addonIds?: string[];
  rxRef?: string;
  storeRxInOrder: boolean;
  prescriptionOnFile: boolean;
  formattedRx?: FormattedRxProperties;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/**
 * JSON array, not a comma join. Ids may contain commas, quotes, spaces,
 * or non-ASCII, and those bytes have to come back unchanged.
 */
function encodeIdList(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

/**
 * Inverse of `encodeIdList`. A missing key stays undefined. Text that is
 * not a JSON array of strings is omitted. Never throws.
 */
function decodeIdList(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (isStringArray(parsed)) {
      return parsed;
    }
  } catch {
    // Hostile property text is not a list.
  }
  return undefined;
}

function parseRole(value: string | undefined): BundleRole | undefined {
  if (value !== undefined && ROLE_SET.has(value)) {
    return value as BundleRole;
  }
  return undefined;
}

function formattedRxFrom(
  input: BuildBundleLinePropertiesInput,
): FormattedRxProperties | undefined {
  if (!input.storeRxInOrder || input.role !== "lens") {
    return undefined;
  }
  if (input.prescription) {
    return {
      od: formatEye(input.prescription.od),
      os: formatEye(input.prescription.os),
      pd: formatPd(input.prescription.pd),
    };
  }
  return input.formattedRx;
}

/**
 * Cart line properties for one nested-bundle line. Frame is the parent;
 * lens / option / addon are children. Rx values are written only when
 * `storeRxInOrder` is on, and only on the lens line.
 */
export function buildBundleLineProperties(
  input: BuildBundleLinePropertiesInput,
): Record<string, string> {
  const properties: Record<string, string> = {
    [BUNDLE_PROPERTY_KEYS.bundleId]: input.bundleId,
    [BUNDLE_PROPERTY_KEYS.bundleRole]: input.role,
  };

  if (input.role !== "frame" && input.itemId !== undefined) {
    properties[BUNDLE_PROPERTY_KEYS.itemId] = input.itemId;
  }

  if (input.role === "lens") {
    properties[BUNDLE_PROPERTY_KEYS.optionIds] = encodeIdList(
      input.optionIds ?? [],
    );
    properties[BUNDLE_PROPERTY_KEYS.addonIds] = encodeIdList(
      input.addonIds ?? [],
    );
    if (input.rxRef !== undefined) {
      properties[BUNDLE_PROPERTY_KEYS.rxRef] = input.rxRef;
    }

    if (input.storeRxInOrder) {
      const formatted = formattedRxFrom(input);
      if (formatted) {
        properties[BUNDLE_PROPERTY_KEYS.rxOd] = formatted.od;
        properties[BUNDLE_PROPERTY_KEYS.rxOs] = formatted.os;
        properties[BUNDLE_PROPERTY_KEYS.rxPd] = formatted.pd;
      }
    } else {
      properties[BUNDLE_PROPERTY_KEYS.prescription] = PRESCRIPTION_ON_FILE;
    }
  }

  return properties;
}

/**
 * Read cart line properties back into a structured snapshot. Missing
 * optional keys (a frame line has no `_rx_ref`) are omitted; never throws.
 */
export function readBundleProperties(
  properties: Record<string, string>,
): ParsedBundleLineProperties {
  const role = parseRole(properties[BUNDLE_PROPERTY_KEYS.bundleRole]);
  const bundleId = properties[BUNDLE_PROPERTY_KEYS.bundleId];
  const itemId = properties[BUNDLE_PROPERTY_KEYS.itemId];
  const rxRef = properties[BUNDLE_PROPERTY_KEYS.rxRef];
  const rxOd = properties[BUNDLE_PROPERTY_KEYS.rxOd];
  const rxOs = properties[BUNDLE_PROPERTY_KEYS.rxOs];
  const rxPd = properties[BUNDLE_PROPERTY_KEYS.rxPd];
  const prescriptionValue = properties[BUNDLE_PROPERTY_KEYS.prescription];

  const hasFormattedRx =
    rxOd !== undefined || rxOs !== undefined || rxPd !== undefined;
  const prescriptionOnFile = prescriptionValue === PRESCRIPTION_ON_FILE;
  // Lens lines omit the visible Prescription key when the shop stores Rx
  // in the order, even if this particular line has no formatted values yet.
  const storeRxInOrder = role === "lens" && !prescriptionOnFile;

  const parsed: ParsedBundleLineProperties = {
    storeRxInOrder,
    prescriptionOnFile,
  };

  if (role !== undefined) {
    parsed.role = role;
  }
  if (bundleId !== undefined) {
    parsed.bundleId = bundleId;
  }
  if (itemId !== undefined) {
    parsed.itemId = itemId;
  }
  if (rxRef !== undefined) {
    parsed.rxRef = rxRef;
  }

  const optionIds = decodeIdList(properties[BUNDLE_PROPERTY_KEYS.optionIds]);
  if (optionIds !== undefined) {
    parsed.optionIds = optionIds;
  }
  const addonIds = decodeIdList(properties[BUNDLE_PROPERTY_KEYS.addonIds]);
  if (addonIds !== undefined) {
    parsed.addonIds = addonIds;
  }

  if (hasFormattedRx) {
    parsed.formattedRx = {
      od: rxOd ?? "",
      os: rxOs ?? "",
      pd: rxPd ?? "",
    };
  }

  return parsed;
}

/** Rebuild builder input from a reader snapshot (property-test round-trip). */
export function parsedToBuildInput(
  parsed: ParsedBundleLineProperties,
): BuildBundleLinePropertiesInput {
  const input: BuildBundleLinePropertiesInput = {
    role: parsed.role ?? "frame",
    bundleId: parsed.bundleId ?? "",
    storeRxInOrder: parsed.storeRxInOrder,
  };
  if (parsed.itemId !== undefined) {
    input.itemId = parsed.itemId;
  }
  if (parsed.optionIds !== undefined) {
    input.optionIds = parsed.optionIds;
  }
  if (parsed.addonIds !== undefined) {
    input.addonIds = parsed.addonIds;
  }
  if (parsed.rxRef !== undefined) {
    input.rxRef = parsed.rxRef;
  }
  if (parsed.formattedRx !== undefined) {
    input.formattedRx = parsed.formattedRx;
  }
  return input;
}
