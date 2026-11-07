import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  document.head.querySelectorAll("script[data-la-configurator]").forEach((node) => {
    node.remove();
  });
});
