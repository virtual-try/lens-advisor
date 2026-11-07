import { describe, expect, it } from "vitest";
import type { Lens, OptionValue } from "../types/index.js";
import { compileLabCode } from "./compiler.js";
import { validateTemplate } from "./validator.js";

const BLUEPRINT_TEMPLATE = "PO-58-[lens_type=NONE]-[lens_color=NONE]-00";

function createMockLens(template: string): Lens {
  return {
    id: "lens-1",
    groupId: "group-1",
    name: "Standard Polycarbonate",
    price: { amountMinor: 5000, currency: "USD" },
    limits: {
      sphMin: -800,
      sphMax: 600,
      cylMin: -400,
      cylMax: 0,
      rxTypes: ["SINGLE_VISION"],
    },
    labCodeTemplate: template,
    shopifyVariantId: "var-1",
    position: 0,
  };
}

function createMockOptionValue(overrides: Partial<OptionValue>): OptionValue {
  return {
    id: "opt-1",
    optionGroupId: "group-opt-1",
    label: "Option Label",
    priceDelta: { amountMinor: 0, currency: "USD" },
    position: 0,
    ...overrides,
  };
}

describe("Spec 12 — Examples table cases", () => {
  it("row 1: no selections compiles defaults", () => {
    const result = compileLabCode(BLUEPRINT_TEMPLATE);
    expect(result.code).toBe("PO-58-NONE-NONE-00");
    expect(result.warnings).toEqual([]);

    const resultEmptyArray = compileLabCode(BLUEPRINT_TEMPLATE, []);
    expect(resultEmptyArray.code).toBe("PO-58-NONE-NONE-00");
    expect(resultEmptyArray.warnings).toEqual([]);
  });

  it("row 2: tint lens_type=POLR, colour lens_color=GREY", () => {
    const selections: OptionValue[] = [
      createMockOptionValue({ tokenKey: "lens_type", tokenValue: "POLR" }),
      createMockOptionValue({ tokenKey: "lens_color", tokenValue: "GREY" }),
    ];

    const result = compileLabCode(BLUEPRINT_TEMPLATE, selections);
    expect(result.code).toBe("PO-58-POLR-GREY-00");
    expect(result.warnings).toEqual([]);

    // Also verify via record input
    const resultRecord = compileLabCode(BLUEPRINT_TEMPLATE, {
      lens_type: "POLR",
      lens_color: "GREY",
    });
    expect(resultRecord.code).toBe("PO-58-POLR-GREY-00");
    expect(resultRecord.warnings).toEqual([]);
  });

  it("row 3: material override PO-67 replaces the first segment", () => {
    const selections = [
      createMockOptionValue({
        overrideCode: "PO-67",
      }),
    ];

    const result = compileLabCode(BLUEPRINT_TEMPLATE, selections);
    expect(result.code).toBe("PO-67-NONE-NONE-00");
    expect(result.warnings).toEqual([]);

    // Also verify when target is explicitly 'material'
    const resultExplicit = compileLabCode(BLUEPRINT_TEMPLATE, [
      { position: "material", overrideCode: "PO-67" },
    ]);
    expect(resultExplicit.code).toBe("PO-67-NONE-NONE-00");
    expect(resultExplicit.warnings).toEqual([]);
  });

  it("row 4: token lens_tint=PHOT (unknown key) falls back to default and warns", () => {
    const selections = [
      createMockOptionValue({
        tokenKey: "lens_tint",
        tokenValue: "PHOT",
      }),
    ];

    const result = compileLabCode(BLUEPRINT_TEMPLATE, selections);
    expect(result.code).toBe("PO-58-NONE-NONE-00");
    expect(result.warnings).toEqual(["UNKNOWN_TOKEN lens_tint"]);
  });

  it("row 5: template PO-[lens_type=NONE -> validateTemplate reports UNCLOSED_TOKEN", () => {
    const res = validateTemplate("PO-[lens_type=NONE");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("UNCLOSED_TOKEN");
    expect(res.errors[0]?.code).toBe("UNCLOSED_TOKEN");
  });

  it("row 6: template with [a=X] twice -> validateTemplate reports DUPLICATE_TOKEN a", () => {
    const res = validateTemplate("[a=X]-[a=X]");
    expect(res.valid).toBe(false);
    expect(res.error).toBe("DUPLICATE_TOKEN a");
    expect(res.errors[0]?.code).toBe("DUPLICATE_TOKEN");
    expect(res.errors[0]?.token).toBe("a");

    const resDiffDefault = validateTemplate("PO-[a=X]-[a=Y]-00");
    expect(resDiffDefault.valid).toBe(false);
    expect(resDiffDefault.error).toBe("DUPLICATE_TOKEN a");
    expect(resDiffDefault.errors[0]?.code).toBe("DUPLICATE_TOKEN");
    expect(resDiffDefault.errors[0]?.token).toBe("a");
  });

  it("row 7: empty template -> validateTemplate reports EMPTY_TEMPLATE", () => {
    const resEmpty = validateTemplate("");
    expect(resEmpty.valid).toBe(false);
    expect(resEmpty.error).toBe("EMPTY_TEMPLATE");
    expect(resEmpty.errors[0]?.code).toBe("EMPTY_TEMPLATE");

    const resWhitespace = validateTemplate("   ");
    expect(resWhitespace.valid).toBe(false);
    expect(resWhitespace.error).toBe("EMPTY_TEMPLATE");
    expect(resWhitespace.errors[0]?.code).toBe("EMPTY_TEMPLATE");
  });
});

