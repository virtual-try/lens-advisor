import type { ConfiguratorState, StepModule, StepProps } from "../../shell/types";
import { validatePrescription } from "../../../../rx-core/src/rx/validate.js";
import { PrescriptionStep } from "./PrescriptionStep";

let activeSubmitHandler: (() => Promise<void>) | null = null;

export function registerPrescriptionSubmitHandler(
  handler: (() => Promise<void>) | null,
): void {
  activeSubmitHandler = handler;
}

export function isComplete(state: ConfiguratorState): boolean {
  if (state.rxType === "NON_PRESCRIPTION") {
    return true;
  }
  return Boolean(state.prescriptionRef);
}

export function isApplicable(state: ConfiguratorState): boolean {
  return state.rxType !== "NON_PRESCRIPTION";
}

export function canContinue(state: ConfiguratorState): boolean {
  if (isComplete(state)) {
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

export async function onContinue(props: StepProps): Promise<void> {
  if (isComplete(props.state)) {
    props.dispatch({ type: "CONTINUE" });
    return;
  }
  if (activeSubmitHandler) {
    await activeSubmitHandler();
    return;
  }
  if (props.state.prescription) {
    const res = await props.api.submitPrescription({
      rxType: props.state.rxType ?? "SINGLE_VISION",
      prescription: props.state.prescription,
    });
    props.dispatch({ type: "SET_PRESCRIPTION_REF", prescriptionRef: res.rxRef });
    props.dispatch({ type: "CONTINUE" });
  }
}

export const id = "prescription";
export const titleKey = "Prescription";
export const Component = PrescriptionStep;

export const prescriptionStep: StepModule = {
  id,
  titleKey,
  isComplete,
  isApplicable,
  canContinue,
  onContinue,
  Component,
};

export default prescriptionStep;
export { PrescriptionStep };
