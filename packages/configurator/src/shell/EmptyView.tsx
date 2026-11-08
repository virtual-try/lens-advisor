import type { JSX } from "preact";
import { strings } from "../shared/strings";

export interface EmptyViewProps {
  onClose: () => void;
}

export function EmptyView({ onClose }: EmptyViewProps): JSX.Element {
  return (
    <div class="la-empty-view">
      <h2 class="la-view-title">{strings.empty.title}</h2>
      <p class="la-view-desc">{strings.empty.message}</p>
      <button
        type="button"
        class="la-btn la-btn--primary"
        onClick={onClose}
      >
        {strings.empty.close}
      </button>
    </div>
  );
}