describe("Self-check 1 — Token values inserted literally (never interpreted as regex)", () => {
  it("inserts value containing $& literally", () => {
    const result = compileLabCode(BLUEPRINT_TEMPLATE, [
      { tokenKey: "lens_type", tokenValue: "FOO$&BAR" },
    ]);
    expect(result.code).toBe("PO-58-FOO$&BAR-NONE-00");
    expect(result.warnings).toEqual([]);
  });

  it("inserts value containing $1, $2, $', $`, $$ literally", () => {
    const result = compileLabCode(BLUEPRINT_TEMPLATE, [
      { tokenKey: "lens_type", tokenValue: "$1$2" },
      { tokenKey: "lens_color", tokenValue: "$$'`" },
    ]);
    expect(result.code).toBe("PO-58-$1$2-$$'`-00");
    expect(result.warnings).toEqual([]);
  });

  it("inserts value containing dot . and regex metacharacters literally", () => {
    const result = compileLabCode(BLUEPRINT_TEMPLATE, [
      { tokenKey: "lens_type", tokenValue: "A.B*C+D?E[F]" },
    ]);
    expect(result.code).toBe("PO-58-A.B*C+D?E[F]-NONE-00");
    expect(result.warnings).toEqual([]);
  });

  it("inserts override code containing $& and $1 literally", () => {
    const result = compileLabCode(BLUEPRINT_TEMPLATE, [
      { position: "material", overrideCode: "PO-$&-$1" },
    ]);
    expect(result.code).toBe("PO-$&-$1-NONE-NONE-00");
    expect(result.warnings).toEqual([]);
  });
});

describe("Self-check 2 — Override and token targeting the same segment (override wins)", () => {
  it("override wins over token targeting material segment (segment 0)", () => {
    // Both an override for material and a token for material
    const result = compileLabCode(BLUEPRINT_TEMPLATE, [
      { position: "material", overrideCode: "PO-67" },
      { tokenKey: "material", tokenValue: "PO-99" },
    ]);
    expect(result.code).toBe("PO-67-NONE-NONE-00");
    // Since material is not in template tokens, token triggers unknown warning, but override code wins in compilation
    expect(result.code).toContain("PO-67");
    expect(result.code).not.toContain("PO-99");
  });

  it("override wins over token when template has token in first segment", () => {
    const tpl = "[material=PO58]-[lens_type=NONE]-[lens_color=NONE]-00";
    const result = compileLabCode(tpl, [
      { position: "material", overrideCode: "PO-67" },
      { tokenKey: "material", tokenValue: "PO-74" },
    ]);
    expect(result.code).toBe("PO-67-NONE-NONE-00");
    expect(result.warnings).toEqual([]);
  });

  it("override wins over token targeting lens_type segment", () => {
    const result = compileLabCode(BLUEPRINT_TEMPLATE, [
      { position: "lens_type", overrideCode: "CUSTOM_TINT" },
      { tokenKey: "lens_type", tokenValue: "POLR" },
    ]);
    expect(result.code).toBe("PO-58-CUSTOM_TINT-NONE-00");
    expect(result.code).not.toContain("POLR");
    expect(result.warnings).toEqual([]);
  });

  it("override by segment index wins over token for that segment", () => {
    const result = compileLabCode(BLUEPRINT_TEMPLATE, [
      { position: 2, overrideCode: "SPECIAL_COLOR" },
      { tokenKey: "lens_color", tokenValue: "GREY" },
    ]);
    expect(result.code).toBe("PO-58-NONE-SPECIAL_COLOR-00");
    expect(result.code).not.toContain("GREY");
    expect(result.warnings).toEqual([]);
  });
});

describe("Step 3 — Identity property test for templates with no tokens", () => {
  it("a template with no tokens compiles to itself for any selections", () => {
    const staticTemplates = [
      "PO-58-NONE-NONE-00",
      "SV-SINGLE-VISION",
      "CUSTOM-LAB-CODE-12345",
      "PO-58",
      "PLAIN",
      "ALPHA-BETA-GAMMA-DELTA",
    ];

    const testSelectionSets = [
      undefined,
      [],
      [{ tokenKey: "lens_type", tokenValue: "POLR" }],
      [{ position: "material", overrideCode: "PO-67" }],
      [{ tokenKey: "lens_tint", tokenValue: "PHOT" }],
      [
        { tokenKey: "lens_type", tokenValue: "POLR" },
        { position: "material", overrideCode: "PO-67" },
      ],
      { lens_type: "POLR", lens_color: "GREY" },
      { tokens: { a: "1", b: "2" }, overrides: { material: "OVERRIDE" } },
    ];

    for (const tpl of staticTemplates) {
      for (const selections of testSelectionSets) {
        const result = compileLabCode(tpl, selections);
        expect(result.code).toBe(tpl);
      }
    }
  });

  it("property: 100 randomly generated static templates compile to themselves", () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
    function randomStaticString(len: number): string {
      let s = "";
      for (let i = 0; i < len; i++) {
        s += chars[Math.floor(Math.random() * chars.length)];
      }
      return s;
    }

    for (let i = 0; i < 100; i++) {
      const segCount = 1 + Math.floor(Math.random() * 5);
      const segments: string[] = [];
      for (let s = 0; s < segCount; s++) {
        segments.push(randomStaticString(3 + Math.floor(Math.random() * 6)));
      }
      const tpl = segments.join("-");

      // Random selections with tokens, overrides, and unknown keys
      const selections = [
        { tokenKey: `tok_${i}`, tokenValue: `VAL_${i}` },
        { position: "material", overrideCode: `MAT_${i}` },
      ];

      const result = compileLabCode(tpl, selections);
      expect(result.code).toBe(tpl);
    }
  });
});

