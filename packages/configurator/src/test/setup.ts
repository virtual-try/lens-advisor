import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

if (typeof globalThis.cancelAnimationFrame === "undefined") {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.head.querySelectorAll("script[data-la-configurator]").forEach((node) => {
    node.remove();
  });
});
