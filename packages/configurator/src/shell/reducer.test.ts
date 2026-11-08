import { describe, expect, it } from "vitest";
import { configuratorReducer, createInitialState } from "./reducer";
import type {
  ConfiguratorAction,
  ConfiguratorState,
  ConfiguratorStatus,
  StepDefinition,
} from "./types";
import type { CatalogResponse } from "../../../rx-core/src/index.js";

const emptyCatalog: CatalogResponse = {
  lensGroups: [],
  optionGroups: [],
  addOns: [],
  settings: {
    manualRxEnabled: true,
    rxUploadEnabled: false,
    storeRxInOrder: false,
  },
};

const populatedCatalog: CatalogResponse = {
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

function createMockSteps(overrides: Partial<StepDefinition>[] = []): StepDefinition[] {
  return [
    {
      id: "vision",
      titleKey: "Vision",
      folder: "01-vision",
      isComplete: (s) => s.rxType !== null,
      isApplicable: () => true,
      Component: () => null,
      ...overrides[0],
    },
    {
      id: "prescription",
      titleKey: "Prescription",
      folder: "02-prescription",
      isComplete: (s) => s.prescription !== null || s.prescriptionRef !== null,
      isApplicable: (s) => s.rxType !== "NON_PRESCRIPTION",
      Component: () => null,
      ...overrides[1],
    },
    {
      id: "lens",
      titleKey: "Lens",
      folder: "03-lens",
      isComplete: (s) => Boolean(s.selection.lensId),
      isApplicable: () => true,
      Component: () => null,
      ...overrides[2],
    },
  ];
}

describe("configuratorReducer", () => {
  const allStatuses: ConfiguratorStatus[] = [
    "idle",
    "loading",
    "ready",
    "error",
    "empty",
  ];

  const actionsToTest: Array<{ name: string; action: ConfiguratorAction }> = [
    { name: "OPEN", action: { type: "OPEN", frameVariantId: "var-frame-1" } },
    { name: "CLOSE", action: { type: "CLOSE" } },
    { name: "CATALOG_LOADING", action: { type: "CATALOG_LOADING" } },
    {
      name: "CATALOG_LOADED (populated)",
      action: { type: "CATALOG_LOADED", catalog: populatedCatalog },
    },
    {
      name: "CATALOG_LOADED (empty)",
      action: { type: "CATALOG_LOADED", catalog: emptyCatalog },
    },
    {
      name: "CATALOG_ERROR",
      action: { type: "CATALOG_ERROR", error: { code: "SERVER_ERROR" } },
    },
    {
      name: "CATALOG_ERROR (NOT_AVAILABLE)",
      action: { type: "CATALOG_ERROR", error: { code: "NOT_AVAILABLE" } },
    },
    { name: "SET_RX_TYPE", action: { type: "SET_RX_TYPE", rxType: "SINGLE_VISION" } },
    {
      name: "SET_PRESCRIPTION",
      action: {
        type: "SET_PRESCRIPTION",
        prescription: {
          od: { sph: -200 },
          os: { sph: -200 },
          pd: { single: 630 },
        },
      },
    },
    {
      name: "CLEAR_PRESCRIPTION",
      action: { type: "CLEAR_PRESCRIPTION" },
    },
    {
      name: "SET_PRESCRIPTION_REF",
      action: { type: "SET_PRESCRIPTION_REF", prescriptionRef: "rx-ref-1" },
    },
    { name: "SET_LENS_GROUP", action: { type: "SET_LENS_GROUP", lensGroupId: "group-1" } },
    { name: "SET_LENS", action: { type: "SET_LENS", lensId: "lens-1" } },
    { name: "SET_OPTIONS", action: { type: "SET_OPTIONS", optionValueIds: ["opt-1"] } },
    { name: "TOGGLE_OPTION", action: { type: "TOGGLE_OPTION", optionValueId: "opt-2" } },
    { name: "SET_ADDONS", action: { type: "SET_ADDONS", addOnIds: ["add-1"] } },
    { name: "TOGGLE_ADDON", action: { type: "TOGGLE_ADDON", addOnId: "add-2" } },
    { name: "CONTINUE", action: { type: "CONTINUE" } },
    { name: "BACK", action: { type: "BACK" } },
    { name: "GO_TO_STEP", action: { type: "GO_TO_STEP", stepIndex: 1 } },
    { name: "RESET", action: { type: "RESET" } },
  ];

  // Table covering every action on every state status
  describe("matrix: every action on every status", () => {
    for (const status of allStatuses) {
      for (const { name, action } of actionsToTest) {
        it(`handles ${name} from ${status}`, () => {
          const initialState: ConfiguratorState = {
            ...createInitialState("frame-0"),
            status,
            isOpen: status !== "idle",
            stepIndex: action.type === "BACK" ? 1 : 0,
            catalog: status === "ready" ? populatedCatalog : null,
          };

          const steps = createMockSteps([
            { id: "step-1", isComplete: () => true, isApplicable: () => true },
            { id: "step-2", isComplete: () => true, isApplicable: () => true },
          ]);
          const nextState = configuratorReducer(initialState, action, steps);

          expect(nextState).toBeDefined();

          if (action.type === "OPEN") {
            expect(nextState.isOpen).toBe(true);
            expect(nextState.status).toBe("loading");
            expect(nextState.selection.frameVariantId).toBe("var-frame-1");
          } else if (action.type === "CLOSE") {
            expect(nextState.isOpen).toBe(false);
            expect(nextState.status).toBe("idle");
            expect(nextState.lensGroupId).toBeNull();
          } else if (action.type === "CATALOG_LOADING") {
            expect(nextState.status).toBe("loading");
          } else if (action.type === "CATALOG_LOADED") {
            const isEmpty = action.catalog.lensGroups.length === 0;
            expect(nextState.status).toBe(isEmpty ? "empty" : "ready");
            expect(nextState.catalog).toEqual(action.catalog);
          } else if (action.type === "CATALOG_ERROR") {
            if (action.error.code === "NOT_AVAILABLE") {
              expect(nextState.status).toBe("empty");
              expect(nextState.error).toBeNull();
            } else {
              expect(nextState.status).toBe("error");
              expect(nextState.error?.code).toBe("SERVER_ERROR");
            }
          } else if (action.type === "SET_RX_TYPE") {
            expect(nextState.rxType).toBe("SINGLE_VISION");
            expect(nextState.selection.rxType).toBe("SINGLE_VISION");
          } else if (action.type === "SET_PRESCRIPTION") {
            expect(nextState.prescription).toEqual(action.prescription);
          } else if (action.type === "CLEAR_PRESCRIPTION") {
            expect(nextState.prescription).toBeNull();
            expect(nextState.prescriptionRef).toBeNull();
          } else if (action.type === "SET_PRESCRIPTION_REF") {
            expect(nextState.prescriptionRef).toBe("rx-ref-1");
            expect(nextState.selection.prescriptionRef).toBe("rx-ref-1");
          } else if (action.type === "SET_LENS_GROUP") {
            expect(nextState.lensGroupId).toBe("group-1");
          } else if (action.type === "SET_LENS") {
            expect(nextState.selection.lensId).toBe("lens-1");
          } else if (action.type === "SET_OPTIONS") {
            expect(nextState.selection.optionValueIds).toEqual(["opt-1"]);
          } else if (action.type === "TOGGLE_OPTION") {
            expect(nextState.selection.optionValueIds).toContain("opt-2");
          } else if (action.type === "SET_ADDONS") {
            expect(nextState.selection.addOnIds).toEqual(["add-1"]);
          } else if (action.type === "TOGGLE_ADDON") {
            expect(nextState.selection.addOnIds).toContain("add-2");
          } else if (action.type === "CONTINUE") {
            expect(nextState.stepIndex).toBe(1);
          } else if (action.type === "BACK") {
            expect(nextState.stepIndex).toBe(0);
          } else if (action.type === "GO_TO_STEP") {
            expect(nextState.stepIndex).toBe(1);
          } else if (action.type === "RESET") {
            expect(nextState.status).toBe("idle");
            expect(nextState.isOpen).toBe(false);
            expect(nextState.stepIndex).toBe(0);
            expect(nextState.lensGroupId).toBeNull();
          }
        });
      }
    }
  });

  describe("applicability and catalog load", () => {
    it("selects the first applicable step on catalog load when step 0 is not applicable", () => {
      const steps = createMockSteps([
        {
          id: "step-0",
          isApplicable: () => false,
          isComplete: () => true,
        },
        {
          id: "step-1",
          isApplicable: () => true,
          isComplete: () => true,
        },
      ]);

      const state: ConfiguratorState = {
        ...createInitialState(),
        status: "loading",
        isOpen: true,
      };

      const next = configuratorReducer(
        state,
        { type: "CATALOG_LOADED", catalog: populatedCatalog },
        steps,
      );

      expect(next.status).toBe("ready");
      expect(next.stepIndex).toBe(1);
      expect(steps[next.stepIndex].id).toBe("step-1");
    });
  });

  describe("Continue gating", () => {
    it("is impossible while isComplete is false", () => {
      const steps = createMockSteps([
        {
          id: "step-1",
          isComplete: () => false, // explicitly incomplete
        },
      ]);

      const state: ConfiguratorState = {
        ...createInitialState(),
        status: "ready",
        isOpen: true,
        stepIndex: 0,
      };

      const result = configuratorReducer(state, { type: "CONTINUE" }, steps);
      expect(result.stepIndex).toBe(0); // blocked! Did not advance
    });

    it("advances to next step when isComplete is true", () => {
      const steps = createMockSteps([
        {
          id: "step-1",
          isComplete: () => true, // complete
        },
      ]);

      const state: ConfiguratorState = {
        ...createInitialState(),
        status: "ready",
        isOpen: true,
        stepIndex: 0,
        rxType: "SINGLE_VISION",
      };

      const result = configuratorReducer(state, { type: "CONTINUE" }, steps);
      expect(result.stepIndex).toBe(1);
    });

    it("skips non-applicable steps when advancing", () => {
      const steps = createMockSteps();
      const state: ConfiguratorState = {
        ...createInitialState(),
        status: "ready",
        isOpen: true,
        stepIndex: 0,
        rxType: "NON_PRESCRIPTION", // Prescription step 1 is not applicable
      };

      const result = configuratorReducer(state, { type: "CONTINUE" }, steps);
      expect(result.stepIndex).toBe(2); // Skipped step 1 directly to step 2!
    });

    it("skips non-applicable steps when navigating back", () => {
      const steps = createMockSteps();
      const state: ConfiguratorState = {
        ...createInitialState(),
        status: "ready",
        isOpen: true,
        stepIndex: 2,
        rxType: "NON_PRESCRIPTION", // Prescription step 1 is not applicable
      };

      const result = configuratorReducer(state, { type: "BACK" }, steps);
      expect(result.stepIndex).toBe(0); // Skipped step 1 back to step 0!
    });
  });

  describe("toggling options and add-ons", () => {
    it("toggles option on and off", () => {
      let state = createInitialState();
      state = configuratorReducer(state, { type: "TOGGLE_OPTION", optionValueId: "opt-1" });
      expect(state.selection.optionValueIds).toEqual(["opt-1"]);

      state = configuratorReducer(state, { type: "TOGGLE_OPTION", optionValueId: "opt-2" });
      expect(state.selection.optionValueIds).toEqual(["opt-1", "opt-2"]);

      state = configuratorReducer(state, { type: "TOGGLE_OPTION", optionValueId: "opt-1" });
      expect(state.selection.optionValueIds).toEqual(["opt-2"]);
    });

    it("toggles addon on and off", () => {
      let state = createInitialState();
      state = configuratorReducer(state, { type: "TOGGLE_ADDON", addOnId: "addon-1" });
      expect(state.selection.addOnIds).toEqual(["addon-1"]);

      state = configuratorReducer(state, { type: "TOGGLE_ADDON", addOnId: "addon-1" });
      expect(state.selection.addOnIds).toEqual([]);
    });
  });

  describe("catalog error mapping (R4-F2)", () => {
    it("maps NOT_AVAILABLE error code to empty state without error", () => {
      const state = { ...createInitialState(), status: "loading" as const };
      const nextState = configuratorReducer(state, {
        type: "CATALOG_ERROR",
        error: { code: "NOT_AVAILABLE" },
      });
      expect(nextState.status).toBe("empty");
      expect(nextState.error).toBeNull();
      expect(nextState.catalog?.lensGroups).toEqual([]);
    });

    it("maps other error codes to error state with error details", () => {
      const state = { ...createInitialState(), status: "loading" as const };
      const nextState = configuratorReducer(state, {
        type: "CATALOG_ERROR",
        error: { code: "RATE_LIMITED", message: "Too many requests" },
      });
      expect(nextState.status).toBe("error");
      expect(nextState.error?.code).toBe("RATE_LIMITED");
      expect(nextState.error?.message).toBe("Too many requests");
    });
  });

  describe("prescription clearing and gating (R2-F1, R2-F2)", () => {
    it("CLEAR_PRESCRIPTION resets prescription and prescriptionRef in state and selection", () => {
      const state: ConfiguratorState = {
        ...createInitialState(),
        prescription: {
          od: { sph: -200 },
          os: { sph: -200 },
          pd: { single: 630 },
        },
        prescriptionRef: "rx-999",
        selection: {
          ...createInitialState().selection,
          prescriptionRef: "rx-999",
        },
      };

      const nextState = configuratorReducer(state, { type: "CLEAR_PRESCRIPTION" });
      expect(nextState.prescription).toBeNull();
      expect(nextState.prescriptionRef).toBeNull();
      expect(nextState.selection.prescriptionRef).toBeUndefined();
    });

    it("SET_RX_TYPE with a different rxType clears prescription and prescriptionRef (R2-F2)", () => {
      const state: ConfiguratorState = {
        ...createInitialState(),
        rxType: "SINGLE_VISION",
        prescription: {
          od: { sph: -200 },
          os: { sph: -200 },
          pd: { single: 630 },
        },
        prescriptionRef: "rx-999",
        selection: {
          ...createInitialState().selection,
          rxType: "SINGLE_VISION",
          prescriptionRef: "rx-999",
        },
      };

      const nextState = configuratorReducer(state, {
        type: "SET_RX_TYPE",
        rxType: "PROGRESSIVE",
      });
      expect(nextState.rxType).toBe("PROGRESSIVE");
      expect(nextState.prescription).toBeNull();
      expect(nextState.prescriptionRef).toBeNull();
      expect(nextState.selection.prescriptionRef).toBeUndefined();
    });

    it("SET_RX_TYPE with same rxType preserves existing prescription", () => {
      const existingRx = { od: { sph: -200 }, os: { sph: -200 }, pd: { single: 630 } };
      const state: ConfiguratorState = {
        ...createInitialState(),
        rxType: "SINGLE_VISION",
        prescription: existingRx,
        prescriptionRef: "rx-999",
      };

      const nextState = configuratorReducer(state, {
        type: "SET_RX_TYPE",
        rxType: "SINGLE_VISION",
      });
      expect(nextState.prescription).toBe(existingRx);
      expect(nextState.prescriptionRef).toBe("rx-999");
    });

    it("GO_TO_STEP is blocked when an intermediate step is incomplete (R2-F1)", () => {
      const steps = createMockSteps([
        {
          id: "step-1",
          isComplete: () => true,
        },
        {
          id: "step-2",
          isComplete: () => false, // incomplete
        },
        {
          id: "step-3",
          isComplete: () => true,
        },
      ]);

      const state: ConfiguratorState = {
        ...createInitialState(),
        status: "ready",
        isOpen: true,
        stepIndex: 1, // on incomplete step 2
      };

      const result = configuratorReducer(
        state,
        { type: "GO_TO_STEP", stepIndex: 2 },
        steps,
      );
      expect(result.stepIndex).toBe(1); // blocked!
    });
  });

  describe("lens group and navigation (spec 27 R1-F1, R1-F2, R1-F7)", () => {
    it("SET_LENS_GROUP sets lensGroupId in shell state", () => {
      const state = createInitialState();
      const nextState = configuratorReducer(state, {
        type: "SET_LENS_GROUP",
        lensGroupId: "group-1",
      });
      expect(nextState.lensGroupId).toBe("group-1");
    });

    it("SET_LENS_GROUP clears selection.lensId if lens belonged to a different group", () => {
      const catalog: CatalogResponse = {
        lensGroups: [
          {
            id: "group-1",
            name: "Group 1",
            position: 0,
            lenses: [
              {
                id: "lens-1",
                groupId: "group-1",
                name: "Lens 1",
                price: { amountMinor: 1000, currency: "USD" },
                limits: { sphMin: -600, sphMax: 400, cylMin: -200, cylMax: 0, rxTypes: ["SINGLE_VISION"] },
                labCodeTemplate: "L1",
                shopifyVariantId: "v1",
                position: 0,
              },
            ],
          },
          {
            id: "group-2",
            name: "Group 2",
            position: 1,
            lenses: [
              {
                id: "lens-2",
                groupId: "group-2",
                name: "Lens 2",
                price: { amountMinor: 2000, currency: "USD" },
                limits: { sphMin: -600, sphMax: 400, cylMin: -200, cylMax: 0, rxTypes: ["SINGLE_VISION"] },
                labCodeTemplate: "L2",
                shopifyVariantId: "v2",
                position: 0,
              },
            ],
          },
        ],
        optionGroups: [],
        addOns: [],
        settings: { manualRxEnabled: true, rxUploadEnabled: true, storeRxInOrder: false },
      };

      const state: ConfiguratorState = {
        ...createInitialState(),
        catalog,
        lensGroupId: "group-1",
        selection: {
          frameVariantId: "frame-1",
          rxType: "SINGLE_VISION",
          lensId: "lens-1",
          optionValueIds: [],
          addOnIds: [],
        },
      };

      const nextState = configuratorReducer(state, {
        type: "SET_LENS_GROUP",
        lensGroupId: "group-2",
      });

      expect(nextState.lensGroupId).toBe("group-2");
      expect(nextState.selection.lensId).toBeUndefined();
    });

    it("CLOSE clears lensGroupId (R1-F2: session outlive)", () => {
      const state: ConfiguratorState = {
        ...createInitialState("frame-1"),
        isOpen: true,
        status: "ready",
        lensGroupId: "group-1",
      };
      const nextState = configuratorReducer(state, { type: "CLOSE" });
      expect(nextState.isOpen).toBe(false);
      expect(nextState.lensGroupId).toBeNull();
    });

    it("GO_TO_STEP looks up step index by stepId (R1-F7)", () => {
      const steps = createMockSteps([
        { id: "vision", isComplete: () => true, isApplicable: () => true },
        { id: "prescription", isComplete: () => true, isApplicable: () => true },
        { id: "lens-group", isComplete: () => true, isApplicable: () => true },
        { id: "lens", isComplete: () => true, isApplicable: () => true },
      ]);
      const state: ConfiguratorState = {
        ...createInitialState(),
        status: "ready",
        isOpen: true,
        stepIndex: 3,
      };

      const nextState = configuratorReducer(
        state,
        { type: "GO_TO_STEP", stepId: "prescription" },
        steps,
      );
      expect(nextState.stepIndex).toBe(1);
    });
  });
});