describe("Parser checklist (§8) & Robustness", () => {
  it("accepts a Lens domain object as input", () => {
    const lens = createMockLens(BLUEPRINT_TEMPLATE);
    const result = compileLabCode(lens, [
      { tokenKey: "lens_type", tokenValue: "POLR" },
    ]);
    expect(result.code).toBe("PO-58-POLR-NONE-00");
  });

  it("handles empty string gracefully", () => {
    const result = compileLabCode("");
    expect(result.code).toBe("");
    expect(result.warnings).toEqual([]);
  });

  it("throws clear error on malformed template passed to compileLabCode", () => {
    expect(() => compileLabCode("PO-[lens_type=NONE")).toThrow(
      "Invalid lab code template: UNCLOSED_TOKEN",
    );
  });

  it("validateTemplate rejects unopened bracket ]", () => {
    const res = validateTemplate("PO-58]NONE");
    expect(res.valid).toBe(false);
    expect(res.errors[0]?.code).toBe("MALFORMED_TOKEN");
  });

  it("validateTemplate rejects nested brackets", () => {
    const res = validateTemplate("[a=[b=X]]");
    expect(res.valid).toBe(false);
    expect(res.errors[0]?.code).toBe("UNCLOSED_TOKEN");
  });

  it("validateTemplate rejects missing equals sign in token", () => {
    const res = validateTemplate("[lens_type]");
    expect(res.valid).toBe(false);
    expect(res.errors[0]?.code).toBe("MALFORMED_TOKEN");
  });

  it("validateTemplate rejects uppercase in token key", () => {
    const res = validateTemplate("[Lens_Type=NONE]");
    expect(res.valid).toBe(false);
    expect(res.errors[0]?.code).toBe("MALFORMED_TOKEN");
  });

  it("validateTemplate rejects lowercase in default value", () => {
    const res = validateTemplate("[lens_type=none]");
    expect(res.valid).toBe(false);
    expect(res.errors[0]?.code).toBe("MALFORMED_TOKEN");
  });

  it("validateTemplate allows empty default value [key=]", () => {
    const res = validateTemplate("PO-[lens_type=]-00");
    expect(res.valid).toBe(true);
    expect(res.tokens[0]?.defaultValue).toBe("");

    const compiled = compileLabCode("PO-[lens_type=]-00");
    expect(compiled.code).toBe("PO--00");
  });

  it("supports multiple option values including material override and tokens together", () => {
    const selections = [
      createMockOptionValue({ overrideCode: "PO-67" }),
      createMockOptionValue({ tokenKey: "lens_type", tokenValue: "POLR" }),
      createMockOptionValue({ tokenKey: "lens_color", tokenValue: "GREY" }),
    ];
    const result = compileLabCode(BLUEPRINT_TEMPLATE, selections);
    expect(result.code).toBe("PO-67-POLR-GREY-00");
    expect(result.warnings).toEqual([]);
  });

  it("reports multiple unknown tokens deduplicated in warnings", () => {
    const selections = [
      { tokenKey: "foo", tokenValue: "1" },
      { tokenKey: "bar", tokenValue: "2" },
      { tokenKey: "foo", tokenValue: "3" },
    ];
    const result = compileLabCode(BLUEPRINT_TEMPLATE, selections);
    expect(result.warnings).toEqual(["UNKNOWN_TOKEN foo", "UNKNOWN_TOKEN bar"]);
  });

  it("handles very long template and selections without crashing (10,000 chars)", () => {
    const longPrefix = "A".repeat(10000);
    const tpl = `${longPrefix}-[lens_type=NONE]-00`;
    const result = compileLabCode(tpl, [{ tokenKey: "lens_type", tokenValue: "POLR" }]);
    expect(result.code).toBe(`${longPrefix}-POLR-00`);
  });

  it("handles unicode and non-ASCII characters in literal parts safely", () => {
    const tpl = "透镜-58-[lens_type=NONE]-00";
    const result = compileLabCode(tpl, [{ tokenKey: "lens_type", tokenValue: "POLR" }]);
    expect(result.code).toBe("透镜-58-POLR-00");
  });
});
