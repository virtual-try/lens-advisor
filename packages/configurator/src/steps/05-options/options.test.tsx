import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/preact";
import { useReducer } from "preact/hooks";
import type { CatalogResponse } from "../../../../rx-core/src/index.js";
import { createApiClient, type ApiClient } from "../../shared/api";
import { ConfiguratorApp } from "../../shell/ConfiguratorApp";
import { configuratorReducer, createInitialState } from "../../shell/reducer";
import type { ConfiguratorAction, ConfiguratorState, StepDefinition } from "../../shell/types";
import {
  isOptionsStepApplicable,
  isOptionsStepComplete,
  optionsStep,
  OptionsStep,
} from "./index";
import { strings } from "./strings";

const SWATCH_GREY = "grey";
const SWATCH_BROWN = "brown";

function createFixtureCatalog(): CatalogResponse {
  return {
    lensGroups: [],
    optionGroups: [
      {
        id: "opt-material",
        kind: "MATERIAL",
        name: "Lens thickness",
        position: 0,
        values: [
          {
            id: "val-150",
            optionGroupId: "opt-material",
            label: "1.50 Standard",
            priceDelta: { amountMinor: 0, currency: "USD" },
            position: 0,
          },
          {
            id: "val-160",
            optionGroupId: "opt-material",
            label: "1.60 Thin",
            priceDelta: { amountMinor: 4000, currency: "USD" },
            position: 1,
          },
        ],
      },
      {
        id: "opt-tint",
        kind: "TINT_TYPE",
        name: "Tint",
        position: 1,
        values: [
          {
            id: "val-clear",
            optionGroupId: "opt-tint",
            label: "Clear",
            priceDelta: { amountMinor: 0, currency: "USD" },
            position: 0,
          },
          {
            id: "val-solid",
            optionGroupId: "opt-tint",
            label: "Solid",
            priceDelta: { amountMinor: 2500, currency: "USD" },
            position: 1,
          },
        ],
      },
      {
        id: "opt-color",
        kind: "COLOR",
        name: "Tint colour",
        position: 2,
        values: [
          {
            id: "val-grey",
            optionGroupId: "opt-color",
            label: "Grey",
            priceDelta: { amountMinor: 0, currency: "USD" },
            swatch: SWATCH_GREY,
            position: 0,
          },
          {
            id: "val-brown",
            optionGroupId: "opt-color",
            label: "Brown",
            priceDelta: { amountMinor: 1000, currency: "USD" },
            swatch: SWATCH_BROWN,
            position: 1,
          },
        ],
      },
    ],
    addOns: [],
    settings: {
      manualRxEnabled: true,
      rxUploadEnabled: false,
      storeRxInOrder: false,
    },
  };
}

