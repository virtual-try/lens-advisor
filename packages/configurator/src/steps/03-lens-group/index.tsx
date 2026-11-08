import type { ConfiguratorState, StepModule } from "../../shell/types.js";
import { LensGroupStep } from "./LensGroupStep.js";
import { getSelectedLensGroupId } from "./store.js";

export function isComplete(state: ConfiguratorState): boolean {
  const groupId = getSelectedLensGroupId(state);
  if (!groupId || !state.catalog) return false;
  const group = state.catalog.lensGroups.find((g) => g.id === groupId);
  if (!group) return false;
  const rxType = state.rxType ?? state.selection.rxType;
  return group.lenses.some(
    (lens) => !rxType || lens.limits.rxTypes.includes(rxType),
  );
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
  id: "lens-group",
  titleKey: "lens_group",
  isComplete,
  isApplicable,
  Component: LensGroupStep,
};

export default step;
