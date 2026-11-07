import { describe, expect, it } from "vitest";
import type {
  AddOn,
  CatalogResponse,
  Lens,
  Money,
  OptionGroup,
  OptionValue,
  RxType,
  Selection,
} from "../types/index.js";
import { PricingError } from "./errors.js";
import { parseMoneyText, toShopifyDecimal } from "./money-text.js";
import { priceSelection, type PriceBreakdown } from "./price-selection.js";

const RX_TYPES: RxType[] = [
  "SINGLE_VISION",
  "PROGRESSIVE",
  "READING",
  "NON_PRESCRIPTION",
];

const SETTINGS: CatalogResponse["settings"] = {
  manualRxEnabled: true,
  rxUploadEnabled: true,
  storeRxInOrder: false,
};

function money(amountMinor: number, currency = "USD"): Money {
  return { amountMinor, currency };
}

function lens(
  id: string,
  name: string,
  amountMinor: number,
  currency = "USD",
): Lens {
  return {
    id,
    groupId: "group-1",
    name,
    price: money(amountMinor, currency),
    limits: {
      sphMin: -800,
      sphMax: 600,
      cylMin: -400,
      cylMax: 0,
      rxTypes: RX_TYPES,
    },
    labCodeTemplate: "X",
    shopifyVariantId: `variant-${id}`,
    position: 0,
  };
}

function optionValue(
  id: string,
  label: string,
  amountMinor: number,
  currency = "USD",
): OptionValue {
  return {
    id,
    optionGroupId: "group",
    label,
    priceDelta: money(amountMinor, currency),
    position: 0,
  };
}

function optionGroup(
  id: string,
  name: string,
  values: OptionValue[],
  position = 0,
): OptionGroup {
  return {
    id,
    kind: "MATERIAL",
    name,
    position,
    values,
  };
}

function addOn(
  id: string,
  name: string,
  amountMinor: number,
  currency = "USD",
  position = 0,
): AddOn {
  return {
    id,
    name,
    price: money(amountMinor, currency),
    shopifyVariantId: `variant-${id}`,
    position,
  };
}

function catalog(parts: {
  lenses?: Lens[];
  lensGroups?: CatalogResponse["lensGroups"];
  optionGroups?: OptionGroup[];
  addOns?: AddOn[];
}): CatalogResponse {
  return {
    lensGroups: parts.lensGroups ?? [
      {
        id: "group-1",
        name: "Lenses",
        position: 0,
        lenses: parts.lenses ?? [],
      },
    ],
    optionGroups: parts.optionGroups ?? [],
    addOns: parts.addOns ?? [],
    settings: SETTINGS,
  };
}

function selection(partial: {
  rxType?: RxType;
  lensId?: string;
  optionValueIds?: string[];
  addOnIds?: string[];
  frameVariantId?: string;
}): Selection {
  return {
    frameVariantId: partial.frameVariantId ?? "frame-1",
    rxType: partial.rxType ?? "SINGLE_VISION",
    lensId: partial.lensId,
    optionValueIds: partial.optionValueIds ?? [],
    addOnIds: partial.addOnIds ?? [],
  };
}

const FRAME = money(12000);
const STANDARD = lens("lens-sv", "Standard", 8000);
const MATERIAL = optionValue("opt-167", "1.67", 3500);
const POLARIZED = optionValue("opt-pol", "Polarized", 4000);
const CLEAR = optionValue("opt-clear", "Clear", 0);
const CASE = addOn("addon-case", "Case", 1500);

const FULL = catalog({
  lenses: [STANDARD],
  optionGroups: [
    optionGroup("og-material", "Material", [MATERIAL], 0),
    optionGroup("og-tint", "Tint", [POLARIZED, CLEAR], 1),
  ],
  addOns: [CASE],
});

function expectIntegers(result: PriceBreakdown): void {
  expect(Number.isInteger(result.total.amountMinor)).toBe(true);
  expect(Object.is(result.total.amountMinor, -0)).toBe(false);
  let sum = 0;
  for (const line of result.lines) {
    expect(Number.isInteger(line.amount.amountMinor)).toBe(true);
    expect(Object.is(line.amount.amountMinor, -0)).toBe(false);
    expect(line.amount.currency).toBe(result.total.currency);
    sum += line.amount.amountMinor;
  }
  expect(result.total.amountMinor).toBe(sum);
  expect(Number.isInteger(sum)).toBe(true);
}

