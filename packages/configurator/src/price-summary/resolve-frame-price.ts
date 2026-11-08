import type { CatalogResponse, Money } from "../../../rx-core/src/index.js";
import type { ConfiguratorState } from "../shell/types";
import { parseProductData } from "../shared/types";

export function findCatalogCurrency(catalog?: CatalogResponse | null): string {
  if (!catalog) return "USD";

  for (const group of catalog.lensGroups ?? []) {
    for (const lens of group.lenses ?? []) {
      if (lens.price?.currency) return lens.price.currency;
    }
  }

  for (const group of catalog.optionGroups ?? []) {
    for (const val of group.values ?? []) {
      if (val.priceDelta?.currency) return val.priceDelta.currency;
    }
  }

  for (const addOn of catalog.addOns ?? []) {
    if (addOn.price?.currency) return addOn.price.currency;
  }

  return "USD";
}

export function resolveFramePrice(options: {
  explicitFramePrice?: Money;
  state?: ConfiguratorState | null;
  catalog?: CatalogResponse | null;
}): Money {
  if (
    options.explicitFramePrice &&
    typeof options.explicitFramePrice.amountMinor === "number" &&
    typeof options.explicitFramePrice.currency === "string" &&
    options.explicitFramePrice.currency.length > 0
  ) {
    return options.explicitFramePrice;
  }

  const stateAny = options.state as Record<string, unknown> | null | undefined;
  if (stateAny?.framePrice) {
    const fp = stateAny.framePrice as Money;
    if (typeof fp.amountMinor === "number" && typeof fp.currency === "string") {
      return fp;
    }
  }

  const selectionAny = options.state?.selection as Record<string, unknown> | undefined;
  if (selectionAny?.framePrice) {
    const fp = selectionAny.framePrice as Money;
    if (typeof fp.amountMinor === "number" && typeof fp.currency === "string") {
      return fp;
    }
  }

  const catalogCurrency = findCatalogCurrency(options.catalog ?? options.state?.catalog);

  if (typeof document !== "undefined") {
    const sheetEl = document.querySelector<HTMLElement>("[data-frame]");
    if (sheetEl) {
      const rawFrame = sheetEl.getAttribute("data-frame");
      if (rawFrame) {
        const parsed = Number(rawFrame);
        if (Number.isFinite(parsed) && parsed >= 0) {
          const currency = sheetEl.getAttribute("data-currency") || catalogCurrency;
          return {
            amountMinor: Math.round(parsed * 100),
            currency,
          };
        }
      }
    }

    const mountEl = document.querySelector<HTMLElement>("[data-product-json]");
    if (mountEl) {
      const rawJson = mountEl.getAttribute("data-product-json");
      const product = parseProductData(rawJson);
      if (product) {
        const frameVariantId = options.state?.selection.frameVariantId;
        const matchingVariant = product.variants?.find((v) => v.id === frameVariantId);
        const amountMinor =
          matchingVariant?.priceMinor ??
          product.priceMinor ??
          product.variants?.[0]?.priceMinor;
        const currency = product.currency || catalogCurrency;

        if (typeof amountMinor === "number") {
          return { amountMinor, currency };
        }
      }
    }
  }

  return {
    amountMinor: 0,
    currency: catalogCurrency,
  };
}
