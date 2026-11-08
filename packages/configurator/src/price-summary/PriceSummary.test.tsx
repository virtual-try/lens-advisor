import { describe, expect, it } from "vitest";
import { render } from "@testing-library/preact";
import type { CatalogResponse, Selection } from "../../../rx-core/src/index.js";
import { PriceSummary } from "./PriceSummary";
import { strings } from "./strings";

function createFixtureCatalog(currency = "USD"): CatalogResponse {
  return {
    lensGroups: [
      {
        id: "group-standard",
        name: "Standard",
        description: "Everyday lenses",
        position: 0,
        lenses: [
          {
            id: "lens-standard",
            groupId: "group-standard",
            name: "Standard 1.50",
            description: "CR-39 material",
            price: { amountMinor: currency === "JPY" ? 800 : 8000, currency },
            limits: {
              sphMin: -600,
              sphMax: 400,
              cylMin: -200,
              cylMax: 0,
              rxTypes: ["SINGLE_VISION"],
            },
            labCodeTemplate: "STD",
            shopifyVariantId: "var-1",
            position: 0,
          },
        ],
      },
    ],
    optionGroups: [
      {
        id: "opt-material",
        kind: "MATERIAL",
        name: "Index",
        position: 0,
        values: [
          {
            id: "val-167",
            optionGroupId: "opt-material",
            label: "1.67 High Index",
            priceDelta: { amountMinor: currency === "JPY" ? 350 : 3500, currency },
            position: 0,
          },
        ],
      },
      {
        id: "opt-tint",
        kind: "TINT_TYPE",
        name: "Tint",
        position: 1,
        values: [
          {
            id: "val-clear",
            optionGroupId: "opt-tint",
            label: "Clear",
            priceDelta: { amountMinor: 0, currency },
            position: 0,
          },
          {
            id: "val-solid",
            optionGroupId: "opt-tint",
            label: "Solid",
            priceDelta: { amountMinor: currency === "JPY" ? 250 : 2500, currency },
            position: 1,
          },
        ],
      },
    ],
    addOns: [
      {
        id: "addon-case",
        name: "Hard Case",
        price: { amountMinor: currency === "JPY" ? 150 : 1500, currency },
        shopifyVariantId: "var-case",
        position: 0,
      },
    ],
    settings: {
      manualRxEnabled: true,
      rxUploadEnabled: false,
      storeRxInOrder: false,
    },
  };
}

