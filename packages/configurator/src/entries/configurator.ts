import { h, render } from "preact";
import { ConfiguratorApp } from "../shell/ConfiguratorApp";
import { parseProductData } from "../shared/types";

export const LENS_CONFIGURATOR_TAG = "lens-configurator";

export class LensConfiguratorElement extends HTMLElement {
  private mountPoint: HTMLElement | null = null;
  private triggerButton: HTMLElement | null = null;
  private isOpenState = false;
  private prevBodyOverflow: string | null = null;
  private copiedMerchantProps: string[] = [];

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

  private copyMerchantProperties(mount: HTMLElement): void {
    this.clearMerchantProperties();

    const win =
      mount.ownerDocument?.defaultView ??
      (typeof window !== "undefined" ? window : null);
    const computed = win ? win.getComputedStyle(mount) : null;
    const merchantProps = new Set<string>();

    if (computed) {
      for (let i = 0; i < computed.length; i++) {
        const prop = computed[i];
        if (prop.startsWith("--la-merchant-")) {
          merchantProps.add(prop);
        }
      }
    }

    for (let i = 0; i < mount.style.length; i++) {
      const prop = mount.style[i];
      if (prop.startsWith("--la-merchant-")) {
        merchantProps.add(prop);
      }
    }

    const rawStyle = mount.getAttribute("style");
    if (rawStyle) {
      const matches = rawStyle.match(/--la-merchant-[a-z0-9_-]+/g);
      if (matches) {
        for (const m of matches) {
          merchantProps.add(m);
        }
      }
    }

    const KNOWN_MERCHANT_PROPS = [
      "--la-merchant-accent",
      "--la-merchant-font-family",
      "--la-merchant-radius",
    ];
    for (const prop of KNOWN_MERCHANT_PROPS) {
      merchantProps.add(prop);
    }

    for (const prop of merchantProps) {
      const val =
        computed?.getPropertyValue(prop)?.trim() ||
        mount.style.getPropertyValue(prop)?.trim();
      if (val) {
        this.style.setProperty(prop, val);
        this.copiedMerchantProps.push(prop);
      }
    }
  }

  private clearMerchantProperties(): void {
    for (const prop of this.copiedMerchantProps) {
      this.style.removeProperty(prop);
    }
    this.copiedMerchantProps = [];

    for (let i = this.style.length - 1; i >= 0; i--) {
      const prop = this.style[i];
      if (prop.startsWith("--la-merchant-")) {
        this.style.removeProperty(prop);
      }
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

    this.copyMerchantProperties(mount);

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
        mountElement: mount,
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

    this.clearMerchantProperties();

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
