import type { JSX } from "preact";
import { useCallback, useMemo, useRef } from "preact/hooks";
import { formatMoney } from "../../shared/format.js";
import type { StepProps } from "../../shell/types.js";
import choiceCardCss from "./ChoiceCard.css?inline";
import { OptionCard } from "./OptionCard.js";
import { lensGroupStrings } from "./strings.js";

export function LensGroupStep({ state, dispatch }: StepProps): JSX.Element {
  const rxType = state.rxType ?? state.selection.rxType;
  const catalog = state.catalog;

  const currentSelectedId = state.lensGroupId;
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Filter groups: groups with zero lenses for this Rx type are hidden
  const visibleGroups = useMemo(() => {
    if (!catalog?.lensGroups) return [];
    return catalog.lensGroups.filter((group) => {
      const supportedLenses = group.lenses.filter(
        (lens) => !rxType || lens.limits.rxTypes.includes(rxType),
      );
      return supportedLenses.length > 0;
    });
  }, [catalog, rxType]);

  const handleSelectGroup = useCallback(
    (groupId: string) => {
      dispatch({ type: "SET_LENS_GROUP", lensGroupId: groupId });
    },
    [dispatch],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (visibleGroups.length === 0) return;
      const activeId =
        (document.activeElement as HTMLInputElement)?.value || state.lensGroupId;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const currentIndex = visibleGroups.findIndex((g) => g.id === activeId);
        const nextIndex =
          currentIndex < 0 ? 0 : (currentIndex + 1) % visibleGroups.length;
        const nextGroup = visibleGroups[nextIndex];
        if (nextGroup) {
          handleSelectGroup(nextGroup.id);
          inputRefs.current[nextGroup.id]?.focus();
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const currentIndex = visibleGroups.findIndex((g) => g.id === activeId);
        const prevIndex =
          currentIndex <= 0 ? visibleGroups.length - 1 : currentIndex - 1;
        const prevGroup = visibleGroups[prevIndex];
        if (prevGroup) {
          handleSelectGroup(prevGroup.id);
          inputRefs.current[prevGroup.id]?.focus();
        }
      }
    },
    [handleSelectGroup, state.lensGroupId, visibleGroups],
  );

  return (
    <div class="la-step-lens-group">
      <style>{choiceCardCss}</style>
      <div class="la-step-head">
        <h2 class="la-step-head__title">{lensGroupStrings.stepTitle}</h2>
        <p class="la-step-head__desc">{lensGroupStrings.stepDescription}</p>
      </div>

      {visibleGroups.length === 0 ? (
        <p class="la-step-head__desc">{lensGroupStrings.noGroupsAvailable}</p>
      ) : (
        <div
          class="la-choices"
          role="radiogroup"
          aria-label={lensGroupStrings.groupListLabel}
          onKeyDown={handleKeyDown}
        >
          {visibleGroups.map((group) => {
            const supportedLenses = group.lenses.filter(
              (lens) => !rxType || lens.limits.rxTypes.includes(rxType),
            );

            // Calculate "from" price as the minimum price of supported lenses
            let minAmount = Infinity;
            let currency = "USD";
            for (const lens of supportedLenses) {
              if (lens.price.amountMinor < minAmount) {
                minAmount = lens.price.amountMinor;
                currency = lens.price.currency;
              }
            }

            const formattedPrice =
              minAmount !== Infinity
                ? formatMoney(minAmount, currency)
                : "";
            const priceLabel = formattedPrice
              ? lensGroupStrings.fromPrice(formattedPrice)
              : undefined;

            const isChecked = currentSelectedId === group.id;

            return (
              <OptionCard
                key={group.id}
                id={`la-group-${group.id}`}
                name="lens-group"
                value={group.id}
                title={group.name}
                description={group.description}
                priceLabel={priceLabel}
                checked={isChecked}
                onChange={() => handleSelectGroup(group.id)}
                inputRef={(el) => {
                  inputRefs.current[group.id] = el;
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
