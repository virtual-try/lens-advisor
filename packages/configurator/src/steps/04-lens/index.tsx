import { checkLens } from "../../../../rx-core/src/limits/check-lens.js";
import type { ConfiguratorState, StepModule } from "../../shell/types.js";
import { getSelectedLensGroupId } from "../03-lens-group/store.js";
import { LensStep } from "./LensStep.js";

export function isComplete(state: ConfiguratorState): boolean {
  if (!state.selection.lensId || !state.catalog) return false;
  const chosenGroupId = getSelectedLensGroupId(state);
  if (!chosenGroupId) return false;
  const group = state.catalog.lensGroups.find((g) => g.id === chosenGroupId);
  if (!group) return false;
  const lens = group.lenses.find((l) => l.id === state.selection.lensId);
  if (!lens) return false;
  const rxType = state.rxType ?? state.selection.rxType;
  const check = checkLens(state.prescription, rxType, lens);
  return check.available;
}

export function isApplicable(state: ConfiguratorState): boolean {
  if (!state.catalog?.lensGroups || state.catalog.lensGroups.length === 0) {
    return false;
  }
  const rxType = state.rxType ?? state.selection.rxType;
  return state.catalog.lensGroups.some((group) =>
    group.lenses.some((lens) => !rxType || lens.limits.rxTypes.includes(rxType)),
  );
}

export const step: StepModule = {
  id: "lens",
  titleKey: "lens",
  isComplete,
  isApplicable,
  Component: LensStep,
};

export default step;
