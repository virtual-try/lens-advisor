import { h } from "preact";
import { describe, expect, it } from "vitest";
import { renderInShadow } from "./render-in-shadow";

describe("renderInShadow", () => {
  it("renders into an open shadow root and leaves the light DOM empty", () => {
    const view = renderInShadow(h("button", { type: "button" }, "Open"));
    const button = view.getByRole("button", { name: "Open" });
    expect(view.shadowRoot.contains(button)).toBe(true);
    expect(document.body.querySelector("button")).toBeNull();
    view.unmount();
    expect(document.body.contains(view.host)).toBe(false);
  });

  it("places optional css in the shadow root ahead of the mount", () => {
    const view = renderInShadow(h("p", null, "Copy"), { css: ".marker { color: canvastext; }" });
    const style = view.shadowRoot.querySelector("style");
    expect(style?.textContent).toContain(".marker");
    expect(view.shadowRoot.firstElementChild).toBe(style);
  });
});