describe("OptionsStep (Step 5)", () => {
  it("Row 2: preselects first value only when its delta is 0 and renders radios checked via real reducer (R2-F5)", () => {
    const catalog = createFixtureCatalog();
    const initialState: ConfiguratorState = {
      ...createInitialState("frame-1"),
      catalog,
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        optionValueIds: [],
        addOnIds: [],
      },
    };

    const api = createApiClient();
    const stepDef: StepDefinition = {
      ...optionsStep,
      folder: "05-options",
    };

    function TestHost() {
      const [state, dispatch] = useReducer<ConfiguratorState, ConfiguratorAction>(
        (s, a) => configuratorReducer(s, a, [stepDef]),
        initialState,
      );
      return <OptionsStep state={state} dispatch={dispatch} api={api} />;
    }

    const { container } = render(<TestHost />);

    // Driven by real reducer: val-150, val-clear, val-grey all have delta 0,
    // so they are preselected on mount and their radio inputs end up :checked
    const checkedInputs = container.querySelectorAll<HTMLInputElement>("input:checked");
    expect(checkedInputs.length).toBe(3);
    const checkedValues = Array.from(checkedInputs).map((input) => input.value);
    expect(checkedValues).toEqual(["val-150", "val-clear", "val-grey"]);
  });

  it("Row 4: option group with no zero-delta value -> nothing preselected, step incomplete (R2-F5)", async () => {
    const catalog: CatalogResponse = {
      ...createFixtureCatalog(),
      optionGroups: [
        {
          id: "opt-premium",
          kind: "MATERIAL",
          name: "Premium index",
          position: 0,
          values: [
            {
              id: "val-167",
              optionGroupId: "opt-premium",
              label: "1.67 Thinner",
              priceDelta: { amountMinor: 8000, currency: "USD" }, // non-zero!
              position: 0,
            },
            {
              id: "val-174",
              optionGroupId: "opt-premium",
              label: "1.74 Thinnest",
              priceDelta: { amountMinor: 14000, currency: "USD" },
              position: 1,
            },
          ],
        },
      ],
    };

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
    const { container } = render(<OptionsStep state={state} dispatch={dispatch} api={api} />);

    // Nothing preselected because first value is +$80
    expect(dispatch).not.toHaveBeenCalled();

    // Assert no input is :checked in DOM
    const checkedInputs = container.querySelectorAll("input:checked");
    expect(checkedInputs.length).toBe(0);

    // Incomplete while required group has no selection
    expect(isOptionsStepComplete(state)).toBe(false);

    // Shell-level check: Continue button in footer is disabled when rendered in shell
    const shellCatalog: CatalogResponse = {
      ...catalog,
      lensGroups: [
        {
          id: "group-1",
          name: "Standard",
          position: 0,
          lenses: [
            {
              id: "lens-1",
              groupId: "group-1",
              name: "Standard 1.50",
              price: { amountMinor: 5000, currency: "USD" },
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
    };
    const mockApi: ApiClient = {
      proxyBase: "/apps/lens-advisor",
      getCatalog: vi.fn().mockResolvedValue(shellCatalog),
      submitPrescription: vi.fn(),
      getUploadUrl: vi.fn(),
      uploadFile: vi.fn(),
    };
    const stepDef: StepDefinition = {
      ...optionsStep,
      folder: "05-options",
    };
    const { container: shellContainer } = render(
      <ConfiguratorApp
        steps={[stepDef]}
        apiClient={mockApi}
        product={{ productId: "prod-1" }}
      />,
    );
    await waitFor(() => {
      const continueBtn = shellContainer.querySelector<HTMLButtonElement>(
        ".la-footer .la-btn--primary",
      );
      expect(continueBtn).not.toBeNull();
      expect(continueBtn?.disabled).toBe(true);
    });

    // Complete once a value is selected
    const completedState: ConfiguratorState = {
      ...state,
      selection: {
        ...state.selection,
        optionValueIds: ["val-167"],
      },
    };
    expect(isOptionsStepComplete(completedState)).toBe(true);
  });

  it("displays negative price deltas with leading '-' without '+-' in choices and swatches (R2-F4)", () => {
    const catalog: CatalogResponse = {
      ...createFixtureCatalog(),
      optionGroups: [
        {
          id: "opt-choices",
          kind: "MATERIAL",
          name: "Material Choice",
          position: 0,
          values: [
            {
              id: "val-discount-choice",
              optionGroupId: "opt-choices",
              label: "Basic Material",
              priceDelta: { amountMinor: -1500, currency: "USD" },
              position: 0,
            },
          ],
        },
        {
          id: "opt-swatches",
          kind: "COLOR",
          name: "Swatch Choice",
          position: 1,
          values: [
            {
              id: "val-discount-swatch",
              optionGroupId: "opt-swatches",
              label: "Discounted Color",
              swatch: "teal",
              priceDelta: { amountMinor: -1000, currency: "USD" },
              position: 0,
            },
          ],
        },
      ],
    };

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
    const { container } = render(<OptionsStep state={state} dispatch={dispatch} api={api} />);

    expect(container.textContent).toContain("-$15.00");
    expect(container.textContent).toContain("-$10.00");
    expect(container.textContent).not.toContain("+-$15.00");
    expect(container.textContent).not.toContain("+-$10.00");
  });

  it("Self-check 2: swatches have text names, not colour alone", () => {
    const catalog = createFixtureCatalog();
    const state: ConfiguratorState = {
      ...createInitialState("frame-1"),
      catalog,
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        optionValueIds: ["val-150", "val-clear", "val-grey"],
        addOnIds: [],
      },
    };

    const dispatch = vi.fn();
    const api = createApiClient();
    const view = render(<OptionsStep state={state} dispatch={dispatch} api={api} />);

    // Text names for swatches must be present in the document
    const greySwatch = view.getByText("Grey");
    const brownSwatch = view.getByText("Brown");
    expect(greySwatch).not.toBeNull();
    expect(brownSwatch).not.toBeNull();

    // Swatch chips carry the custom property
    const greyLabel = greySwatch.closest("label");
    const chip = greyLabel?.querySelector(".la-swatch__chip");
    expect(chip?.getAttribute("style")).toContain("--la-swatch-color");
  });

  it("displays price deltas as '+${price}' or 'Included'", () => {
    const catalog = createFixtureCatalog();
    const state: ConfiguratorState = {
      ...createInitialState("frame-1"),
      catalog,
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        optionValueIds: ["val-150"],
        addOnIds: [],
      },
    };

    const dispatch = vi.fn();
    const api = createApiClient();
    const view = render(<OptionsStep state={state} dispatch={dispatch} api={api} />);

    // Zero delta displayed as "Included"
    const includedDeltas = view.getAllByText(strings.included);
    expect(includedDeltas.length).toBeGreaterThan(0);

    // Non-zero deltas displayed as +$40.00, +$25.00, +$10.00
    expect(view.getByText("+$40.00")).not.toBeNull();
    expect(view.getByText("+$25.00")).not.toBeNull();
    expect(view.getByText("+$10.00")).not.toBeNull();
  });

  it("dispatches SET_OPTIONS when a radio option is chosen, replacing prior choice in that group", () => {
    const catalog = createFixtureCatalog();
    const state: ConfiguratorState = {
      ...createInitialState("frame-1"),
      catalog,
      selection: {
        frameVariantId: "frame-1",
        rxType: "SINGLE_VISION",
        optionValueIds: ["val-150", "val-clear", "val-grey"],
        addOnIds: [],
      },
    };

    const dispatch = vi.fn();
    const api = createApiClient();
    const view = render(<OptionsStep state={state} dispatch={dispatch} api={api} />);

    // Click on "1.60 Thin" radio input
    const thinRadio = view.container.querySelector<HTMLInputElement>(
      'input[value="val-160"]',
    );
    expect(thinRadio).not.toBeNull();
    if (thinRadio) {
      fireEvent.change(thinRadio);
    }

    // val-150 must be replaced by val-160, while val-clear and val-grey remain
    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_OPTIONS",
      optionValueIds: ["val-clear", "val-grey", "val-160"],
    });
  });

  it("satisfies step contract exports and applicability", () => {
    expect(optionsStep.id).toBe("options");
    expect(optionsStep.titleKey).toBe(strings.title);
    expect(optionsStep.Summary).toBeDefined();

    const emptyState = createInitialState("frame-1");
    expect(isOptionsStepApplicable(emptyState)).toBe(true);

    const noOptionsCatalog: CatalogResponse = {
      ...createFixtureCatalog(),
      optionGroups: [],
    };
    const noOptionsState = { ...emptyState, catalog: noOptionsCatalog };
    expect(isOptionsStepApplicable(noOptionsState)).toBe(false);
  });
});
