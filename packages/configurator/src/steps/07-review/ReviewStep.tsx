import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type {
  CatalogResponse,
  Lens,
  OptionValue,
} from "../../../../rx-core/src/index.js";
import { priceSelection, type PriceBreakdown } from "../../../../rx-core/src/pricing/index.js";
import { formatAxis, formatDiopter, formatPd } from "../../../../rx-core/src/format/index.js";
import { formatMoney } from "../../shared/format";
import type { StepProps } from "../../shell/types";
import { PriceSummary } from "../../price-summary";
import { findCatalogCurrency, resolveFramePrice } from "../../price-summary/resolve-frame-price";
import { addBundle, refreshCartOrRedirect, type AddBundleResult } from "../../cart";
import { strings } from "./strings";
import reviewCss from "./review.css?inline";

export interface ReviewStepProps extends StepProps {
  onSuccess?: (result: AddBundleResult) => void;
  fetchFn?: typeof fetch;
  routesRoot?: string;
  onRedirect?: (url: string) => void;
}

function findLens(catalog?: CatalogResponse | null, lensId?: string): Lens | undefined {
  if (!catalog || !lensId) return undefined;
  for (const group of catalog.lensGroups ?? []) {
    for (const lens of group.lenses ?? []) {
      if (lens.id === lensId) {
        return lens;
      }
    }
  }
  return undefined;
}

function findOptionValue(catalog?: CatalogResponse | null, valueId?: string): OptionValue | undefined {
  if (!catalog || !valueId) return undefined;
  for (const group of catalog.optionGroups ?? []) {
    for (const val of group.values ?? []) {
      if (val.id === valueId) {
        return val;
      }
    }
  }
  return undefined;
}