function expectPricingError(
  run: () => unknown,
  code: string,
  itemId?: string,
): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PricingError);
  if (!(caught instanceof PricingError)) {
    return;
  }
  expect(caught.code).toBe(code);
  if (itemId !== undefined) {
    expect(caught.itemId).toBe(itemId);
    expect(caught.message).toBe(`${code} ${itemId}`);
  }
}

describe("priceSelection examples", () => {
  it("frame 12000 + lens 8000 totals 20000", () => {
    const result = priceSelection(
      selection({ lensId: "lens-sv" }),
      FULL,
      FRAME,
    );
    expect(result.total).toEqual(money(20000));
    expect(result.lines).toEqual([
      { role: "frame", label: "Frame", amount: money(12000) },
      { role: "lens", label: "Standard", amount: money(8000) },
    ]);
    expectIntegers(result);
  });

  it("frame + lens + 1.67 + polarized + case totals 29000", () => {
    const result = priceSelection(
      selection({
        lensId: "lens-sv",
        optionValueIds: ["opt-pol", "opt-167"],
        addOnIds: ["addon-case"],
      }),
      FULL,
      FRAME,
    );
    expect(result.total).toEqual(money(29000));
    expect(result.lines.map((line) => line.label)).toEqual([
      "Frame",
      "Standard",
      "1.67",
      "Polarized",
      "Case",
    ]);
    expect(result.lines.map((line) => line.role)).toEqual([
      "frame",
      "lens",
      "option",
      "option",
      "addon",
    ]);
    expect(result.lines.map((line) => line.amount.amountMinor)).toEqual([
      12000, 8000, 3500, 4000, 1500,
    ]);
    expectIntegers(result);
  });

  it("keeps a zero option delta as its own line", () => {
    const result = priceSelection(
      selection({
        lensId: "lens-sv",
        optionValueIds: ["opt-clear"],
      }),
      FULL,
      FRAME,
    );
    const clear = result.lines.find((line) => line.label === "Clear");
    expect(clear).toEqual({
      role: "option",
      label: "Clear",
      amount: money(0),
    });
    expect(result.total).toEqual(money(20000));
    expectIntegers(result);
  });

  it("rejects a non-integer amount before adding", () => {
    expectPricingError(
      () => priceSelection(selection({}), catalog({}), money(12.5)),
      "MONEY_FORMAT",
    );
    const floatLens = catalog({
      lenses: [lens("lens-sv", "Standard", 12.5)],
    });
    expectPricingError(
      () =>
        priceSelection(selection({ lensId: "lens-sv" }), floatLens, FRAME),
      "MONEY_FORMAT",
      "lens-sv",
    );
  });

  it("rejects a lens priced in another currency", () => {
    const euroLens = catalog({
      lenses: [lens("lens-sv", "Standard", 8000, "EUR")],
    });
    expectPricingError(
      () =>
        priceSelection(selection({ lensId: "lens-sv" }), euroLens, FRAME),
      "CURRENCY_MISMATCH",
      "lens-sv",
    );
  });

  it("rejects an option id that is not in the catalog", () => {
    expectPricingError(
      () =>
        priceSelection(
          selection({
            lensId: "lens-sv",
            optionValueIds: ["missing-opt"],
          }),
          FULL,
          FRAME,
        ),
      "UNKNOWN_ITEM",
      "missing-opt",
    );
  });

  it("prices a non-prescription with no lens as frame plus add-ons", () => {
    const result = priceSelection(
      selection({
        rxType: "NON_PRESCRIPTION",
        addOnIds: ["addon-case"],
      }),
      FULL,
      FRAME,
    );
    expect(result.lines.map((line) => line.role)).toEqual(["frame", "addon"]);
    expect(result.total).toEqual(money(13500));
    expectIntegers(result);
  });
});

