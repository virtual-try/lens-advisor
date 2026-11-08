import type { ConfiguratorState, StepModule } from "../../shell/types";
import { PriceSummary } from "../../price-summary/PriceSummary";
import { AddOnsStep } from "./AddOnsStep";
import { strings } from "./strings";

export function isAddOnsStepComplete(_state: ConfiguratorState): boolean {
  return true;
}

export function isAddOnsStepApplicable(state: ConfiguratorState): boolean {
  if (!state.catalog) return true;
  return state.catalog.addOns.length > 0;
}

export const addOnsStep: StepModule = {
  id: "add-ons",
  titleKey: strings.title,
  isComplete: isAddOnsStepComplete,
  isApplicable: isAddOnsStepApplicable,
  Component: AddOnsStep,
  Summary: PriceSummary,
};

export { AddOnsStep };
export const id = addOnsStep.id;
export const titleKey = addOnsStep.titleKey;
export const isComplete = addOnsStep.isComplete;
export const isApplicable = addOnsStep.isApplicable;
export const Component = addOnsStep.Component;
export const Summary = addOnsStep.Summary;

export default addOnsStep;
