import type {
  ConfiguratorAction,
  ConfiguratorState,
  StepDefinition,
} from "./types";

export function createInitialState(frameVariantId = ""): ConfiguratorState {
  return {
    stepIndex: 0,
    rxType: null,
    prescription: null,
    prescriptionRef: null,
    catalog: null,
    selection: {
      frameVariantId,
      rxType: "SINGLE_VISION",
      optionValueIds: [],
      addOnIds: [],
    },
    status: "idle",
    error: null,
    isOpen: false,
  };
}

function keepStepApplicable(
  state: ConfiguratorState,
  steps: StepDefinition[],
  preferFirst = false,
): ConfiguratorState {
  if (steps.length === 0) return state;
  const currentStep = steps[state.stepIndex];
  if (currentStep && currentStep.isApplicable(state) && !preferFirst) {
    return state;
  }
  const firstApplicable = steps.findIndex((s) => s.isApplicable(state));
  if (firstApplicable >= 0) {
    return {
      ...state,
      stepIndex: firstApplicable,
    };
  }
  return state;
}

/**
 * Pure state machine reducer for the configurator.
 * Effects (API calls, storage, etc.) belong in the shell components, never here.
 */
export function configuratorReducer(
  state: ConfiguratorState,
  action: ConfiguratorAction,
  providedSteps?: StepDefinition[],
): ConfiguratorState {
  const steps =
    ("steps" in action && action.steps) || providedSteps || [];

  const nextState = ((): ConfiguratorState => {
    switch (action.type) {
      case "OPEN": {
        return {
          ...state,
          isOpen: true,
          status: "loading",
          error: null,
          selection: {
            ...state.selection,
            frameVariantId: action.frameVariantId || state.selection.frameVariantId,
          },
        };
      }

      case "CLOSE": {
        return {
          ...state,
          isOpen: false,
          status: "idle",
        };
      }

      case "CATALOG_LOADING": {
        return {
          ...state,
          status: "loading",
          error: null,
        };
      }

      case "CATALOG_LOADED": {
        const catalog = action.catalog;
        const isEmpty = !catalog.lensGroups || catalog.lensGroups.length === 0;
        return {
          ...state,
          catalog,
          status: isEmpty ? "empty" : "ready",
          error: null,
          stepIndex: 0,
        };
      }

      case "CATALOG_ERROR": {
        if (action.error.code === "NOT_AVAILABLE") {
          return {
            ...state,
            status: "empty",
            error: null,
            catalog: state.catalog ?? {
              lensGroups: [],
              optionGroups: [],
              addOns: [],
              settings: {
                manualRxEnabled: false,
                rxUploadEnabled: false,
                storeRxInOrder: false,
              },
            },
          };
        }
        return {
          ...state,
          status: "error",
          error: action.error,
        };
      }

      case "SET_RX_TYPE": {
        const isDifferent = state.rxType !== action.rxType;
        return {
          ...state,
          rxType: action.rxType,
          prescription: isDifferent ? null : state.prescription,
          prescriptionRef: isDifferent ? null : state.prescriptionRef,
          selection: {
            ...state.selection,
            rxType: action.rxType,
            prescriptionRef: isDifferent ? undefined : state.selection.prescriptionRef,
          },
        };
      }

      case "SET_PRESCRIPTION": {
        return {
          ...state,
          prescription: action.prescription,
        };
      }

      case "CLEAR_PRESCRIPTION": {
        return {
          ...state,
          prescription: null,
          prescriptionRef: null,
          selection: {
            ...state.selection,
            prescriptionRef: undefined,
          },
        };
      }

      case "SET_PRESCRIPTION_REF": {
        return {
          ...state,
          prescriptionRef: action.prescriptionRef,
          selection: {
            ...state.selection,
            prescriptionRef: action.prescriptionRef,
          },
        };
      }

      case "SET_LENS": {
        return {
          ...state,
          selection: {
            ...state.selection,
            lensId: action.lensId,
          },
        };
      }

      case "SET_OPTIONS": {
        return {
          ...state,
          selection: {
            ...state.selection,
            optionValueIds: action.optionValueIds,
          },
        };
      }

      case "TOGGLE_OPTION": {
        const exists = state.selection.optionValueIds.includes(action.optionValueId);
        const optionValueIds = exists
          ? state.selection.optionValueIds.filter((id) => id !== action.optionValueId)
          : [...state.selection.optionValueIds, action.optionValueId];
        return {
          ...state,
          selection: {
            ...state.selection,
            optionValueIds,
          },
        };
      }

      case "SET_ADDONS": {
        return {
          ...state,
          selection: {
            ...state.selection,
            addOnIds: action.addOnIds,
          },
        };
      }

      case "TOGGLE_ADDON": {
        const exists = state.selection.addOnIds.includes(action.addOnId);
        const addOnIds = exists
          ? state.selection.addOnIds.filter((id) => id !== action.addOnId)
          : [...state.selection.addOnIds, action.addOnId];
        return {
          ...state,
          selection: {
            ...state.selection,
            addOnIds,
          },
        };
      }

      case "CONTINUE": {
        const currentStep = steps[state.stepIndex];
        // Continue is impossible while isComplete is false
        if (currentStep && !currentStep.isComplete(state)) {
          return state;
        }

        let nextIndex = state.stepIndex + 1;
        while (nextIndex < steps.length && !steps[nextIndex].isApplicable(state)) {
          nextIndex++;
        }
        if (nextIndex >= steps.length) {
          return state;
        }
        return {
          ...state,
          stepIndex: nextIndex,
        };
      }

      case "BACK": {
        let prevIndex = state.stepIndex - 1;
        while (prevIndex >= 0 && !steps[prevIndex].isApplicable(state)) {
          prevIndex--;
        }
        if (prevIndex < 0) {
          return state;
        }
        return {
          ...state,
          stepIndex: prevIndex,
        };
      }

      case "GO_TO_STEP": {
        const target = action.stepIndex;
        if (target >= 0 && target < steps.length && steps[target].isApplicable(state)) {
          if (target > state.stepIndex) {
            for (let i = state.stepIndex; i < target; i++) {
              if (steps[i].isApplicable(state) && !steps[i].isComplete(state)) {
                return state;
              }
            }
          }
          return {
            ...state,
            stepIndex: target,
          };
        }
        return state;
      }

      case "RESET": {
        return createInitialState(action.frameVariantId || state.selection.frameVariantId);
      }

      default:
        return state;
    }
  })();

  if (action.type === "CATALOG_LOADED") {
    return keepStepApplicable(nextState, steps, true);
  }
  if (action.type !== "CLOSE" && action.type !== "RESET") {
    return keepStepApplicable(nextState, steps, false);
  }
  return nextState;
}
