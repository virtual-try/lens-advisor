import { z } from "zod";

/**
 * Retry settings passed to pg-boss. Delays are in seconds, matching pg-boss.
 */
export interface RetryOptions {
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
}

export interface JobContext {
  jobId: string;
  retryCount: number;
  signal: AbortSignal;
}

export type JobHandler<TPayload> = (
  payload: TPayload,
  context: JobContext
) => Promise<void> | void;

export interface JobDefinition<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TPayload = z.infer<TSchema>,
> {
  readonly __jobDefinition: true;
  readonly name: string;
  readonly schema: TSchema;
  readonly handler: JobHandler<TPayload>;
  readonly retry: Readonly<Required<Pick<RetryOptions, "retryLimit" | "retryDelay" | "retryBackoff">>>;
  readonly allowStringFields: readonly string[];
}

export type AnyJobDefinition = JobDefinition<z.ZodTypeAny, never>;

export interface DefineJobOptions<TSchema extends z.ZodTypeAny> {
  name: string;
  schema: TSchema;
  handler: JobHandler<z.infer<TSchema>>;
  retry?: RetryOptions;
  /**
   * Field names that may hold strings or numbers even though they do not end in Id/Ids/Key/Keys.
   * Keep this list empty for payloads carrying prescription data (INV-2).
   */
  allowStringFields?: readonly string[];
}

export class JobDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobDefinitionError";
  }
}

export interface SanitizedValidationIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
}

/**
 * Sanitized validation error carrying only job name, issue paths, and Zod issue codes.
 * Never exposes the received values, Zod message text, or raw ZodError as cause (INV-2).
 */
export class JobPayloadValidationError extends JobDefinitionError {
  readonly jobName: string;
  readonly issues: readonly SanitizedValidationIssue[];

  constructor(jobName: string, issues: readonly SanitizedValidationIssue[]) {
    const summary = issues
      .map((issue) => `${issue.path.length === 0 ? "payload" : issue.path.join(".")}: ${issue.code}`)
      .join(", ");
    super(`Job "${jobName}" payload validation failed: ${summary}`);
    this.name = "JobPayloadValidationError";
    this.jobName = jobName;
    this.issues = issues;
    // Explicitly guarantee no cause property is set
    delete (this as { cause?: unknown }).cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      jobName: this.jobName,
      issues: this.issues,
    };
  }
}

const JOB_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const ID_FIELD_PATTERN = /(?:Id|Ids|Key|Keys)$/;

const DEFAULT_RETRY: JobDefinition["retry"] = Object.freeze({
  retryLimit: 2,
  retryDelay: 0,
  retryBackoff: false,
});

const registry = new Map<string, AnyJobDefinition>();

function schemaPath(path: readonly (string | number)[]): string {
  return path.length === 0 ? "payload" : path.join(".");
}

function assertPayloadSchema(schema: z.ZodTypeAny, allowStringFields: ReadonlySet<string>): void {
  if (schema instanceof z.ZodEffects) {
    throw new JobDefinitionError(
      `Job payload schema contains ZodEffects (${schema._def.effect.type}); ` +
        "effects are not permitted in job payload schemas (INV-2)"
    );
  }
  if (schema instanceof z.ZodIntersection) {
    throw new JobDefinitionError(
      "Job payload schema contains ZodIntersection; intersections are not permitted in job payload schemas (INV-2)"
    );
  }
  if (schema instanceof z.ZodUnion) {
    throw new JobDefinitionError(
      "Job payload schema contains ZodUnion; plain z.union is not permitted, use z.discriminatedUnion (INV-2)"
    );
  }
  if (schema instanceof z.ZodCatch) {
    throw new JobDefinitionError(
      "Job payload schema contains ZodCatch; catch is not permitted in job payload schemas (INV-2)"
    );
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    throw new JobDefinitionError(
      "Job payload schema root cannot be wrapped in optional, nullable, or default (must be a zod object or discriminated union)"
    );
  }
  if (!(schema instanceof z.ZodObject) && !(schema instanceof z.ZodDiscriminatedUnion)) {
    throw new JobDefinitionError(
      "Job payload schema must be a zod object or discriminated union so pg-boss can store an id/enum payload"
    );
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    for (const option of schema.options) {
      if (!(option instanceof z.ZodObject)) {
        throw new JobDefinitionError(
          "Job payload discriminated union options must be zod objects"
        );
      }
    }
  }
  assertNode(schema, [], allowStringFields);
}

