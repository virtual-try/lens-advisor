import { describe, expect, it } from "vitest";
import { formatDiopter, formatEye, formatPd } from "../format/index.js";
import {
  catalogResponseSchema,
  iso4217CurrencySchema,
  moneySchema,
  prescriptionSchema,
  prescriptionSubmitBodySchema,
} from "../schemas/index.js";
import {
  BUNDLE_PROPERTY_KEYS,
  PRESCRIPTION_ON_FILE,
  buildBundleLineProperties,
  readBundleProperties,
  type BuildBundleLinePropertiesInput,
  type BundleRole,
  type ParsedBundleLineProperties,
} from "./bundle-properties.js";

const distinctiveRx = prescriptionSchema.parse({
  od: { sph: -775, cyl: -125, axis: 137, add: 250 },
  os: { sph: -325, cyl: 75, axis: 42 },
  pd: { single: 645 },
});

const distinctiveFragments = [
  "7.75",
  "1.25",
  "2.50",
  "3.25",
  "0.75",
  "64.5",
  "137",
  "042",
  "+2.50",
  "-7.75",
  "-3.25",
  "+0.75",
  "-1.25",
];

function propertyValues(properties: Record<string, string>): string[] {
  return Object.values(properties);
}

/** Ids a comma-split would corrupt or drop. Included in the 200-case round-trip. */
const HOSTILE_IDS = ["opt,a", 'say"hi"', "透镜", " ", "", ","] as const;

/**
 * Observable snapshot from Examples: fields that do not apply are absent,
 * and `storeRxInOrder` is true only on a lens line whose input flag is true.
 * Independent of `readBundleProperties` — the property test compares the
 * reader to this contract.
 */
function normalizedBundleSnapshot(
  input: BuildBundleLinePropertiesInput,
): ParsedBundleLineProperties {
  const lens = input.role === "lens";
  const storeRxInOrder = lens && input.storeRxInOrder;
  const snapshot: ParsedBundleLineProperties = {
    role: input.role,
    bundleId: input.bundleId,
    storeRxInOrder,
    prescriptionOnFile: lens && !input.storeRxInOrder,
  };

  if (input.role !== "frame" && input.itemId !== undefined) {
    snapshot.itemId = input.itemId;
  }

  if (lens) {
    snapshot.optionIds = [...(input.optionIds ?? [])];
    snapshot.addonIds = [...(input.addonIds ?? [])];
    if (input.rxRef !== undefined) {
      snapshot.rxRef = input.rxRef;
    }
    if (storeRxInOrder && input.prescription) {
      snapshot.formattedRx = {
        od: formatEye(input.prescription.od),
        os: formatEye(input.prescription.os),
        pd: formatPd(input.prescription.pd),
      };
    } else if (storeRxInOrder && input.formattedRx) {
      snapshot.formattedRx = { ...input.formattedRx };
    }
  }

  return snapshot;
}

function generateBundle(index: number): BuildBundleLinePropertiesInput {
  const roles: BundleRole[] = ["frame", "lens", "option", "addon"];
  const role = roles[index % roles.length] ?? "frame";
  const storeRxInOrder = Math.floor(index / roles.length) % 2 === 0;
  const sphHundredths = ((index % 40) - 20) * 25;
  const cylHundredths = -((index % 8) * 25);
  const addHundredths = 75 + (index % 12) * 25;
  const axis = 1 + (index % 180);
  const pdTenths = 500 + (index % 300);

  const input: BuildBundleLinePropertiesInput = {
    role,
    bundleId: `bundle-${index}`,
    storeRxInOrder,
  };

  if (role !== "frame") {
    input.itemId = `item-${index}`;
  }

  if (role === "lens") {
    if (index % 3 === 0) {
      input.optionIds = [];
      input.addonIds = [];
    } else if (index % 3 === 1) {
      input.optionIds = [HOSTILE_IDS[index % HOSTILE_IDS.length] ?? "opt,a"];
      input.addonIds = ["only-addon"];
    } else {
      input.optionIds = [...HOSTILE_IDS, `opt-${index}`];
      input.addonIds = [...HOSTILE_IDS];
    }
    input.rxRef = `rx-${index}`;
    input.prescription = prescriptionSchema.parse({
      od: {
        sph: sphHundredths,
        ...(cylHundredths !== 0
          ? { cyl: cylHundredths, axis }
          : {}),
        ...(addHundredths !== 0 ? { add: addHundredths } : {}),
      },
      os: { sph: sphHundredths },
      pd: { single: pdTenths },
    });
  }

  return input;
}

