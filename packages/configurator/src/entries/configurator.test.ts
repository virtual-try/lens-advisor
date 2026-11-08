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

  it("makes open() idempotent when already open: la:open yields one open and close restores body overflow (R2-F1)", () => {
    document.body.style.overflow = "auto";

    const mount = document.createElement("div");
    mount.setAttribute("data-la-mount", "");
    mount.setAttribute("data-product-json", JSON.stringify({ id: "prod-idemp" }));
    const button = document.createElement("button");
    button.setAttribute("data-la-open", "");
    mount.appendChild(button);
    document.body.appendChild(mount);

    const configurator = ensureConfigurator(document);
    expect(configurator.isOpen).toBe(false);

    // Dispatch la:open
    mount.dispatchEvent(
      new CustomEvent("la:open", {
        bubbles: true,
        detail: { mount },
      }),
    );
    expect(configurator.isOpen).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    // Second la:open while already open must be idempotent and not capture "hidden"
    mount.dispatchEvent(
      new CustomEvent("la:open", {
        bubbles: true,
        detail: { mount },
      }),
    );
    // Explicit duplicate call to open() while open
    configurator.open(mount);
    expect(configurator.isOpen).toBe(true);

    // Close configurator: body overflow must be restored to prior "auto", not "hidden"
    configurator.close();
    expect(configurator.isOpen).toBe(false);
    expect(document.body.style.overflow).toBe("auto");

    mount.remove();
    configurator.remove();
    document.body.style.overflow = "";
  });

  it("captures real overflow and restores it on close across multiple reopen cycles (R2-F1)", () => {
    document.body.style.overflow = "scroll";

    const mount = document.createElement("div");
    mount.setAttribute("data-la-mount", "");
    mount.setAttribute("data-product-json", JSON.stringify({ id: "prod-reopen" }));
    const button = document.createElement("button");
    button.setAttribute("data-la-open", "");
    mount.appendChild(button);
    document.body.appendChild(mount);

    const configurator = ensureConfigurator(document);

    // Cycle 1: open -> close restores "scroll"
    configurator.open(mount);
    expect(document.body.style.overflow).toBe("hidden");
    configurator.close();
    expect(document.body.style.overflow).toBe("scroll");

    // Change overflow while closed to "visible"
    document.body.style.overflow = "visible";

    // Cycle 2 (reopen): captures new "visible" overflow and restores it on close
    configurator.open(mount);
    expect(document.body.style.overflow).toBe("hidden");
    configurator.close();
    expect(document.body.style.overflow).toBe("visible");

    mount.remove();
    configurator.remove();
    document.body.style.overflow = "";
  });

  it("handles lazy-load with data-la-state='open', capturing pre-existing overflow and restoring on close (R2-F1)", () => {
    document.body.style.overflow = "auto";

    const mount = document.createElement("div");
    mount.setAttribute("data-la-mount", "");
    mount.setAttribute("data-la-state", "open");
    mount.setAttribute("data-product-json", JSON.stringify({ id: "prod-lazy" }));
    const button = document.createElement("button");
    button.setAttribute("data-la-open", "");
    mount.appendChild(button);
    document.body.appendChild(mount);

    // Simulate lazy-loading: creating and connecting element while mount is already open
    const configurator = document.createElement(LENS_CONFIGURATOR_TAG) as LensConfiguratorElement;
    document.body.appendChild(configurator);

    expect(configurator.isOpen).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    // Simulate module-level handler also calling open(mount) after connectedCallback
    configurator.open(mount);

    // Close restores prior "auto", not "hidden"
    configurator.close();
    expect(configurator.isOpen).toBe(false);
    expect(document.body.style.overflow).toBe("auto");

    mount.remove();
    configurator.remove();
    document.body.style.overflow = "";
  });
});