function assertNode(
  schema: z.ZodTypeAny,
  path: readonly string[],
  allowStringFields: ReadonlySet<string>
): void {
  if (schema instanceof z.ZodBigInt) {
    throw new JobDefinitionError(
      `Job payload field "${schemaPath(path)}" is a bigint; bigint is not permitted in job payload schemas (JSON-unsafe)`
    );
  }

  if (schema instanceof z.ZodEffects) {
    throw new JobDefinitionError(
      `Job payload field "${schemaPath(path)}" uses ZodEffects (${schema._def.effect.type}), which is not permitted in job payload schemas (INV-2)`
    );
  }

  if (schema instanceof z.ZodIntersection) {
    throw new JobDefinitionError(
      `Job payload field "${schemaPath(path)}" uses ZodIntersection, which is not permitted in job payload schemas (INV-2)`
    );
  }

  if (schema instanceof z.ZodUnion) {
    throw new JobDefinitionError(
      `Job payload field "${schemaPath(path)}" uses ZodUnion; plain z.union is not permitted, use z.discriminatedUnion (INV-2)`
    );
  }

  if (schema instanceof z.ZodCatch) {
    throw new JobDefinitionError(
      `Job payload field "${schemaPath(path)}" uses ZodCatch, which is not permitted in job payload schemas (INV-2)`
    );
  }

  if (schema instanceof z.ZodLiteral) {
    const val = schema.value;
    const isAllowed =
      typeof val === "string" ||
      (typeof val === "number" && Number.isFinite(val)) ||
      typeof val === "boolean" ||
      val === null;

    if (!isAllowed) {
      const typeDesc =
        typeof val === "bigint"
          ? "bigint"
          : typeof val === "symbol"
          ? "symbol"
          : val === undefined
          ? "undefined"
          : typeof val === "number" && !Number.isFinite(val)
          ? `non-finite number (${String(val)})`
          : typeof val;
      throw new JobDefinitionError(
        `Job payload field "${schemaPath(path)}" uses a ${typeDesc} literal; ` +
          "z.literal is allowed only for string, number (finite), boolean or null values (JSON-safe)"
      );
    }
    return;
  }

  if (
    schema instanceof z.ZodString ||
    schema instanceof z.ZodNumber
  ) {
    const field = path[path.length - 1] ?? "";
    if (field === "" || (!ID_FIELD_PATTERN.test(field) && !allowStringFields.has(field))) {
      const typeName =
        schema instanceof z.ZodString
          ? "string"
          : "number";
      throw new JobDefinitionError(
        `Job payload field "${schemaPath(path)}" is a ${typeName} but does not end in Id/Ids/Key/Keys ` +
          "(INV-2: job payloads carry ids and enums only)"
      );
    }
    return;
  }

  if (
    schema instanceof z.ZodEnum ||
    schema instanceof z.ZodNativeEnum ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodNull ||
    schema instanceof z.ZodUndefined ||
    schema instanceof z.ZodVoid ||
    schema instanceof z.ZodNever
  ) {
    return;
  }

  if (schema instanceof z.ZodObject) {
    if (schema._def.unknownKeys === "passthrough") {
      throw new JobDefinitionError(
        `Job payload object "${schemaPath(path)}" is passthrough; unknown string values could carry Rx data (INV-2)`
      );
    }
    if (!(schema._def.catchall instanceof z.ZodNever)) {
      throw new JobDefinitionError(
        `Job payload object "${schemaPath(path)}" has a catchall schema; declare each id/enum field instead (INV-2)`
      );
    }
    for (const [key, child] of Object.entries(schema.shape)) {
      assertNode(child as z.ZodTypeAny, [...path, key], allowStringFields);
    }
    return;
  }

  if (schema instanceof z.ZodArray) {
    assertNode(schema.element as z.ZodTypeAny, path, allowStringFields);
    return;
  }

  if (schema instanceof z.ZodTuple) {
    if (schema._def.rest !== null && schema._def.rest !== undefined) {
      throw new JobDefinitionError(
        `Job payload field "${schemaPath(path)}" uses a variadic tuple with .rest(), which is not permitted in job payload schemas (INV-2)`
      );
    }
    schema.items.forEach((item: z.ZodTypeAny) => {
      assertNode(item, path, allowStringFields);
    });
    return;
  }

  if (schema instanceof z.ZodDiscriminatedUnion) {
    for (const option of schema.options) {
      if (!(option instanceof z.ZodObject)) {
        throw new JobDefinitionError(
          `Job payload field "${schemaPath(path)}" discriminated union options must be zod objects`
        );
      }
      assertNode(option as z.ZodTypeAny, path, allowStringFields);
    }
    return;
  }

  if (schema instanceof z.ZodOptional) {
    assertNode(schema.unwrap(), path, allowStringFields);
    return;
  }

  if (schema instanceof z.ZodNullable) {
    assertNode(schema.unwrap(), path, allowStringFields);
    return;
  }

  if (schema instanceof z.ZodDefault) {
    assertNode(schema.removeDefault(), path, allowStringFields);
    return;
  }

  if (schema instanceof z.ZodBranded || schema instanceof z.ZodReadonly) {
    assertNode(schema.unwrap(), path, allowStringFields);
    return;
  }

  throw new JobDefinitionError(
    `Job payload field "${schemaPath(path)}" uses ${schema.constructor.name}, which is not an id/enum payload type (INV-2)`
  );
}

