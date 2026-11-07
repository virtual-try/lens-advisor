import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./repo-root";

const packageRoot = resolve(repoRoot(), "packages/configurator");
const buildScript = resolve(packageRoot, "scripts/build.mjs");

const typescriptExtension = /\.(?:[cm]ts|tsx?)$/;

function staticImportSpecifiers(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const specs: string[] = [];
  for (const match of stripped.matchAll(
    /(?:^|\n)\s*import\s+(?:[^'"()\n][\s\S]*?)?\sfrom\s*["']([^"']+)["']/g,
  )) {
    const spec = match[1];
    if (spec) specs.push(spec);
  }
  for (const match of stripped.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
    const spec = match[1];
    if (spec) specs.push(spec);
  }
  return specs;
}

/** Local static imports, followed through `.js` / `.mjs` modules. */
function typescriptImports(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const spec of staticImportSpecifiers(source)) {
    if (!spec.startsWith(".")) continue;
    if (typescriptExtension.test(spec)) {
      found.push(`${file} imports ${spec}`);
      continue;
    }
    const resolved = resolve(dirname(file), spec);
    if (!existsSync(resolved)) {
      found.push(`${file} imports missing ${spec}`);
      continue;
    }
    found.push(...typescriptImports(resolved, seen));
  }
  return found;
}

describe("configurator build script", () => {
  it("loads its config on Node 22.12, which does not strip TypeScript", () => {
    const relative = staticImportSpecifiers(readFileSync(buildScript, "utf8")).filter((spec) =>
      spec.startsWith("."),
    );
    expect(typescriptImports(buildScript)).toEqual([]);
    expect(relative.length).toBeGreaterThan(0);

    const urls = relative.map((spec) => new URL(spec, pathToFileURL(buildScript)).href);
    const code = `
const urls = ${JSON.stringify(urls)};
let found = false;
for (const url of urls) {
  const mod = await import(url);
  if (typeof mod.entryConfigs !== "function") continue;
  found = true;
  const configs = mod.entryConfigs();
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error("entryConfigs() returned no configs");
  }
  if (typeof mod.assetsOutDir !== "string" || mod.assetsOutDir.length === 0) {
    throw new Error("assetsOutDir missing");
  }
}
if (!found) throw new Error("build script does not import entryConfigs");
`;
    const result = spawnSync(
      process.execPath,
      ["--no-experimental-strip-types", "--input-type=module", "--eval", code],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
