import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type AnyJobDefinition, registerJobExports } from "./define-job";

/** Features live in `app/features/<feature>/jobs.server.ts` (ARCHITECTURE.md). */
export function defaultFeaturesDir(): string {
  return resolve(process.cwd(), "app/features");
}

/**
 * Worker-side job discovery contract: every immediate child directory of the
 * features folder may export job definitions from `jobs.server.ts`. A missing
 * features folder is an empty worker, not an error.
 */
export async function discoverJobs(
  featuresDir: string = defaultFeaturesDir()
): Promise<AnyJobDefinition[]> {
  const entries = await readdir(featuresDir, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingDirectory(error)) return [];
    throw error;
  });

  const modules: unknown[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const jobsFile = join(featuresDir, entry.name, "jobs.server.ts");
    if (!(await fileExists(jobsFile))) continue;

    modules.push(await import(pathToFileURL(jobsFile).href));
  }

  return registerJobExports(modules);
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function isMissingDirectory(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