describe("formatDiopter (Examples)", () => {
  it("formatDiopter(-225) → -2.25", () => {
    expect(formatDiopter(-225)).toBe("-2.25");
  });

  it("formatDiopter(25) → +0.25", () => {
    expect(formatDiopter(25)).toBe("+0.25");
  });

  it("formatDiopter(0) → PL", () => {
    expect(formatDiopter(0)).toBe("PL");
  });
});

describe("formatPd (Examples)", () => {
  it("formatPd({single: 635}) → 63.5", () => {
    expect(formatPd({ single: 635 })).toBe("63.5");
  });
});

describe("bundle properties, storeRxInOrder=false (INV-3)", () => {
  it("writes Prescription on file and no property value contains a formatted Rx number", () => {
    const properties = buildBundleLineProperties({
      role: "lens",
      bundleId: "bundle-alpha",
      itemId: "lens-alpha",
      optionIds: ["opt-clear"],
      addonIds: ["addon-case"],
      rxRef: "rx-opaque-ref",
      storeRxInOrder: false,
      prescription: distinctiveRx,
    });

    expect(properties[BUNDLE_PROPERTY_KEYS.prescription]).toBe(
      PRESCRIPTION_ON_FILE,
    );
    expect(properties[BUNDLE_PROPERTY_KEYS.rxRef]).toBe("rx-opaque-ref");
    expect(properties[BUNDLE_PROPERTY_KEYS.rxOd]).toBeUndefined();
    expect(properties[BUNDLE_PROPERTY_KEYS.rxOs]).toBeUndefined();
    expect(properties[BUNDLE_PROPERTY_KEYS.rxPd]).toBeUndefined();

    const values = propertyValues(properties);
    for (const fragment of distinctiveFragments) {
      for (const value of values) {
        expect(value).not.toContain(fragment);
      }
    }
  });
});

describe("bundle properties, storeRxInOrder=true (INV-3)", () => {
  it("writes every Rx key with an underscore prefix", () => {
    const properties = buildBundleLineProperties({
      role: "lens",
      bundleId: "bundle-alpha",
      itemId: "lens-alpha",
      optionIds: ["opt-clear"],
      addonIds: [],
      rxRef: "rx-opaque-ref",
      storeRxInOrder: true,
      prescription: distinctiveRx,
    });

    expect(properties[BUNDLE_PROPERTY_KEYS.prescription]).toBeUndefined();
    expect(properties[BUNDLE_PROPERTY_KEYS.rxOd]).toBe("-7.75/-1.25x137 ADD +2.50");
    expect(properties[BUNDLE_PROPERTY_KEYS.rxOs]).toBe("-3.25/+0.75x042");
    expect(properties[BUNDLE_PROPERTY_KEYS.rxPd]).toBe("64.5");

    const rxKeys = Object.keys(properties).filter((key) => {
      const value = properties[key];
      return distinctiveFragments.some((fragment) => value?.includes(fragment));
    });
    expect(rxKeys.length).toBeGreaterThan(0);
    for (const key of rxKeys) {
      expect(key.startsWith("_")).toBe(true);
    }
  });
});

describe("catalog JSON with float money (INV-4)", () => {
  it("rejects amountMinor: 12.5", () => {
    const result = moneySchema.safeParse({
      amountMinor: 12.5,
      currency: "USD",
    });
    expect(result.success).toBe(false);

    const catalogResult = catalogResponseSchema.safeParse({
      lensGroups: [
        {
          id: "g",
          name: "G",
          position: 0,
          lenses: [
            {
              id: "l",
              groupId: "g",
              name: "L",
              price: { amountMinor: 12.5, currency: "USD" },
              limits: {
                sphMin: -800,
                sphMax: 600,
                cylMin: -400,
                cylMax: 0,
                rxTypes: ["SINGLE_VISION"],
              },
              labCodeTemplate: "X",
              shopifyVariantId: "v1",
              position: 0,
            },
          ],
        },
      ],
      optionGroups: [],
      addOns: [],
      settings: {
        manualRxEnabled: true,
        rxUploadEnabled: true,
        storeRxInOrder: false,
      },
    });
    expect(catalogResult.success).toBe(false);
  });
});

