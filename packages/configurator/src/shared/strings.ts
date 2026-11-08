export const strings = {
  header: {
    titlePrefix: "Lenses for ",
    defaultFrameSubtitle: "Customize your lenses",
    closeLabel: "Close lens selection",
  },
  progress: {
    label: "Progress",
    stepCount: (current: number, total: number, name: string): string =>
      `Step ${current} of ${total} · ${name}`,
    currentSr: " (current)",
  },
  footer: {
    back: "Back",
    continue: "Continue",
    totalLabel: "Total",
  },
  loading: {
    title: "Loading catalog…",
    subtitle: "Please wait while we load lens options.",
  },
  error: {
    title: "Something went wrong",
    message: "We couldn't load the lens options. Please try again.",
    retry: "Retry",
  },
  empty: {
    title: "No lenses available",
    message: "There are no lenses configured for this product.",
    close: "Close",
  },
} as const;

export type ConfiguratorStrings = typeof strings;
