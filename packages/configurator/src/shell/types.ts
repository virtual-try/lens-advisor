import type { ComponentType } from "preact";
import type {
  CatalogResponse,
  Prescription,
  RxType,
  Selection,
} from "../../../rx-core/src/index.js";
import type { ApiClient } from "../shared/api.js";
import type { ProductData } from "../shared/types.js";

export type ConfiguratorStatus = "idle" | "loading" | "ready" | "error" | "empty";

export interface ConfiguratorState {
  stepIndex: number;
  rxType: RxType | null;
  prescription: Prescription | null;
  prescriptionRef: string | null;
  lensGroupId: string | null;
  catalog: CatalogResponse | null;
  selection: Selection;
  status: ConfiguratorStatus;
  error: { code: string; message?: string } | null;
  isOpen: boolean;
}

export interface StepProps {
  state: ConfiguratorState;
  dispatch: (action: ConfiguratorAction) => void;
  api: ApiClient;
  mount?: HTMLElement | null;
  product?: ProductData | null;
}

export interface StepModule {
  id: string;
  titleKey: string;
  isComplete: (state: ConfiguratorState) => boolean;
  isApplicable: (state: ConfiguratorState) => boolean;
  Component: ComponentType<StepProps>;
  Summary?: ComponentType<StepProps>;
}

export interface StepDefinition extends StepModule {
  folder: string;
}

export type ConfiguratorAction =
  | { type: "OPEN"; frameVariantId?: string }
  | { type: "CLOSE" }
  | { type: "CATALOG_LOADING" }
  | { type: "CATALOG_LOADED"; catalog: CatalogResponse; steps?: StepDefinition[] }
  | { type: "CATALOG_ERROR"; error: { code: string; message?: string } }
  | { type: "SET_RX_TYPE"; rxType: RxType }
  | { type: "SET_PRESCRIPTION"; prescription: Prescription }
  | { type: "SET_PRESCRIPTION_REF"; prescriptionRef: string }
  | { type: "SET_LENS_GROUP"; lensGroupId: string }
  | { type: "SET_LENS"; lensId: string }
  | { type: "SET_OPTIONS"; optionValueIds: string[] }
  | { type: "TOGGLE_OPTION"; optionValueId: string }
  | { type: "SET_ADDONS"; addOnIds: string[] }
  | { type: "TOGGLE_ADDON"; addOnId: string }
  | { type: "CONTINUE"; steps?: StepDefinition[] }
  | { type: "BACK"; steps?: StepDefinition[] }
  | { type: "GO_TO_STEP"; stepIndex?: number; stepId?: string; steps?: StepDefinition[] }
  | { type: "RESET"; frameVariantId?: string };