describe("prescription body with float diopters (INV-5)", () => {
  it("rejects sph: -2.25", () => {
    const result = prescriptionSubmitBodySchema.safeParse({
      rxType: "SINGLE_VISION",
      prescription: {
        od: { sph: -2.25 },
        os: { sph: -200 },
        pd: { single: 635 },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("money currency LOL (INV-4)", () => {
  it("rejects unknown uppercase code LOL", () => {
    expect(iso4217CurrencySchema.safeParse("LOL").success).toBe(false);
    expect(iso4217CurrencySchema.safeParse("USD").success).toBe(true);
    const result = moneySchema.safeParse({
      amountMinor: 100,
      currency: "LOL",
    });
    expect(result.success).toBe(false);
  });
});

describe("readBundleProperties", () => {
  it("tolerates a frame line with no _rx_ref", () => {
    const properties = buildBundleLineProperties({
      role: "frame",
      bundleId: "bundle-frame",
      storeRxInOrder: false,
      prescription: distinctiveRx,
    });

    expect(properties[BUNDLE_PROPERTY_KEYS.rxRef]).toBeUndefined();
    expect(properties[BUNDLE_PROPERTY_KEYS.itemId]).toBeUndefined();

    const parsed = readBundleProperties(properties);
    expect(parsed.role).toBe("frame");
    expect(parsed.bundleId).toBe("bundle-frame");
    expect(parsed.rxRef).toBeUndefined();
    expect(parsed.itemId).toBeUndefined();
    expect(parsed.formattedRx).toBeUndefined();
  });

  it("empty input returns only the two flags and does not throw", () => {
    expect(() => readBundleProperties({})).not.toThrow();
    expect(readBundleProperties({})).toEqual({
      storeRxInOrder: false,
      prescriptionOnFile: false,
    });
  });

  it("reads a single option id and an empty add-on list", () => {
    const input: BuildBundleLinePropertiesInput = {
      role: "lens",
      bundleId: "bundle-one",
      itemId: "lens-one",
      optionIds: ["only-one"],
      addonIds: [],
      storeRxInOrder: false,
    };
    const properties = buildBundleLineProperties(input);
    expect(properties[BUNDLE_PROPERTY_KEYS.optionIds]).toBe(
      JSON.stringify(["only-one"]),
    );
    expect(properties[BUNDLE_PROPERTY_KEYS.addonIds]).toBe("[]");
    const parsed = readBundleProperties(properties);
    expect(parsed.optionIds).toEqual(["only-one"]);
    expect(parsed.addonIds).toEqual([]);
  });

  it("round-trips hostile ids: comma, quote, non-ASCII, empty-looking", () => {
    const optionIds = ["opt,a", 'say"hi"', "透镜", " ", "", ","];
    const addonIds = ["add,on", "[]", " "];
    const input: BuildBundleLinePropertiesInput = {
      role: "lens",
      bundleId: "bundle-hostile",
      itemId: "lens-hostile",
      optionIds,
      addonIds,
      storeRxInOrder: false,
    };
    const properties = buildBundleLineProperties(input);
    expect(properties[BUNDLE_PROPERTY_KEYS.optionIds]).toBe(
      JSON.stringify(optionIds),
    );
    expect(properties[BUNDLE_PROPERTY_KEYS.addonIds]).toBe(
      JSON.stringify(addonIds),
    );
    const parsed = readBundleProperties(properties);
    expect(parsed.optionIds).toEqual(optionIds);
    expect(parsed.addonIds).toEqual(addonIds);
  });

  it("does not throw on whitespace-only reader input and does not invent a role or id list", () => {
    const properties = {
      [BUNDLE_PROPERTY_KEYS.bundleId]: "   ",
      [BUNDLE_PROPERTY_KEYS.bundleRole]: " \t ",
      [BUNDLE_PROPERTY_KEYS.optionIds]: "   ",
      [BUNDLE_PROPERTY_KEYS.addonIds]: "\n",
      [BUNDLE_PROPERTY_KEYS.itemId]: "   ",
      [BUNDLE_PROPERTY_KEYS.prescription]: "   ",
    };
    expect(() => readBundleProperties(properties)).not.toThrow();
    const parsed = readBundleProperties(properties);
    expect(parsed.role).toBeUndefined();
    expect(parsed.optionIds).toBeUndefined();
    expect(parsed.addonIds).toBeUndefined();
    expect(parsed.bundleId).toBe("   ");
    expect(parsed.itemId).toBe("   ");
    expect(parsed.storeRxInOrder).toBe(false);
    expect(parsed.prescriptionOnFile).toBe(false);
  });

  it("does not throw on very long values and returns them unchanged", () => {
    const long = "x".repeat(10_000);
    const longId = "非".repeat(10_000);
    const properties = {
      [BUNDLE_PROPERTY_KEYS.bundleId]: long,
      [BUNDLE_PROPERTY_KEYS.bundleRole]: "lens",
      [BUNDLE_PROPERTY_KEYS.itemId]: longId,
      [BUNDLE_PROPERTY_KEYS.optionIds]: JSON.stringify([long]),
    };
    expect(() => readBundleProperties(properties)).not.toThrow();
    const parsed = readBundleProperties(properties);
    expect(parsed.bundleId).toBe(long);
    expect(parsed.itemId).toBe(longId);
    expect(parsed.optionIds).toEqual([long]);
  });

  it("does not throw on non-ASCII reader input and returns those strings", () => {
    const properties = {
      [BUNDLE_PROPERTY_KEYS.bundleId]: "束-α",
      [BUNDLE_PROPERTY_KEYS.bundleRole]: "lens",
      [BUNDLE_PROPERTY_KEYS.itemId]: "🙂透镜",
      [BUNDLE_PROPERTY_KEYS.optionIds]: JSON.stringify(["透镜", "opt,a"]),
    };
    expect(() => readBundleProperties(properties)).not.toThrow();
    const parsed = readBundleProperties(properties);
    expect(parsed.bundleId).toBe("束-α");
    expect(parsed.itemId).toBe("🙂透镜");
    expect(parsed.role).toBe("lens");
    expect(parsed.optionIds).toEqual(["透镜", "opt,a"]);
  });

  it("reads storeRxInOrder false on a frame line even when the input flag was true", () => {
    const input: BuildBundleLinePropertiesInput = {
      role: "frame",
      bundleId: "bundle-frame",
      storeRxInOrder: true,
      prescription: distinctiveRx,
    };
    expect(readBundleProperties(buildBundleLineProperties(input))).toEqual(
      normalizedBundleSnapshot(input),
    );
  });

  it("reads a lens line with the flag off as prescription-on-file and no formatted Rx", () => {
    const input: BuildBundleLinePropertiesInput = {
      role: "lens",
      bundleId: "bundle-off",
      itemId: "lens-off",
      optionIds: [],
      addonIds: [],
      storeRxInOrder: false,
      prescription: distinctiveRx,
    };
    const parsed = readBundleProperties(buildBundleLineProperties(input));
    expect(parsed).toEqual(normalizedBundleSnapshot(input));
    expect(parsed.storeRxInOrder).toBe(false);
    expect(parsed.prescriptionOnFile).toBe(true);
    expect(parsed.formattedRx).toBeUndefined();
  });
});

describe("round-trip property test", () => {
  it("read(build(x)) equals the normalized snapshot for 200 generated bundles", () => {
    for (let index = 0; index < 200; index += 1) {
      const input = generateBundle(index);
      const parsed = readBundleProperties(buildBundleLineProperties(input));
      expect(parsed, `bundle ${index}`).toEqual(normalizedBundleSnapshot(input));
      expect(parsed.storeRxInOrder, `bundle ${index} flag`).toBe(
        input.role === "lens" && input.storeRxInOrder,
      );
      expect(parsed.prescriptionOnFile, `bundle ${index} on file`).toBe(
        input.role === "lens" && !input.storeRxInOrder,
      );
    }
  });
});
