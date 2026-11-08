import type { JSX } from "preact";
import { strings } from "../shared/strings";

export interface ErrorViewProps {
  onRetry: () => void;
}

export function ErrorView({ onRetry }: ErrorViewProps): JSX.Element {
  return (
    <div class="la-error-view" role="alert">
      <h2 class="la-view-title">{strings.error.title}</h2>
      <p class="la-view-desc">{strings.error.message}</p>
      <button
        type="button"
        class="la-btn la-btn--primary"
        onClick={onRetry}
      >
        {strings.error.retry}
      </button>
    </div>
  );
}