describe("parseMoneyText examples", () => {
  it("parses 35.5 USD as 3550 and 0.1 USD as 10", () => {
    expect(parseMoneyText("35.5", "USD")).toEqual({
      ok: true,
      amountMinor: 3550,
    });
    expect(parseMoneyText("0.1", "USD")).toEqual({
      ok: true,
      amountMinor: 10,
    });
    expect(Number.isInteger(3550)).toBe(true);
    expect(Number.isInteger(10)).toBe(true);
  });

  it("rejects a third USD decimal as MONEY_PRECISION", () => {
    expect(parseMoneyText("35.555", "USD")).toEqual({
      ok: false,
      error: "MONEY_PRECISION",
    });
  });

  it("parses JPY with no decimals and rejects a fraction", () => {
    expect(parseMoneyText("1500", "JPY")).toEqual({
      ok: true,
      amountMinor: 1500,
    });
    expect(parseMoneyText("15.5", "JPY")).toEqual({
      ok: false,
      error: "MONEY_PRECISION",
    });
    expect(Number.isInteger(1500)).toBe(true);
  });

  it("rejects empty, non-numeric, and exponent text", () => {
    expect(parseMoneyText("", "USD")).toEqual({
      ok: false,
      error: "MONEY_FORMAT",
    });
    expect(parseMoneyText("abc", "USD")).toEqual({
      ok: false,
      error: "MONEY_FORMAT",
    });
    expect(parseMoneyText("1e3", "USD")).toEqual({
      ok: false,
      error: "MONEY_FORMAT",
    });
  });
});

describe("toShopifyDecimal examples", () => {
  it("formats USD with two decimals and JPY with none", () => {
    expect(toShopifyDecimal(8000, "USD")).toBe("80.00");
    expect(toShopifyDecimal(1500, "JPY")).toBe("1500");
  });
});

