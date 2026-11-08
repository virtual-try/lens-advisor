export interface TrapOptions {
  container: HTMLElement;
  trigger?: HTMLElement | null;
  onEscape?: () => void;
}

export interface FocusTrapController {
  activate: () => void;
  deactivate: () => void;
  isActive: () => boolean;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createFocusTrap(options: TrapOptions): FocusTrapController {
  const { container, trigger, onEscape } = options;
  let active = false;
  let prevOverflow = "";

  function getFocusableElements(): HTMLElement[] {
    const root = container.shadowRoot || container;
    const elements = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    return elements.filter((el) => {
      return (
        el.getAttribute("aria-hidden") !== "true" &&
        el.style.display !== "none" &&
        el.style.visibility !== "hidden"
      );
    });
  }

  function deactivate(): void {
    if (!active) return;
    active = false;

    if (typeof document !== "undefined") {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    }

    if (trigger && typeof trigger.focus === "function") {
      trigger.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!active) return;

    if (event.key === "Escape") {
      event.preventDefault();
      deactivate();
      onEscape?.();
      return;
    }

    if (event.key === "Tab") {
      const focusables = getFocusableElements();
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = (container.shadowRoot?.activeElement || document.activeElement) as HTMLElement | null;

      if (event.shiftKey) {
        if (!activeEl || activeEl === first || !container.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (!activeEl || activeEl === last || !container.contains(activeEl)) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }

  function activate(): void {
    if (active) return;
    active = true;

    if (typeof document !== "undefined") {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleKeyDown);
    }

    // Initial focus on first element
    const focusables = getFocusableElements();
    if (focusables.length > 0) {
      focusables[0].focus();
    }
  }

  return {
    isActive() {
      return active;
    },
    activate,
    deactivate,
  };
}
