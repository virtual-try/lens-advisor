import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JobDefinitionError, defineJob, validateJobPayload } from "./define-job";

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
        versionKey: z.number().int(),
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

  it("rejects a bigint field such as versionKey at registration (R2-F1)", () => {
    expect(() =>
      defineJob({
        name: "test.bigint-key",
        schema: z.object({ orderId: z.string(), versionKey: z.bigint() }),
        handler: () => undefined,
      })
    ).toThrowError(/versionKey.*is a bigint.*bigint is not permitted/);
  });

  it("rejects a bigint field even if listed in allowStringFields (R2-F1)", () => {
    expect(() =>
      defineJob({
        name: "test.bigint-whitelisted",
        schema: z.object({ orderId: z.string(), count: z.bigint() }),
        allowStringFields: ["count"],
        handler: () => undefined,
      })
    ).toThrowError(/count.*is a bigint.*bigint is not permitted/);
  });

  it("allows a numeric field if whitelisted in allowStringFields (R1-F1)", () => {
    expect(() =>
      defineJob({
        name: "test.numeric-whitelisted",
        schema: z.object({ orderId: z.string(), attempt: z.number(), count: z.number() }),
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

  it("rejects schemas containing ZodCatch at root or nested at registration (R3-F1)", () => {
    // Root catch
    expect(() =>
      defineJob({
        name: "test.root-catch",
        schema: z.object({ orderId: z.string() }).catch({ orderId: "fallback" }),
        handler: () => undefined,
      })
    ).toThrowError(/ZodCatch/);

    // Field-level catch
    expect(() =>
      defineJob({
        name: "test.field-catch",
        schema: z.object({
          orderId: z.string().catch("fallback-id"),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/ZodCatch/);

    // Nested object catch that could synthesize undeclared/Rx fields
    expect(() =>
      defineJob({
        name: "test.nested-catch",
        schema: z.object({
          orderId: z.string(),
          nested: z
            .object({ rxText: z.string() })
            .catch({ rxText: "SPH -2.25" }),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/ZodCatch/);

    // Discriminated union branch with catch
    expect(() =>
      defineJob({
        name: "test.union-catch",
        schema: z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("order"),
            orderId: z.string().catch("ord-fallback"),
          }),
        ]),
        handler: () => undefined,
      })
    ).toThrowError(/ZodCatch/);
  });

  it("rejects bigint, symbol, undefined, and non-finite number literals at registration (R3-F2)", () => {
    // BigInt literal
    expect(() =>
      defineJob({
        name: "test.literal-bigint",
        schema: z.object({
          orderId: z.string(),
          versionKey: z.literal(1n),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/versionKey.*bigint literal.*z\.literal is allowed only/);

    // Infinity literal
    expect(() =>
      defineJob({
        name: "test.literal-infinity",
        schema: z.object({
          orderId: z.string(),
          limitKey: z.literal(Infinity),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/limitKey.*non-finite number.*literal/);

    // -Infinity literal
    expect(() =>
      defineJob({
        name: "test.literal-neg-infinity",
        schema: z.object({
          orderId: z.string(),
          limitKey: z.literal(-Infinity),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/limitKey.*non-finite number.*literal/);

    // NaN literal
    expect(() =>
      defineJob({
        name: "test.literal-nan",
        schema: z.object({
          orderId: z.string(),
          limitKey: z.literal(NaN),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/limitKey.*non-finite number.*literal/);

    // Symbol literal
    expect(() =>
      defineJob({
        name: "test.literal-symbol",
        schema: z.object({
          orderId: z.string(),
          tagKey: z.literal(Symbol("tag")),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/tagKey.*symbol literal/);

    // Undefined literal
    expect(() =>
      defineJob({
        name: "test.literal-undefined",
        schema: z.object({
          orderId: z.string(),
          emptyKey: z.literal(undefined),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/emptyKey.*undefined literal/);
  });

  it("accepts valid JSON-safe literal values (string, finite number, boolean, null) (R3-F2)", () => {
    expect(() =>
      defineJob({
        name: "test.literal-valid",
        schema: z.object({
          orderId: z.string(),
          kind: z.literal("order"),
          flag: z.literal(true),
          status: z.literal(false),
          codeKey: z.literal(42),
          negativeKey: z.literal(-10.5),
          empty: z.literal(null),
        }),
        handler: () => undefined,
      })
    ).not.toThrow();
  });

  it("rejects root optional, nullable, or default schemas at registration (R3-F3)", () => {
    // Root optional
    expect(() =>
      defineJob({
        name: "test.root-optional",
        schema: z.object({ orderId: z.string() }).optional(),
        handler: () => undefined,
      })
    ).toThrowError(/Job payload schema root cannot be wrapped in optional, nullable, or default/);

    // Root nullable
    expect(() =>
      defineJob({
        name: "test.root-nullable",
        schema: z.object({ orderId: z.string() }).nullable(),
        handler: () => undefined,
      })
    ).toThrowError(/Job payload schema root cannot be wrapped in optional, nullable, or default/);

    // Root default
    expect(() =>
      defineJob({
        name: "test.root-default",
        schema: z.object({ orderId: z.string() }).default({ orderId: "ord-1" }),
        handler: () => undefined,
      })
    ).toThrowError(/Job payload schema root cannot be wrapped in optional, nullable, or default/);

    // Root optional discriminated union
    expect(() =>
      defineJob({
        name: "test.root-optional-union",
        schema: z
          .discriminatedUnion("kind", [
            z.object({ kind: z.literal("order"), orderId: z.string() }),
          ])
          .optional(),
        handler: () => undefined,
      })
    ).toThrowError(/Job payload schema root cannot be wrapped in optional, nullable, or default/);

    // Root discriminated union with non-object option
    const fakeUnion = Object.create(z.ZodDiscriminatedUnion.prototype);
    fakeUnion._def = {
      typeName: "ZodDiscriminatedUnion",
      discriminator: "kind",
      options: [
        z.object({ kind: z.literal("order"), orderId: z.string() }),
        z.string(),
      ],
    };

    expect(() =>
      defineJob({
        name: "test.union-non-object",
        schema: fakeUnion,
        handler: () => undefined,
      })
    ).toThrowError(/discriminated union options must be zod objects/);
  });

  it("rejects a duplicate job name", () => {
    const schema = z.object({ orderId: z.string() });
    defineJob({ name: "test.duplicate", schema, handler: () => undefined });

    expect(() =>
      defineJob({ name: "test.duplicate", schema, handler: () => undefined })
    ).toThrowError(JobDefinitionError);
  });

  it("rejects plain z.union at registration (R2-F2)", () => {
    expect(() =>
      defineJob({
        name: "test.plain-union",
        schema: z.union([
          z.object({ orderId: z.string() }),
          z.object({ accountId: z.string() }),
        ]) as unknown as z.ZodObject<Record<string, z.ZodTypeAny>>,
        handler: () => undefined,
      })
    ).toThrowError(/plain z\.union is not permitted.*use z\.discriminatedUnion/);

    expect(() =>
      defineJob({
        name: "test.nested-plain-union",
        schema: z.object({
          nested: z.union([
            z.object({ orderId: z.string() }),
            z.object({ accountId: z.string() }),
          ]),
        }),
        handler: () => undefined,
      })
    ).toThrowError(/plain z\.union is not permitted.*use z\.discriminatedUnion/);
  });

  it("supports z.discriminatedUnion and runs strict-key validation against the selected branch (R2-F2)", () => {
    const definition = defineJob({
      name: "test.discriminated-order-account",
      schema: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("order"), orderId: z.string() }),
        z.object({ kind: z.literal("account"), accountId: z.string() }),
      ]),
      handler: () => undefined,
    });

    // Both branches validate successfully with their declared keys
    expect(
      validateJobPayload(definition, { kind: "order", orderId: "ord-123" })
    ).toEqual({ kind: "order", orderId: "ord-123" });

    expect(
      validateJobPayload(definition, { kind: "account", accountId: "acc-456" })
    ).toEqual({ kind: "account", accountId: "acc-456" });

    // Strict-key validation rejects extra keys on either branch
    expect(() =>
      validateJobPayload(definition, {
        kind: "order",
        orderId: "ord-123",
        accountId: "acc-456",
      })
    ).toThrowError(/accountId.*not declared/);

    expect(() =>
      validateJobPayload(definition, {
        kind: "account",
        accountId: "acc-456",
        orderId: "ord-123",
      })
    ).toThrowError(/orderId.*not declared/);

    expect(() =>
      validateJobPayload(definition, {
        kind: "account",
        accountId: "acc-456",
        rxText: "SPH -2.25",
      })
    ).toThrowError(/rxText.*not declared/);
  });

  it("rejects job names ending in .dead (reserved for dead-letter queues) at registration (R4-F1)", () => {
    expect(() =>
      defineJob({
        name: "orders.sync.dead",
        schema: z.object({ orderId: z.string() }),
        handler: () => undefined,
      })
    ).toThrowError(/cannot end with reserved dead-letter suffix "\.dead"/);

    expect(() =>
      defineJob({
        name: "foo.dead",
        schema: z.object({ orderId: z.string() }),
        handler: () => undefined,
      })
    ).toThrowError(JobDefinitionError);

    expect(() =>
      defineJob({
        name: "orders.deadline",
        schema: z.object({ orderId: z.string() }),
        handler: () => undefined,
      })
    ).not.toThrow();
  });
});
