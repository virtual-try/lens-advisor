import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogResponse, Lens, Prescription } from "../../../../rx-core/src/index.js";
import { formatDiopter } from "../../../../rx-core/src/index.js";
import type { ApiClient } from "../../shared/api.js";
import { createInitialState } from "../../shell/reducer.js";
import type { ConfiguratorState } from "../../shell/types.js";
import { formatLensReason, formatReasonDiopter } from "./format-reason.js";
import { isApplicable, isComplete, step } from "./index.js";
import { LensStep } from "./LensStep.js";
import { lensStrings } from "./strings.js";

const mockApi: ApiClient = {
  proxyBase: "/apps/lens-advisor",
  getCatalog: vi.fn(),
  submitPrescription: vi.fn(),
  getUploadUrl: vi.fn(),
  uploadFile: vi.fn(),
};

/**
 * Fixture lens L: SPH −800..+600, CYL −400..0, SV + PROGRESSIVE.
 * Stated in Spec 27 Examples.
 */
const fixtureLensL: Lens = {
  id: "lens-l",
  groupId: "group-clear",
  name: "Clear Everyday L",
  description: "Standard clear lens for everyday wear.",
  price: { amountMinor: 8000, currency: "USD" },
  limits: {
    sphMin: -800,
    sphMax: 600,
    cylMin: -400,
    cylMax: 0,
    rxTypes: ["SINGLE_VISION", "PROGRESSIVE"],
  },
  labCodeTemplate: "L-STD",
  shopifyVariantId: "var-l",
  position: 0,
};

const fixtureLensHighIndex: Lens = {
  id: "lens-hi",
  groupId: "group-clear",
  name: "High Index 1.67",
  description: "Ultra-thin lens for strong prescriptions.",
  price: { amountMinor: 14000, currency: "USD" },
  limits: {
    sphMin: -1200,
    sphMax: 800,
    cylMin: -400,
    cylMax: 0,
    rxTypes: ["SINGLE_VISION", "PROGRESSIVE"],
  },
  labCodeTemplate: "L-HI",
  shopifyVariantId: "var-hi",
  position: 1,
};

const fixtureCatalog: CatalogResponse = {
  lensGroups: [
    {
      id: "group-clear",
      name: "Clear",
      description: "Everyday lenses.",
      position: 0,
      lenses: [fixtureLensL, fixtureLensHighIndex],
    },
  ],
  optionGroups: [],
  addOns: [],
  settings: {
    manualRxEnabled: true,
    rxUploadEnabled: true,
    storeRxInOrder: false,
  },
};

function createTestState(overrides?: Partial<ConfiguratorState>): ConfiguratorState {
  return {
    ...createInitialState("frame-1"),
    catalog: fixtureCatalog,
    rxType: "SINGLE_VISION",
    lensGroupId: "group-clear",
    prescription: {
      od: { sph: -225 },
      os: { sph: -200 },
      pd: { single: 630 },
    },
    selection: {
      frameVariantId: "frame-1",
      rxType: "SINGLE_VISION",
      optionValueIds: [],
      addOnIds: [],
    },
    status: "ready",
    isOpen: true,
    ...overrides,
  };
}

