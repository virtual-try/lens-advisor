import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPgBoss } from "./shared/container/queue.server";
import { discoverJobs } from "./shared/queue/discovery.server";
import { createQueue } from "./shared/queue/queue";
import { requireTestDatabaseUrl, uniqueSchema, waitFor } from "./shared/queue/test-support";

const PROJECT_ROOT = process.cwd();
const WORKER_ENTRY = resolve(PROJECT_ROOT, "app/worker.server.ts");
const TSX_BIN = resolve(PROJECT_ROOT, "node_modules/.bin/tsx");
const FIXTURE_FEATURES_DIR = resolve(PROJECT_ROOT, "app/shared/queue/__fixtures__/features");

let running: ChildProcess | undefined;

afterEach(() => {
  if (running && running.exitCode === null) {
    running.kill("SIGKILL");
  }
  running = undefined;
});

describe("worker process", () => {
  it(
    "finishes an in-flight job and exits 0 on SIGTERM",
    async () => {
      const schema = uniqueSchema();
      const databaseUrl = requireTestDatabaseUrl();
      await mkdir("/tmp/opencode", { recursive: true });
      const markerDir = await mkdtemp(join("/tmp/opencode", "lens-advisor-worker-"));
      const markerPath = join(markerDir, "marker.txt");

      const child = spawn(
        TSX_BIN,
        [
          WORKER_ENTRY,
          "--features-dir",
          FIXTURE_FEATURES_DIR,
          "--schema",
          schema,
          "--database-url",
          databaseUrl,
          "--polling-interval",
          "0.5",
        ],
        { cwd: PROJECT_ROOT, stdio: ["ignore", "pipe", "pipe"] }
      );
      running = child;

      let output = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });

      try {
        await waitFor(
          async () => Promise.resolve(output.includes("[worker] ready") ? true : undefined),
          (ready) => ready,
          20000
        );

        const boss = createPgBoss({
          connectionString: databaseUrl,
          schema,
          onError: () => undefined,
        });
        const queue = await createQueue(boss, {
          schema,
          pollingIntervalSeconds: 0.5,
        });

        try {
          const definitions = await discoverJobs(FIXTURE_FEATURES_DIR);
          await queue.registerAll(definitions);
          await queue.enqueue(
            "fixture.slow",
            { markerId: markerPath },
            { singletonKey: "shutdown-marker" }
          );

          await waitFor(
            async () => readFile(markerPath, "utf8").catch(() => undefined),
            (content) => content === "started",
            15000
          );

          child.kill("SIGTERM");
          const exitCode = await waitForExit(child, 20000);

          expect(exitCode).toBe(0);
          expect(await readFile(markerPath, "utf8")).toBe("done");
        } finally {
          await queue.destroy({ dropSchema: true });
        }
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nworker output:\n${output}`
        );
      } finally {
        await rm(markerDir, { recursive: true, force: true });
      }
    },
    45000
  );
});

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);

  return new Promise<number | null>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`worker did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}
