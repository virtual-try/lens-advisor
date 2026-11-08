import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  addOnSchema,
  catalogResponseSchema,
  diopterSchema,
  eyeSchema,
  iso4217CurrencySchema,
  lensGroupSchema,
  lensSchema,
  moneySchema,
  optionGroupSchema,
  optionValueSchema,
  prescriptionSchema,
  prescriptionSubmitBodySchema,
  rxLimitsSchema,
  selectionSchema,
  uploadUrlRequestSchema,
} from "./index.js";

const validMoney = { amountMinor: 8000, currency: "USD" };

const validEye = { sph: -225, cyl: -50, axis: 180, add: 200 };

const validPrescription = {
  od: validEye,
  os: { sph: -200, add: 200 },
  pd: { single: 635 },
};

const validCatalog = {
  lensGroups: [
    {
      id: "grp-sv",
      name: "Single vision",
      position: 0,
      lenses: [
        {
          id: "lens-167",
          groupId: "grp-sv",
          name: "1.67 High index",
          price: validMoney,
          limits: {
            sphMin: -800,
            sphMax: 600,
            cylMin: -400,
            cylMax: 0,
            rxTypes: ["SINGLE_VISION", "PROGRESSIVE"],
          },
          labCodeTemplate: "PO-58-[lens_type=NONE]-[lens_color=NONE]-00",
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          position: 0,
        },
      ],
    },
  ],
  optionGroups: [
    {
      id: "og-material",
      kind: "MATERIAL",
      name: "Material",
      position: 0,
      values: [
        {
          id: "ov-167",
          optionGroupId: "og-material",
          label: "1.67",
          priceDelta: { amountMinor: 3500, currency: "USD" },
          tokenKey: "material",
          tokenValue: "167",
          shopifyVariantId: "gid://shopify/ProductVariant/2",
          position: 0,
        },
        {
          id: "ov-clear",
          optionGroupId: "og-material",
          label: "Clear",
          priceDelta: { amountMinor: 0, currency: "USD" },
          position: 1,
        },
      ],
    },
  ],
  addOns: [
    {
      id: "addon-case",
      name: "Hard case",
      price: { amountMinor: 1500, currency: "USD" },
      shopifyVariantId: "gid://shopify/ProductVariant/3",
      position: 0,
    },
  ],
  settings: {
    manualRxEnabled: true,
    rxUploadEnabled: true,
    storeRxInOrder: false,
  },
};

const validSelection = {
  frameVariantId: "gid://shopify/ProductVariant/9",
  rxType: "SINGLE_VISION",
  prescriptionRef: "rx-ref-1",
  lensId: "lens-167",
  optionValueIds: ["ov-167", "ov-clear"],
  addOnIds: ["addon-case"],
};

const validUploadUrlRequest = {
  contentType: "image/jpeg",
  size: 1024,
};

const validSubmitBody = {
  rxType: "PROGRESSIVE",
  prescription: validPrescription,
};

