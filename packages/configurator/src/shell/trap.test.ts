import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "preact";
import { renderInShadow } from "../test/render-in-shadow";
import { createFocusTrap } from "./trap";

describe("createFocusTrap", () => {
  let container: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let btn1: HTMLButtonElement;
  let btn2: HTMLButtonElement;

  beforeEach(() => {
    trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    container = document.createElement("div");
    btn1 = document.createElement("button");
    btn1.textContent = "First";
    btn2 = document.createElement("button");
    btn2.textContent = "Second";
    container.appendChild(btn1);
    container.appendChild(btn2);
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  it("locks scroll and focuses first element on activate", () => {
    const trap = createFocusTrap({ container, trigger });
    trap.activate();

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(btn1);

    trap.deactivate();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab navigation within container", () => {
    const trap = createFocusTrap({ container, trigger });
    trap.activate();

    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    // Tab from last element wraps to first
    const tabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabEvent);
    expect(document.activeElement).toBe(btn1);

    // Shift+Tab from first element wraps to last
    const shiftTabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabEvent);
    expect(document.activeElement).toBe(btn2);

    trap.deactivate();
  });

  it("calls onEscape when Escape key is pressed and keeps trap active until deactivated (R2-F4)", () => {
    const onEscape = vi.fn();
    const trap = createFocusTrap({ container, trigger, onEscape });
    trap.activate();

    const escEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escEvent);
    expect(onEscape).toHaveBeenCalledOnce();
    // Trap remains active so exiting animation can complete with trap engaged
    expect(trap.isActive()).toBe(true);
    expect(document.activeElement).not.toBe(trigger);

    trap.deactivate();
    expect(trap.isActive()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("deactivates immediately and returns focus on Escape when onEscape is not provided", () => {
    const trap = createFocusTrap({ container, trigger });
    trap.activate();

    const escEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(escEvent);
    expect(trap.isActive()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("releases scroll lock and focus when deactivated on disconnect", () => {
    const trap = createFocusTrap({ container, trigger });
    trap.activate();
    expect(document.body.style.overflow).toBe("hidden");

    // Simulating disconnect: element removed from DOM while open
    container.remove();
    trap.deactivate();

    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("cycles Tab and Shift+Tab correctly inside Shadow DOM via renderInShadow", () => {
    let shadowContainer!: HTMLDivElement;
    let sBtn1!: HTMLButtonElement;
    let sBtn2!: HTMLButtonElement;

    const TestComp = () =>
      h(
        "div",
        {
          ref: (el: HTMLDivElement | null) => {
            if (el) shadowContainer = el;
          },
        },
        h(
          "button",
          {
            ref: (el: HTMLButtonElement | null) => {
              if (el) sBtn1 = el;
            },
            type: "button",
          },
          "First",
        ),
        h(
          "button",
          {
            ref: (el: HTMLButtonElement | null) => {
              if (el) sBtn2 = el;
            },
            type: "button",
          },
          "Second",
        ),
      );

    const view = renderInShadow(h(TestComp, null));
    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);

    const trap = createFocusTrap({
      container: shadowContainer,
      trigger: triggerBtn,
    });
    trap.activate();

    // Initial focus on first element in shadow root
    expect(view.shadowRoot.activeElement).toBe(sBtn1);
    expect(document.activeElement).toBe(view.host);

    // Tab from first element: default Tab is not prevented, allowing normal navigation to second
    const tabEvent1 = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabEvent1);
    expect(tabEvent1.defaultPrevented).toBe(false);

    // Move focus to last element
    sBtn2.focus();
    expect(view.shadowRoot.activeElement).toBe(sBtn2);

    // Tab from last element wraps to first element
    const tabEvent2 = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabEvent2);
    expect(tabEvent2.defaultPrevented).toBe(true);
    expect(view.shadowRoot.activeElement).toBe(sBtn1);

    // Shift+Tab from first element wraps to last element
    const shiftTabEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTabEvent);
    expect(shiftTabEvent.defaultPrevented).toBe(true);
    expect(view.shadowRoot.activeElement).toBe(sBtn2);

    trap.deactivate();
    view.unmount();
    triggerBtn.remove();
  });
});
