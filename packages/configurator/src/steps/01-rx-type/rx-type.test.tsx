import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import type { CatalogResponse } from "../../../../rx-core/src/index.js";
import { createInitialState } from "../../shell/reducer";
import type { ConfiguratorState, StepProps } from "../../shell/types";
import { RxTypeStep, getLowestPriceForRxType } from "./RxTypeStep";
import { isApplicable, isComplete, rxTypeStep } from "./index";
import rxTypeCss from "./rx-type.css?inline";
import { strings } from "./strings";

const mockCatalog: CatalogResponse = {
  lensGroups: [
    {
      id: "group-1",
      name: "Single Vision Clear",
      position: 0,
      lenses: [
        {
          id: "lens-1",
          groupId: "group-1",
          name: "Standard 1.50",
          price: { amountMinor: 4900, currency: "USD" },
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
        {
          id: "lens-2",
          groupId: "group-1",
          name: "Economy 1.50",
          price: { amountMinor: 3900, currency: "USD" },
          limits: {
            sphMin: -400,
            sphMax: 200,
            cylMin: 0,
            cylMax: 0,
            rxTypes: ["SINGLE_VISION"],
          },
          labCodeTemplate: "ECON",
          shopifyVariantId: "var-2",
          position: 1,
        },
      ],
    },
    {
      id: "group-2",
      name: "Progressive Premium",
      position: 1,
      lenses: [
        {
          id: "lens-3",
          groupId: "group-2",
          name: "Varilux Comfort",
          price: { amountMinor: 18900, currency: "USD" },
          limits: {
            sphMin: -800,
            sphMax: 600,
            cylMin: -400,
            cylMax: 0,
            addMin: 75,
            addMax: 350,
            rxTypes: ["PROGRESSIVE"],
          },
          labCodeTemplate: "PROG",
          shopifyVariantId: "var-3",
          position: 0,
        },
      ],
    },
    {
      id: "group-3",
      name: "Reading Lenses",
      position: 2,
      lenses: [
        {
          id: "lens-4",
          groupId: "group-3",
          name: "Reading Standard",
          price: { amountMinor: 3500, currency: "USD" },
          limits: {
            sphMin: 0,
            sphMax: 400,
            cylMin: 0,
            cylMax: 0,
            addMin: 75,
            addMax: 350,
            rxTypes: ["READING"],
          },
          labCodeTemplate: "READ",
          shopifyVariantId: "var-4",
          position: 0,
        },
      ],
    },
    {
      id: "group-4",
      name: "Non-Prescription Plano",
      position: 3,
      lenses: [
        {
          id: "lens-5",
          groupId: "group-4",
          name: "Plano Clear",
          price: { amountMinor: 2500, currency: "USD" },
          limits: {
            sphMin: 0,
            sphMax: 0,
            cylMin: 0,
            cylMax: 0,
            rxTypes: ["NON_PRESCRIPTION"],
          },
          labCodeTemplate: "PLANO",
          shopifyVariantId: "var-5",
          position: 0,
        },
      ],
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

describe("01-rx-type step", () => {
  it("exports correct StepModule contract", () => {
    expect(rxTypeStep.id).toBe("rx-type");
    expect(rxTypeStep.titleKey).toBe("Vision");
    expect(typeof rxTypeStep.isComplete).toBe("function");
    expect(typeof rxTypeStep.isApplicable).toBe("function");
    expect(rxTypeStep.Component).toBe(RxTypeStep);
  });

  it("isApplicable always returns true", () => {
    const state = createInitialState();
    expect(isApplicable(state)).toBe(true);
  });

  it("isComplete is false when rxType is null, true when set", () => {
    const state = createInitialState();
    expect(isComplete(state)).toBe(false);

    const stateWithSingleVision: ConfiguratorState = {
      ...state,
      rxType: "SINGLE_VISION",
    };
    expect(isComplete(stateWithSingleVision)).toBe(true);

    const stateWithNonRx: ConfiguratorState = {
      ...state,
      rxType: "NON_PRESCRIPTION",
    };
    expect(isComplete(stateWithNonRx)).toBe(true);
  });

  it("computes lowest price correctly from catalog", () => {
    const singleVisionPrice = getLowestPriceForRxType(mockCatalog, "SINGLE_VISION");
    expect(singleVisionPrice).toEqual({ amountMinor: 3900, currency: "USD" });

    const progressivePrice = getLowestPriceForRxType(mockCatalog, "PROGRESSIVE");
    expect(progressivePrice).toEqual({ amountMinor: 18900, currency: "USD" });

    const readingPrice = getLowestPriceForRxType(mockCatalog, "READING");
    expect(readingPrice).toEqual({ amountMinor: 3500, currency: "USD" });

    const nonRxPrice = getLowestPriceForRxType(mockCatalog, "NON_PRESCRIPTION");
    expect(nonRxPrice).toEqual({ amountMinor: 2500, currency: "USD" });
  });

  it("renders all four choices with 'from <price>' when lenses exist", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: null,
    };
    const dispatch = vi.fn();
    const mockApi = {} as StepProps["api"];

    render(<RxTypeStep state={state} dispatch={dispatch} api={mockApi} />);

    // Step heading and subtitle
    expect(screen.getByRole("heading", { name: strings.title })).not.toBeNull();
    expect(screen.getByText(strings.subtitle)).not.toBeNull();

    // Four radio choices asserted by role and text
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);

    expect(screen.getByRole("radio", { name: new RegExp(strings.types.SINGLE_VISION.title, "i") })).not.toBeNull();
    expect(screen.getByRole("radio", { name: new RegExp(strings.types.PROGRESSIVE.title, "i") })).not.toBeNull();
    expect(screen.getByRole("radio", { name: new RegExp(strings.types.READING.title, "i") })).not.toBeNull();
    expect(screen.getByRole("radio", { name: new RegExp(strings.types.NON_PRESCRIPTION.title, "i") })).not.toBeNull();

    // Prices formatted properly
    expect(screen.getByText("from $39.00")).not.toBeNull();
    expect(screen.getByText("from $189.00")).not.toBeNull();
    expect(screen.getByText("from $35.00")).not.toBeNull();
    expect(screen.getByText("from $25.00")).not.toBeNull();

    // One-line descriptions
    expect(screen.getByText(strings.types.SINGLE_VISION.desc)).not.toBeNull();
    expect(screen.getByText(strings.types.PROGRESSIVE.desc)).not.toBeNull();
    expect(screen.getByText(strings.types.READING.desc)).not.toBeNull();
    expect(screen.getByText(strings.types.NON_PRESCRIPTION.desc)).not.toBeNull();

    // Helper disclosure
    expect(screen.getByText(strings.help.summary)).not.toBeNull();
    expect(screen.getByText(strings.help.addTitle)).not.toBeNull();
    expect(screen.getByText(strings.help.addDesc)).not.toBeNull();
  });

  it("hides rx types with no lenses in the catalog", () => {
    const limitedCatalog: CatalogResponse = {
      ...mockCatalog,
      lensGroups: [mockCatalog.lensGroups[0]], // Only Single Vision lenses
    };

    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: limitedCatalog,
      rxType: null,
    };
    const dispatch = vi.fn();
    const mockApi = {} as StepProps["api"];

    render(<RxTypeStep state={state} dispatch={dispatch} api={mockApi} />);

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(1);

    expect(screen.getByRole("radio", { name: new RegExp(strings.types.SINGLE_VISION.title, "i") })).not.toBeNull();
    expect(screen.queryByRole("radio", { name: new RegExp(strings.types.PROGRESSIVE.title, "i") })).toBeNull();
    expect(screen.queryByRole("radio", { name: new RegExp(strings.types.READING.title, "i") })).toBeNull();
    expect(screen.queryByRole("radio", { name: new RegExp(strings.types.NON_PRESCRIPTION.title, "i") })).toBeNull();
  });

  it("dispatches SET_RX_TYPE when a radio option is selected", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: null,
    };
    const dispatch = vi.fn();
    const mockApi = {} as StepProps["api"];

    render(<RxTypeStep state={state} dispatch={dispatch} api={mockApi} />);

    const progressiveRadio = screen.getByRole("radio", {
      name: new RegExp(strings.types.PROGRESSIVE.title, "i"),
    });
    fireEvent.click(progressiveRadio);

    expect(dispatch).toHaveBeenCalledWith({
      type: "SET_RX_TYPE",
      rxType: "PROGRESSIVE",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "CLEAR_PRESCRIPTION",
    });
  });

  it("R1-F5: disables transitions under prefers-reduced-motion: reduce", () => {
    expect(rxTypeCss).toContain("prefers-reduced-motion: reduce");
    expect(rxTypeCss).toMatch(/@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{[\s\S]*?\.la-choice[\s\S]*?transition:\s*none/);
  });

  it("reflects checked state for selected rxType", () => {
    const state: ConfiguratorState = {
      ...createInitialState(),
      catalog: mockCatalog,
      rxType: "PROGRESSIVE",
    };
    const dispatch = vi.fn();
    const mockApi = {} as StepProps["api"];

    render(<RxTypeStep state={state} dispatch={dispatch} api={mockApi} />);

    const progressiveRadio = screen.getByRole("radio", {
      name: new RegExp(strings.types.PROGRESSIVE.title, "i"),
    }) as HTMLInputElement;
    expect(progressiveRadio.checked).toBe(true);

    const singleVisionRadio = screen.getByRole("radio", {
      name: new RegExp(strings.types.SINGLE_VISION.title, "i"),
    }) as HTMLInputElement;
    expect(singleVisionRadio.checked).toBe(false);
  });
});
