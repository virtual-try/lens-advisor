import { describe, expect, it } from "vitest";
import {
  ensureConfigurator,
  LENS_CONFIGURATOR_TAG,
  LensConfiguratorElement,
} from "./configurator";

describe("configurator entry", () => {
  it("registers lens-configurator custom element", () => {
    const ctor = customElements.get(LENS_CONFIGURATOR_TAG);
    expect(ctor).toBeTypeOf("function");
  });

  it("attaches shadow root when connected", () => {
    const el = document.createElement(LENS_CONFIGURATOR_TAG) as LensConfiguratorElement;
    document.body.appendChild(el);
    expect(el.shadowRoot).not.toBeNull();
    el.remove();
  });

  it("reads mount data-product-json and opens on la:open event", () => {
    const mount = document.createElement("div");
    mount.setAttribute("data-la-mount", "");
    mount.setAttribute(
      "data-product-json",
      JSON.stringify({ id: "prod-1", title: "Harlow frame" }),
    );
    mount.setAttribute("data-proxy", "/apps/lens-advisor");

    const button = document.createElement("button");
    button.setAttribute("data-la-open", "");
    button.textContent = "Open configurator";
    mount.appendChild(button);
    document.body.appendChild(mount);

    const configurator = ensureConfigurator(document);
    expect(configurator.isOpen).toBe(false);

    // Dispatch la:open event
    mount.dispatchEvent(
      new CustomEvent("la:open", {
        bubbles: true,
        detail: { mount },
      }),
    );

    expect(configurator.isOpen).toBe(true);
    expect(configurator.shadowRoot?.querySelector(".la-sheet")).not.toBeNull();

    // Close configurator
    configurator.close();
    expect(configurator.isOpen).toBe(false);
    expect(configurator.shadowRoot?.querySelector(".la-sheet")).toBeNull();

    mount.remove();
    configurator.remove();
  });

  it("preserves pre-existing body overflow ('clip') on close and on disconnect", () => {
    document.body.style.overflow = "clip";

    const mount = document.createElement("div");
    mount.setAttribute("data-la-mount", "");
    mount.setAttribute("data-product-json", JSON.stringify({ id: "prod-clip" }));
    const button = document.createElement("button");
    button.setAttribute("data-la-open", "");
    mount.appendChild(button);
    document.body.appendChild(mount);

    // Test 1: open -> close restores exact prior "clip"
    const configurator = ensureConfigurator(document);
    configurator.open(mount);
    expect(document.body.style.overflow).toBe("hidden");

    configurator.close();
    expect(document.body.style.overflow).toBe("clip");

    // Test 2: open -> disconnect restores exact prior "clip"
    configurator.open(mount);
    expect(document.body.style.overflow).toBe("hidden");

    configurator.remove();
    expect(document.body.style.overflow).toBe("clip");

    mount.remove();
    document.body.style.overflow = "";
  });

  it("releases focus trap and scroll lock on disconnect when open", () => {
    const mount = document.createElement("div");
    mount.setAttribute("data-la-mount", "");
    mount.setAttribute("data-product-json", JSON.stringify({ id: "prod-2" }));

    const button = document.createElement("button");
    button.setAttribute("data-la-open", "");
    button.textContent = "Open configurator";
    mount.appendChild(button);
    document.body.appendChild(mount);
    button.focus();

    const configurator = ensureConfigurator(document);
    configurator.open(mount);
    expect(configurator.isOpen).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    // Remove element while open (disconnect)
    configurator.remove();

    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(button);

    mount.remove();
  });
});
