import { mkdirSync, rmSync } from "node:fs";
import { build } from "vite";
import { assetsOutDir, entryConfigs } from "../vite.config.ts";

const configs = entryConfigs();
if (configs.length === 0) {
  throw new Error("No configurator entries in src/entries.");
}

rmSync(assetsOutDir, { recursive: true, force: true });
mkdirSync(assetsOutDir, { recursive: true });

for (const config of configs) {
  await build(config);
}

await import("./check-bundle-size.mjs");
