import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function repoRoot(start = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("pnpm-workspace.yaml not found from " + start);
    }
    dir = parent;
  }
}
