import { describe, expect, it } from "vitest";
import { render } from "@testing-library/preact";
import type { CatalogResponse, Selection } from "../../../rx-core/src/index.js";
import { PriceSummary } from "./PriceSummary";
import { resolveFramePrice } from "./resolve-frame-price";
import { strings } from "./strings";

function createFixtureCatalog(currency = "USD"): CatalogResponse {
  const isZeroOrThree = currency === "JPY" || currency === "KWD";
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
            price: { amountMinor: isZeroOrThree ? 800 : 8000, currency },
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
            priceDelta: { amountMinor: isZeroOrThree ? 350 : 3500, currency },
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
            priceDelta: { amountMinor: isZeroOrThree ? 250 : 2500, currency },
            position: 1,
          },
        ],
      },
    ],
    addOns: [
      {
        id: "addon-case",
        name: "Hard Case",
        price: { amountMinor: isZeroOrThree ? 150 : 1500, currency },
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

  it("resolves frame price from integer priceMinor in data-product-json for USD, JPY and KWD (R1-F1)", () => {
    // 1. USD: 12000 minor units ($120.00) + 8000 lens ($80.00) = $200.00
    const mountUsd = document.createElement("div");
    mountUsd.setAttribute("data-la-mount", "");
    mountUsd.setAttribute("data-la-state", "open");
    mountUsd.setAttribute(
      "data-product-json",
      JSON.stringify({
        productId: "prod-usd",
        priceMinor: 12000,
        currency: "USD",
      }),
    );
    document.body.appendChild(mountUsd);

    try {
      const catalogUsd = createFixtureCatalog("USD");
      const selectionUsd: Selection = {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        lensId: "lens-standard",
        optionValueIds: [],
        addOnIds: [],
      };

      const resolvedUsd = resolveFramePrice({
        catalog: catalogUsd,
        mount: mountUsd,
      });
      expect(resolvedUsd).toEqual({ amountMinor: 12000, currency: "USD" });

      const { container: cUsd } = render(
        <PriceSummary catalog={catalogUsd} selection={selectionUsd} mount={mountUsd} />,
      );
      expect(cUsd.textContent).toContain("$120.00");
      expect(cUsd.textContent).toContain("$200.00");
    } finally {
      document.body.removeChild(mountUsd);
    }

    // 2. JPY: 1500 minor units (¥1,500, zero decimals - NOT multiplied by 100)
    const mountJpy = document.createElement("div");
    mountJpy.setAttribute("data-la-mount", "");
    mountJpy.setAttribute("data-la-state", "open");
    mountJpy.setAttribute(
      "data-product-json",
      JSON.stringify({
        productId: "prod-jpy",
        priceMinor: 1500,
        currency: "JPY",
      }),
    );
    document.body.appendChild(mountJpy);

    try {
      const catalogJpy = createFixtureCatalog("JPY");
      const selectionJpy: Selection = {
        frameVariantId: "frame-jpy",
        rxType: "SINGLE_VISION",
        lensId: "lens-standard", // 800 JPY
        optionValueIds: [],
        addOnIds: [],
      };

      const resolvedJpy = resolveFramePrice({
        catalog: catalogJpy,
        mount: mountJpy,
      });
      expect(resolvedJpy).toEqual({ amountMinor: 1500, currency: "JPY" });

      const { container: cJpy } = render(
        <PriceSummary catalog={catalogJpy} selection={selectionJpy} mount={mountJpy} />,
      );
      expect(cJpy.textContent).toContain("¥1,500");
      // Total: 1500 + 800 = 2300 JPY (¥2,300, not ¥150,000!)
      expect(cJpy.textContent).toContain("¥2,300");
      expect(cJpy.textContent).not.toContain("150,000");
    } finally {
      document.body.removeChild(mountJpy);
    }

    // 3. KWD: 1500 minor units (1.500 KWD, 3 decimals)
    const mountKwd = document.createElement("div");
    mountKwd.setAttribute("data-la-mount", "");
    mountKwd.setAttribute("data-la-state", "open");
    mountKwd.setAttribute(
      "data-product-json",
      JSON.stringify({
        productId: "prod-kwd",
        priceMinor: 1500,
        currency: "KWD",
      }),
    );
    document.body.appendChild(mountKwd);

    try {
      const catalogKwd = createFixtureCatalog("KWD");
      const selectionKwd: Selection = {
        frameVariantId: "frame-kwd",
        rxType: "SINGLE_VISION",
        lensId: "lens-standard", // 800 minor units
        optionValueIds: [],
        addOnIds: [],
      };

      const resolvedKwd = resolveFramePrice({
        catalog: catalogKwd,
        mount: mountKwd,
      });
      expect(resolvedKwd).toEqual({ amountMinor: 1500, currency: "KWD" });

      const { container: cKwd } = render(
        <PriceSummary catalog={catalogKwd} selection={selectionKwd} mount={mountKwd} />,
      );
      // 1500 KWD minor units formats as 1.500, total 2300 formats as 2.300
      expect(cKwd.textContent).toContain("1.500");
      expect(cKwd.textContent).toContain("2.300");
    } finally {
      document.body.removeChild(mountKwd);
    }
  });

  it("renders explicit 'frame price unavailable' state without total when frame price cannot be resolved (R1-F2)", () => {
    const catalog = createFixtureCatalog("USD");
    const selection: Selection = {
      frameVariantId: "frame-1",
      rxType: "SINGLE_VISION",
      lensId: "lens-standard", // 8000 cents ($80.00)
      optionValueIds: [],
      addOnIds: [],
    };

    // Compact variant
    const { container: compactContainer } = render(
      <PriceSummary
        catalog={catalog}
        selection={selection}
        framePrice={undefined}
        variant="compact"
      />,
    );

    // Frame price unavailable text displayed
    expect(compactContainer.textContent).toContain(strings.framePriceUnavailable);
    // Never displays an understated total of $80.00 or $0.00
    expect(compactContainer.textContent).not.toContain("$80.00 Total");
    expect(compactContainer.querySelector(".la-total__amount strong")).toBeNull();
    // Lens line ($80.00) is shown in the parts
    expect(compactContainer.textContent).toContain("Standard 1.50");
    expect(compactContainer.textContent).toContain("$80.00");

    // Expanded variant
    const { container: expandedContainer } = render(
      <PriceSummary
        catalog={catalog}
        selection={selection}
        framePrice={undefined}
        variant="expanded"
      />,
    );

    expect(expandedContainer.textContent).toContain(strings.framePriceUnavailable);
    expect(expandedContainer.querySelector(".la-price-summary__total-amount")).toBeNull();
  });

  it("scopes DOM resolution to the active mount, ignoring other mounts on the page (R1-F2)", () => {
    // Mount 1 is inactive (no data-la-state="open") with $50 price
    const mount1 = document.createElement("div");
    mount1.setAttribute("data-la-mount", "");
    mount1.setAttribute(
      "data-product-json",
      JSON.stringify({ productId: "prod-1", priceMinor: 5000, currency: "USD" }),
    );
    document.body.appendChild(mount1);

    // Mount 2 is active (data-la-state="open") with $120 price
    const mount2 = document.createElement("div");
    mount2.setAttribute("data-la-mount", "");
    mount2.setAttribute("data-la-state", "open");
    mount2.setAttribute(
      "data-product-json",
      JSON.stringify({ productId: "prod-2", priceMinor: 12000, currency: "USD" }),
    );
    document.body.appendChild(mount2);

    try {
      const catalog = createFixtureCatalog("USD");
      const selection: Selection = {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        lensId: "lens-standard",
        optionValueIds: [],
        addOnIds: [],
      };

      // When passed mount2 directly, resolves to $120
      const resolvedFromProp = resolveFramePrice({ catalog, mount: mount2 });
      expect(resolvedFromProp).toEqual({ amountMinor: 12000, currency: "USD" });

      // When resolved from DOM without explicit mount prop, finds active mount2 (not mount1)
      const resolvedFromDom = resolveFramePrice({ catalog });
      expect(resolvedFromDom).toEqual({ amountMinor: 12000, currency: "USD" });

      // Renders with mount2: frame $120.00 + lens $80.00 = $200.00 (not $130.00)
      const { container } = render(
        <PriceSummary catalog={catalog} selection={selection} mount={mount2} />,
      );
      expect(container.textContent).toContain("$120.00");
      expect(container.textContent).toContain("$200.00");
      expect(container.textContent).not.toContain("$50.00");
      expect(container.textContent).not.toContain("$130.00");
    } finally {
      document.body.removeChild(mount1);
      document.body.removeChild(mount2);
    }
  });

  it("catches expected 'no lens selected' case by returning null (R1-F7)", () => {
    const catalog = createFixtureCatalog("USD");
    const selection: Selection = {
      frameVariantId: "frame-1",
      rxType: "SINGLE_VISION",
      lensId: undefined, // No lens selected yet
      optionValueIds: [],
      addOnIds: [],
    };

    const { container } = render(
      <PriceSummary catalog={catalog} selection={selection} framePrice={{ amountMinor: 12000, currency: "USD" }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("surfaces pricing error state when priceSelection throws an error (R1-F7)", () => {
    const catalog = createFixtureCatalog("USD");
    // Invalid selection with non-existent lens ID triggers PricingError(UNKNOWN_ITEM)
    const selection: Selection = {
      frameVariantId: "frame-1",
      rxType: "SINGLE_VISION",
      lensId: "unknown-lens-id-999",
      optionValueIds: [],
      addOnIds: [],
    };

    const { container } = render(
      <PriceSummary
        catalog={catalog}
        selection={selection}
        framePrice={{ amountMinor: 12000, currency: "USD" }}
      />,
    );

    const errorEl = container.querySelector(".la-price-summary--error");
    expect(errorEl).not.toBeNull();
    expect(errorEl?.getAttribute("role")).toBe("alert");
    expect(container.textContent).toContain(strings.pricingError);
  });
});
