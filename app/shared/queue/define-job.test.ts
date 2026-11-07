import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JobDefinitionError, defineJob } from "./define-job";

describe("defineJob payload guard (INV-2)", () => {
  it("rejects a plain string field such as rxText at registration", () => {
    expect(() =>
      defineJob({
        name: "test.rx-text",
        schema: z.object({ orderId: z.string(), rxText: z.string() }),
        handler: () => undefined,
      })
    ).toThrowError(/rxText.*does not end in Id\/Ids\/Key\/Keys/);
  });

  it("rejects a string field nested inside an object", () => {
    expect(() =>
      defineJob({
        name: "test.nested-rx",
        schema: z.object({ orderId: z.string(), rx: z.object({ notes: z.string() }) }),
        handler: () => undefined,
      })
    ).toThrowError(/rx\.notes/);
  });

  it("rejects a non-object payload schema", () => {
    expect(() =>
      defineJob({
        name: "test.scalar",
        schema: z.string(),
        handler: () => undefined,
      })
    ).toThrowError(/must be a zod object/);
  });

  it("accepts ids, id arrays, enums, numbers and booleans", () => {
    const definition = defineJob({
      name: "test.valid-payload",
      schema: z.object({
        orderId: z.string(),
        optionValueIds: z.array(z.string()),
        bundleKey: z.string(),
        mode: z.enum(["send", "skip"]),
        attempt: z.number().int(),
        urgent: z.boolean(),
      }),
      handler: () => undefined,
    });

    expect(definition.name).toBe("test.valid-payload");
    expect(definition.retry).toEqual({ retryLimit: 2, retryDelay: 0, retryBackoff: false });
  });

  it("allows an explicitly whitelisted string field", () => {
    expect(() =>
      defineJob({
        name: "test.whitelisted",
        schema: z.object({ orderId: z.string(), note: z.string() }),
        allowStringFields: ["note"],
        handler: () => undefined,
      })
    ).not.toThrow();
  });

  it("rejects a duplicate job name", () => {
    const schema = z.object({ orderId: z.string() });
    defineJob({ name: "test.duplicate", schema, handler: () => undefined });

    expect(() =>
      defineJob({ name: "test.duplicate", schema, handler: () => undefined })
    ).toThrowError(JobDefinitionError);
  });
});
