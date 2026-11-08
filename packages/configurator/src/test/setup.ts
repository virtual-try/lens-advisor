import { cleanup } from "@testing-library/preact";
import { afterAll, afterEach } from "vitest";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.head.querySelectorAll("script[data-la-configurator]").forEach((node) => {
    node.remove();
  });
});

// Preact's hooks schedule effects with requestAnimationFrame plus a 100 ms
// setTimeout fallback (preact/hooks afterPaint). If that timer fires after
// vitest tears down jsdom, it calls the removed cancelAnimationFrame and the
// run reports an unhandled ReferenceError. Let pending timers drain first.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
});
