export const strings = {
  title: "Extras",
  stepHeading: "Extras",
  stepDescription: "Optional. Add only what you want.",
  included: "Included",
  priceDelta: (formatted: string): string => `+${formatted}`,
} as const;

export type AddOnsStepStrings = typeof strings;
