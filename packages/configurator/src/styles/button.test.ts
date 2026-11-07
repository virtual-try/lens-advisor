import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../test/repo-root";

const root = repoRoot();
const buttonCss = readFileSync(
  join(root, "packages/configurator/src/styles/button.css"),
  "utf8",
);
const tokensCss = readFileSync(
  join(root, "packages/configurator/src/styles/tokens.css"),
  "utf8",
);

describe("select lenses button", () => {
  it("uses the touch-target token, a visible focus outline, and a reduced-motion fallback", () => {
    expect(buttonCss).toContain("min-height: var(--la-target)");
    expect(buttonCss).toContain("min-width: var(--la-target)");
    expect(buttonCss).toContain(":focus-visible");
    expect(buttonCss).toContain("outline: var(--la-focus-outline)");
    expect(buttonCss).toContain("outline-offset: var(--la-focus-offset)");
    expect(buttonCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("sizes the touch target from --la-target, which is at least 44", () => {
    const declared = tokensCss.match(/--la-target:\s*([^;]+)/)?.[1]?.trim() ?? "";
    const pixels = Number.parseFloat(declared);
    expect(buttonCss).toContain("min-height: var(--la-target)");
    expect(buttonCss).toContain("min-width: var(--la-target)");
    expect(Number.isFinite(pixels)).toBe(true);
    expect(pixels).toBeGreaterThanOrEqual(44);
  });
});