export function validateRetryOptions(retry: RetryOptions): void {
  if (
    retry.retryLimit !== undefined &&
    (!Number.isInteger(retry.retryLimit) || retry.retryLimit < 0)
  ) {
    throw new JobDefinitionError("retryLimit must be a non-negative integer");
  }
  if (
    retry.retryDelay !== undefined &&
    (!Number.isInteger(retry.retryDelay) || retry.retryDelay < 0)
  ) {
    throw new JobDefinitionError("retryDelay must be a non-negative integer");
  }
}

function normaliseRetry(retry: RetryOptions | undefined): JobDefinition["retry"] {
  if (retry) {
    validateRetryOptions(retry);
  }
  const retryLimit = retry?.retryLimit ?? DEFAULT_RETRY.retryLimit;
  const retryDelay = retry?.retryDelay ?? DEFAULT_RETRY.retryDelay;
  const retryBackoff = retry?.retryBackoff ?? DEFAULT_RETRY.retryBackoff;

  if (!Number.isInteger(retryLimit) || retryLimit < 0) {
    throw new JobDefinitionError("retryLimit must be a non-negative integer");
  }
  if (!Number.isInteger(retryDelay) || retryDelay < 0) {
    throw new JobDefinitionError("retryDelay must be a non-negative integer");
  }

  return Object.freeze({ retryLimit, retryDelay, retryBackoff });
}

export function isJobDefinition(value: unknown): value is AnyJobDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __jobDefinition?: unknown }).__jobDefinition === true
  );
}

export function registerJob(definition: AnyJobDefinition): void {
  if (definition.name.endsWith(".dead")) {
    throw new JobDefinitionError(
      `Job name "${definition.name}" cannot end with reserved dead-letter suffix ".dead"`
    );
  }
  const existing = registry.get(definition.name);
  if (existing && existing !== definition) {
    throw new JobDefinitionError(`Duplicate job definition for "${definition.name}"`);
  }
  registry.set(definition.name, definition);
}

