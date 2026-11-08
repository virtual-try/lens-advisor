export const lensGroupStrings = {
  stepTitle: "Choose your lens family",
  stepDescription: "Select a lens family to see available lenses.",
  groupListLabel: "Lens families",
  fromPrice: (formattedPrice: string) => `from ${formattedPrice}`,
  noGroupsAvailable: "No lens options available for your prescription type.",
};

export type LensGroupStrings = typeof lensGroupStrings;
