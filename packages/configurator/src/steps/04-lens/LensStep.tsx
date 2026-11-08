import type { JSX } from "preact";
import { useCallback, useMemo, useRef } from "preact/hooks";
import { filterLenses } from "../../../../rx-core/src/limits/filter-lenses.js";
import type { FilteredLens } from "../../../../rx-core/src/limits/types.js";
import { formatMoney } from "../../shared/format.js";
import type { StepProps } from "../../shell/types.js";
import choiceCardCss from "../03-lens-group/ChoiceCard.css?inline";
import { OptionCard } from "../03-lens-group/OptionCard.js";
import { formatLensReason } from "./format-reason.js";
import lensCss from "./lens.css?inline";
import { lensStrings } from "./strings.js";

export function LensStep({ state, dispatch }: StepProps): JSX.Element {
  const rxType = state.rxType ?? state.selection.rxType;
  const catalog = state.catalog;

  const chosenGroupId = state.lensGroupId;
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const chosenGroup = useMemo(() => {
    if (!catalog?.lensGroups || catalog.lensGroups.length === 0 || !chosenGroupId) {
      return null;
    }
    return catalog.lensGroups.find((g) => g.id === chosenGroupId) ?? null;
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
    dispatch({ type: "GO_TO_STEP", stepId: "prescription" });
  }, [dispatch]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (orderedLenses.length === 0 || availableLenses.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const currentId =
          (document.activeElement as HTMLInputElement)?.value ||
          state.selection.lensId;
        const currentIndex = orderedLenses.findIndex(
          (item) => item.lens.id === currentId,
        );
        let nextIndex = currentIndex;
        for (let i = 1; i <= orderedLenses.length; i++) {
          const candidateIdx =
            currentIndex < 0 ? 0 : (currentIndex + i) % orderedLenses.length;
          const candidate = orderedLenses[candidateIdx];
          if (candidate?.available) {
            nextIndex = candidateIdx;
            break;
          }
        }
        const nextItem = orderedLenses[nextIndex];
        if (nextItem && nextItem.available) {
          handleSelectLens(nextItem.lens.id);
          inputRefs.current[nextItem.lens.id]?.focus();
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const currentId =
          (document.activeElement as HTMLInputElement)?.value ||
          state.selection.lensId;
        const currentIndex = orderedLenses.findIndex(
          (item) => item.lens.id === currentId,
        );
        let prevIndex = currentIndex;
        for (let i = 1; i <= orderedLenses.length; i++) {
          const candidateIdx =
            currentIndex <= 0
              ? (orderedLenses.length - i + orderedLenses.length) % orderedLenses.length
              : (currentIndex - i + orderedLenses.length) % orderedLenses.length;
          const candidate = orderedLenses[candidateIdx];
          if (candidate?.available) {
            prevIndex = candidateIdx;
            break;
          }
        }
        const prevItem = orderedLenses[prevIndex];
        if (prevItem && prevItem.available) {
          handleSelectLens(prevItem.lens.id);
          inputRefs.current[prevItem.lens.id]?.focus();
        }
      }
    },
    [availableLenses.length, handleSelectLens, orderedLenses, state.selection.lensId],
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
                  inputRef={(el) => {
                    inputRefs.current[item.lens.id] = el;
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
