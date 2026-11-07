import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));

/** Flat theme-extension assets. Liquid references these names, so they stay unhashed. */
export const assetsOutDir = resolve(packageRoot, "../../extensions/lens-configurator/assets");

const entriesDir = resolve(packageRoot, "src/entries");

export function listEntryNames() {
  return readdirSync(entriesDir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts"))
    .map((file) => file.slice(0, -".ts".length))
    .sort();
}

function globalName(entryName) {
  const camel = entryName.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
  return `LensAdvisor${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

/**
 * One IIFE build per `src/entries/*.ts`. Vite 7's CLI accepts a single config,
 * so `scripts/build.mjs` runs these sequentially. IIFE (not ES modules) because
 * the theme block's schema `javascript` key injects a classic script tag.
 */
export function entryConfigs() {
  return listEntryNames().map((name) => ({
    configFile: false,
    root: packageRoot,
    publicDir: false,
    build: {
      outDir: assetsOutDir,
      emptyOutDir: false,
      copyPublicDir: false,
      sourcemap: false,
      minify: "esbuild",
      cssCodeSplit: false,
      assetsInlineLimit: 0,
      lib: {
        entry: resolve(entriesDir, `${name}.ts`),
        name: globalName(name),
        formats: ["iife"],
        fileName: () => `${name}.js`,
        cssFileName: name,
      },
      rollupOptions: {
        output: {
          entryFileNames: `${name}.js`,
          assetFileNames: `${name}.[ext]`,
        },
      },
    },
  }));
}
