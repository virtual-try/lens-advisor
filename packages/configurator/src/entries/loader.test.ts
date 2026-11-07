import { fireEvent } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIGURATOR_SCRIPT_SELECTOR,
  OPEN_EVENT,
  bindAll,
  bootWhenReady,
} from "./loader";

const SRC = "https://cdn.example.test/configurator.js";

function addMount(doc: Document, src: string | null): HTMLElement {
  const mount = doc.createElement("div");
  mount.setAttribute("data-la-mount", "");
  if (src !== null) mount.setAttribute("data-configurator-src", src);
  const button = doc.createElement("button");
  button.type = "button";
  button.setAttribute("data-la-open", "");
  button.textContent = "Trigger";
  mount.appendChild(button);
  doc.body.appendChild(mount);
  return mount;
}

function buttonOf(mount: HTMLElement): HTMLButtonElement {
  const button = mount.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("missing button");
  return button;
}

function scripts(doc: Document): NodeListOf<HTMLScriptElement> {
  return doc.querySelectorAll<HTMLScriptElement>(CONFIGURATOR_SCRIPT_SELECTOR);
}

describe("loader", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.head.querySelectorAll(CONFIGURATOR_SCRIPT_SELECTOR).forEach((node) => {
      node.remove();
    });
  });

  it("injects configurator.js once when the same button is clicked twice", () => {
    const mount = addMount(document, SRC);
    bindAll(document);
    const button = buttonOf(mount);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(scripts(document)).toHaveLength(1);
    expect(scripts(document)[0]?.src).toBe(SRC);
    expect(scripts(document)[0]?.async).toBe(true);
    expect(mount.getAttribute("data-la-state")).toBe("open");
  });

  it("opens both mount points and still injects one script", () => {
    const first = addMount(document, SRC);
    const second = addMount(document, SRC);
    bindAll(document);
    fireEvent.click(buttonOf(first));
    fireEvent.click(buttonOf(second));
    expect(scripts(document)).toHaveLength(1);
    expect(first.getAttribute("data-la-state")).toBe("open");
    expect(second.getAttribute("data-la-state")).toBe("open");
  });

  it("dispatches la:open once per click when bound twice", () => {
    const mount = addMount(document, SRC);
    let openings = 0;
    mount.addEventListener(OPEN_EVENT, () => {
      openings += 1;
    });
    bindAll(document);
    bindAll(document);
    fireEvent.click(buttonOf(mount));
    expect(openings).toBe(1);
    expect(scripts(document)).toHaveLength(1);
  });

  it("replays la:open for every open mount when configurator.js loads", () => {
    const first = addMount(document, SRC);
    const second = addMount(document, SRC);
    bindAll(document);
    fireEvent.click(buttonOf(first));
    fireEvent.click(buttonOf(second));
    let replays = 0;
    document.addEventListener(OPEN_EVENT, () => {
      replays += 1;
    });
    scripts(document)[0]?.dispatchEvent(new Event("load"));
    expect(replays).toBe(2);
    expect(scripts(document)[0]?.dataset.laLoaded).toBe("true");
    scripts(document)[0]?.dispatchEvent(new Event("load"));
    expect(replays).toBe(2);
  });

  it("opens a mount that has no configurator src without injecting a script", () => {
    const mount = addMount(document, null);
    bindAll(document);
    fireEvent.click(buttonOf(mount));
    expect(mount.getAttribute("data-la-state")).toBe("open");
    expect(scripts(document)).toHaveLength(0);
  });

  it("binds every mount that is already in the document when the script runs late", () => {
    addMount(document, SRC);
    addMount(document, SRC);
    bootWhenReady(document);
    expect(document.querySelectorAll("[data-la-bound='true']")).toHaveLength(2);
  });
});