export function defineJob<TSchema extends z.ZodTypeAny>(
  options: DefineJobOptions<TSchema>
): JobDefinition<TSchema> {
  if (!JOB_NAME_PATTERN.test(options.name)) {
    throw new JobDefinitionError(
      `Job name "${options.name}" must be lowercase letters, digits, dots, hyphens or underscores`
    );
  }
  if (options.name.endsWith(".dead")) {
    throw new JobDefinitionError(
      `Job name "${options.name}" cannot end with reserved dead-letter suffix ".dead"`
    );
  }

  const allowStringFields = Object.freeze([...(options.allowStringFields ?? [])]);
  assertPayloadSchema(options.schema, new Set(allowStringFields));

  const definition: JobDefinition<TSchema, z.infer<TSchema>> = Object.freeze({
    __jobDefinition: true as const,
    name: options.name,
    schema: options.schema,
    handler: options.handler,
    retry: normaliseRetry(options.retry),
    allowStringFields,
  });

  registerJob(definition);
  return definition;
}

/**
 * Registers every job definition exported by the given job modules. Feature
 * modules register themselves when imported; calling this again after a module
 * cache hit keeps discovery deterministic.
 */
export function registerJobExports(modules: readonly unknown[]): AnyJobDefinition[] {
  const found: AnyJobDefinition[] = [];
  for (const module of modules) {
    if (typeof module !== "object" || module === null) continue;
    for (const value of Object.values(module)) {
      if (isJobDefinition(value)) {
        registerJob(value);
        found.push(value);
      }
    }
  }
  return found;
}

export function getJobDefinition(name: string): AnyJobDefinition | undefined {
  return registry.get(name);
}

export function getJobDefinitions(): AnyJobDefinition[] {
  return [...registry.values()];
}

export function clearJobRegistry(): void {
  registry.clear();
}

export function deadLetterQueueName(name: string): string {
  return `${name}.dead`;
}

/**
 * Parses a payload for a job and rejects unknown fields loudly. Zod's default
 * strip mode would otherwise silently drop an extra `rxText`, so the guard also
 * walks the schema and input together (INV-2, INV-8).
 */
