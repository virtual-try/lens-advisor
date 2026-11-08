import type { CatalogResponse, Money, Selection } from "../../../rx-core/src/index.js";
import type { ConfiguratorState } from "../shell/types";
import { parseProductData, type ProductData } from "../shared/types";

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

export function getCurrencyFractionDigits(currency: string): number {
  try {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
    if (typeof digits === "number" && Number.isInteger(digits) && digits >= 0) {
      return digits;
    }
  } catch {
    // fallback
  }
  return 2;
}

/**
 * Normalises Shopify Liquid prices into integer minor units using integer math only (INV-4).
 *
 * Shopify Liquid money filter documentation (https://shopify.dev/docs/api/liquid/filters/money):
 * Liquid money values are always in hundredths of the currency unit, whatever the currency:
 * the money filters divide by 100, so ¥1,500 arrives as 150000, $120.00 arrives as 12000, and
 * 1.500 KWD arrives as 150.
 *
 * Formula using integer arithmetic:
 * priceMinor = round(liquid * 10^digits / 100), where digits is the currency's fraction digits
 * (JPY 0, USD 2, KWD 3).
 *   - digits === 2: liquid unchanged (e.g. 12000 -> 12000)
 *   - digits === 0 (JPY): liquid / 100 (e.g. 150000 -> 1500)
 *   - digits === 3 (KWD): liquid * 10 (e.g. 150 -> 1500)
 */
export function normalizeShopifyLiquidPrice(liquidAmount: number, currency: string): number {
  const digits = getCurrencyFractionDigits(currency);
  if (digits === 2) {
    return liquidAmount;
  }
  if (digits > 2) {
    const factor = Math.pow(10, digits - 2);
    return Math.round(liquidAmount * factor);
  }
  const divisor = Math.pow(10, 2 - digits);
  return Math.round(liquidAmount / divisor);
}

export interface ResolveFramePriceOptions {
  explicitFramePrice?: Money;
  product?: ProductData | null;
  state?: ConfiguratorState | null;
  selection?: Selection | null;
  catalog?: CatalogResponse | null;
  mount?: HTMLElement | null;
}

/**
 * Resolves the frame price in integer minor units without float arithmetic (INV-4).
 *
 * Scoping: DOM resolution looks strictly at the active mount passed by the shell (or
 * `[data-la-mount][data-la-state="open"]`), never taking the first `[data-product-json]` on the document.
 * If the frame price cannot be resolved (or frameVariantId is set and missing), returns `null`
 * so an authoritative-looking 0 total is never produced.
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

  const catalogCurrency = findCatalogCurrency(options.catalog ?? options.state?.catalog);

  let product: ProductData | null = options.product ?? null;

  if (!product && typeof document !== "undefined") {
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
        product = parseProductData(rawJson) ?? null;
      }
    }
  }

  if (product) {
    const frameVariantId =
      options.selection?.frameVariantId ?? options.state?.selection?.frameVariantId;
    let rawAmount: number | undefined;

    if (frameVariantId && product.variants && product.variants.length > 0) {
      const matchingVariant = product.variants.find((v) => v.id === frameVariantId);
      if (!matchingVariant || typeof matchingVariant.priceMinor !== "number") {
        return null;
      }
      rawAmount = matchingVariant.priceMinor;
    } else if (frameVariantId && product.variants && product.variants.length === 0) {
      return null;
    } else {
      rawAmount =
        typeof product.priceMinor === "number"
          ? product.priceMinor
          : product.variants?.[0]?.priceMinor;
    }

    if (typeof rawAmount === "number" && Number.isSafeInteger(rawAmount)) {
      const currency = product.currency || catalogCurrency;
      const amountMinor = normalizeShopifyLiquidPrice(rawAmount, currency);
      return { amountMinor, currency };
    }
  }

  return null;
}
