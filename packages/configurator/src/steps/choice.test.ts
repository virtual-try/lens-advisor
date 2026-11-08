import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../test/repo-root";

const root = repoRoot();
const choiceCss = readFileSync(
  join(root, "packages/configurator/src/steps/choice.css"),
  "utf8",
);
const optionsCss = readFileSync(
  join(root, "packages/configurator/src/steps/05-options/options.css"),
  "utf8",
);
const addOnsCss = readFileSync(
  join(root, "packages/configurator/src/steps/06-add-ons/add-ons.css"),
  "utf8",
);

describe("choice cards and step layout (shared stylesheet)", () => {
  it("defines shared rules for step head, choices list, choice cards, and mark (R1-F8)", () => {
    expect(choiceCss).toContain(".la-step-head");
    expect(choiceCss).toContain(".la-choices");
    expect(choiceCss).toContain(".la-choice");
    expect(choiceCss).toContain(".la-mark");
    expect(choiceCss).toContain("min-height: var(--la-target)");

    // Both step 5 and step 6 stylesheets import choice.css
    expect(optionsCss).toMatch(/@import\s+["']\.\.\/choice\.css["']/);
    expect(addOnsCss).toMatch(/@import\s+["']\.\.\/choice\.css["']/);
  });

  it("provides a reduced-motion fallback for choice-card transitions (R1-F4)", () => {
    // Assert prefers-reduced-motion block exists and disables transitions on .la-choice
    expect(choiceCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(choiceCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.la-choice\s*\{\s*transition:\s*none;\s*\}\s*\}/,
    );
  });
});
