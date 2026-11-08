import { describe, expect, it } from "vitest";
import { LENS_CONFIGURATOR_TAG } from "./configurator";

describe("configurator entry", () => {
  it("registers an empty lens-configurator element", () => {
    const ctor = customElements.get(LENS_CONFIGURATOR_TAG);
    expect(ctor).toBeTypeOf("function");
    const element = document.createElement(LENS_CONFIGURATOR_TAG);
    expect(element.shadowRoot).toBeNull();
    expect(element.childNodes).toHaveLength(0);
  });
});
