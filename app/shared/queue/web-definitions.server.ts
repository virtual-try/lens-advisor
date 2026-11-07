import { type AnyJobDefinition, registerJobExports } from "./define-job";

/**
 * Web-process half of the jobs discovery contract. Vite bundles this eager glob
 * so a route can enqueue by job name without a filesystem read at request time.
 * The worker uses the filesystem glob in `discovery.server.ts` instead because
 * it runs through tsx.
 */
export function registerWebFeatureJobs(): AnyJobDefinition[] {
  const modules = import.meta.glob<Record<string, unknown>>(
    "../../features/*/jobs.server.ts",
    { eager: true }
  );
  return registerJobExports(Object.values(modules));
}
