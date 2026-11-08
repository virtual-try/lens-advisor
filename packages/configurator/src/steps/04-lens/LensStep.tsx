import type { JSX } from "preact";
import { useCallback, useMemo } from "preact/hooks";
import { filterLenses } from "../../../../rx-core/src/limits/filter-lenses.js";
import type { FilteredLens } from "../../../../rx-core/src/limits/types.js";
import { formatMoney } from "../../shared/format.js";
import type { StepProps } from "../../shell/types.js";
import choiceCardCss from "../03-lens-group/ChoiceCard.css?inline";
import { OptionCard } from "../03-lens-group/OptionCard.js";
import { getSelectedLensGroupId } from "../03-lens-group/store.js";
import { formatLensReason } from "./format-reason.js";
import lensCss from "./lens.css?inline";
import { lensStrings } from "./strings.js";

export function LensStep({ state, dispatch }: StepProps): JSX.Element {
  const rxType = state.rxType ?? state.selection.rxType;
  const catalog = state.catalog;

  const chosenGroupId = getSelectedLensGroupId(state);

  const chosenGroup = useMemo(() => {
    if (!catalog?.lensGroups || catalog.lensGroups.length === 0) return null;
    if (chosenGroupId) {
      const found = catalog.lensGroups.find((g) => g.id === chosenGroupId);
      if (found) return found;
    }
    // Fallback: pick first group with lenses
    return catalog.lensGroups[0] ?? null;
  }, [catalog, chosenGroupId]);

  // Run limits engine filterLenses on the chosen group's lenses
  const { availableLenses, orderedLenses, allUnavailable } = useMemo(() => {
    if (!chosenGroup) {
      return {
        availableLenses: [] as FilteredLens[],
        unavailableLenses: [] as FilteredLens[],
        orderedLenses: [] as FilteredLens[],
        allUnavailable: false,
      };
    }
    const filtered: FilteredLens[] = filterLenses(
      state.prescription,
      rxType,
      chosenGroup.lenses,
    );
    const available = filtered.filter((item: FilteredLens) => item.available);
    const unavailable = filtered.filter((item: FilteredLens) => !item.available);
    // Scope: available listed first, then unavailable, each keeping catalog order
    const ordered = [...available, ...unavailable];
    const isAllUnavailable = filtered.length > 0 && available.length === 0;

    return {
      availableLenses: available,
      unavailableLenses: unavailable,
      orderedLenses: ordered,
      allUnavailable: isAllUnavailable,
    };
  }, [chosenGroup, rxType, state.prescription]);

  const handleSelectLens = useCallback(
    (lensId: string) => {
      dispatch({ type: "SET_LENS", lensId });
    },
    [dispatch],
  );

  const handleChangePrescription = useCallback(() => {
    dispatch({ type: "GO_TO_STEP", stepIndex: 1 });
  }, [dispatch]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (availableLenses.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const currentIndex = availableLenses.findIndex(
          (item: FilteredLens) => item.lens.id === state.selection.lensId,
        );
        const nextIndex =
          currentIndex < 0 ? 0 : (currentIndex + 1) % availableLenses.length;
        const nextItem = availableLenses[nextIndex];
        if (nextItem) {
          handleSelectLens(nextItem.lens.id);
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const currentIndex = availableLenses.findIndex(
          (item: FilteredLens) => item.lens.id === state.selection.lensId,
        );
        const prevIndex =
          currentIndex <= 0 ? availableLenses.length - 1 : currentIndex - 1;
        const prevItem = availableLenses[prevIndex];
        if (prevItem) {
          handleSelectLens(prevItem.lens.id);
        }
      }
    },
    [availableLenses, handleSelectLens, state.selection.lensId],
  );

  return (
    <div class="la-step-lens">
      <style>{choiceCardCss}</style>
      <style>{lensCss}</style>
      <div class="la-step-head">
        <h2 class="la-step-head__title">{lensStrings.stepTitle}</h2>
        <p class="la-step-head__desc">{lensStrings.stepDescription}</p>
      </div>

      {!chosenGroup ? (
        <p class="la-step-head__desc">{lensStrings.noGroupSelected}</p>
      ) : (
        <>
          {allUnavailable ? (
            <div class="la-notice" role="alert">
              <p class="la-notice__text">{lensStrings.allUnavailableExplanation}</p>
              <div class="la-notice__actions">
                <button
                  type="button"
                  class="la-notice__btn"
                  onClick={handleChangePrescription}
                >
                  {lensStrings.changePrescription}
                </button>
              </div>
            </div>
          ) : null}

          <div
            class="la-choices"
            role="radiogroup"
            aria-label={lensStrings.lensListLabel}
            onKeyDown={handleKeyDown}
          >
            {orderedLenses.map((item) => {
              const isChecked = state.selection.lensId === item.lens.id;
              const reasonId = !item.available
                ? `la-reason-${item.lens.id}`
                : undefined;
              const reasonText =
                !item.available && item.reason
                  ? formatLensReason(item.reason)
                  : undefined;
              const priceLabel = formatMoney(
                item.lens.price.amountMinor,
                item.lens.price.currency,
              );

              return (
                <OptionCard
                  key={item.lens.id}
                  id={`la-lens-${item.lens.id}`}
                  name="lens"
                  value={item.lens.id}
                  title={item.lens.name}
                  description={item.lens.description}
                  priceLabel={priceLabel}
                  checked={isChecked}
                  disabled={!item.available}
                  reasonText={reasonText}
                  reasonId={reasonId}
                  onChange={() => {
                    if (item.available) {
                      handleSelectLens(item.lens.id);
                    }
                  }}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
