import type { JSX } from "preact";
import { strings } from "../shared/strings";
import type { StepDefinition } from "./types";

export interface ProgressBarProps {
  steps: StepDefinition[];
  activeStepId: string;
}

export function ProgressBar({ steps, activeStepId }: ProgressBarProps): JSX.Element {
  const activeIndex = steps.findIndex((s) => s.id === activeStepId);

  return (
    <ol class="la-steps" aria-label={strings.progress.label}>
      {steps.map((step, idx) => {
        const isCurrent = idx === activeIndex;
        const isPast = idx < activeIndex;
        const itemClass = `la-steps__item ${isCurrent ? "la-steps__item--current" : ""} ${isPast ? "la-steps__item--completed" : ""}`.trim();

        return (
          <li key={step.id} class={itemClass}>
            <span
              class="la-steps__link"
              aria-current={isCurrent ? "step" : undefined}
            >
              <span class="la-steps__fill" />
              <span class="la-sr">
                {step.titleKey}
                {isCurrent && <span>{strings.progress.currentSr}</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