describe("catalogResponseSchema", () => {
  it("accepts a valid storefront catalog fixture", () => {
    const parsed = catalogResponseSchema.parse(validCatalog);
    expect(parsed.lensGroups).toHaveLength(1);
    expect(parsed.lensGroups[0]?.lenses[0]?.price.amountMinor).toBe(8000);
    expect(parsed.settings.storeRxInOrder).toBe(false);
  });

  it("rejects float money (INV-4)", () => {
    const result = catalogResponseSchema.safeParse({
      ...validCatalog,
      lensGroups: [
        {
          ...validCatalog.lensGroups[0],
          lenses: [
            {
              ...validCatalog.lensGroups[0]?.lenses[0],
              price: { amountMinor: 12.5, currency: "USD" },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects float diopter limits (INV-5)", () => {
    const result = catalogResponseSchema.safeParse({
      ...validCatalog,
      lensGroups: [
        {
          ...validCatalog.lensGroups[0],
          lenses: [
            {
              ...validCatalog.lensGroups[0]?.lenses[0],
              limits: {
                sphMin: -8.25,
                sphMax: 6.25,
                cylMin: -4.25,
                cylMax: 0,
                rxTypes: ["SINGLE_VISION"],
              },
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("moneySchema", () => {
  it("accepts integer minor units", () => {
    expect(moneySchema.parse(validMoney)).toEqual(validMoney);
  });

  it("rejects amountMinor 12.5 (INV-4)", () => {
    const result = moneySchema.safeParse({
      amountMinor: 12.5,
      currency: "USD",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown uppercase currency LOL (INV-4)", () => {
    expect(iso4217CurrencySchema.safeParse("LOL").success).toBe(false);
    expect(iso4217CurrencySchema.safeParse("USD").success).toBe(true);
    const result = moneySchema.safeParse({
      amountMinor: 100,
      currency: "LOL",
    });
    expect(result.success).toBe(false);
  });
});

describe("prescriptionSchema", () => {
  it("accepts a valid typed prescription in integer hundredths", () => {
    expect(prescriptionSchema.parse(validPrescription).od.sph).toBe(-225);
  });

  it("rejects float sph -2.25 (INV-5)", () => {
    const result = prescriptionSchema.safeParse({
      ...validPrescription,
      od: { ...validEye, sph: -2.25 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts dual PD in integer tenths", () => {
    const parsed = prescriptionSchema.parse({
      od: { sph: -225 },
      os: { sph: -200 },
      pd: { od: 320, os: 315 },
    });
    expect(parsed.pd).toEqual({ od: 320, os: 315 });
  });
});

describe("prescriptionSubmitBodySchema", () => {
  it("accepts a valid submit body", () => {
    expect(prescriptionSubmitBodySchema.parse(validSubmitBody).rxType).toBe(
      "PROGRESSIVE",
    );
  });

  it("rejects float sph -2.25 on the body (INV-5)", () => {
    const result = prescriptionSubmitBodySchema.safeParse({
      rxType: "SINGLE_VISION",
      prescription: {
        od: { sph: -2.25 },
        os: { sph: -200 },
        pd: { single: 635 },
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a body with no prescription (upload path)", () => {
    const parsed = prescriptionSubmitBodySchema.parse({
      rxType: "SINGLE_VISION",
      draftId: "draft-1",
      uploadedKeys: ["shops/shop-a/rx/draft-1/file.jpg"],
    });
    expect(parsed.prescription).toBeUndefined();
  });
});

describe("selectionSchema", () => {
  it("accepts a valid selection", () => {
    expect(selectionSchema.parse(validSelection).lensId).toBe("lens-167");
  });

  it("accepts NON_PRESCRIPTION without lens or rx ref", () => {
    const parsed = selectionSchema.parse({
      frameVariantId: "gid://shopify/ProductVariant/9",
      rxType: "NON_PRESCRIPTION",
      optionValueIds: [],
      addOnIds: [],
    });
    expect(parsed.lensId).toBeUndefined();
  });
});

describe("uploadUrlRequestSchema", () => {
  it("accepts a valid upload-url request", () => {
    expect(uploadUrlRequestSchema.parse(validUploadUrlRequest)).toEqual(
      validUploadUrlRequest,
    );
  });

  it("rejects a non-integer size", () => {
    const result = uploadUrlRequestSchema.safeParse({
      contentType: "image/jpeg",
      size: 10.5,
    });
    expect(result.success).toBe(false);
  });
});

const FLOAT_MONEY = 12.5;
const FLOAT_DIOPTER = -2.25;

const limitsFixture = {
  sphMin: -800,
  sphMax: 600,
  cylMin: -400,
  cylMax: 0,
  addMin: 75,
  addMax: 350,
  rxTypes: ["SINGLE_VISION"],
};

const eyeFixture = { sph: -225, cyl: -50, axis: 180, add: 200 };

const prescriptionFixture = {
  od: { sph: -225, cyl: -50, axis: 180, add: 200 },
  os: { sph: -200, cyl: 75, axis: 42, add: 200 },
  pd: { single: 635 },
};

const lensFixture = {
  id: "lens-1",
  groupId: "grp-1",
  name: "Lens",
  price: { amountMinor: 8000, currency: "USD" },
  limits: limitsFixture,
  labCodeTemplate: "X",
  shopifyVariantId: "v1",
  position: 0,
};

const lensGroupFixture = {
  id: "grp-1",
  name: "Group",
  position: 0,
  lenses: [lensFixture],
};

const optionValueFixture = {
  id: "ov-1",
  optionGroupId: "og-1",
  label: "Clear",
  priceDelta: { amountMinor: 0, currency: "USD" },
  position: 0,
};

const optionGroupFixture = {
  id: "og-1",
  kind: "MATERIAL",
  name: "Material",
  position: 0,
  values: [optionValueFixture],
};

const addOnFixture = {
  id: "addon-1",
  name: "Case",
  price: { amountMinor: 1500, currency: "USD" },
  shopifyVariantId: "v3",
  position: 0,
};

const submitFixture = {
  rxType: "SINGLE_VISION",
  prescription: prescriptionFixture,
};

type FloatCase = {
  schemaName: string;
  field: string;
  schema: ZodTypeAny;
  payload: unknown;
};

function withField(base: unknown, path: string, value: unknown): unknown {
  const clone = structuredClone(base) as Record<string, unknown>;
  const parts = path.split(".");
  let cursor: Record<string, unknown> = clone;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (key === undefined) {
      throw new Error(`empty path segment in ${path}`);
    }
    const next = cursor[key];
    if (typeof next !== "object" || next === null) {
      throw new Error(`missing ${path} at ${key}`);
    }
    cursor = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last === undefined) {
    throw new Error(`empty field path ${path}`);
  }
  cursor[last] = value;
  return clone;
}

function nestedFloats(
  schemaName: string,
  schema: ZodTypeAny,
  base: unknown,
  fields: ReadonlyArray<{ field: string; value: number }>,
): FloatCase[] {
  return fields.map(({ field, value }) => ({
    schemaName,
    field,
    schema,
    payload: withField(base, field, value),
  }));
}

const LIMIT_FLOATS = [
  { field: "sphMin", value: FLOAT_DIOPTER },
  { field: "sphMax", value: FLOAT_DIOPTER },
  { field: "cylMin", value: FLOAT_DIOPTER },
  { field: "cylMax", value: FLOAT_DIOPTER },
  { field: "addMin", value: FLOAT_DIOPTER },
  { field: "addMax", value: FLOAT_DIOPTER },
] as const;

const EYE_FLOATS = [
  { field: "sph", value: FLOAT_DIOPTER },
  { field: "cyl", value: FLOAT_DIOPTER },
  { field: "add", value: FLOAT_DIOPTER },
] as const;

function prefixFields(
  prefix: string,
  fields: ReadonlyArray<{ field: string; value: number }>,
): Array<{ field: string; value: number }> {
  return fields.map(({ field, value }) => ({
    field: `${prefix}${field}`,
    value,
  }));
}

const floatCases: FloatCase[] = [
  {
    schemaName: "diopterSchema",
    field: "",
    schema: diopterSchema,
    payload: FLOAT_DIOPTER,
  },
  {
    schemaName: "moneySchema",
    field: "amountMinor",
    schema: moneySchema,
    payload: { amountMinor: FLOAT_MONEY, currency: "USD" },
  },
  ...nestedFloats("eyeSchema", eyeSchema, eyeFixture, EYE_FLOATS),
  ...nestedFloats(
    "prescriptionSchema",
    prescriptionSchema,
    prescriptionFixture,
    [
      ...prefixFields("od.", EYE_FLOATS),
      ...prefixFields("os.", EYE_FLOATS),
    ],
  ),
  ...nestedFloats("rxLimitsSchema", rxLimitsSchema, limitsFixture, LIMIT_FLOATS),
  ...nestedFloats("lensSchema", lensSchema, lensFixture, [
    { field: "price.amountMinor", value: FLOAT_MONEY },
    ...prefixFields("limits.", LIMIT_FLOATS),
  ]),
  ...nestedFloats("lensGroupSchema", lensGroupSchema, lensGroupFixture, [
    { field: "lenses.0.price.amountMinor", value: FLOAT_MONEY },
    ...prefixFields("lenses.0.limits.", LIMIT_FLOATS),
  ]),
  ...nestedFloats("optionValueSchema", optionValueSchema, optionValueFixture, [
    { field: "priceDelta.amountMinor", value: FLOAT_MONEY },
  ]),
  ...nestedFloats("optionGroupSchema", optionGroupSchema, optionGroupFixture, [
    { field: "values.0.priceDelta.amountMinor", value: FLOAT_MONEY },
  ]),
  ...nestedFloats("addOnSchema", addOnSchema, addOnFixture, [
    { field: "price.amountMinor", value: FLOAT_MONEY },
  ]),
  ...nestedFloats(
    "catalogResponseSchema",
    catalogResponseSchema,
    validCatalog,
    [
      {
        field: "lensGroups.0.lenses.0.price.amountMinor",
        value: FLOAT_MONEY,
      },
      ...prefixFields("lensGroups.0.lenses.0.limits.", LIMIT_FLOATS),
      {
        field: "optionGroups.0.values.0.priceDelta.amountMinor",
        value: FLOAT_MONEY,
      },
      { field: "addOns.0.price.amountMinor", value: FLOAT_MONEY },
    ],
  ),
  ...nestedFloats(
    "prescriptionSubmitBodySchema",
    prescriptionSubmitBodySchema,
    submitFixture,
    [
      ...prefixFields("prescription.od.", EYE_FLOATS),
      ...prefixFields("prescription.os.", EYE_FLOATS),
    ],
  ),
];

describe("float rejection per money and diopter field", () => {
  it("covers priceDelta, AddOn.price, eye sph/cyl/add, and ADD limits on every exported schema that has them", () => {
    const ids = floatCases.map((entry) => `${entry.schemaName}:${entry.field}`);
    expect(ids).toContain("optionValueSchema:priceDelta.amountMinor");
    expect(ids).toContain(
      "optionGroupSchema:values.0.priceDelta.amountMinor",
    );
    expect(ids).toContain(
      "catalogResponseSchema:optionGroups.0.values.0.priceDelta.amountMinor",
    );
    expect(ids).toContain("addOnSchema:price.amountMinor");
    expect(ids).toContain("catalogResponseSchema:addOns.0.price.amountMinor");
    expect(ids).toContain("eyeSchema:sph");
    expect(ids).toContain("eyeSchema:cyl");
    expect(ids).toContain("eyeSchema:add");
    expect(ids).toContain("prescriptionSchema:od.cyl");
    expect(ids).toContain("prescriptionSchema:od.add");
    expect(ids).toContain("prescriptionSchema:os.cyl");
    expect(ids).toContain("prescriptionSchema:os.add");
    expect(ids).toContain("rxLimitsSchema:addMin");
    expect(ids).toContain("rxLimitsSchema:addMax");
    expect(ids).toContain("lensSchema:limits.addMin");
    expect(ids).toContain("lensSchema:limits.addMax");
    expect(ids).toContain("lensGroupSchema:lenses.0.limits.addMin");
    expect(ids).toContain("lensGroupSchema:lenses.0.limits.addMax");
    expect(ids).toContain(
      "catalogResponseSchema:lensGroups.0.lenses.0.limits.addMin",
    );
    expect(ids).toContain(
      "catalogResponseSchema:lensGroups.0.lenses.0.limits.addMax",
    );
    expect(ids).toContain("prescriptionSubmitBodySchema:prescription.od.add");
    expect(ids).toContain("prescriptionSubmitBodySchema:prescription.os.cyl");
    expect(new Set(floatCases.map((entry) => entry.schemaName))).toEqual(
      new Set([
        "diopterSchema",
        "moneySchema",
        "eyeSchema",
        "prescriptionSchema",
        "rxLimitsSchema",
        "lensSchema",
        "lensGroupSchema",
        "optionValueSchema",
        "optionGroupSchema",
        "addOnSchema",
        "catalogResponseSchema",
        "prescriptionSubmitBodySchema",
      ]),
    );
  });

  it.each(floatCases)(
    "$schemaName rejects float $field",
    ({ schema, payload, field }) => {
      const result = schema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join("."));
        expect(paths).toContain(field);
      }
    },
  );
});
