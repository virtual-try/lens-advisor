import type { JSX } from "preact";
import type { CatalogResponse, Money, Selection } from "../../../rx-core/src/index.js";
import { priceSelection, type PriceBreakdown } from "../../../rx-core/src/pricing/index.js";
import { formatMoney } from "../shared/format";
import type { ApiClient } from "../shared/api";
import type { ProductData } from "../shared/types";
import type { ConfiguratorAction, ConfiguratorState } from "../shell/types";
import priceSummaryCss from "./price-summary.css?inline";
import { findCatalogCurrency, resolveFramePrice } from "./resolve-frame-price";
import { strings } from "./strings";

export interface PriceSummaryProps {
  state?: ConfiguratorState;
  dispatch?: (action: ConfiguratorAction) => void;
  api?: ApiClient;
  variant?: "compact" | "expanded";
  framePrice?: Money;
  selection?: Selection;
  catalog?: CatalogResponse;
  mount?: HTMLElement | null;
  product?: ProductData | null;
}

export function PriceSummary({
  state,
  variant = "compact",
  framePrice: explicitFramePrice,
  selection: explicitSelection,
  catalog: explicitCatalog,
  mount,
  product,
}: PriceSummaryProps): JSX.Element | null {
  const selection = explicitSelection ?? state?.selection;
  const catalog = explicitCatalog ?? state?.catalog;

  if (!selection || !catalog) {
    return null;
  }

  // Catch the expected "no lens selected" case: return null
  if (!selection.lensId) {
    return null;
  }

  const framePrice = resolveFramePrice({
    explicitFramePrice,
    product,
    state,
    selection,
    catalog,
    mount,
  });

  const catalogCurrency = findCatalogCurrency(catalog);
  const fallbackCurrency = framePrice?.currency || catalogCurrency;

  let breakdown: PriceBreakdown;
  try {
    breakdown = priceSelection(
      selection,
      catalog,
      framePrice ?? { amountMinor: 0, currency: fallbackCurrency },
    );
  } catch {
    return (
      <div class="la-price-summary la-price-summary--error" role="alert">
        <style>{priceSummaryCss}</style>
        <span class="la-price-summary__error-message">{strings.pricingError}</span>
      </div>
    );
  }

  const { lines, total } = breakdown;
  const hasFramePrice = framePrice !== null;
  const formattedTotal = hasFramePrice
    ? formatMoney(total.amountMinor, total.currency)
    : null;

  if (variant === "expanded") {
    return (
      <div class="la-price-summary la-price-summary--expanded">
        <style>{priceSummaryCss}</style>
        <div class="la-price-summary__title">{strings.breakdownTitle}</div>
        <ul class="la-price-summary__list">
          {lines.map((line, idx) => {
            const isFrame = line.role === "frame";
            if (isFrame && !hasFramePrice) {
              return (
                <li
                  key={`${line.role}-${line.label}-${idx}`}
                  class="la-price-summary__item"
                >
                  <span class="la-price-summary__item-label">{line.label}</span>
                  <span class="la-price-summary__item-amount la-price-summary__unavailable">
                    {strings.framePriceUnavailable}
                  </span>
                </li>
              );
            }

            const isZero = line.amount.amountMinor === 0;
            const formatted = isZero
              ? strings.included
              : formatMoney(line.amount.amountMinor, line.amount.currency);
            return (
              <li
                key={`${line.role}-${line.label}-${idx}`}
                class="la-price-summary__item"
              >
                <span class="la-price-summary__item-label">{line.label}</span>
                <span class="la-price-summary__item-amount">{formatted}</span>
              </li>
            );
          })}
        </ul>
        <div class="la-price-summary__total">
          {hasFramePrice ? (
            <>
              <span class="la-price-summary__total-label">{strings.total}</span>
              <strong class="la-price-summary__total-amount">{formattedTotal}</strong>
            </>
          ) : (
            <span class="la-price-summary__unavailable">{strings.framePriceUnavailable}</span>
          )}
        </div>
      </div>
    );
  }

  // Compact variant: if frame price unavailable, hide frame line and show unavailable state instead of total
  const visibleLines = hasFramePrice ? lines : lines.filter((l) => l.role !== "frame");

  return (
    <div class="la-price-summary la-price-summary--compact">
      <style>{priceSummaryCss}</style>
      <span class="la-total__parts">
        {visibleLines.map((line, idx) => {
          const isZero = line.amount.amountMinor === 0;
          const formatted = isZero
            ? strings.included
            : formatMoney(line.amount.amountMinor, line.amount.currency);
          return (
            <span
              key={`${line.role}-${line.label}-${idx}`}
              class="la-price-summary__line"
            >
              {idx > 0 && (
                <span class="la-price-summary__separator">
                  {strings.separator}
                </span>
              )}
              <span class="la-price-summary__line-label">{line.label}</span>
              <b class="la-price-summary__line-amount">{formatted}</b>
            </span>
          );
        })}
      </span>
      <span class="la-total__amount" aria-live="polite" aria-atomic="true">
        {hasFramePrice ? (
          <>
            <span class="la-total__label">{strings.total}</span>
            <strong>{formattedTotal}</strong>
          </>
        ) : (
          <span class="la-price-summary__unavailable">{strings.framePriceUnavailable}</span>
        )}
      </span>
    </div>
  );
}
