import type { StepDefinition, StepModule } from "./types";

/**
 * Discovered step modules from import.meta.glob.
 * Eager discovery lets the shell configure all steps synchronously.
 */
export function loadDiscoveredSteps(
  modulesRecord?: Record<string, unknown>,
): StepDefinition[] {
  // If no custom record passed, use import.meta.glob
  const modules =
    modulesRecord ??
    (import.meta.glob("../steps/*/index.tsx", {
      eager: true,
    }) as Record<string, unknown>);

  const entries = Object.entries(modules);
  // Order by folder prefix (e.g. '01-rx-type' < '02-prescription')
  entries.sort(([pathA], [pathB]) => pathA.localeCompare(pathB));

  const steps: StepDefinition[] = [];
  for (const [path, rawMod] of entries) {
    const mod = rawMod as Partial<StepModule> & { default?: Partial<StepModule> };
    const step = (mod.id ? mod : mod.default) as StepModule | undefined;
    if (
      step &&
      typeof step.id === "string" &&
      typeof step.titleKey === "string" &&
      typeof step.isComplete === "function" &&
      typeof step.isApplicable === "function" &&
      typeof step.Component !== "undefined"
    ) {
      const folderMatch = path.match(/steps\/([^/]+)/);
      const folder = folderMatch ? folderMatch[1] : path;
      steps.push({
        id: step.id,
        titleKey: step.titleKey,
        isComplete: step.isComplete,
        isApplicable: step.isApplicable,
        canContinue: step.canContinue,
        onContinue: step.onContinue,
        Component: step.Component,
        Summary: step.Summary,
        folder,
      });
    }
  }

  return steps;
}
