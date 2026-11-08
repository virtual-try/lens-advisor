import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./repo-root";

const srcRoot = join(repoRoot(), "packages/configurator/src");
const rawValue = /#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    found.push(path);
  }
  return found;
}

describe("INV-7", () => {
  it("keeps raw colour, size, and duration values inside tokens.css", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(srcRoot)) {
      if (path.endsWith(`${join("styles", "tokens.css")}`)) continue;
      const lines = readFileSync(path, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (rawValue.test(line)) offenders.push(`${path}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
