import type { JSX } from "preact";
import { strings } from "../shared/strings";
import { ProgressBar } from "./ProgressBar";
import type { StepDefinition } from "./types";

export interface HeaderProps {
  productTitle?: string;
  frameSubtitle?: string;
  steps: StepDefinition[];
  activeStep?: StepDefinition;
  onClose: () => void;
}

export function Header({
  productTitle = "",
  frameSubtitle = strings.header.defaultFrameSubtitle,
  steps,
  activeStep,
  onClose,
}: HeaderProps): JSX.Element {
  const activeIndex = activeStep ? steps.findIndex((s) => s.id === activeStep.id) : 0;
  const currentStepNumber = activeIndex >= 0 ? activeIndex + 1 : 1;
  const totalApplicableSteps = steps.length;
  const stepTitle = activeStep ? activeStep.titleKey : "";

  return (
    <header class="la-header">
      <div class="la-grabber" aria-hidden="true" />
      <div class="la-header__top">
        <p class="la-header__title" id="la-dialog-title">
          <span>{strings.header.titlePrefix}</span>
          <span>{productTitle}</span>
          <span class="la-header__frame">{frameSubtitle}</span>
        </p>
        <button
          type="button"
          class="la-iconbtn"
          aria-label={strings.header.closeLabel}
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {steps.length > 0 && activeStep && (
        <p class="la-steps__count">
          {strings.progress.stepCount(currentStepNumber, totalApplicableSteps, stepTitle)}
        </p>
      )}
      {steps.length > 0 && activeStep && (
        <ProgressBar steps={steps} activeStepId={activeStep.id} />
      )}
    </header>
  );
}
