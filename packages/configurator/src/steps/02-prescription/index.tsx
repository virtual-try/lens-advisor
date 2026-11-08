import type { ConfiguratorState, StepModule } from "../../shell/types";
import { validatePrescription } from "../../../../rx-core/src/rx/validate.js";
import { PrescriptionStep } from "./PrescriptionStep";

export function isComplete(state: ConfiguratorState): boolean {
  if (state.rxType === "NON_PRESCRIPTION") {
    return true;
  }
  if (state.prescriptionRef) {
    return true;
  }
  if (
    state.prescription &&
    validatePrescription(state.prescription, state.rxType ?? "SINGLE_VISION").length === 0
  ) {
    return true;
  }
  return false;
}

export function isApplicable(state: ConfiguratorState): boolean {
  return state.rxType !== "NON_PRESCRIPTION";
}

export const id = "prescription";
export const titleKey = "Prescription";
export const Component = PrescriptionStep;

export const prescriptionStep: StepModule = {
  id,
  titleKey,
  isComplete,
  isApplicable,
  Component,
};

export default prescriptionStep;
export { PrescriptionStep };
