import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverJobs } from "./discovery.server";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mockedAccess = vi.fn((...args: Parameters<typeof actual.access>) => actual.access(...args));
  return {
    ...actual,
    default: { ...actual, access: mockedAccess },
    access: mockedAccess,
  };
});

const FIXTURE_FEATURES_DIR = resolve(
  process.cwd(),
  "app/shared/queue/__fixtures__/features"
);

describe("worker job discovery contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("rethrows filesystem errors other than ENOENT when checking jobs.server.ts (R5-F4)", async () => {
    const eaccesError = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    vi.mocked(fsPromises.access).mockRejectedValueOnce(eaccesError);

    await expect(discoverJobs(FIXTURE_FEATURES_DIR)).rejects.toThrow("EACCES: permission denied");
  });
});
