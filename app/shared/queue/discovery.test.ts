import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverJobs } from "./discovery.server";

const FIXTURE_FEATURES_DIR = resolve(
  process.cwd(),
  "app/shared/queue/__fixtures__/features"
);

describe("worker job discovery contract", () => {
  it("loads the fixture jobs.server.ts from a test features folder", async () => {
    const definitions = await discoverJobs(FIXTURE_FEATURES_DIR);

    expect(definitions.map((definition) => definition.name)).toEqual(["fixture.slow"]);
    const fixture = definitions[0];
    expect(fixture.schema.safeParse({ markerId: "/tmp/marker" }).success).toBe(true);
    expect(fixture.schema.safeParse({ markerId: 42 }).success).toBe(false);
    expect(typeof fixture.handler).toBe("function");
  });

  it("treats a missing features folder as an empty worker", async () => {
    const definitions = await discoverJobs(
      resolve(process.cwd(), "app/shared/queue/__fixtures__/missing")
    );
    expect(definitions).toEqual([]);
  });
});
