import "../styles/block.css";

export const MOUNT_SELECTOR = "[data-la-mount]";
export const OPEN_SELECTOR = "[data-la-open]";
export const CONFIGURATOR_SCRIPT_SELECTOR = "script[data-la-configurator]";
export const OPEN_EVENT = "la:open";

export interface OpenDetail {
  mount: HTMLElement;
}

export function dispatchOpen(mount: HTMLElement): void {
  mount.setAttribute("data-la-state", "open");
  mount.dispatchEvent(
    new CustomEvent<OpenDetail>(OPEN_EVENT, {
      bubbles: true,
      detail: { mount },
    }),
  );
}

export function injectConfigurator(src: string, doc: Document): HTMLScriptElement {
  const existing = doc.querySelector<HTMLScriptElement>(CONFIGURATOR_SCRIPT_SELECTOR);
  if (existing) return existing;

  const script = doc.createElement("script");
  script.src = src;
  script.async = true;
  script.setAttribute("data-la-configurator", "");
  script.addEventListener(
    "load",
    () => {
      script.dataset.laLoaded = "true";
      doc.querySelectorAll<HTMLElement>(`${MOUNT_SELECTOR}[data-la-state="open"]`).forEach((mount) => {
        dispatchOpen(mount);
      });
    },
    { once: true },
  );
  (doc.head ?? doc.documentElement).appendChild(script);
  return script;
}

export function bindMount(mount: HTMLElement): void {
  const button = mount.querySelector(OPEN_SELECTOR);
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.getAttribute("data-la-bound") === "true") return;
  button.setAttribute("data-la-bound", "true");
  button.addEventListener("click", () => {
    const src = mount.getAttribute("data-configurator-src");
    if (src) injectConfigurator(src, mount.ownerDocument);
    dispatchOpen(mount);
  });
}

export function bindAll(doc: Document): void {
  doc.querySelectorAll<HTMLElement>(MOUNT_SELECTOR).forEach((mount) => {
    bindMount(mount);
  });
}

export function bootWhenReady(doc: Document): void {
  if (doc.readyState === "loading") {
    doc.addEventListener(
      "DOMContentLoaded",
      () => {
        bindAll(doc);
      },
      { once: true },
    );
    return;
  }
  bindAll(doc);
}

if (typeof document !== "undefined") {
  bootWhenReady(document);
}
