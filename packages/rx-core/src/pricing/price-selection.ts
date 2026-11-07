import type { BundleRole } from "../cart/bundle-properties.js";
import type {
  CatalogResponse,
  Lens,
  Money,
  OptionValue,
  Selection,
} from "../types/index.js";
import { PRICING_ERROR_CODES, PricingError } from "./errors.js";

export interface PriceLine {
  role: BundleRole;
  label: string;
  amount: Money;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  total: Money;
}

/**
 * The frame title is not an input. Specs 28 and 29 can replace this
 * label with the product title; the amount stays the frame price.
 */
const FRAME_LABEL = "Frame";

/**
 * Price a selection in the frame's currency.
 *
 * Line order is the catalog array order, not the selection id order and
 * not a re-sort by `position`: frame, then the lens (when `lensId` is
 * set), then selected option values walked as `optionGroups` → `values`,
 * then selected add-ons walked as `addOns`. A repeated id is one line.
 *
 * An unknown id throws `UNKNOWN_ITEM` before any price is read. The
 * first unknown wins, in order: lens id, then `optionValueIds` as
 * listed, then `addOnIds` as listed. On a selected row, currency is
 * checked before the sign, so a foreign negative delta is
 * `CURRENCY_MISMATCH`. Only option deltas are rejected when negative
 * (`NEGATIVE_DELTA`); a zero delta is a real line.
 */
export function priceSelection(
  selection: Selection,
  catalog: CatalogResponse,
  framePrice: Money,
): PriceBreakdown {
  if (
    typeof framePrice.currency !== "string" ||
    framePrice.currency.length === 0 ||
    !Number.isSafeInteger(framePrice.amountMinor)
  ) {
    throw new PricingError(PRICING_ERROR_CODES.MONEY_FORMAT);
  }
  const currency = framePrice.currency;

  const lenses = indexFirst(flattenLenses(catalog));
  const options = indexFirst(flattenOptions(catalog));
  const addOns = indexFirst(catalog.addOns);

  if (selection.lensId !== undefined && !lenses.has(selection.lensId)) {
    throw new PricingError(
      PRICING_ERROR_CODES.UNKNOWN_ITEM,
      selection.lensId,
    );
  }
  for (const id of selection.optionValueIds) {
    if (!options.has(id)) {
      throw new PricingError(PRICING_ERROR_CODES.UNKNOWN_ITEM, id);
    }
  }
  for (const id of selection.addOnIds) {
    if (!addOns.has(id)) {
      throw new PricingError(PRICING_ERROR_CODES.UNKNOWN_ITEM, id);
    }
  }

  const lines: PriceLine[] = [
    {
      role: "frame",
      label: FRAME_LABEL,
      amount: {
        amountMinor: framePrice.amountMinor === 0 ? 0 : framePrice.amountMinor,
        currency,
      },
    },
  ];

  if (selection.lensId !== undefined) {
    const lens = lenses.get(selection.lensId);
    if (lens === undefined) {
      throw new PricingError(
        PRICING_ERROR_CODES.UNKNOWN_ITEM,
        selection.lensId,
      );
    }
    lines.push({
      role: "lens",
      label: lens.name,
      amount: pricedAmount(lens.price, currency, lens.id),
    });
  }

  const wantedOptions = new Set(selection.optionValueIds);
  const emittedOptions = new Set<string>();
  for (const group of catalog.optionGroups) {
    for (const value of group.values) {
      if (!wantedOptions.has(value.id) || emittedOptions.has(value.id)) {
        continue;
      }
      emittedOptions.add(value.id);
      const amount = pricedAmount(value.priceDelta, currency, value.id);
      if (amount.amountMinor < 0) {
        throw new PricingError(PRICING_ERROR_CODES.NEGATIVE_DELTA, value.id);
      }
      lines.push({
        role: "option",
        label: value.label,
        amount,
      });
    }
  }

  const wantedAddOns = new Set(selection.addOnIds);
  const emittedAddOns = new Set<string>();
  for (const addOn of catalog.addOns) {
    if (!wantedAddOns.has(addOn.id) || emittedAddOns.has(addOn.id)) {
      continue;
    }
    emittedAddOns.add(addOn.id);
    lines.push({
      role: "addon",
      label: addOn.name,
      amount: pricedAmount(addOn.price, currency, addOn.id),
    });
  }

  let totalMinor = 0;
  for (const priceLine of lines) {
    const next = totalMinor + priceLine.amount.amountMinor;
    if (!Number.isSafeInteger(next)) {
      throw new PricingError(PRICING_ERROR_CODES.MONEY_FORMAT);
    }
    totalMinor = next;
  }

  return {
    lines,
    total: { amountMinor: totalMinor, currency },
  };
}

function pricedAmount(
  amount: Money,
  currency: string,
  itemId: string,
): Money {
  if (!Number.isSafeInteger(amount.amountMinor)) {
    throw new PricingError(PRICING_ERROR_CODES.MONEY_FORMAT, itemId);
  }
  if (amount.currency !== currency) {
    throw new PricingError(PRICING_ERROR_CODES.CURRENCY_MISMATCH, itemId);
  }
  const amountMinor = amount.amountMinor === 0 ? 0 : amount.amountMinor;
  return { amountMinor, currency };
}

function flattenLenses(catalog: CatalogResponse): Lens[] {
  const lenses: Lens[] = [];
  for (const group of catalog.lensGroups) {
    for (const lens of group.lenses) {
      lenses.push(lens);
    }
  }
  return lenses;
}

function flattenOptions(catalog: CatalogResponse): OptionValue[] {
  const values: OptionValue[] = [];
  for (const group of catalog.optionGroups) {
    for (const value of group.values) {
      values.push(value);
    }
  }
  return values;
}

function indexFirst<T extends { id: string }>(
  items: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  }
  return map;
}