export function validateJobPayload(
  definition: AnyJobDefinition,
  payload: unknown
): unknown {
  const issues: SanitizedValidationIssue[] = [];
  const schemaToParse =
    definition.schema instanceof z.ZodObject
      ? definition.schema.strict()
      : definition.schema;
  const result = schemaToParse.safeParse(payload);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({
        path: issue.path,
        code: issue.code,
      });
    }
  }

  collectUnknownKeys(definition.schema, payload, [], issues);
  collectNonFiniteNumbers(definition.schema, payload, [], issues);

  if (issues.length > 0) {
    const seen = new Set<string>();
    const uniqueIssues: SanitizedValidationIssue[] = [];
    for (const issue of issues) {
      const key = `${issue.path.join(".")}:${issue.code}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueIssues.push(issue);
      }
    }
    throw new JobPayloadValidationError(definition.name, uniqueIssues);
  }

  if (!result.success) {
    throw new JobPayloadValidationError(definition.name, issues);
  }

  return result.data;
}

function collectUnknownKeys(
  schema: z.ZodTypeAny,
  value: unknown,
  path: readonly (string | number)[],
  issues: SanitizedValidationIssue[]
): void {
  if (value === undefined || value === null) return;

  if (schema instanceof z.ZodOptional) {
    collectUnknownKeys(schema.unwrap(), value, path, issues);
    return;
  }
  if (schema instanceof z.ZodNullable) {
    collectUnknownKeys(schema.unwrap(), value, path, issues);
    return;
  }
  if (schema instanceof z.ZodDefault) {
    collectUnknownKeys(schema.removeDefault(), value, path, issues);
    return;
  }
  if (schema instanceof z.ZodCatch) {
    throw new JobDefinitionError(
      `Job payload field "${schemaPath(path)}" uses ZodCatch, which is not permitted in job payload schemas (INV-2)`
    );
  }
  if (schema instanceof z.ZodBranded || schema instanceof z.ZodReadonly) {
    collectUnknownKeys(schema.unwrap(), value, path, issues);
    return;
  }

  if (schema instanceof z.ZodObject) {
    if (typeof value !== "object" || Array.isArray(value)) return;

    const record = value as Record<string, unknown>;
    let hasUnrecognized = false;
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(schema.shape, key)) {
        hasUnrecognized = true;
        break;
      }
    }
    if (!hasUnrecognized && Object.hasOwn(record, "__proto__") && !Object.hasOwn(schema.shape, "__proto__")) {
      hasUnrecognized = true;
    }
    if (hasUnrecognized) {
      issues.push({ path, code: "unrecognized_keys" });
    }
    for (const [key, child] of Object.entries(schema.shape)) {
      collectUnknownKeys(child as z.ZodTypeAny, record[key], [...path, key], issues);
    }
    return;
  }

  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => {
      collectUnknownKeys(schema.element as z.ZodTypeAny, item, [...path, index], issues);
    });
    return;
  }

  if (schema instanceof z.ZodTuple) {
    if (schema._def.rest !== null && schema._def.rest !== undefined) {
      throw new JobDefinitionError(
        `Job payload field "${schemaPath(path)}" uses a variadic tuple with .rest(), which is not permitted in job payload schemas (INV-2)`
      );
    }
    if (!Array.isArray(value)) return;
    schema.items.forEach((item: z.ZodTypeAny, index: number) => {
      collectUnknownKeys(item, value[index], [...path, index], issues);
    });
    return;
  }

  if (schema instanceof z.ZodUnion) {
    throw new JobDefinitionError(
      `Job payload field "${schemaPath(path)}" uses ZodUnion; plain z.union is not permitted, use z.discriminatedUnion (INV-2)`
    );
  }

  if (schema instanceof z.ZodDiscriminatedUnion) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const discKey = schema.discriminator;
    const discValue = (value as Record<string, unknown>)[discKey];
    const branch = schema.optionsMap.get(discValue as string);
    if (branch) {
      collectUnknownKeys(branch, value, path, issues);
    }
    return;
  }
}

function collectNonFiniteNumbers(
  schema: z.ZodTypeAny,
  value: unknown,
  path: readonly (string | number)[],
  issues: SanitizedValidationIssue[]
): void {
  if (value === undefined || value === null) return;

  if (schema instanceof z.ZodOptional) {
    collectNonFiniteNumbers(schema.unwrap(), value, path, issues);
    return;
  }
  if (schema instanceof z.ZodNullable) {
    collectNonFiniteNumbers(schema.unwrap(), value, path, issues);
    return;
  }
  if (schema instanceof z.ZodDefault) {
    collectNonFiniteNumbers(schema.removeDefault(), value, path, issues);
    return;
  }
  if (schema instanceof z.ZodBranded || schema instanceof z.ZodReadonly) {
    collectNonFiniteNumbers(schema.unwrap(), value, path, issues);
    return;
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    issues.push({
      path,
      code: Number.isNaN(value) ? "invalid_type" : "not_finite",
    });
    return;
  }

  if (schema instanceof z.ZodObject) {
    if (typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(schema.shape)) {
      if (Object.hasOwn(record, key)) {
        collectNonFiniteNumbers(child as z.ZodTypeAny, record[key], [...path, key], issues);
      }
    }
    return;
  }

  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => {
      collectNonFiniteNumbers(schema.element as z.ZodTypeAny, item, [...path, index], issues);
    });
    return;
  }

  if (schema instanceof z.ZodTuple) {
    if (!Array.isArray(value)) return;
    schema.items.forEach((item: z.ZodTypeAny, index: number) => {
      collectNonFiniteNumbers(item, value[index], [...path, index], issues);
    });
    return;
  }

  if (schema instanceof z.ZodDiscriminatedUnion) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const discKey = schema.discriminator;
    const discValue = (value as Record<string, unknown>)[discKey];
    const branch = schema.optionsMap.get(discValue as string);
    if (branch) {
      collectNonFiniteNumbers(branch, value, path, issues);
    }
    return;
  }
}
