import type { CatalogResponse, Money } from "../../../rx-core/src/index.js";
import { parseMoneyText } from "../../../rx-core/src/pricing/index.js";
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

export interface ResolveFramePriceOptions {
  explicitFramePrice?: Money;
  state?: ConfiguratorState | null;
  catalog?: CatalogResponse | null;
  mount?: HTMLElement | null;
}

/**
 * Resolves the frame price in integer minor units without float arithmetic (INV-4).
 *
 * Shopify Liquid money-unit convention (select-lenses.liquid):
 * In Shopify Liquid, `variant.price` and `product.price` represent the price in the customer's
 * currency's smallest/minor unit:
 *   - 2-decimal currencies (USD, EUR, GBP): cents (e.g. 12000 for $120.00).
 *   - 0-decimal currencies (JPY, KRW): integer units (e.g. 1500 for ¥1,500).
 *   - 3-decimal currencies (KWD, BHD): minor units/fils (e.g. 1500 for 1.500 KWD).
 * Therefore, `priceMinor` in `data-product-json` is already in integer minor units and must never
 * be multiplied by 100.
 *
 * If any decimal text is parsed, it is parsed strictly using rx-core `parseMoneyText(text, currency)`.
 *
 * Scoping: DOM resolution looks strictly at the active mount passed by the shell (or
 * `[data-la-mount][data-la-state="open"]`), never taking the first `[data-product-json]` on the document.
 * If the frame price cannot be resolved, returns `null` so an authoritative-looking 0 total is never produced.
 */
export function resolveFramePrice(options: ResolveFramePriceOptions): Money | null {
  if (
    options.explicitFramePrice &&
    typeof options.explicitFramePrice.amountMinor === "number" &&
    Number.isSafeInteger(options.explicitFramePrice.amountMinor) &&
    typeof options.explicitFramePrice.currency === "string" &&
    options.explicitFramePrice.currency.length > 0
  ) {
    return options.explicitFramePrice;
  }

  const stateAny = options.state as Record<string, unknown> | null | undefined;
  if (stateAny?.framePrice) {
    const fp = stateAny.framePrice as Money;
    if (
      typeof fp.amountMinor === "number" &&
      Number.isSafeInteger(fp.amountMinor) &&
      typeof fp.currency === "string"
    ) {
      return fp;
    }
  }

  const selectionAny = options.state?.selection as Record<string, unknown> | undefined;
  if (selectionAny?.framePrice) {
    const fp = selectionAny.framePrice as Money;
    if (
      typeof fp.amountMinor === "number" &&
      Number.isSafeInteger(fp.amountMinor) &&
      typeof fp.currency === "string"
    ) {
      return fp;
    }
  }

  const catalogCurrency = findCatalogCurrency(options.catalog ?? options.state?.catalog);

  if (typeof document !== "undefined") {
    // Resolve from the active mount passed by the shell, or document active mount.
    // Never document.querySelector('[data-product-json]') which could match an inactive block.
    const activeMount =
      options.mount ??
      document.querySelector<HTMLElement>('[data-la-mount][data-la-state="open"]');

    if (activeMount) {
      const rawJson =
        activeMount.getAttribute("data-product-json") ??
        activeMount.querySelector<HTMLElement>("[data-product-json]")?.getAttribute("data-product-json");

      if (rawJson) {
        const product = parseProductData(rawJson);
        if (product) {
          const frameVariantId = options.state?.selection.frameVariantId;
          const matchingVariant = product.variants?.find((v) => v.id === frameVariantId);
          const rawAmount =
            matchingVariant?.priceMinor ??
            product.priceMinor ??
            product.variants?.[0]?.priceMinor;
          const currency = product.currency || catalogCurrency;

          if (typeof rawAmount === "number" && Number.isSafeInteger(rawAmount)) {
            return { amountMinor: rawAmount, currency };
          }
          if (typeof rawAmount === "string") {
            const parsed = parseMoneyText(rawAmount, currency);
            if (parsed.ok) {
              return { amountMinor: parsed.amountMinor, currency };
            }
          }
        }
      }
    }
  }

  return null;
}
