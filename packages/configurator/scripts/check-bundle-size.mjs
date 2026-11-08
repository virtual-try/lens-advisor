import { readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const assetsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../extensions/lens-configurator/assets",
);

/** 10 KB, binary. Spec 04 measures minified bytes, not gzip. */
const LOADER_LIMIT_BYTES = 10 * 1024;
const EXPECTED = ["configurator.js", "loader.css", "loader.js"];

const entries = readdirSync(assetsDir, { withFileTypes: true });
if (entries.some((entry) => entry.isDirectory())) {
  console.error("assets/ must be flat — theme extension assets cannot use subfolders");
  process.exit(1);
}

const names = entries.map((entry) => entry.name).sort();
const missing = EXPECTED.filter((name) => !names.includes(name));
const unexpected = names.filter((name) => !EXPECTED.includes(name));
if (missing.length > 0 || unexpected.length > 0) {
  console.error(
    `expected assets ${EXPECTED.join(", ")}; found ${names.join(", ") || "(none)"}`,
  );
  process.exit(1);
}

let failed = false;
for (const name of names) {
  const bytes = statSync(resolve(assetsDir, name)).size;
  const kib = (bytes / 1024).toFixed(2);
  if (name === "loader.js") {
    const over = bytes > LOADER_LIMIT_BYTES;
    console.log(
      `loader.js ${bytes} B (${kib} KB), limit ${LOADER_LIMIT_BYTES} B${over ? " OVER LIMIT" : ""}`,
    );
    if (over) failed = true;
    continue;
  }
  console.log(`${name} ${bytes} B (${kib} KB)`);
}

if (failed) process.exit(1);
