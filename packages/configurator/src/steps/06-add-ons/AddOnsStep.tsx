import type { JSX } from "preact";
import { formatMoney } from "../../shared/format";
import type { StepProps } from "../../shell/types";
import addOnsCss from "./add-ons.css?inline";
import { strings } from "./strings";

export function AddOnsStep({ state, dispatch }: StepProps): JSX.Element | null {
  const addOns = state.catalog?.addOns ?? [];

  const handleToggleAddOn = (addOnId: string) => {
    dispatch({
      type: "TOGGLE_ADDON",
      addOnId,
    });
  };

  return (
    <div class="la-add-ons-step">
      <style>{addOnsCss}</style>
      <div class="la-step-head">
        <h2 id="la-addons-title" tabIndex={-1}>
          {strings.stepHeading}
        </h2>
        <p>{strings.stepDescription}</p>
      </div>

      <div
        class="la-choices"
        role="group"
        aria-labelledby="la-addons-title"
      >
        {addOns.map((addOn) => {
          const isChecked = state.selection.addOnIds.includes(addOn.id);
          const deltaText =
            addOn.price.amountMinor === 0
              ? strings.included
              : strings.priceDelta(
                  formatMoney(addOn.price.amountMinor, addOn.price.currency),
                );

          return (
            <label
              key={addOn.id}
              class={`la-choice${isChecked ? " la-choice--selected" : ""}`}
            >
              <input
                type="checkbox"
                name={`la-addon-${addOn.id}`}
                value={addOn.id}
                checked={isChecked}
                onChange={() => handleToggleAddOn(addOn.id)}
              />
              <span class="la-mark la-mark--box" aria-hidden="true">
                {isChecked && (
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
                  </svg>
                )}
              </span>
              <span class="la-choice__body">
                <span class="la-choice__title">{addOn.name}</span>
              </span>
              <span class="la-choice__price">{deltaText}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