describe("PriceSummary", () => {
  it("Row 1: frame $120, lens $80, 1.67 (+$35) -> lines 120 / 80 / 35, total $235.00 (normal)", () => {
    const catalog = createFixtureCatalog("USD");
    const selection: Selection = {
      frameVariantId: "frame-1",
      rxType: "SINGLE_VISION",
      lensId: "lens-standard",
      optionValueIds: ["val-167"],
      addOnIds: [],
    };
    const framePrice = { amountMinor: 12000, currency: "USD" };

    const { container } = render(
      <PriceSummary
        catalog={catalog}
        selection={selection}
        framePrice={framePrice}
        variant="compact"
      />,
    );

    // Assert total text: $235.00
    expect(container.textContent).toContain("$235.00");
    // Assert lines: frame $120.00, lens $80.00, 1.67 $35.00
    expect(container.textContent).toContain("Frame");
    expect(container.textContent).toContain("$120.00");
    expect(container.textContent).toContain("Standard 1.50");
    expect(container.textContent).toContain("$80.00");
    expect(container.textContent).toContain("1.67 High Index");
    expect(container.textContent).toContain("$35.00");
    expect(container.textContent).toContain(strings.total);
  });

  it("Row 2: tint 'Clear' delta 0 preselected -> line 'Included' (zero delta)", () => {
    const catalog = createFixtureCatalog("USD");
    const selection: Selection = {
      frameVariantId: "frame-1",
      rxType: "SINGLE_VISION",
      lensId: "lens-standard",
      optionValueIds: ["val-clear"],
      addOnIds: [],
    };
    const framePrice = { amountMinor: 12000, currency: "USD" };

    const { container } = render(
      <PriceSummary
        catalog={catalog}
        selection={selection}
        framePrice={framePrice}
        variant="compact"
      />,
    );

    // Delta 0 line renders "Included"
    expect(container.textContent).toContain("Clear");
    expect(container.textContent).toContain(strings.included);
    // Total is frame + lens = 120 + 80 = 200
    expect(container.textContent).toContain("$200.00");
  });

  it("Row 5: JPY shop -> '¥1,500' (no decimals) (currency)", () => {
    const catalog = createFixtureCatalog("JPY");
    const selection: Selection = {
      frameVariantId: "frame-jpy",
      rxType: "SINGLE_VISION",
      lensId: "lens-standard", // 800 JPY
      optionValueIds: ["val-167"], // 350 JPY
      addOnIds: ["addon-case"], // 150 JPY
    };
    // Frame price: 200 JPY -> total = 200 + 800 + 350 + 150 = 1500 JPY
    const framePrice = { amountMinor: 200, currency: "JPY" };

    const { container } = render(
      <PriceSummary
        catalog={catalog}
        selection={selection}
        framePrice={framePrice}
        variant="compact"
      />,
    );

    expect(container.textContent).toContain("¥1,500");
    expect(container.textContent).not.toContain(".00");
  });

  it("renders expanded variant with complete itemized breakdown", () => {
    const catalog = createFixtureCatalog("USD");
    const selection: Selection = {
      frameVariantId: "frame-1",
      rxType: "SINGLE_VISION",
      lensId: "lens-standard",
      optionValueIds: ["val-167", "val-clear"],
      addOnIds: ["addon-case"],
    };
    const framePrice = { amountMinor: 12000, currency: "USD" };

    const { container } = render(
      <PriceSummary
        catalog={catalog}
        selection={selection}
        framePrice={framePrice}
        variant="expanded"
      />,
    );

    expect(container.querySelector(".la-price-summary--expanded")).not.toBeNull();
    expect(container.textContent).toContain(strings.breakdownTitle);
    expect(container.textContent).toContain("Frame");
    expect(container.textContent).toContain("$120.00");
    expect(container.textContent).toContain("Standard 1.50");
    expect(container.textContent).toContain("$80.00");
    expect(container.textContent).toContain("1.67 High Index");
    expect(container.textContent).toContain("$35.00");
    expect(container.textContent).toContain("Clear");
    expect(container.textContent).toContain(strings.included);
    expect(container.textContent).toContain("Hard Case");
    expect(container.textContent).toContain("$15.00");
    // Total = 120 + 80 + 35 + 0 + 15 = 250
    expect(container.textContent).toContain("$250.00");
  });

  it("returns null safely when catalog or selection is missing", () => {
    const { container: c1 } = render(<PriceSummary catalog={undefined} selection={undefined} />);
    expect(c1.innerHTML).toBe("");

    const catalog = createFixtureCatalog("USD");
    const { container: c2 } = render(<PriceSummary catalog={catalog} selection={undefined} />);
    expect(c2.innerHTML).toBe("");
  });

  it("resolves frame price from DOM data-frame attribute when not passed in props", () => {
    const section = document.createElement("section");
    section.setAttribute("data-frame", "129");
    section.setAttribute("data-currency", "USD");
    document.body.appendChild(section);

    try {
      const catalog = createFixtureCatalog("USD");
      const selection: Selection = {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        lensId: "lens-standard",
        optionValueIds: [],
        addOnIds: [],
      };

      const { container } = render(
        <PriceSummary catalog={catalog} selection={selection} variant="compact" />,
      );

      // Frame 129 + lens 80 = 209
      expect(container.textContent).toContain("$129.00");
      expect(container.textContent).toContain("$209.00");
    } finally {
      document.body.removeChild(section);
    }
  });
});
