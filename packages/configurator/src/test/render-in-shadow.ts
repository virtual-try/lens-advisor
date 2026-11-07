import { type ComponentChild } from "preact";
import { render, type RenderResult } from "@testing-library/preact";

export interface ShadowRenderResult extends RenderResult {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
}

export function renderInShadow(
  ui: ComponentChild,
  options?: { css?: string },
): ShadowRenderResult {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadowRoot = host.attachShadow({ mode: "open" });
  if (options?.css) {
    const style = document.createElement("style");
    style.textContent = options.css;
    shadowRoot.appendChild(style);
  }
  const container = document.createElement("div");
  shadowRoot.appendChild(container);
  const result = render(ui, { container });
  const unmountResult = result.unmount.bind(result);
  const view: ShadowRenderResult = {
    ...result,
    host,
    shadowRoot,
    unmount() {
      unmountResult();
      host.remove();
    },
  };
  return view;
}