describe("priceSelection order and edges", () => {
  it("keeps catalog order when selection ids are reversed", () => {
    const forward = priceSelection(
      selection({
        lensId: "lens-sv",
        optionValueIds: ["opt-167", "opt-pol"],
        addOnIds: ["addon-case", "addon-cloth"],
      }),
      catalog({
        lenses: [STANDARD],
        optionGroups: [
          optionGroup("og-material", "Material", [MATERIAL], 5),
          optionGroup("og-tint", "Tint", [POLARIZED], 0),
        ],
        addOns: [
          addOn("addon-case", "Case", 1500, "USD", 9),
          addOn("addon-cloth", "Cloth", 0, "USD", 0),
        ],
      }),
      FRAME,
    );
    const reversed = priceSelection(
      selection({
        lensId: "lens-sv",
        optionValueIds: ["opt-pol", "opt-167"],
        addOnIds: ["addon-cloth", "addon-case"],
      }),
      catalog({
        lenses: [STANDARD],
        optionGroups: [
          optionGroup("og-material", "Material", [MATERIAL], 5),
          optionGroup("og-tint", "Tint", [POLARIZED], 0),
        ],
        addOns: [
          addOn("addon-case", "Case", 1500, "USD", 9),
          addOn("addon-cloth", "Cloth", 0, "USD", 0),
        ],
      }),
      FRAME,
    );
    expect(reversed.lines).toEqual(forward.lines);
    expect(forward.lines.map((line) => line.label)).toEqual([
      "Frame",
      "Standard",
      "1.67",
      "Polarized",
      "Case",
      "Cloth",
    ]);
    expectIntegers(forward);
  });

  it("prices a frame alone when nothing else is selected", () => {
    const result = priceSelection(selection({}), catalog({}), FRAME);
    expect(result.lines).toEqual([
      { role: "frame", label: "Frame", amount: money(12000) },
    ]);
    expect(result.total).toEqual(money(12000));
    expectIntegers(result);
  });

  it("counts a repeated option id once", () => {
    const result = priceSelection(
      selection({ optionValueIds: ["opt-167", "opt-167"] }),
      catalog({
        optionGroups: [optionGroup("og-material", "Material", [MATERIAL])],
      }),
      FRAME,
    );
    expect(result.lines).toEqual([
      { role: "frame", label: "Frame", amount: money(12000) },
      { role: "option", label: "1.67", amount: money(3500) },
    ]);
    expect(result.total).toEqual(money(15500));
  });

  it("uses the first catalog row when an id is duplicated", () => {
    const result = priceSelection(
      selection({ lensId: "lens-sv" }),
      catalog({
        lensGroups: [
          {
            id: "g1",
            name: "A",
            position: 1,
            lenses: [lens("lens-sv", "First", 8000)],
          },
          {
            id: "g2",
            name: "B",
            position: 0,
            lenses: [lens("lens-sv", "Second", 100)],
          },
        ],
      }),
      FRAME,
    );
    expect(result.lines[1]).toEqual({
      role: "lens",
      label: "First",
      amount: money(8000),
    });
    expect(result.total).toEqual(money(20000));
  });

  it("does not reject an unselected negative delta or foreign price", () => {
    const result = priceSelection(
      selection({}),
      catalog({
        lenses: [lens("lens-eur", "Euro", 8000, "EUR")],
        optionGroups: [
          optionGroup("og", "Material", [
            optionValue("opt-neg", "Bad", -100),
          ]),
        ],
      }),
      FRAME,
    );
    expect(result.total).toEqual(money(12000));
  });

  it("names a missing lens id and a missing add-on id", () => {
    expectPricingError(
      () => priceSelection(selection({ lensId: "no-lens" }), FULL, FRAME),
      "UNKNOWN_ITEM",
      "no-lens",
    );
    expectPricingError(
      () =>
        priceSelection(selection({ addOnIds: ["no-addon"] }), FULL, FRAME),
      "UNKNOWN_ITEM",
      "no-addon",
    );
  });

  it("reports the lens id when the lens and an option are both unknown", () => {
    expectPricingError(
      () =>
        priceSelection(
          selection({
            lensId: "no-lens",
            optionValueIds: ["no-opt"],
          }),
          FULL,
          FRAME,
        ),
      "UNKNOWN_ITEM",
      "no-lens",
    );
  });

  it("rejects a negative option delta and checks currency first", () => {
    const negative = catalog({
      optionGroups: [
        optionGroup("og", "Material", [optionValue("opt-neg", "Bad", -100)]),
      ],
    });
    expectPricingError(
      () =>
        priceSelection(
          selection({ optionValueIds: ["opt-neg"] }),
          negative,
          FRAME,
        ),
      "NEGATIVE_DELTA",
      "opt-neg",
    );

    const foreignNegative = catalog({
      optionGroups: [
        optionGroup("og", "Material", [
          optionValue("opt-neg", "Bad", -100, "EUR"),
        ]),
      ],
    });
    expectPricingError(
      () =>
        priceSelection(
          selection({ optionValueIds: ["opt-neg"] }),
          foreignNegative,
          FRAME,
        ),
      "CURRENCY_MISMATCH",
      "opt-neg",
    );
  });

  it("rejects an add-on in another currency", () => {
    const euroCase = catalog({
      addOns: [addOn("addon-case", "Case", 1500, "EUR")],
    });
    expectPricingError(
      () =>
        priceSelection(
          selection({ addOnIds: ["addon-case"] }),
          euroCase,
          FRAME,
        ),
      "CURRENCY_MISMATCH",
      "addon-case",
    );
  });

  it("keeps equal prices in catalog order", () => {
    const tied = catalog({
      addOns: [
        addOn("addon-a", "Alpha", 500),
        addOn("addon-b", "Beta", 500),
      ],
    });
    const result = priceSelection(
      selection({ addOnIds: ["addon-b", "addon-a"] }),
      tied,
      FRAME,
    );
    expect(result.lines.map((line) => line.label)).toEqual([
      "Frame",
      "Alpha",
      "Beta",
    ]);
    expect(result.total).toEqual(money(13000));
  });

  it("prices a non-ascii id and names an unknown one", () => {
    const named = optionValue("透镜", "高折射", 3500);
    const result = priceSelection(
      selection({ optionValueIds: ["透镜"] }),
      catalog({
        optionGroups: [optionGroup("og", "Material", [named])],
      }),
      FRAME,
    );
    expect(result.lines[1]).toEqual({
      role: "option",
      label: "高折射",
      amount: money(3500),
    });
    expectPricingError(
      () =>
        priceSelection(
          selection({ optionValueIds: ["🙂"] }),
          FULL,
          FRAME,
        ),
      "UNKNOWN_ITEM",
      "🙂",
    );
  });

  it("does not mutate a frozen catalog or selection", () => {
    const frozenCatalog = catalog({
      lenses: [STANDARD],
      optionGroups: [optionGroup("og", "Material", [MATERIAL])],
      addOns: [CASE],
    });
    const frozenSelection = selection({
      lensId: "lens-sv",
      optionValueIds: ["opt-167"],
      addOnIds: ["addon-case"],
    });
    Object.freeze(frozenSelection.optionValueIds);
    Object.freeze(frozenSelection.addOnIds);
    Object.freeze(frozenSelection);
    Object.freeze(frozenCatalog.optionGroups);
    Object.freeze(frozenCatalog.addOns);
    Object.freeze(frozenCatalog.lensGroups);
    const result = priceSelection(frozenSelection, frozenCatalog, FRAME);
    expect(result.total).toEqual(money(25000));
  });

  it("prices in the frame currency when that currency is JPY", () => {
    const result = priceSelection(
      selection({ lensId: "lens-sv" }),
      catalog({ lenses: [lens("lens-sv", "Standard", 8000, "JPY")] }),
      money(12000, "JPY"),
    );
    expect(result.total).toEqual(money(20000, "JPY"));
    expect(result.lines.every((line) => line.amount.currency === "JPY")).toBe(
      true,
    );
  });
});

