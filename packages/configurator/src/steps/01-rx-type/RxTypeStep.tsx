import type { JSX } from "preact";
import type { CatalogResponse, RxType } from "../../../../rx-core/src/index.js";
import { formatMoney } from "../../shared/format";
import type { StepProps } from "../../shell/types";
import { strings } from "./strings";
import rxTypeCss from "./rx-type.css?inline";

export function getLowestPriceForRxType(
  catalog: CatalogResponse | null,
  rxType: RxType,
): { amountMinor: number; currency: string } | null {
  if (!catalog || !catalog.lensGroups) return null;
  let lowest: { amountMinor: number; currency: string } | null = null;
  for (const group of catalog.lensGroups) {
    for (const lens of group.lenses) {
      if (lens.limits.rxTypes.includes(rxType)) {
        if (!lowest || lens.price.amountMinor < lowest.amountMinor) {
          lowest = { amountMinor: lens.price.amountMinor, currency: lens.price.currency };
        }
      }
    }
  }
  return lowest;
}

const RX_OPTIONS: Array<{
  type: RxType;
  title: string;
  desc: string;
  renderPictogram: () => JSX.Element;
}> = [
  {
    type: "SINGLE_VISION",
    title: strings.types.SINGLE_VISION.title,
    desc: strings.types.SINGLE_VISION.desc,
    renderPictogram: () => (
      <svg class="la-choice__pict" viewBox="0 0 40 40" aria-hidden="true">
        <circle class="la-pict__zone" cx="20" cy="20" r="16" />
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="1.8" />
      </svg>
    ),
  },
  {
    type: "PROGRESSIVE",
    title: strings.types.PROGRESSIVE.title,
    desc: strings.types.PROGRESSIVE.desc,
    renderPictogram: () => (
      <svg class="la-choice__pict" viewBox="0 0 40 40" aria-hidden="true">
        <path class="la-pict__zone" d="M6.1 28a16 16 0 0027.8 0z" />
        <path
          d="M4.6 15h30.8M6.1 28h27.8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-dasharray="2.5 2.5"
        />
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="1.8" />
      </svg>
    ),
  },
  {
    type: "READING",
    title: strings.types.READING.title,
    desc: strings.types.READING.desc,
    renderPictogram: () => (
      <svg class="la-choice__pict" viewBox="0 0 40 40" aria-hidden="true">
        <path class="la-pict__zone" d="M4 20a16 16 0 0032 0z" />
        <path d="M4 20h32" stroke="currentColor" stroke-width="1.4" />
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" stroke-width="1.8" />
      </svg>
    ),
  },
  {
    type: "NON_PRESCRIPTION",
    title: strings.types.NON_PRESCRIPTION.title,
    desc: strings.types.NON_PRESCRIPTION.desc,
    renderPictogram: () => (
      <svg class="la-choice__pict" viewBox="0 0 40 40" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-dasharray="3 4"
        />
      </svg>
    ),
  },
];

export function RxTypeStep({ state, dispatch }: StepProps): JSX.Element {
  const availableOptions = RX_OPTIONS.map((opt) => {
    const price = getLowestPriceForRxType(state.catalog, opt.type);
    return {
      ...opt,
      price,
    };
  }).filter((opt): opt is typeof opt & { price: { amountMinor: number; currency: string } } => {
    return opt.price !== null;
  });

  return (
    <div class="la-step-rx-type">
      <style>{rxTypeCss}</style>
      <div class="la-step-head">
        <h2 id="la-step-title">{strings.title}</h2>
        <p>{strings.subtitle}</p>
      </div>
      <fieldset class="la-fieldset">
        <legend class="la-sr">{strings.legend}</legend>
        <div class="la-choices" role="radiogroup" aria-labelledby="la-step-title">
          {availableOptions.map((opt) => {
            const isSelected = state.rxType === opt.type;
            const priceText = `${strings.fromPricePrefix}${formatMoney(
              opt.price.amountMinor,
              opt.price.currency,
            )}`;
            return (
              <label
                key={opt.type}
                class={`la-choice${isSelected ? " la-choice--selected" : ""}`}
              >
                <input
                  type="radio"
                  name="rx-type"
                  value={opt.type}
                  checked={isSelected}
                  onChange={() => {
                    dispatch({ type: "SET_RX_TYPE", rxType: opt.type });
                    dispatch({ type: "SET_PRESCRIPTION_REF", prescriptionRef: "" });
                  }}
                />
                {opt.renderPictogram()}
                <span class="la-choice__body">
                  <span class="la-choice__title">{opt.title}</span>
                  <span class="la-choice__desc">{opt.desc}</span>
                </span>
                <span class="la-choice__price">{priceText}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <details class="la-help">
        <summary>{strings.help.summary}</summary>
        <dl>
          <div>
            <dt>{strings.help.addTitle}</dt>
            <dd>{strings.help.addDesc}</dd>
          </div>
          <div>
            <dt>{strings.help.sphTitle}</dt>
            <dd>{strings.help.sphDesc}</dd>
          </div>
          <div>
            <dt>{strings.help.unsureTitle}</dt>
            <dd>{strings.help.unsureDesc}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
