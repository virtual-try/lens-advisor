import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/preact";
import type { CatalogResponse } from "../../../../rx-core/src/index.js";
import { priceSelection } from "../../../../rx-core/src/pricing/index.js";
import { createApiClient } from "../../shared/api";
import { configuratorReducer, createInitialState } from "../../shell/reducer";
import type { ConfiguratorState } from "../../shell/types";
import {
  addOnsStep,
  AddOnsStep,
  isAddOnsStepApplicable,
  isAddOnsStepComplete,
} from "./index";
import { strings } from "./strings";

function createFixtureCatalog(): CatalogResponse {
  return {
    lensGroups: [
      {
        id: "group-standard",
        name: "Standard",
        position: 0,
        lenses: [
          {
            id: "lens-standard",
            groupId: "group-standard",
            name: "Standard 1.50",
            price: { amountMinor: 8000, currency: "USD" },
            limits: {
              sphMin: -600,
              sphMax: 400,
              cylMin: -200,
              cylMax: 0,
              rxTypes: ["SINGLE_VISION"],
            },
            labCodeTemplate: "STD",
            shopifyVariantId: "var-1",
            position: 0,
          },
        ],
      },
    ],
    optionGroups: [],
    addOns: [
      {
        id: "addon-ar",
        name: "Anti-reflective coating",
        price: { amountMinor: 3500, currency: "USD" },
        shopifyVariantId: "var-ar",
        position: 0,
      },
      {
        id: "addon-case",
        name: "Hard case",
        price: { amountMinor: 1500, currency: "USD" },
        shopifyVariantId: "var-case",
        position: 1,
      },
      {
        id: "addon-pouch",
        name: "Microfiber pouch",
        price: { amountMinor: 0, currency: "USD" },
        shopifyVariantId: "var-pouch",
        position: 2,
      },
    ],
    settings: {
      manualRxEnabled: true,
      rxUploadEnabled: false,
      storeRxInOrder: false,
    },
  };
}

describe("AddOnsStep (Step 6)", () => {
  it("Self-check 1: no add-on is ever checked on first render (dark-pattern guard)", () => {
    const catalog = createFixtureCatalog();
    const state: ConfiguratorState = {
      ...createInitialState("frame-1"),
      catalog,
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        optionValueIds: [],
        addOnIds: [],
      },
    };

    const dispatch = vi.fn();
    const api = createApiClient();
    const view = render(<AddOnsStep state={state} dispatch={dispatch} api={api} />);

    // Assert every checkbox in the step is unchecked
    const checkboxes = view.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.length).toBe(3);
    for (const checkbox of checkboxes) {
      expect(checkbox.checked).toBe(false);
    }
  });

  it("Row 3: tick then untick case (+$15) -> total returns to previous value (toggle)", () => {
    const catalog = createFixtureCatalog();
    const framePrice = { amountMinor: 12000, currency: "USD" };

    // Initial state: frame $120, lens $80, no add-ons -> total $200
    let state: ConfiguratorState = {
      ...createInitialState("frame-1"),
      catalog,
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        lensId: "lens-standard",
        optionValueIds: [],
        addOnIds: [],
      },
    };

    const initialBreakdown = priceSelection(state.selection, catalog, framePrice);
    expect(initialBreakdown.total.amountMinor).toBe(20000); // $200.00

    const dispatch = (action: Parameters<typeof configuratorReducer>[1]) => {
      state = configuratorReducer(state, action);
    };

    const api = createApiClient();
    const { rerender, container } = render(
      <AddOnsStep state={state} dispatch={dispatch} api={api} />,
    );

    // 1. Tick the hard case (+$15.00)
    const caseCheckbox = container.querySelector<HTMLInputElement>(
      'input[value="addon-case"]',
    );
    expect(caseCheckbox).not.toBeNull();
    if (caseCheckbox) {
      fireEvent.change(caseCheckbox);
    }

    // State now has addon-case
    expect(state.selection.addOnIds).toEqual(["addon-case"]);
    const tickedBreakdown = priceSelection(state.selection, catalog, framePrice);
    expect(tickedBreakdown.total.amountMinor).toBe(21500); // $215.00

    // Rerender with updated state
    rerender(<AddOnsStep state={state} dispatch={dispatch} api={api} />);
    const caseCheckboxAfterTick = container.querySelector<HTMLInputElement>(
      'input[value="addon-case"]',
    );
    expect(caseCheckboxAfterTick?.checked).toBe(true);

    // 2. Untick the hard case
    if (caseCheckboxAfterTick) {
      fireEvent.change(caseCheckboxAfterTick);
    }

    // State addOnIds is back to empty
    expect(state.selection.addOnIds).toEqual([]);
    const untickedBreakdown = priceSelection(state.selection, catalog, framePrice);
    expect(untickedBreakdown.total.amountMinor).toBe(20000); // Total returned to previous value!
  });

  it("is an optional step (always complete)", () => {
    const emptyState = createInitialState("frame-1");
    expect(isAddOnsStepComplete(emptyState)).toBe(true);

    const populatedState: ConfiguratorState = {
      ...emptyState,
      catalog: createFixtureCatalog(),
      selection: {
        ...emptyState.selection,
        addOnIds: ["addon-case"],
      },
    };
    expect(isAddOnsStepComplete(populatedState)).toBe(true);
  });

  it("formats zero-price add-on as 'Included' and priced add-ons with '+${price}'", () => {
    const catalog = createFixtureCatalog();
    const state: ConfiguratorState = {
      ...createInitialState("frame-1"),
      catalog,
    };

    const dispatch = vi.fn();
    const api = createApiClient();
    const view = render(<AddOnsStep state={state} dispatch={dispatch} api={api} />);

    expect(view.getByText(strings.included)).not.toBeNull();
    expect(view.getByText("+$35.00")).not.toBeNull();
    expect(view.getByText("+$15.00")).not.toBeNull();
  });

  it("satisfies step contract exports and applicability", () => {
    expect(addOnsStep.id).toBe("add-ons");
    expect(addOnsStep.titleKey).toBe(strings.title);
    expect(addOnsStep.Summary).toBeDefined();

    const emptyState = createInitialState("frame-1");
    expect(isAddOnsStepApplicable(emptyState)).toBe(true);

    const noAddOnsCatalog: CatalogResponse = {
      ...createFixtureCatalog(),
      addOns: [],
    };
    const noAddOnsState = { ...emptyState, catalog: noAddOnsCatalog };
    expect(isAddOnsStepApplicable(noAddOnsState)).toBe(false);
  });
});
