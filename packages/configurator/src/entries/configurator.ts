import { h, render } from "preact";
import { ConfiguratorApp } from "../shell/ConfiguratorApp";
import { parseProductData } from "../shared/types";

export const LENS_CONFIGURATOR_TAG = "lens-configurator";

export class LensConfiguratorElement extends HTMLElement {
  private mountPoint: HTMLElement | null = null;
  private triggerButton: HTMLElement | null = null;
  private isOpenState = false;
  private prevBodyOverflow: string | null = null;

  connectedCallback(): void {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    // If mount was already opened before connection:
    const activeMount = document.querySelector<HTMLElement>(
      '[data-la-mount][data-la-state="open"]',
    );
    if (activeMount && !this.isOpenState) {
      this.open(activeMount);
    }
  }

  disconnectedCallback(): void {
    if (this.isOpenState) {
      this.close();
    } else if (typeof document !== "undefined" && this.prevBodyOverflow !== null) {
      document.body.style.overflow = this.prevBodyOverflow;
      this.prevBodyOverflow = null;
    }
  }

  open(mount: HTMLElement): void {
    if (this.isOpenState) {
      return;
    }
    this.isOpenState = true;

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    this.mountPoint = mount;
    this.triggerButton = mount.querySelector<HTMLElement>("[data-la-open]") || null;

    if (typeof document !== "undefined" && this.prevBodyOverflow === null) {
      this.prevBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const rawJson = mount.getAttribute("data-product-json");
    const product = parseProductData(rawJson);

    const proxyBase = mount.getAttribute("data-proxy") || "/apps/lens-advisor";

    const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });

    render(
      h(ConfiguratorApp, {
        product,
        proxyBase,
        isOpen: true,
        triggerElement: this.triggerButton,
        onClose: () => {
          this.close();
        },
      }),
      shadow,
    );
  }

  close(): void {
    this.isOpenState = false;

    if (this.shadowRoot) {
      render(null, this.shadowRoot);
    }

    if (typeof document !== "undefined" && this.prevBodyOverflow !== null) {
      document.body.style.overflow = this.prevBodyOverflow;
      this.prevBodyOverflow = null;
    }

    if (this.mountPoint) {
      this.mountPoint.removeAttribute("data-la-state");
      this.mountPoint = null;
    }

    if (this.triggerButton && typeof this.triggerButton.focus === "function") {
      this.triggerButton.focus();
      this.triggerButton = null;
    }
  }

  get isOpen(): boolean {
    return this.isOpenState;
  }
}

export function ensureConfigurator(doc: Document = document): LensConfiguratorElement {
  let element = doc.querySelector<LensConfiguratorElement>(LENS_CONFIGURATOR_TAG);
  if (!element) {
    element = doc.createElement(LENS_CONFIGURATOR_TAG) as LensConfiguratorElement;
    (doc.body ?? doc.documentElement).appendChild(element);
  }
  return element;
}

if (typeof customElements !== "undefined" && !customElements.get(LENS_CONFIGURATOR_TAG)) {
  customElements.define(LENS_CONFIGURATOR_TAG, LensConfiguratorElement);
}

if (typeof document !== "undefined") {
  document.addEventListener("la:open", (event: Event) => {
    const customEvent = event as CustomEvent<{ mount: HTMLElement }>;
    const mount = customEvent.detail?.mount;
    if (mount) {
      const configurator = ensureConfigurator(mount.ownerDocument);
      configurator.open(mount);
    }
  });

  const activeMount = document.querySelector<HTMLElement>(
    '[data-la-mount][data-la-state="open"]',
  );
  if (activeMount) {
    const configurator = ensureConfigurator(activeMount.ownerDocument);
    configurator.open(activeMount);
  }
}
