import type { JSX } from "preact";
import { strings } from "../shared/strings";
import type { ApiClient } from "../shared/api";
import type { ConfiguratorAction, ConfiguratorState, StepDefinition } from "./types";

export interface FooterProps {
  state: ConfiguratorState;
  dispatch: (action: ConfiguratorAction) => void;
  api: ApiClient;
  activeStep?: StepDefinition;
  canGoBack: boolean;
  canContinue?: boolean;
  isComplete: boolean;
  onBack: () => void;
  onContinue: () => void;
}

export function Footer({
  state,
  dispatch,
  api,
  activeStep,
  canGoBack,
  canContinue,
  isComplete,
  onBack,
  onContinue,
}: FooterProps): JSX.Element {
  const SummaryComponent = activeStep?.Summary;

  const continueDisabled = canContinue !== undefined ? !canContinue : !isComplete;

  return (
    <footer class="la-footer">
      <div class="la-total">
        {SummaryComponent && (
          <SummaryComponent state={state} dispatch={dispatch} api={api} />
        )}
      </div>
      <div class="la-footer__actions">
        {canGoBack && (
          <button
            type="button"
            class="la-btn la-btn--ghost"
            onClick={onBack}
          >
            {strings.footer.back}
          </button>
        )}
        <button
          type="button"
          class="la-btn la-btn--primary"
          disabled={continueDisabled}
          onClick={onContinue}
        >
          {strings.footer.continue}
        </button>
      </div>
    </footer>
  );
}
