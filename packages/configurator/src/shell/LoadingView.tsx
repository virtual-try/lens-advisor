import type { JSX } from "preact";
import { strings } from "../shared/strings";

export function LoadingView(): JSX.Element {
  return (
    <div class="la-loading" role="status" aria-busy="true">
      <h2 class="la-view-title">{strings.loading.title}</h2>
      <p class="la-view-desc">{strings.loading.subtitle}</p>
    </div>
  );
}
