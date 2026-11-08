export const strings = {
  total: "Total",
  included: "Included",
  separator: "+",
  breakdownTitle: "Price breakdown",
  framePriceUnavailable: "Frame price unavailable",
  pricingError: "Pricing error",
} as const;

export type PriceSummaryStrings = typeof strings;
