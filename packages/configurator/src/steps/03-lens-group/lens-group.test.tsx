import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogResponse, Lens } from "../../../../rx-core/src/index.js";
import type { ApiClient } from "../../shared/api.js";
import { createInitialState } from "../../shell/reducer.js";
import type { ConfiguratorState } from "../../shell/types.js";
import { isApplicable, isComplete, step } from "./index.js";
import { LensGroupStep } from "./LensGroupStep.js";
import { clearSelectedLensGroupId, getSelectedLensGroupId, setSelectedLensGroupId } from "./store.js";
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
  beforeEach(() => {
    clearSelectedLensGroupId();
  });

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

    expect(getSelectedLensGroupId(state)).toBe("group-clear");
    expect(isComplete(state)).toBe(true);
  });

  it("selecting a new group clears selection.lensId if it belonged to the old group", () => {
    const state = createTestState({
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        lensId: "lens-l", // belongs to group-clear
        optionValueIds: [],
        addOnIds: [],
      },
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

    // Should dispatch SET_LENS with empty string to clear previous lens
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_LENS", lensId: "" });
    expect(getSelectedLensGroupId()).toBe("group-sun");
  });

  it("keyboard: arrow keys navigate between visible groups", () => {
    const state = createTestState();
    const dispatch = vi.fn();

    // Select first group before render
    setSelectedLensGroupId("group-clear");

    const { container } = render(
      <LensGroupStep state={state} dispatch={dispatch} api={mockApi} />,
    );

    const radiogroup = container.querySelector('[role="radiogroup"]');
    expect(radiogroup).not.toBeNull();

    // ArrowDown advances to next group
    fireEvent.keyDown(radiogroup!, { key: "ArrowDown" });
    expect(getSelectedLensGroupId()).toBe("group-sun");

    // ArrowDown wraps back to first group
    fireEvent.keyDown(radiogroup!, { key: "ArrowDown" });
    expect(getSelectedLensGroupId()).toBe("group-clear");

    // ArrowUp goes to previous group (wraps to last)
    fireEvent.keyDown(radiogroup!, { key: "ArrowUp" });
    expect(getSelectedLensGroupId()).toBe("group-sun");
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
    it("INV-7: contains no raw hex, rgb, px, or ms outside tokens.css", async () => {
      const { execSync } = await import("node:child_process");
      const cmd =
        "rg -n '#[0-9a-fA-F]{3,8}\\b|rgb\\(|[0-9]+px|[0-9]+ms' packages/configurator/src/steps/03-lens-group --glob '!tokens.css'";
      let out = "";
      try {
        out = execSync(cmd, { encoding: "utf8" });
      } catch {
        out = "";
      }
      expect(out.trim()).toBe("");
    });

    it("INV-9: contains no inline JSX text literals outside strings files", async () => {
      const { execSync } = await import("node:child_process");
      const cmd =
        "rg '>[A-Za-z]' packages/configurator/src/steps/03-lens-group --glob '*.tsx'";
      let out = "";
      try {
        out = execSync(cmd, { encoding: "utf8" });
      } catch {
        out = "";
      }
      expect(out.trim()).toBe("");
    });
  });
});
