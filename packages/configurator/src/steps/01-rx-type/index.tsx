import type { ConfiguratorState, StepModule } from "../../shell/types";
import { RxTypeStep } from "./RxTypeStep";

export function isComplete(state: ConfiguratorState): boolean {
  return state.rxType !== null;
}

export function isApplicable(_state: ConfiguratorState): boolean {
  return true;
}

export const id = "rx-type";
export const titleKey = "Vision";
export const Component = RxTypeStep;

export const rxTypeStep: StepModule = {
  id,
  titleKey,
  isComplete,
  isApplicable,
  Component,
};

export default rxTypeStep;
export { RxTypeStep };
