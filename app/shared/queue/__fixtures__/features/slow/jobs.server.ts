import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { defineJob } from "../../../define-job";

/**
 * Discovery and graceful-shutdown fixture. `markerId` is a temp file path in the
 * test; the job marks itself started, stays in flight, then marks itself done so
 * the test can prove SIGTERM lets the handler finish.
 */
export const slowJob = defineJob({
  name: "fixture.slow",
  schema: z.object({ markerId: z.string() }),
  retry: { retryLimit: 1, retryDelay: 0 },
  handler: async ({ markerId }) => {
    await writeFile(markerId, "started");
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    await writeFile(markerId, "done");
  },
});
