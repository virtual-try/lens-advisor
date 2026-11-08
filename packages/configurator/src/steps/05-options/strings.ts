export const strings = {
  title: "Options",
  stepHeading: "Fine-tune your lenses",
  stepDescription:
    "Thickness and tint first, then any extras you want. Prices update as you go.",
  included: "Included",
  priceDelta: (formatted: string): string => `+${formatted}`,
} as const;

export type OptionsStepStrings = typeof strings;
