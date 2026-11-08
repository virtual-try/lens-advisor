import { runWorker } from "./shared/queue/worker";

runWorker(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    `[worker] failed to start: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
