export const strings = {
  title: "Extras",
  stepHeading: "Extras",
  stepDescription: "Optional. Add only what you want.",
  included: "Included",
  priceDelta: (formatted: string, amountMinor?: number): string => {
    if (typeof amountMinor === "number") {
      if (amountMinor > 0) return `+${formatted}`;
      if (amountMinor < 0) return formatted.startsWith("-") ? formatted : `-${formatted}`;
      return "";
    }
    if (formatted.startsWith("-") || formatted.startsWith("+")) {
      return formatted;
    }
    return `+${formatted}`;
  },
} as const;

export type AddOnsStepStrings = typeof strings;