describe("parseMoneyText edges", () => {
  it("pads short fractions and keeps trailing zeros exact", () => {
    expect(parseMoneyText("1.10", "USD")).toEqual({
      ok: true,
      amountMinor: 110,
    });
    expect(parseMoneyText("0.10", "USD")).toEqual({
      ok: true,
      amountMinor: 10,
    });
    expect(parseMoneyText("2.30", "USD")).toEqual({
      ok: true,
      amountMinor: 230,
    });
    expect(parseMoneyText("35", "USD")).toEqual({
      ok: true,
      amountMinor: 3500,
    });
    expect(parseMoneyText(".5", "USD")).toEqual({
      ok: true,
      amountMinor: 50,
    });
    expect(parseMoneyText("35.", "USD")).toEqual({
      ok: true,
      amountMinor: 3500,
    });
    expect(Number.isInteger(110)).toBe(true);
  });

  it("parses KWD to three decimals", () => {
    expect(parseMoneyText("1.5", "KWD")).toEqual({
      ok: true,
      amountMinor: 1500,
    });
    expect(parseMoneyText("1.500", "KWD")).toEqual({
      ok: true,
      amountMinor: 1500,
    });
    expect(parseMoneyText("0.001", "KWD")).toEqual({
      ok: true,
      amountMinor: 1,
    });
    expect(parseMoneyText("1.5000", "KWD")).toEqual({
      ok: false,
      error: "MONEY_PRECISION",
    });
  });

  it("accepts a sign and a unicode minus, and normalizes negative zero", () => {
    expect(parseMoneyText("+35.5", "USD")).toEqual({
      ok: true,
      amountMinor: 3550,
    });
    expect(parseMoneyText("-1.50", "USD")).toEqual({
      ok: true,
      amountMinor: -150,
    });
    expect(parseMoneyText("−0.10", "USD")).toEqual({
      ok: true,
      amountMinor: -10,
    });
    const zero = parseMoneyText("-0.00", "USD");
    expect(zero).toEqual({ ok: true, amountMinor: 0 });
    if (zero.ok) {
      expect(Object.is(zero.amountMinor, -0)).toBe(false);
    }
  });

  it("rejects hostile text without throwing", () => {
    const hostile = [
      "   ",
      "1E3",
      "0x10",
      "35.5.0",
      "1,500",
      "35,50",
      "usd",
      "💰",
      "٣٥.٥٠",
      "+",
      ".",
      " 1e3 ",
      "9".repeat(10_000),
      "9007199254740992",
    ];
    for (const text of hostile) {
      expect(parseMoneyText(text, "JPY")).toEqual({
        ok: false,
        error: "MONEY_FORMAT",
      });
    }
    expect(parseMoneyText("35.5", "LOL")).toEqual({
      ok: false,
      error: "MONEY_FORMAT",
    });
    expect(parseMoneyText("35.5", "usd")).toEqual({
      ok: false,
      error: "MONEY_FORMAT",
    });
  });

  it("accepts the largest safe JPY integer and a leading-zero fraction", () => {
    expect(parseMoneyText("9007199254740991", "JPY")).toEqual({
      ok: true,
      amountMinor: 9007199254740991,
    });
    expect(parseMoneyText("00.10", "USD")).toEqual({
      ok: true,
      amountMinor: 10,
    });
    expect(parseMoneyText("  35.50  ", "USD")).toEqual({
      ok: true,
      amountMinor: 3550,
    });
  });
});

