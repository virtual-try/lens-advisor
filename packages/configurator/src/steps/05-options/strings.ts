export const strings = {
  title: "Options",
  stepHeading: "Fine-tune your lenses",
  stepDescription:
    "Thickness and tint first, then any extras you want. Prices update as you go.",
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

export type OptionsStepStrings = typeof strings;