describe("Step 4: Lens Selection with Rx Limits", () => {
  afterEach(() => {
    cleanup();
  });

  it("exports valid StepModule contract", () => {
    expect(step.id).toBe("lens");
    expect(step.titleKey).toBe("lens");
    expect(typeof step.isComplete).toBe("function");
    expect(typeof step.isApplicable).toBe("function");
    expect(step.Component).toBeDefined();
  });

  // Examples Row 1: SV, OD −2.25 | L enabled, selectable | normal
  it("Examples row 1: SV, OD −2.25 makes Lens L enabled and selectable", () => {
    const rx: Prescription = {
      od: { sph: -225 },
      os: { sph: -200 },
      pd: { single: 630 },
    };
    const state = createTestState({
      rxType: "SINGLE_VISION",
      prescription: rx,
    });
    const dispatch = vi.fn();

    const { container } = render(
      <LensStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const radioL = container.querySelector<HTMLInputElement>(
      'input[value="lens-l"]',
    );
    expect(radioL).not.toBeNull();
    expect(radioL?.disabled).toBe(false);
    expect(radioL?.getAttribute("aria-disabled")).toBeNull();

    // Selecting Lens L
    fireEvent.click(radioL!);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_LENS", lensId: "lens-l" });

    // With lens-l selected, isComplete is true
    const completedState = createTestState({
      rxType: "SINGLE_VISION",
      prescription: rx,
      selection: {
        ...state.selection,
        lensId: "lens-l",
      },
    });
    expect(isComplete(completedState)).toBe(true);
  });

  // Examples Row 2: SV, OD −8.25 | L disabled, reason mentions "−8.25" and "−8.00" | limit
  it("Examples row 2: SV, OD −8.25 makes L disabled and reason mentions '−8.25' and '−8.00'", () => {
    const rx: Prescription = {
      od: { sph: -825 },
      os: { sph: -200 },
      pd: { single: 630 },
    };
    const state = createTestState({
      rxType: "SINGLE_VISION",
      prescription: rx,
    });
    const dispatch = vi.fn();

    const { container } = render(
      <LensStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const radioL = container.querySelector<HTMLInputElement>(
      'input[value="lens-l"]',
    );
    expect(radioL).not.toBeNull();
    // R1-F3: Native disabled is dropped so keyboard/screen reader focus mode can reach the input
    expect(radioL?.disabled).toBe(false);
    expect(radioL?.getAttribute("aria-disabled")).toBe("true");

    // Reason line is rendered, hidden from label text (browse mode), and linked via aria-describedby for focus mode
    const describedBy = radioL?.getAttribute("aria-describedby");
    expect(describedBy).toBe("la-reason-lens-l");

    const reasonEl = container.querySelector(`#${describedBy}`);
    expect(reasonEl).not.toBeNull();
    expect(reasonEl?.getAttribute("aria-hidden")).toBe("true");
    const reasonText = reasonEl?.textContent ?? "";

    // Self-check 2: Reason text mentions "−8.25" and "−8.00" using typographic minus
    expect(reasonText).toContain("−8.25");
    expect(reasonText).toContain("−8.00");
    expect(reasonText).toBe(
      "Not available for your prescription — SPH −8.25 is beyond −8.00",
    );

    // Clicking or pressing space on unavailable lens ignores selection (R1-F3)
    fireEvent.click(radioL!);
    expect(dispatch).not.toHaveBeenCalled();

    // High index lens (-12.00 limit) is available and enabled
    const radioHi = container.querySelector<HTMLInputElement>(
      'input[value="lens-hi"]',
    );
    expect(radioHi?.disabled).toBe(false);
    expect(radioHi?.getAttribute("aria-disabled")).toBeNull();
  });

  // Examples Row 3: SV, OD +5.00/+1.50×90 | L disabled (after transposition +6.50) | plus-cyl
  it("Examples row 3: SV, OD +5.00/+1.50×90 makes L disabled after transposition (+6.50)", () => {
    // SPH +5.00 (+500), CYL +1.50 (+150) x 90
    // Transposed: SPH' = +6.50 (+650), CYL' = -1.50 (-150) x 180
    // Lens L limit sphMax is +600 (+6.00). SPH +650 exceeds +600.
    const rx: Prescription = {
      od: { sph: 500, cyl: 150, axis: 90 },
      os: { sph: 200 },
      pd: { single: 630 },
    };
    const state = createTestState({
      rxType: "SINGLE_VISION",
      prescription: rx,
    });
    const dispatch = vi.fn();

    const { container } = render(
      <LensStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const radioL = container.querySelector<HTMLInputElement>(
      'input[value="lens-l"]',
    );
    // R1-F3: Native disabled dropped, aria-disabled="true" set
    expect(radioL?.disabled).toBe(false);
    expect(radioL?.getAttribute("aria-disabled")).toBe("true");

    const reasonEl = container.querySelector("#la-reason-lens-l");
    expect(reasonEl).not.toBeNull();
    expect(reasonEl?.getAttribute("aria-hidden")).toBe("true");
    const reasonText = reasonEl?.textContent ?? "";

    // Reason mentions +6.50 and +6.00
    expect(reasonText).toContain("+6.50");
    expect(reasonText).toContain("+6.00");
    expect(reasonText).toBe(
      "Not available for your prescription — SPH +6.50 is beyond +6.00",
    );
  });

  it("formats zero limit as '0.00' instead of 'PL' in rendered reason text (R2-F1)", () => {
    const zeroLimitLens: Lens = {
      ...fixtureLensL,
      id: "lens-zero-limit",
      limits: {
        ...fixtureLensL.limits,
        sphMax: 0,
      },
    };
    const zeroLimitCatalog: CatalogResponse = {
      ...fixtureCatalog,
      lensGroups: [
        {
          ...fixtureCatalog.lensGroups[0],
          lenses: [zeroLimitLens],
        },
      ],
    };
    const rx: Prescription = {
      od: { sph: 100 },
      os: { sph: 50 },
      pd: { single: 630 },
    };
    const state = createTestState({
      catalog: zeroLimitCatalog,
      rxType: "SINGLE_VISION",
      prescription: rx,
    });
    const dispatch = vi.fn();

    const { container } = render(
      <LensStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const reasonEl = container.querySelector("#la-reason-lens-zero-limit");
    expect(reasonEl).not.toBeNull();
    expect(reasonEl?.textContent).toBe(
      "Not available for your prescription — SPH +1.00 is beyond 0.00",
    );
  });

  // Ordering check: available listed first, then unavailable, each keeping catalog order
  it("lists available lenses first, then unavailable, each keeping catalog order", () => {
    // With OD -825:
    // Catalog order in group-clear is: [lens-l, lens-hi]
    // lens-l is unavailable (SPH -825 beyond -800)
    // lens-hi is available (SPH -825 within -1200)
    // Ordered display MUST list available first: [lens-hi, lens-l]
    const state = createTestState({
      prescription: {
        od: { sph: -825 },
        os: { sph: -200 },
        pd: { single: 630 },
      },
    });
    const dispatch = vi.fn();

    const { container } = render(
      <LensStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[name="lens"]'),
    );
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe("lens-hi"); // available first
    expect(inputs[1].value).toBe("lens-l"); // unavailable second
  });

  // Examples Row 5: all lenses unavailable | message + "Change prescription" returns to step 2 | dead end
  it("Examples row 5: all lenses unavailable shows explanation and 'Change prescription' returns to step 2", () => {
    // Both lenses have limits: lens-l min -800, lens-hi min -1200
    // SPH -14.00 (-1400) makes ALL lenses in this group unavailable!
    const state = createTestState({
      prescription: {
        od: { sph: -1400 },
        os: { sph: -1400 },
        pd: { single: 630 },
      },
    });
    const dispatch = vi.fn();

    render(<LensStep state={state} dispatch={dispatch} api={mockApi} />);

    // Explanation message is displayed
    expect(screen.getByText(lensStrings.allUnavailableExplanation)).toBeTruthy();

    // "Change prescription" button is rendered
    const changeRxBtn = screen.getByText(lensStrings.changePrescription);
    expect(changeRxBtn).toBeTruthy();

    // Clicking "Change prescription" dispatches GO_TO_STEP with stepId: "prescription" (R1-F7)
    fireEvent.click(changeRxBtn);
    expect(dispatch).toHaveBeenCalledWith({
      type: "GO_TO_STEP",
      stepId: "prescription",
    });

    // Step 4 isComplete is false
    expect(isComplete(state)).toBe(false);
  });

  // Examples Row 6: keyboard: arrow keys in the radio group | skip disabled lenses | a11y
  it("Examples row 6: keyboard arrow keys in the radio group skip disabled lenses and move focus (R1-F4, R1-F10)", () => {
    // Add a third lens that is available, so we have:
    // 1. lens-l (disabled, OD -825)
    // 2. lens-hi (available)
    // 3. lens-extra (available)
    const fixtureLensExtra: Lens = {
      id: "lens-extra",
      groupId: "group-clear",
      name: "High Index 1.74",
      description: "Thinnest lens.",
      price: { amountMinor: 18000, currency: "USD" },
      limits: {
        sphMin: -1400,
        sphMax: 1000,
        cylMin: -400,
        cylMax: 0,
        rxTypes: ["SINGLE_VISION", "PROGRESSIVE"],
      },
      labCodeTemplate: "L-174",
      shopifyVariantId: "var-174",
      position: 2,
    };

    const threeLensCatalog: CatalogResponse = {
      ...fixtureCatalog,
      lensGroups: [
        {
          id: "group-clear",
          name: "Clear",
          description: "Everyday lenses.",
          position: 0,
          lenses: [fixtureLensL, fixtureLensHighIndex, fixtureLensExtra],
        },
      ],
    };

    const state = createTestState({
      catalog: threeLensCatalog,
      prescription: {
        od: { sph: -825 },
        os: { sph: -200 },
        pd: { single: 630 },
      },
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        lensId: "lens-hi", // Start on first available lens
        optionValueIds: [],
        addOnIds: [],
      },
    });
    const dispatch = vi.fn();

    const { container } = render(
      <LensStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const radioHi = container.querySelector<HTMLInputElement>(
      'input[value="lens-hi"]',
    );
    const radioExtra = container.querySelector<HTMLInputElement>(
      'input[value="lens-extra"]',
    );
    const radioL = container.querySelector<HTMLInputElement>(
      'input[value="lens-l"]',
    );

    expect(radioHi).not.toBeNull();
    expect(radioExtra).not.toBeNull();
    expect(radioL).not.toBeNull();

    // Focus on initial selected radio
    radioHi!.focus();
    expect(document.activeElement).toBe(radioHi);

    // ArrowDown advances from lens-hi directly to lens-extra, and moves focus
    fireEvent.keyDown(radioHi!, { key: "ArrowDown" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_LENS",
      lensId: "lens-extra",
    });
    expect(document.activeElement).toBe(radioExtra);

    // ArrowDown on lens-extra skips unavailable lens-l at end, wraps back to lens-hi, and focuses it
    dispatch.mockClear();
    fireEvent.keyDown(radioExtra!, { key: "ArrowDown" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_LENS",
      lensId: "lens-hi",
    });
    expect(document.activeElement).toBe(radioHi);

    // ArrowUp on lens-hi skips unavailable lens-l backwards, wraps to lens-extra, and focuses it
    dispatch.mockClear();
    fireEvent.keyDown(radioHi!, { key: "ArrowUp" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_LENS",
      lensId: "lens-extra",
    });
    expect(document.activeElement).toBe(radioExtra);
  });

  // Invariant INV-5: reason values come from integers through formatDiopter
  describe("Invariant INV-5: diopter values formatting", () => {
    it("formats integer hundredths through formatDiopter without float math", () => {
      expect(formatReasonDiopter(-825)).toBe("−8.25");
      expect(formatReasonDiopter(-800)).toBe("−8.00");
      expect(formatReasonDiopter(650)).toBe("+6.50");
      expect(formatReasonDiopter(600)).toBe("+6.00");
      // Zero limit edge case (R2-F1): limit of 0 formats as "0.00", not "PL"
      const zeroLimitReason = formatLensReason({
        code: "SPH_ABOVE_MAX",
        field: "sph",
        eye: "OD",
        value: 100,
        limit: 0,
      });
      expect(zeroLimitReason).toBe(
        "Not available for your prescription — SPH +1.00 is beyond 0.00",
      );
      expect(formatReasonDiopter(0)).toBe("0.00");
      expect(formatDiopter(-825)).toBe("-8.25");
    });

    it("formats every LimitExceededReason code through formatLensReason", () => {
      // SPH_BELOW_MIN
      const sphBelow = formatLensReason({
        code: "SPH_BELOW_MIN",
        field: "sph",
        eye: "OD",
        value: -825,
        limit: -800,
      });
      expect(sphBelow).toBe(
        "Not available for your prescription — SPH −8.25 is beyond −8.00",
      );

      // SPH_ABOVE_MAX
      const sphAbove = formatLensReason({
        code: "SPH_ABOVE_MAX",
        field: "sph",
        eye: "OD",
        value: 650,
        limit: 600,
      });
      expect(sphAbove).toBe(
        "Not available for your prescription — SPH +6.50 is beyond +6.00",
      );

      // CYL_OUT_OF_RANGE
      const cylOut = formatLensReason({
        code: "CYL_OUT_OF_RANGE",
        field: "cyl",
        eye: "OD",
        value: -425,
        limit: -400,
      });
      expect(cylOut).toBe(
        "Not available for your prescription — CYL −4.25 is beyond −4.00",
      );

      // ADD_OUT_OF_RANGE
      const addOut = formatLensReason({
        code: "ADD_OUT_OF_RANGE",
        field: "add",
        eye: "OD",
        value: 375,
        limit: 350,
      });
      expect(addOut).toBe(
        "Not available for your prescription — ADD +3.75 is beyond +3.50",
      );

      // RX_TYPE_NOT_SUPPORTED
      const rxTypeNotSupported = formatLensReason({
        code: "RX_TYPE_NOT_SUPPORTED",
        field: "rxType",
        value: "READING",
        limit: ["SINGLE_VISION"],
      });
      expect(rxTypeNotSupported).toBe("Not available for your prescription type");
    });
  });

  it("isComplete returns false if selected lens is unavailable for prescription", () => {
    const state = createTestState({
      prescription: {
        od: { sph: -825 }, // L is unavailable
        os: { sph: -200 },
        pd: { single: 630 },
      },
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        lensId: "lens-l", // unavailable lens!
        optionValueIds: [],
        addOnIds: [],
      },
    });
    // Since lens-l is not available for OD -8.25, isComplete must be false
    expect(isComplete(state)).toBe(false);
  });

  it("isApplicable returns true when catalog has matching lens groups", () => {
    const state = createTestState();
    expect(isApplicable(state)).toBe(true);
  });

  it("renders noGroupSelected message when no group is chosen (R1-F8, R1-F10)", () => {
    const state = createTestState({
      lensGroupId: null,
    });
    const { container } = render(
      <LensStep state={state} dispatch={vi.fn()} api={mockApi} />,
    );
    expect(screen.getByText(lensStrings.noGroupSelected)).toBeTruthy();
    // Must NOT silently render lenses from catalog.lensGroups[0]
    expect(container.querySelector('input[name="lens"]')).toBeNull();
  });

  it("renders gracefully when catalog is null (R1-F10)", () => {
    const state = createTestState({
      catalog: null,
      lensGroupId: null,
    });
    const { container } = render(
      <LensStep state={state} dispatch={vi.fn()} api={mockApi} />,
    );
    expect(screen.getByText(lensStrings.noGroupSelected)).toBeTruthy();
    expect(container.querySelector('input[name="lens"]')).toBeNull();
  });

  describe("Invariants: Step 4", () => {
    it("INV-7: contains no raw hex, rgb, px, or ms outside tokens.css", () => {
      const dir = path.resolve(__dirname);
      const rawValueRegex = /#[0-9a-fA-F]{3,8}\b|rgb\(|[0-9]+px|[0-9]+ms/;
      const offenders: string[] = [];

      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith(".test.tsx") || file.endsWith(".test.ts") || file === "tokens.css") {
          continue;
        }
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath, "utf8");
          const lines = content.split(/\r?\n/);
          lines.forEach((line: string, idx: number) => {
            if (rawValueRegex.test(line)) {
              offenders.push(`${file}:${idx + 1}: ${line.trim()}`);
            }
          });
        }
      }
      expect(offenders).toEqual([]);
    });

    it("INV-9: contains no inline JSX text literals outside strings files", () => {
      const dir = path.resolve(__dirname);
      const offenders: Array<{ file: string; line: number; text: string }> = [];

      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".tsx") || file.endsWith(".test.tsx")) {
          continue;
        }
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, "utf8");
        const sourceFile = ts.createSourceFile(
          file,
          content,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );

        const visit = (node: ts.Node) => {
          if (ts.isJsxText(node)) {
            const text = node.getText(sourceFile).trim();
            if (text.length > 0) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
              offenders.push({ file, line: line + 1, text });
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
      }
      expect(offenders).toEqual([]);
    });
  });
});