export function ReviewStep({
  state,
  dispatch,
  product,
  mount,
  onSuccess,
  fetchFn,
  routesRoot,
  onRedirect,
}: ReviewStepProps): JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storeRxInOrder = state.catalog?.settings?.storeRxInOrder ?? false;

  const framePrice = resolveFramePrice({
    product,
    state,
    selection: state.selection,
    catalog: state.catalog,
    mount,
  });

  const catalogCurrency = findCatalogCurrency(state.catalog);
  const fallbackCurrency = framePrice?.currency || catalogCurrency;

  let breakdown: PriceBreakdown | null = null;
  if (state.catalog) {
    try {
      breakdown = priceSelection(
        state.selection,
        state.catalog,
        framePrice ?? { amountMinor: 0, currency: fallbackCurrency },
      );
    } catch {
      // Price calculation errors handled gracefully
    }
  }

  const formattedTotal =
    breakdown && framePrice
      ? formatMoney(breakdown.total.amountMinor, breakdown.total.currency)
      : null;

  const handleAddToCart = async () => {
    if (isSubmitting) return; // Prevent double click
    if (!state.catalog) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await addBundle({
        selection: state.selection,
        catalog: state.catalog,
        prescription: state.prescription,
        storeRxInOrder,
        fetch: fetchFn,
        routesRoot,
      });

      setIsSubmitting(false);
      onSuccess?.(result);

      // Close sheet
      dispatch({ type: "CLOSE" });

      // Refresh cart or redirect to /cart
      refreshCartOrRedirect({
        routesRoot,
        redirectFn: onRedirect,
      });
    } catch {
      setIsSubmitting(false);
      setError(strings.errorChildAddFailed);
    }
  };

  // Choice items
  // 1. Frame
  const matchingVariant =
    product?.variants && state.selection.frameVariantId
      ? product.variants.find((v) => v.id === state.selection.frameVariantId)
      : product?.variants?.[0];
  const frameTitle = product?.title || strings.labels.frame;
  const frameSub =
    matchingVariant?.title && matchingVariant.title !== "Default Title"
      ? matchingVariant.title
      : "";
  const framePriceFormatted = framePrice
    ? formatMoney(framePrice.amountMinor, framePrice.currency)
    : "";

  // 2. Vision
  const visionType = state.rxType || "SINGLE_VISION";
  const visionTitle = strings.visionTypes[visionType];
  const visionSub = strings.visionSubtitles[visionType];

  // 3. Prescription
  let rxValueText: string;
  let rxSubText = "";
  if (!storeRxInOrder) {
    rxValueText = strings.rx.onFile;
    rxSubText = visionTitle;
  } else {
    if (visionType === "NON_PRESCRIPTION") {
      rxValueText = strings.rx.nonPrescription;
    } else if (state.prescription) {
      rxValueText = strings.rx.enteredByUser;
      rxSubText = `${strings.rx.pdPrefix}${formatPd(state.prescription.pd)}${strings.rx.pdUnit}`;
    } else if (state.prescriptionRef) {
      rxValueText = strings.rx.uploaded;
    } else {
      rxValueText = strings.rx.onFile;
      rxSubText = visionTitle;
    }
  }

  // 4. Lens
  const chosenLens = findLens(state.catalog, state.selection.lensId);
  const lensName = chosenLens?.name || strings.noneSelected;
  const lensSub = chosenLens?.description || "";
  const lensPriceFormatted = chosenLens
    ? formatMoney(chosenLens.price.amountMinor, chosenLens.price.currency)
    : "";

  // 5. Options
  const selectedOptions: OptionValue[] = [];
  let optionsDeltaMinor = 0;
  for (const valId of state.selection.optionValueIds) {
    const val = findOptionValue(state.catalog, valId);
    if (val) {
      selectedOptions.push(val);
      optionsDeltaMinor += val.priceDelta.amountMinor;
    }
  }
  const optionsValueText =
    selectedOptions.map((o) => o.label).join(", ") || strings.noneSelected;
  const optionsSubText = selectedOptions
    .map((o) => {
      const deltaText =
        o.priceDelta.amountMinor === 0
          ? strings.included
          : `+${formatMoney(o.priceDelta.amountMinor, o.priceDelta.currency)}`;
      return `${deltaText} ${o.label}`;
    })
    .join(", ");
  const optionsPriceFormatted =
    selectedOptions.length === 0
      ? ""
      : optionsDeltaMinor === 0
        ? strings.included
        : `+${formatMoney(optionsDeltaMinor, fallbackCurrency)}`;

  // 6. Extras / Add-ons
  const selectedAddOns = (state.catalog?.addOns ?? []).filter((a) =>
    state.selection.addOnIds.includes(a.id),
  );
  let addOnsTotalMinor = 0;
  for (const addOn of selectedAddOns) {
    addOnsTotalMinor += addOn.price.amountMinor;
  }
  const addOnsValueText =
    selectedAddOns.map((a) => a.name).join(", ") || strings.noneSelected;
  const addOnsPriceFormatted =
    selectedAddOns.length === 0
      ? ""
      : `+${formatMoney(addOnsTotalMinor, fallbackCurrency)}`;

  return (
    <div class="la-review-step">
      <style>{reviewCss}</style>
      <div class="la-step-head">
        <h2 id="la-title" tabIndex={-1}>
          {strings.stepTitle}
        </h2>
        <p>{strings.stepDescription}</p>
      </div>

      <div class="la-review">
        {/* Frame */}
        <div class="la-review__item">
          <p class="la-review__label">{strings.labels.frame}</p>
          <p class="la-review__value">{frameTitle}</p>
          {frameSub ? <p class="la-review__sub">{frameSub}</p> : null}
          <div class="la-review__aside">
            {framePriceFormatted ? (
              <span class="la-review__price">{framePriceFormatted}</span>
            ) : null}
            <button
              type="button"
              class="la-link"
              onClick={() => dispatch({ type: "GO_TO_STEP", stepIndex: 0 })}
            >
              {strings.change}
              <span class="la-sr">{strings.sr.frame}</span>
            </button>
          </div>
        </div>

        {/* Vision */}
        <div class="la-review__item">
          <p class="la-review__label">{strings.labels.vision}</p>
          <p class="la-review__value">{visionTitle}</p>
          {visionSub ? <p class="la-review__sub">{visionSub}</p> : null}
          <div class="la-review__aside">
            <button
              type="button"
              class="la-link"
              onClick={() => dispatch({ type: "GO_TO_STEP", stepIndex: 0 })}
            >
              {strings.edit}
              <span class="la-sr">{strings.sr.vision}</span>
            </button>
          </div>
        </div>

        {/* Prescription */}
        <div class="la-review__item">
          <p class="la-review__label">{strings.labels.prescription}</p>
          <p class="la-review__value">{rxValueText}</p>
          {rxSubText ? <p class="la-review__sub">{rxSubText}</p> : null}
          <div class="la-review__aside">
            <button
              type="button"
              class="la-link"
              onClick={() => dispatch({ type: "GO_TO_STEP", stepIndex: 1 })}
            >
              {strings.edit}
              <span class="la-sr">{strings.sr.prescription}</span>
            </button>
          </div>

          {storeRxInOrder && state.prescription && (
            <table class="la-rxtable">
              <caption class="la-sr">{strings.rx.table.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    <span class="la-sr">{strings.rx.table.eye}</span>
                  </th>
                  <th scope="col">{strings.rx.table.sph}</th>
                  <th scope="col">{strings.rx.table.cyl}</th>
                  <th scope="col">{strings.rx.table.axis}</th>
                  <th scope="col">{strings.rx.table.add}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{strings.rx.table.right}</th>
                  <td>{formatDiopter(state.prescription.od.sph)}</td>
                  <td>
                    {state.prescription.od.cyl !== undefined && state.prescription.od.cyl !== 0
                      ? formatDiopter(state.prescription.od.cyl)
                      : strings.rx.table.none}
                  </td>
                  <td>
                    {state.prescription.od.axis !== undefined
                      ? formatAxis(state.prescription.od.axis)
                      : strings.rx.table.none}
                  </td>
                  <td>
                    {state.prescription.od.add !== undefined && state.prescription.od.add !== 0
                      ? formatDiopter(state.prescription.od.add)
                      : strings.rx.table.none}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{strings.rx.table.left}</th>
                  <td>{formatDiopter(state.prescription.os.sph)}</td>
                  <td>
                    {state.prescription.os.cyl !== undefined && state.prescription.os.cyl !== 0
                      ? formatDiopter(state.prescription.os.cyl)
                      : strings.rx.table.none}
                  </td>
                  <td>
                    {state.prescription.os.axis !== undefined
                      ? formatAxis(state.prescription.os.axis)
                      : strings.rx.table.none}
                  </td>
                  <td>
                    {state.prescription.os.add !== undefined && state.prescription.os.add !== 0
                      ? formatDiopter(state.prescription.os.add)
                      : strings.rx.table.none}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Lens */}
        <div class="la-review__item">
          <p class="la-review__label">{strings.labels.lens}</p>
          <p class="la-review__value">{lensName}</p>
          {lensSub ? <p class="la-review__sub">{lensSub}</p> : null}
          <div class="la-review__aside">
            {lensPriceFormatted ? (
              <span class="la-review__price">{lensPriceFormatted}</span>
            ) : null}
            <button
              type="button"
              class="la-link"
              onClick={() => dispatch({ type: "GO_TO_STEP", stepIndex: 3 })}
            >
              {strings.edit}
              <span class="la-sr">{strings.sr.lens}</span>
            </button>
          </div>
        </div>

        {/* Options */}
        <div class="la-review__item">
          <p class="la-review__label">{strings.labels.options}</p>
          <p class="la-review__value">{optionsValueText}</p>
          {optionsSubText ? <p class="la-review__sub">{optionsSubText}</p> : null}
          <div class="la-review__aside">
            {optionsPriceFormatted ? (
              <span class="la-review__price">{optionsPriceFormatted}</span>
            ) : null}
            <button
              type="button"
              class="la-link"
              onClick={() => dispatch({ type: "GO_TO_STEP", stepIndex: 4 })}
            >
              {strings.edit}
              <span class="la-sr">{strings.sr.options}</span>
            </button>
          </div>
        </div>

        {/* Extras */}
        <div class="la-review__item">
          <p class="la-review__label">{strings.labels.extras}</p>
          <p class="la-review__value">{addOnsValueText}</p>
          <div class="la-review__aside">
            {addOnsPriceFormatted ? (
              <span class="la-review__price">{addOnsPriceFormatted}</span>
            ) : null}
            <button
              type="button"
              class="la-link"
              onClick={() => dispatch({ type: "GO_TO_STEP", stepIndex: 5 })}
            >
              {strings.edit}
              <span class="la-sr">{strings.sr.extras}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Reassurance text */}
      <p class="la-reassure">{strings.reassurance}</p>

      {/* Expanded PriceSummary */}
      <div class="la-review__summary">
        <PriceSummary
          variant="expanded"
          state={state}
          selection={state.selection}
          catalog={state.catalog ?? undefined}
          product={product}
          mount={mount}
        />
      </div>

      {/* Error state with Retry */}
      {error && (
        <div class="la-review__error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            class="la-btn la-btn--primary"
            onClick={handleAddToCart}
          >
            {strings.retry}
          </button>
        </div>
      )}

      {/* Primary Add to cart button */}
      <div class="la-review__action">
        <button
          type="button"
          class="la-btn la-btn--primary la-btn--block"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          onClick={handleAddToCart}
        >
          {isSubmitting
            ? strings.addingToCart
            : strings.addToCart(formattedTotal ?? "")}
        </button>
      </div>
    </div>
  );
}
