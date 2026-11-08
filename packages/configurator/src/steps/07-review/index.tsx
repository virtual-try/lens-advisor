import type { ConfiguratorState, StepModule } from "../../shell/types";
import { ReviewStep } from "./ReviewStep";

export function isReviewStepComplete(_state: ConfiguratorState): boolean {
  return true;
}

export function isReviewStepApplicable(_state: ConfiguratorState): boolean {
  return true;
}

export const reviewStep: StepModule = {
  id: "review",
  titleKey: "review",
  isComplete: isReviewStepComplete,
  isApplicable: isReviewStepApplicable,
  Component: ReviewStep,
};

export default reviewStep;
export const id = reviewStep.id;
export const titleKey = reviewStep.titleKey;
export const isComplete = reviewStep.isComplete;
export const isApplicable = reviewStep.isApplicable;
export const Component = reviewStep.Component;
