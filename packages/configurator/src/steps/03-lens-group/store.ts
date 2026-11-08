import type { ConfiguratorState } from "../../shell/types.js";

let selectedGroupId: string | null = null;

/**
 * Returns the currently selected lens group ID.
 * If a lens is already selected in state, derives the group from that lens.
 * Otherwise returns the module-stored group ID.
 */
export function getSelectedLensGroupId(state?: ConfiguratorState | null): string | null {
  if (state?.selection?.lensId && state.catalog) {
    for (const group of state.catalog.lensGroups) {
      if (group.lenses.some((l) => l.id === state.selection.lensId)) {
        return group.id;
      }
    }
  }
  return selectedGroupId;
}

/**
 * Stores the chosen lens group ID.
 */
export function setSelectedLensGroupId(groupId: string | null): void {
  selectedGroupId = groupId;
}

/**
 * Clears the chosen lens group ID.
 */
export function clearSelectedLensGroupId(): void {
  selectedGroupId = null;
}
