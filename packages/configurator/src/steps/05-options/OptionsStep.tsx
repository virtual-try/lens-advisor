import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import type { CatalogResponse, OptionGroup } from "../../../../rx-core/src/index.js";
import { formatMoney } from "../../shared/format";
import type { StepProps } from "../../shell/types";
import optionsCss from "./options.css?inline";
import { strings } from "./strings";

export function getPreselectedOptionIds(
  catalog: CatalogResponse | null | undefined,
  currentSelectedIds: readonly string[],
): string[] {
  if (!catalog?.optionGroups) return [];
  const preselected: string[] = [];

  for (const group of catalog.optionGroups) {
    if (group.values.length === 0) continue;
    const hasSelection = group.values.some((v) => currentSelectedIds.includes(v.id));
    if (!hasSelection) {
      const firstVal = group.values[0];
      if (firstVal && firstVal.priceDelta.amountMinor === 0) {
        preselected.push(firstVal.id);
      }
    }
  }

  return preselected;
}

export function OptionsStep({ state, dispatch }: StepProps): JSX.Element | null {
  const catalog = state.catalog;
  const optionGroups = catalog?.optionGroups ?? [];

  useEffect(() => {
    if (!catalog) return;
    const preselected = getPreselectedOptionIds(catalog, state.selection.optionValueIds);
    if (preselected.length > 0) {
      const merged = Array.from(new Set([...state.selection.optionValueIds, ...preselected]));
      dispatch({
        type: "SET_OPTIONS",
        optionValueIds: merged,
      });
    }
  }, [catalog, dispatch, state.selection.optionValueIds]);

  const handleSelectOption = (group: OptionGroup, valId: string) => {
    const groupValIds = new Set(group.values.map((v) => v.id));
    const remaining = state.selection.optionValueIds.filter((id) => !groupValIds.has(id));
    dispatch({
      type: "SET_OPTIONS",
      optionValueIds: [...remaining, valId],
    });
  };

  return (
    <div class="la-options-step">
      <style>{optionsCss}</style>
      <div class="la-step-head">
        <h2 id="la-options-title" tabIndex={-1}>
          {strings.stepHeading}
        </h2>
        <p>{strings.stepDescription}</p>
      </div>

      {optionGroups.map((group) => {
        const isColorGroup =
          group.kind === "COLOR" || group.values.some((v) => typeof v.swatch === "string");

        return (
          <fieldset key={group.id} class="la-fieldset la-section">
            <legend class="la-section__title">{group.name}</legend>

            {isColorGroup ? (
              <div
                class="la-swatches"
                role="radiogroup"
                aria-label={group.name}
              >
                {group.values.map((val) => {
                  const isSelected = state.selection.optionValueIds.includes(val.id);
                  const deltaText =
                    val.priceDelta.amountMinor === 0
                      ? strings.included
                      : strings.priceDelta(
                          formatMoney(
                            val.priceDelta.amountMinor,
                            val.priceDelta.currency,
                          ),
                        );

                  const chipStyle = val.swatch
                    ? { "--la-swatch-color": val.swatch }
                    : undefined;

                  return (
                    <label
                      key={val.id}
                      class={`la-swatch${isSelected ? " la-swatch--selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`la-option-${group.id}`}
                        value={val.id}
                        checked={isSelected}
                        onChange={() => handleSelectOption(group, val.id)}
                      />
                      <span
                        class="la-swatch__chip"
                        style={chipStyle}
                        aria-hidden="true"
                      />
                      <span class="la-swatch__name">{val.label}</span>
                      <span class="la-swatch__price">{deltaText}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div
                class="la-choices"
                role="radiogroup"
                aria-label={group.name}
              >
                {group.values.map((val) => {
                  const isSelected = state.selection.optionValueIds.includes(val.id);
                  const deltaText =
                    val.priceDelta.amountMinor === 0
                      ? strings.included
                      : strings.priceDelta(
                          formatMoney(
                            val.priceDelta.amountMinor,
                            val.priceDelta.currency,
                          ),
                        );

                  return (
                    <label
                      key={val.id}
                      class={`la-choice${isSelected ? " la-choice--selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`la-option-${group.id}`}
                        value={val.id}
                        checked={isSelected}
                        onChange={() => handleSelectOption(group, val.id)}
                      />
                      <span class="la-mark" aria-hidden="true" />
                      <span class="la-choice__body">
                        <span class="la-choice__title">{val.label}</span>
                      </span>
                      <span class="la-choice__price">{deltaText}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
