import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("calls onEscape when Escape key is pressed", () => {
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

    trap.deactivate();
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
});
