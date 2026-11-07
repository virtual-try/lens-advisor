import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("rx-core harness", () => {
  it("verifies zod schema validation in rx-core package", () => {
    const harnessSchema = z.object({
      active: z.boolean(),
      version: z.string(),
    });

    const parsed = harnessSchema.parse({
      active: true,
      version: "0.1.0",
    });

    expect(parsed.active).toBe(true);
    expect(parsed.version).toBe("0.1.0");
  });
});
