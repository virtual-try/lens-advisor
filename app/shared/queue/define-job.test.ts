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
        attemptId: z.number().int(),
        versionKey: z.bigint(),
        urgent: z.boolean(),
      }),
      handler: () => undefined,
    });

    expect(definition.name).toBe("test.valid-payload");
    expect(definition.retry).toEqual({ retryLimit: 2, retryDelay: 0, retryBackoff: false });
  });

  it("rejects a numeric Rx field such as sph at registration (R1-F1)", () => {
    expect(() =>
      defineJob({
        name: "test.sph-number",
        schema: z.object({ orderId: z.string(), sph: z.number() }),
        handler: () => undefined,
      })
    ).toThrowError(/sph.*is a number but does not end in Id\/Ids\/Key\/Keys/);
  });

  it("rejects a bigint non-id field such as sph at registration (R1-F1)", () => {
    expect(() =>
      defineJob({
        name: "test.sph-bigint",
        schema: z.object({ orderId: z.string(), sph: z.bigint() }),
        handler: () => undefined,
      })
    ).toThrowError(/sph.*is a bigint but does not end in Id\/Ids\/Key\/Keys/);
  });

  it("allows a numeric or bigint field if whitelisted in allowStringFields (R1-F1)", () => {
    expect(() =>
      defineJob({
        name: "test.numeric-whitelisted",
        schema: z.object({ orderId: z.string(), attempt: z.number(), count: z.bigint() }),
        allowStringFields: ["attempt", "count"],
        handler: () => undefined,
      })
    ).not.toThrow();
  });

  it("rejects schemas containing ZodEffects at registration (R1-F2)", () => {
    const fieldTransform = z.object({
      orderId: z.string().transform((id) => `${id}-transformed`),
    });
    expect(() =>
      defineJob({
        name: "test.transform-field",
        schema: fieldTransform,
        handler: () => undefined,
      })
    ).toThrowError(/ZodEffects/);

    const rootTransform = z
      .object({ orderId: z.string() })
      .transform((data) => ({ ...data, rxText: "SPH -2.25" }));
    expect(() =>
      defineJob({
        name: "test.transform-root",
        schema: rootTransform,
        handler: () => undefined,
      })
    ).toThrowError(/ZodEffects/);

    const preprocessSchema = z.object({
      orderId: z.preprocess((val) => String(val), z.string()),
    });
    expect(() =>
      defineJob({
        name: "test.preprocess",
        schema: preprocessSchema,
        handler: () => undefined,
      })
    ).toThrowError(/ZodEffects/);
  });

  it("rejects schemas containing ZodIntersection at registration (R1-F4)", () => {
    const base = z.object({ orderId: z.string() });
    const extra = z.object({ accountId: z.string() });

    expect(() =>
      defineJob({
        name: "test.nested-intersection",
        schema: z.object({
          nested: z.intersection(base, extra),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/ZodIntersection/);

    expect(() =>
      defineJob({
        name: "test.root-intersection",
        schema: z.intersection(base, extra) as unknown as z.ZodObject<Record<string, z.ZodTypeAny>>,
        handler: () => undefined,
      })
    ).toThrowError(/ZodIntersection/);
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
