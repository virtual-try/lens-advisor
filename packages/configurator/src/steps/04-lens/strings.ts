export const lensStrings = {
  stepTitle: "Choose your lens",
  stepDescription: "Every option below works with your prescription unless it says otherwise.",
  lensListLabel: "Lenses",
  allUnavailableTitle: "No matching lenses",
  allUnavailableExplanation: "No lenses in this group are available for your prescription.",
  changePrescription: "Change prescription",
  noGroupSelected: "Please go back and choose a lens family first.",
  reasons: {
    rxTypeNotSupported: "Not available for your prescription type",
    sphBelowMin: (val: string, lim: string) =>
      `Not available for your prescription — SPH ${val} is beyond ${lim}`,
    sphAboveMax: (val: string, lim: string) =>
      `Not available for your prescription — SPH ${val} is beyond ${lim}`,
    cylOutOfRange: (val: string, lim: string) =>
      `Not available for your prescription — CYL ${val} is beyond ${lim}`,
    addOutOfRange: (val: string, lim: string) =>
      `Not available for your prescription — ADD ${val} is beyond ${lim}`,
    generic: "Not available for your prescription",
  },
};

export type LensStrings = typeof lensStrings;
