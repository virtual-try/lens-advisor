import { describe, expect, it } from "vitest";
import {
  catalogResponseSchema,
  moneySchema,
  prescriptionSchema,
  prescriptionSubmitBodySchema,
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