describe("toShopifyDecimal edges", () => {
  it("pads cents, formats KWD, and rounds-trips through parseMoneyText", () => {
    expect(toShopifyDecimal(0, "USD")).toBe("0.00");
    expect(toShopifyDecimal(1, "USD")).toBe("0.01");
    expect(toShopifyDecimal(10, "USD")).toBe("0.10");
    expect(toShopifyDecimal(110, "USD")).toBe("1.10");
    expect(toShopifyDecimal(0, "JPY")).toBe("0");
    expect(toShopifyDecimal(1500, "KWD")).toBe("1.500");
    expect(toShopifyDecimal(1, "KWD")).toBe("0.001");
    expect(toShopifyDecimal(-8000, "USD")).toBe("-80.00");

    const samples = [0, 1, 10, 110, 1500, 8000, 12000, 999999, -150];
    for (const currency of ["USD", "JPY", "KWD"]) {
      for (const amountMinor of samples) {
        const text = toShopifyDecimal(amountMinor, currency);
        const parsed = parseMoneyText(text, currency);
        expect(parsed).toEqual({ ok: true, amountMinor });
        if (parsed.ok) {
          expect(Number.isInteger(parsed.amountMinor)).toBe(true);
        }
      }
    }
  });

  it("throws on a non-integer and an unknown currency", () => {
    expect(() => toShopifyDecimal(80.5, "USD")).toThrow(PricingError);
    expect(() => toShopifyDecimal(8000, "LOL")).toThrow(PricingError);
  });
});

describe("priceSelection property", () => {
  const propertyLensA = lens("lens-a", "A", 8000);
  const propertyLensB = lens("lens-b", "B", 0);
  const propertyCatalog = catalog({
    lenses: [propertyLensA, propertyLensB],
    optionGroups: [
      optionGroup("og-material", "Material", [
        optionValue("opt-167", "1.67", 3500),
        optionValue("opt-160", "1.60", 0),
      ]),
      optionGroup("og-tint", "Tint", [
        optionValue("opt-pol", "Polarized", 4000),
        optionValue("opt-clear", "Clear", 0),
      ]),
      optionGroup("og-color", "Color", [
        optionValue("opt-grey", "Grey", 500),
      ]),
    ],
    addOns: [
      addOn("addon-case", "Case", 1500),
      addOn("addon-cloth", "Cloth", 0),
      addOn("addon-spray", "Spray", 700),
    ],
  });

  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state;
    };
  }

  function shuffle(ids: readonly string[], next: () => number): string[] {
    const copy = ids.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = next() % (i + 1);
      const left = copy[i];
      const right = copy[j];
      if (left === undefined || right === undefined) {
        continue;
      }
      copy[i] = right;
      copy[j] = left;
    }
    return copy;
  }

  it("totals the lines for 200 generated selections, in catalog order", () => {
    const next = lcg(13);
    const lensIds = [undefined, "lens-a", "lens-b"] as const;
    const optionIds = ["opt-167", "opt-160", "opt-pol", "opt-clear", "opt-grey"];
    const addOnIds = ["addon-case", "addon-cloth", "addon-spray"];

    for (let i = 0; i < 200; i++) {
      const lensId = lensIds[next() % lensIds.length];
      const optionCount = next() % (optionIds.length + 1);
      const addOnCount = next() % (addOnIds.length + 1);
      const pickedOptions = shuffle(optionIds, next).slice(0, optionCount);
      const pickedAddOns = shuffle(addOnIds, next).slice(0, addOnCount);
      const chosen = selection({
        rxType: lensId === undefined ? "NON_PRESCRIPTION" : "SINGLE_VISION",
        lensId,
        optionValueIds: pickedOptions,
        addOnIds: pickedAddOns,
      });
      const reversed = selection({
        rxType: chosen.rxType,
        lensId,
        optionValueIds: pickedOptions.slice().reverse(),
        addOnIds: pickedAddOns.slice().reverse(),
      });
      const result = priceSelection(chosen, propertyCatalog, FRAME);
      const flipped = priceSelection(reversed, propertyCatalog, FRAME);
      expect(flipped.lines).toEqual(result.lines);
      expectIntegers(result);
      expect(result.lines[0]).toEqual({
        role: "frame",
        label: "Frame",
        amount: FRAME,
      });
      const roles = result.lines.map((line) => line.role).join(",");
      expect(roles).toMatch(/^frame(,lens)?(,option)*(,addon)*$/);
    }
  });
});
