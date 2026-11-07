import { describe, expect, it } from "vitest";
import {
  catalogResponseSchema,
  moneySchema,
  prescriptionSchema,
  prescriptionSubmitBodySchema,
} from "../schemas/index.js";
import { formatDiopter, formatPd } from "../format/index.js";
import {
  BUNDLE_PROPERTY_KEYS,
  PRESCRIPTION_ON_FILE,
  buildBundleLineProperties,
  parsedToBuildInput,
  readBundleProperties,
  type BuildBundleLinePropertiesInput,
  type BundleRole,
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
    input.optionIds =
      index % 3 === 0 ? [] : [`opt-a-${index}`, `opt-b-${index}`];
    input.addonIds = index % 5 === 0 ? [] : [`addon-${index}`];
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

  it("does not throw on empty or hostile property maps", () => {
    expect(() => readBundleProperties({})).not.toThrow();
    expect(() =>
      readBundleProperties({
        _bundle_role: "not-a-role",
        _bundle_id: "x".repeat(10_000),
        _item_id: "🙂",
      }),
    ).not.toThrow();

    const empty = readBundleProperties({});
    expect(empty.role).toBeUndefined();
    expect(empty.bundleId).toBeUndefined();
    expect(empty.prescriptionOnFile).toBe(false);
  });
});

describe("round-trip property test", () => {
  it("read(build(x)) rebuilds the same property map for 200 generated bundles", () => {
    for (let index = 0; index < 200; index += 1) {
      const input = generateBundle(index);
      const built = buildBundleLineProperties(input);
      const parsed = readBundleProperties(built);
      const rebuilt = buildBundleLineProperties(parsedToBuildInput(parsed));
      expect(rebuilt, `bundle ${index} properties`).toEqual(built);
      expect(readBundleProperties(rebuilt), `bundle ${index} parsed`).toEqual(
        parsed,
      );
    }
  });
});
