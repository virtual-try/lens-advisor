import type { ConfiguratorState, StepModule } from "../../shell/types";
import { PriceSummary } from "../../price-summary/PriceSummary";
import { OptionsStep } from "./OptionsStep";
import { strings } from "./strings";

export function isOptionsStepComplete(state: ConfiguratorState): boolean {
  if (!state.catalog?.optionGroups || state.catalog.optionGroups.length === 0) {
    return true;
  }
  return state.catalog.optionGroups.every((group) => {
    if (group.values.length === 0) return true;
    return group.values.some((v) => state.selection.optionValueIds.includes(v.id));
  });
}

export function isOptionsStepApplicable(state: ConfiguratorState): boolean {
  if (!state.catalog) return true;
  return state.catalog.optionGroups.length > 0;
}

export const optionsStep: StepModule = {
  id: "options",
  titleKey: strings.title,
  isComplete: isOptionsStepComplete,
  isApplicable: isOptionsStepApplicable,
  Component: OptionsStep,
  Summary: PriceSummary,
};

export { OptionsStep };
export const id = optionsStep.id;
export const titleKey = optionsStep.titleKey;
export const isComplete = optionsStep.isComplete;
export const isApplicable = optionsStep.isApplicable;
export const Component = optionsStep.Component;
export const Summary = optionsStep.Summary;

export default optionsStep;
