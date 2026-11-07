import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../test/repo-root";

const root = repoRoot();
const designSystem = readFileSync(join(root, "specs/DESIGN-SYSTEM.md"), "utf8");
const tokensCss = readFileSync(join(root, "packages/configurator/src/styles/tokens.css"), "utf8");

function tokenNamesFromTables(markdown: string): Set<string> {
  const names = new Set<string>();
  let inTokenTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\|\s*Token\s*\|/.test(line)) {
      inTokenTable = true;
      continue;
    }
    if (!inTokenTable) continue;
    if (!line.startsWith("|")) {
      inTokenTable = false;
      continue;
    }
    const cell = line.split("|")[1] ?? "";
    for (const name of cell.match(/--la-[a-z0-9-]+/g) ?? []) names.add(name);
    // Table cells wrap names in backticks: `--la-space-1` … `--la-space-7`.
    const range = cell.match(
      /--la-([a-z0-9-]*?)(\d+)`?\s*(?:\u2026|\.{3})\s*`?--la-\1(\d+)/,
    );
    if (!range) continue;
    const prefix = range[1] ?? "";
    const start = Number(range[2]);
    const end = Number(range[3]);
    const step = start <= end ? 1 : -1;
    for (let value = start; value !== end + step; value += step) {
      names.add(`--la-${prefix}${value}`);
    }
  }
  return names;
}

function definedTokens(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/(^|[{};])\s*(--la-[a-z0-9-]+)\s*:/g)) {
    const name = match[2];
    if (name) names.add(name);
  }
  return names;
}

describe("tokens.css", () => {
  const expected = tokenNamesFromTables(designSystem);
  const defined = definedTokens(tokensCss);

  it("parses every DESIGN-SYSTEM token table, including ellipsis ranges", () => {
    expect(expected.has("--la-bg")).toBe(true);
    expect(expected.has("--la-space-1")).toBe(true);
    expect(expected.has("--la-space-4")).toBe(true);
    expect(expected.has("--la-space-7")).toBe(true);
    expect(expected.has("--la-press-scale")).toBe(true);
    expect(expected.size).toBeGreaterThan(40);
  });

  it("defines each parsed token and no extra token", () => {
    expect([...defined].sort()).toEqual([...expected].sort());
  });

  it("reads merchant overrides through the --la-merchant-* fallback chain", () => {
    expect(tokensCss).toMatch(/--la-accent:\s*var\(\s*--la-merchant-accent\s*,/);
    expect(tokensCss).toMatch(/--la-font-family:\s*var\(\s*--la-merchant-font-family\s*,/);
    expect(tokensCss).toMatch(/--la-radius:\s*var\(\s*--la-merchant-radius\s*,/);
    const merchants = new Set(tokensCss.match(/--la-merchant-[a-z0-9-]+/g) ?? []);
    expect([...merchants].sort()).toEqual([
      "--la-merchant-accent",
      "--la-merchant-font-family",
      "--la-merchant-radius",
    ]);
  });
});
