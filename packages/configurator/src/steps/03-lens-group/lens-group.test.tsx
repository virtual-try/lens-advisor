import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogResponse, Lens } from "../../../../rx-core/src/index.js";
import type { ApiClient } from "../../shared/api.js";
import { createInitialState } from "../../shell/reducer.js";
import type { ConfiguratorState } from "../../shell/types.js";
import { isApplicable, isComplete, step } from "./index.js";
import { LensGroupStep } from "./LensGroupStep.js";
import { lensGroupStrings } from "./strings.js";

const mockApi: ApiClient = {
  proxyBase: "/apps/lens-advisor",
  getCatalog: vi.fn(),
  submitPrescription: vi.fn(),
  getUploadUrl: vi.fn(),
  uploadFile: vi.fn(),
};

const fixtureLensL: Lens = {
  id: "lens-l",
  groupId: "group-clear",
  name: "Clear Everyday L",
  description: "Standard clear lenses.",
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

const fixtureLensPro: Lens = {
  id: "lens-pro",
  groupId: "group-clear",
  name: "Clear Digital Pro",
  description: "Widest zones.",
  price: { amountMinor: 12000, currency: "USD" },
  limits: {
    sphMin: -800,
    sphMax: 600,
    cylMin: -400,
    cylMax: 0,
    rxTypes: ["SINGLE_VISION", "PROGRESSIVE"],
  },
  labCodeTemplate: "L-PRO",
  shopifyVariantId: "var-pro",
  position: 1,
};

const fixtureLensSun: Lens = {
  id: "lens-sun",
  groupId: "group-sun",
  name: "Sun Tinted",
  description: "Outdoors.",
  price: { amountMinor: 9500, currency: "USD" },
  limits: {
    sphMin: -600,
    sphMax: 400,
    cylMin: -200,
    cylMax: 0,
    rxTypes: ["SINGLE_VISION"],
  },
  labCodeTemplate: "SUN-1",
  shopifyVariantId: "var-sun",
  position: 0,
};

const fixtureCatalog: CatalogResponse = {
  lensGroups: [
    {
      id: "group-clear",
      name: "Clear",
      description: "Everyday lenses. You can add a tint in the next step.",
      position: 0,
      lenses: [fixtureLensL, fixtureLensPro],
    },
    {
      id: "group-sun",
      name: "Sun",
      description: "Fixed tint for outdoors.",
      position: 1,
      lenses: [fixtureLensSun],
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

describe("Step 3: Lens Group Selection", () => {
  afterEach(() => {
    cleanup();
  });

  it("exports valid StepModule contract", () => {
    expect(step.id).toBe("lens-group");
    expect(step.titleKey).toBe("lens_group");
    expect(typeof step.isComplete).toBe("function");
    expect(typeof step.isApplicable).toBe("function");
    expect(step.Component).toBeDefined();
  });

  it("renders lens group cards with name, description, and 'from' price", () => {
    const state = createTestState();
    const dispatch = vi.fn();

    render(<LensGroupStep state={state} dispatch={dispatch} api={mockApi} />);

    expect(screen.getByText("Clear")).toBeTruthy();
    expect(
      screen.getByText("Everyday lenses. You can add a tint in the next step."),
    ).toBeTruthy();
    // 'from' price should be the lowest price among group's lenses: $80.00 (8000 minor units)
    expect(screen.getByText(lensGroupStrings.fromPrice("$80.00"))).toBeTruthy();

    expect(screen.getByText("Sun")).toBeTruthy();
    expect(screen.getByText(lensGroupStrings.fromPrice("$95.00"))).toBeTruthy();
  });

  it("Examples row 4: READING hides group when all its lenses do not support the Rx type", () => {
    // Lens L and Lens Pro support only SV + PROGRESSIVE. Lens Sun supports only SV.
    // For rxType READING, zero lenses in either group support READING.
    const state = createTestState({
      rxType: "READING",
      selection: {
        frameVariantId: "frame-1",
        rxType: "READING",
        optionValueIds: [],
        addOnIds: [],
      },
    });
    const dispatch = vi.fn();

    render(<LensGroupStep state={state} dispatch={dispatch} api={mockApi} />);

    // Both groups have 0 lenses for READING, so both are hidden
    expect(screen.queryByText("Clear")).toBeNull();
    expect(screen.queryByText("Sun")).toBeNull();
    expect(screen.getByText(lensGroupStrings.noGroupsAvailable)).toBeTruthy();

    // isApplicable should also return false
    expect(isApplicable(state)).toBe(false);
  });

  it("hides groups with 0 lenses for rxType but shows groups that have matching lenses", () => {
    // PROGRESSIVE: Clear has 2 lenses (L and Pro), Sun has 0 lenses.
    const state = createTestState({
      rxType: "PROGRESSIVE",
      selection: {
        frameVariantId: "frame-1",
        rxType: "PROGRESSIVE",
        optionValueIds: [],
        addOnIds: [],
      },
    });
    const dispatch = vi.fn();

    render(<LensGroupStep state={state} dispatch={dispatch} api={mockApi} />);

    expect(screen.getByText("Clear")).toBeTruthy();
    expect(screen.queryByText("Sun")).toBeNull();
  });

  it("selecting a group marks step as complete", () => {
    const state = createTestState();
    const dispatch = vi.fn();

    expect(isComplete(state)).toBe(false);

    const { container } = render(
      <LensGroupStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const clearRadio = container.querySelector<HTMLInputElement>(
      'input[value="group-clear"]',
    );
    expect(clearRadio).not.toBeNull();
    fireEvent.click(clearRadio!);

    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_LENS_GROUP",
      lensGroupId: "group-clear",
    });

    const completedState = { ...state, lensGroupId: "group-clear" };
    expect(isComplete(completedState)).toBe(true);
  });

  it("selecting a group dispatches SET_LENS_GROUP", () => {
    const state = createTestState({
      lensGroupId: "group-clear",
    });
    const dispatch = vi.fn();

    const { container } = render(
      <LensGroupStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const sunRadio = container.querySelector<HTMLInputElement>(
      'input[value="group-sun"]',
    );
    expect(sunRadio).not.toBeNull();
    fireEvent.click(sunRadio!);

    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_LENS_GROUP",
      lensGroupId: "group-sun",
    });
  });

  it("keyboard: arrow keys navigate between visible groups and move focus (R1-F4)", () => {
    const state = createTestState({
      lensGroupId: "group-clear",
    });
    const dispatch = vi.fn();

    const { container } = render(
      <LensGroupStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const clearRadio = container.querySelector<HTMLInputElement>(
      'input[value="group-clear"]',
    );
    const sunRadio = container.querySelector<HTMLInputElement>(
      'input[value="group-sun"]',
    );
    expect(clearRadio).not.toBeNull();
    expect(sunRadio).not.toBeNull();

    clearRadio!.focus();
    expect(document.activeElement).toBe(clearRadio);

    // ArrowDown advances to next group and focuses it
    fireEvent.keyDown(clearRadio!, { key: "ArrowDown" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_LENS_GROUP",
      lensGroupId: "group-sun",
    });
    expect(document.activeElement).toBe(sunRadio);

    // ArrowUp goes back to previous group and focuses it
    dispatch.mockClear();
    fireEvent.keyDown(sunRadio!, { key: "ArrowUp" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_LENS_GROUP",
      lensGroupId: "group-clear",
    });
    expect(document.activeElement).toBe(clearRadio);
  });

  it("Examples row 4: mixed group derives 'from' price and visibility only from lenses matching rxType (R1-F10)", () => {
    const mixedCatalog: CatalogResponse = {
      lensGroups: [
        {
          id: "group-mixed",
          name: "Mixed Group",
          description: "Mixed lenses.",
          position: 0,
          lenses: [
            {
              id: "lens-reading-cheap",
              groupId: "group-mixed",
              name: "Reading Only",
              description: "Cheap reading.",
              price: { amountMinor: 2500, currency: "USD" }, // $25.00
              limits: {
                sphMin: -400,
                sphMax: 400,
                cylMin: -200,
                cylMax: 0,
                rxTypes: ["READING"], // NOT single vision
              },
              labCodeTemplate: "RD",
              shopifyVariantId: "v-rd",
              position: 0,
            },
            {
              id: "lens-sv-normal",
              groupId: "group-mixed",
              name: "SV Normal",
              description: "Normal SV.",
              price: { amountMinor: 7500, currency: "USD" }, // $75.00
              limits: {
                sphMin: -600,
                sphMax: 400,
                cylMin: -200,
                cylMax: 0,
                rxTypes: ["SINGLE_VISION"],
              },
              labCodeTemplate: "SV",
              shopifyVariantId: "v-sv",
              position: 1,
            },
            {
              id: "lens-sv-premium",
              groupId: "group-mixed",
              name: "SV Premium",
              description: "Premium SV.",
              price: { amountMinor: 11000, currency: "USD" }, // $110.00
              limits: {
                sphMin: -800,
                sphMax: 600,
                cylMin: -400,
                cylMax: 0,
                rxTypes: ["SINGLE_VISION"],
              },
              labCodeTemplate: "SVP",
              shopifyVariantId: "v-svp",
              position: 2,
            },
          ],
        },
      ],
      optionGroups: [],
      addOns: [],
      settings: { manualRxEnabled: true, rxUploadEnabled: true, storeRxInOrder: false },
    };

    const state = createTestState({
      catalog: mixedCatalog,
      rxType: "SINGLE_VISION",
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        optionValueIds: [],
        addOnIds: [],
      },
    });

    render(<LensGroupStep state={state} dispatch={vi.fn()} api={mockApi} />);

    // Group is visible because it has lenses matching SINGLE_VISION
    expect(screen.getByText("Mixed Group")).toBeTruthy();
    // 'from' price MUST be $75.00 (from SV Normal), NOT $25.00 (which is READING only)
    expect(screen.getByText(lensGroupStrings.fromPrice("$75.00"))).toBeTruthy();
    expect(screen.queryByText(lensGroupStrings.fromPrice("$25.00"))).toBeNull();
  });

  it("renders empty state gracefully when catalog is null (R1-F10)", () => {
    const state = createTestState({ catalog: null });
    render(<LensGroupStep state={state} dispatch={vi.fn()} api={mockApi} />);
    expect(screen.getByText(lensGroupStrings.noGroupsAvailable)).toBeTruthy();
  });

  it("isApplicable returns false when catalog has no groups or empty lenses", () => {
    const emptyState = createTestState({
      catalog: {
        ...fixtureCatalog,
        lensGroups: [],
      },
    });
    expect(isApplicable(emptyState)).toBe(false);

    const nullCatalogState = createTestState({ catalog: null });
    expect(isApplicable(nullCatalogState)).toBe(false);
  });

  describe("Invariants: Step 3", () => {
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
