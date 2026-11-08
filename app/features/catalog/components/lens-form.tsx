import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RxType } from "../../../../packages/rx-core/src/index.js";
import { formatDiopter } from "../../../../packages/rx-core/src/format/index.js";
import {
  compileLabCode,
  validateTemplate,
} from "../../../../packages/rx-core/src/lab-code/index.js";
import { parseDiopterText } from "../../../../packages/rx-core/src/rx/parse.js";
import {
  parseMoneyText,
  toShopifyDecimal,
} from "../../../../packages/rx-core/src/pricing/index.js";
import type {
  CatalogLensDto,
  CatalogLensGroupDto,
} from "../catalog.service.server";
import { RX_TYPE_LABELS } from "../strings";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function usePolarisProperty<T extends HTMLElement>(
  propName: "checked" | "value",
  val: boolean | string,
) {
  const ref = useRef<T | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (ref.current) {
      (ref.current as Record<string, unknown>)[propName] = val;
    }
  });

  const refCallback = (el: T | null) => {
    ref.current = el;
    if (el) {
      (el as Record<string, unknown>)[propName] = val;
    }
  };

  return [ref, refCallback] as const;
}

function usePolarisCheckbox(
  checked: boolean,
  onCheckedChange: (checked: boolean) => void,
) {
  const ref = useRef<HTMLElementTagNameMap["s-checkbox"] | null>(null);
  const onCheckedChangeRef = useRef(onCheckedChange);
  onCheckedChangeRef.current = onCheckedChange;

  useIsomorphicLayoutEffect(() => {
    if (ref.current) {
      ref.current.checked = checked;
    }
  });

  const refCallback = useCallback((el: HTMLElementTagNameMap["s-checkbox"] | null) => {
    if (ref.current) {
      ref.current.removeEventListener("change", handleChange);
    }
    ref.current = el;
    if (el) {
      el.checked = checked;
      el.addEventListener("change", handleChange);
    }
  }, [checked]);

  function handleChange(e: Event) {
    const target = e.currentTarget as HTMLElementTagNameMap["s-checkbox"] | HTMLInputElement;
    const isNowChecked = Boolean(target?.checked);
    onCheckedChangeRef.current(isNowChecked);
  }

  useEffect(() => {
    const current = ref.current;
    return () => {
      if (current) {
        current.removeEventListener("change", handleChange);
      }
    };
  }, []);

  return [ref, refCallback] as const;
}

export interface LensFormProps {
  lens?: CatalogLensDto | null;
  groups: CatalogLensGroupDto[];
  defaultGroupId?: string;
  shopCurrency?: string;
  isSubmitting?: boolean;
  actionData?: unknown;
  onArchiveConfirm?: () => void;
  formId?: string;
  defaultValues?: {
    name?: string;
    description?: string;
    price?: string;
    currency?: string;
    sphMin?: string;
    sphMax?: string;
    cylMin?: string;
    cylMax?: string;
    addMin?: string;
    addMax?: string;
    labCodeTemplate?: string;
  };
}

export function LensForm({
  lens,
  groups,
  defaultGroupId,
  shopCurrency = "USD",
  isSubmitting = false,
  actionData,
  onArchiveConfirm,
  formId = "lens-form",
  defaultValues,
}: LensFormProps) {
  const initialGroupId =
    lens?.groupId ?? defaultGroupId ?? (groups[0]?.id || "");
  const initialName = defaultValues?.name ?? (lens?.name ?? "");
  const initialDescription =
    defaultValues?.description ?? (lens?.description ?? "");
  const initialPrice =
    defaultValues?.price ??
    (lens
      ? toShopifyDecimal(lens.price.amountMinor, lens.price.currency)
      : "80.00");
  const initialCurrency =
    defaultValues?.currency ?? (lens?.price.currency ?? shopCurrency);
  const initialRxTypes =
    lens?.limits.rxTypes && lens.limits.rxTypes.length > 0
      ? lens.limits.rxTypes
      : (["SINGLE_VISION"] as RxType[]);
  const initialSphMin =
    defaultValues?.sphMin ??
    (lens ? formatDiopter(lens.limits.sphMin) : "-8.00");
  const initialSphMax =
    defaultValues?.sphMax ??
    (lens ? formatDiopter(lens.limits.sphMax) : "+6.00");
  const initialCylMin =
    defaultValues?.cylMin ??
    (lens ? formatDiopter(lens.limits.cylMin) : "-4.00");
  const initialCylMax =
    defaultValues?.cylMax ?? (lens ? formatDiopter(lens.limits.cylMax) : "0.00");
  const initialAddMin =
    defaultValues?.addMin ??
    (lens?.limits.addMin != null ? formatDiopter(lens.limits.addMin) : "+1.00");
  const initialAddMax =
    defaultValues?.addMax ??
    (lens?.limits.addMax != null ? formatDiopter(lens.limits.addMax) : "+3.00");
  const initialTemplate =
    defaultValues?.labCodeTemplate ??
    (lens?.labCodeTemplate ?? "PO-58-[lens_type=NONE]-[lens_color=NONE]-00");

  const [groupId, setGroupId] = useState(initialGroupId);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [price, setPrice] = useState(initialPrice);
  const [currency] = useState(initialCurrency);
  const [rxTypes, setRxTypes] = useState<RxType[]>(initialRxTypes);
  const [sphMin, setSphMin] = useState(initialSphMin);
  const [sphMax, setSphMax] = useState(initialSphMax);
  const [cylMin, setCylMin] = useState(initialCylMin);
  const [cylMax, setCylMax] = useState(initialCylMax);
  const [addMin, setAddMin] = useState(initialAddMin);
  const [addMax, setAddMax] = useState(initialAddMax);
  const [template, setTemplate] = useState(initialTemplate);

  const [, setGroupIdRef] = usePolarisProperty<HTMLElementTagNameMap["s-select"]>(
    "value",
    groupId,
  );
  const [, setNameRef] = usePolarisProperty<HTMLElementTagNameMap["s-text-field"]>(
    "value",
    name,
  );
  const [, setDescriptionRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-area"]
  >("value", description);
  const [, setPriceRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-field"]
  >("value", price);
  const [, setSphMinRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-field"]
  >("value", sphMin);
  const [, setSphMaxRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-field"]
  >("value", sphMax);
  const [, setCylMinRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-field"]
  >("value", cylMin);
  const [, setCylMaxRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-field"]
  >("value", cylMax);
  const [, setAddMinRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-field"]
  >("value", addMin);
  const [, setAddMaxRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-field"]
  >("value", addMax);
  const [, setTemplateRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-field"]
  >("value", template);

  const modalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);

  // Template validation and live preview
  const templateValidation = validateTemplate(template);
  const templateError = !templateValidation.valid
    ? templateValidation.errors[0]?.code ||
      templateValidation.error ||
      "INVALID_TEMPLATE"
    : undefined;

  let previewCode: string | null = null;
  if (templateValidation.valid) {
    try {
      previewCode = compileLabCode(template, []).code;
    } catch {
      previewCode = null;
    }
  }

  // SPH Limits validation
  const parsedSphMin = parseDiopterText(sphMin, "sph");
  const parsedSphMax = parseDiopterText(sphMax, "sph");
  let sphMaxError: string | undefined;
  if (
    parsedSphMin.ok &&
    parsedSphMax.ok &&
    parsedSphMin.value > parsedSphMax.value
  ) {
    sphMaxError = "LIMITS_INVERTED";
  } else if (!parsedSphMax.ok) {
    sphMaxError = parsedSphMax.error;
  }

  // CYL Limits validation
  const parsedCylMin = parseDiopterText(cylMin, "cyl");
  const parsedCylMax = parseDiopterText(cylMax, "cyl");
  let cylMaxError: string | undefined;
  if (
    parsedCylMin.ok &&
    parsedCylMax.ok &&
    parsedCylMin.value > parsedCylMax.value
  ) {
    cylMaxError = "LIMITS_INVERTED";
  } else if (!parsedCylMax.ok) {
    cylMaxError = parsedCylMax.error;
  }

  // ADD Limits validation
  const hasAddMin = addMin.trim().length > 0;
  const hasAddMax = addMax.trim().length > 0;
  let addMaxError: string | undefined;
  if (hasAddMin && hasAddMax) {
    const parsedAddMin = parseDiopterText(addMin, "add");
    const parsedAddMax = parseDiopterText(addMax, "add");
    if (
      parsedAddMin.ok &&
      parsedAddMax.ok &&
      parsedAddMin.value > parsedAddMax.value
    ) {
      addMaxError = "LIMITS_INVERTED";
    }
  }

  // Price validation
  const parsedPrice = parseMoneyText(price, currency);
  let priceError: string | undefined;
  if (!parsedPrice.ok) {
    priceError = parsedPrice.error;
  } else if (parsedPrice.amountMinor < 0) {
    priceError = "NEGATIVE_PRICE";
  }

  // Action field errors from server (if any)
  const serverError =
    actionData && typeof actionData === "object" && "error" in actionData
      ? (
          actionData as {
            error?: {
              code?: string;
              message?: string;
              fields?: Array<{ path: string; code: string }>;
            };
          }
        ).error
      : undefined;

  const serverFieldErrors = new Map<string, string>();
  if (serverError?.fields) {
    for (const f of serverError.fields) {
      serverFieldErrors.set(f.path, f.code);
    }
  }

  const effectiveSphMaxError =
    sphMaxError ||
    serverFieldErrors.get("sphMax") ||
    (serverError?.code === "LIMITS_INVERTED" ? "LIMITS_INVERTED" : undefined);
  const effectiveTemplateError =
    templateError ||
    serverFieldErrors.get("labCodeTemplate") ||
    (serverError?.code === "UNCLOSED_TOKEN" ? "UNCLOSED_TOKEN" : undefined);

  // Disable save button if template error, inverted limits, invalid price, blank name, or no Rx types
  const isSaveDisabled =
    !templateValidation.valid ||
    Boolean(sphMaxError) ||
    Boolean(cylMaxError) ||
    Boolean(addMaxError) ||
    Boolean(priceError) ||
    !name.trim() ||
    !groupId ||
    rxTypes.length === 0 ||
    isSubmitting;

  const handleSetRxType = (type: RxType, isChecked: boolean) => {
    setRxTypes((prev) => {
      if (isChecked) {
        if (prev.includes(type)) return prev;
        return [...prev, type];
      } else {
        if (prev.length <= 1) return prev; // keep at least one
        return prev.filter((t) => t !== type);
      }
    });
  };

  const [, setSingleVisionRef] = usePolarisCheckbox(
    rxTypes.includes("SINGLE_VISION"),
    (checked) => handleSetRxType("SINGLE_VISION", checked),
  );
  const [, setProgressiveRef] = usePolarisCheckbox(
    rxTypes.includes("PROGRESSIVE"),
    (checked) => handleSetRxType("PROGRESSIVE", checked),
  );
  const [, setReadingRef] = usePolarisCheckbox(
    rxTypes.includes("READING"),
    (checked) => handleSetRxType("READING", checked),
  );
  const [, setNonPrescriptionRef] = usePolarisCheckbox(
    rxTypes.includes("NON_PRESCRIPTION"),
    (checked) => handleSetRxType("NON_PRESCRIPTION", checked),
  );

  const handleModalHide = useCallback(() => {
    modalRef.current?.hideOverlay?.();
  }, []);

  const openArchiveModal = () => {
    modalRef.current?.showOverlay?.();
  };

  const handleCancelArchive = () => {
    handleModalHide();
  };

  const handleConfirmArchive = () => {
    handleModalHide();
    if (onArchiveConfirm) {
      onArchiveConfirm();
    } else {
      const form = document.getElementById(formId) as HTMLFormElement | null;
      if (form) {
        const intentInput = form.querySelector(
          'input[name="intent"]',
        ) as HTMLInputElement | null;
        if (intentInput) {
          intentInput.value = "archive";
        }
        form.requestSubmit();
      }
    }
  };

  const handleSubmit = () => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    form?.requestSubmit();
  };

  return (
    <s-page heading={lens ? `Edit ${lens.name}` : "New lens"}>
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={isSaveDisabled}
        onClick={handleSubmit}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>

      {lens && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={openArchiveModal}
        >
          Archive
        </s-button>
      )}

      <form method="post" id={formId}>
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="price" value={price} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="sphMin" value={sphMin} />
        <input type="hidden" name="sphMax" value={sphMax} />
        <input type="hidden" name="cylMin" value={cylMin} />
        <input type="hidden" name="cylMax" value={cylMax} />
        <input type="hidden" name="addMin" value={addMin} />
        <input type="hidden" name="addMax" value={addMax} />
        <input type="hidden" name="labCodeTemplate" value={template} />
        {rxTypes.map((t) => (
          <input key={t} type="hidden" name="rxTypes" value={t} />
        ))}

        <s-stack direction="block" gap="base">
          {serverError && (
            <s-banner tone="critical" heading="Save failed">
              {serverError.message || serverError.code}
            </s-banner>
          )}

          <s-section heading="Basic details">
            <s-stack direction="block" gap="base">
              <s-select
                ref={setGroupIdRef}
                label="Lens group"
                name="groupIdSelect"
                value={groupId}
                onChange={(e) => {
                  setGroupId(e.currentTarget.value);
                }}
                onInput={(e) => {
                  setGroupId(e.currentTarget.value);
                }}
              >
                {groups.map((g) => (
                  <s-option key={g.id} value={g.id}>
                    {g.name}
                  </s-option>
                ))}
              </s-select>

              <s-text-field
                ref={setNameRef}
                label="Lens name"
                name="nameField"
                value={name}
                error={serverFieldErrors.get("name")}
                onChange={(e) => {
                  setName(e.currentTarget.value);
                }}
                onInput={(e) => {
                  setName(e.currentTarget.value);
                }}
              />

              <s-text-area
                ref={setDescriptionRef}
                label="Description"
                name="descriptionField"
                value={description}
                onChange={(e) => {
                  setDescription(e.currentTarget.value);
                }}
                onInput={(e) => {
                  setDescription(e.currentTarget.value);
                }}
              />

              <s-text-field
                ref={setPriceRef}
                label="Price"
                name="priceField"
                value={price}
                error={priceError || serverFieldErrors.get("price")}
                details={`Expressed in ${currency}. Minor units are stored internally.`}
                onChange={(e) => {
                  setPrice(e.currentTarget.value);
                }}
                onInput={(e) => {
                  setPrice(e.currentTarget.value);
                }}
              />
            </s-stack>
          </s-section>

          <s-section heading="Allowed prescription types">
            <s-stack direction="block" gap="base">
              <s-checkbox
                ref={setSingleVisionRef}
                label={RX_TYPE_LABELS.SINGLE_VISION}
                name="rxTypeSingleVision"
                checked={rxTypes.includes("SINGLE_VISION")}
                onChange={(e) => {
                  const isChecked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  handleSetRxType("SINGLE_VISION", isChecked);
                }}
              />
              <s-checkbox
                ref={setProgressiveRef}
                label={RX_TYPE_LABELS.PROGRESSIVE}
                name="rxTypeProgressive"
                checked={rxTypes.includes("PROGRESSIVE")}
                onChange={(e) => {
                  const isChecked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  handleSetRxType("PROGRESSIVE", isChecked);
                }}
              />
              <s-checkbox
                ref={setReadingRef}
                label={RX_TYPE_LABELS.READING}
                name="rxTypeReading"
                checked={rxTypes.includes("READING")}
                onChange={(e) => {
                  const isChecked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  handleSetRxType("READING", isChecked);
                }}
              />
              <s-checkbox
                ref={setNonPrescriptionRef}
                label={RX_TYPE_LABELS.NON_PRESCRIPTION}
                name="rxTypeNonPrescription"
                checked={rxTypes.includes("NON_PRESCRIPTION")}
                onChange={(e) => {
                  const isChecked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  handleSetRxType("NON_PRESCRIPTION", isChecked);
                }}
              />
            </s-stack>
          </s-section>

          <s-section heading="Prescription limits">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Enter limits as diopter text (e.g. -8, −8.00, +6.00, PL).
              </s-paragraph>

              <s-stack direction="inline" gap="base">
                <s-text-field
                  ref={setSphMinRef}
                  label="SPH minimum"
                  name="sphMinField"
                  value={sphMin}
                  onChange={(e) => {
                    setSphMin(e.currentTarget.value);
                  }}
                  onInput={(e) => {
                    setSphMin(e.currentTarget.value);
                  }}
                />

                <s-text-field
                  ref={setSphMaxRef}
                  label="SPH maximum"
                  name="sphMaxField"
                  value={sphMax}
                  error={effectiveSphMaxError}
                  onChange={(e) => {
                    setSphMax(e.currentTarget.value);
                  }}
                  onInput={(e) => {
                    setSphMax(e.currentTarget.value);
                  }}
                />
              </s-stack>
              {effectiveSphMaxError && (
                <s-banner tone="critical" heading="Invalid SPH range">
                  {effectiveSphMaxError}
                </s-banner>
              )}

              <s-stack direction="inline" gap="base">
                <s-text-field
                  ref={setCylMinRef}
                  label="CYL minimum"
                  name="cylMinField"
                  value={cylMin}
                  onChange={(e) => {
                    setCylMin(e.currentTarget.value);
                  }}
                  onInput={(e) => {
                    setCylMin(e.currentTarget.value);
                  }}
                />

                <s-text-field
                  ref={setCylMaxRef}
                  label="CYL maximum"
                  name="cylMaxField"
                  value={cylMax}
                  error={cylMaxError}
                  onChange={(e) => {
                    setCylMax(e.currentTarget.value);
                  }}
                  onInput={(e) => {
                    setCylMax(e.currentTarget.value);
                  }}
                />
              </s-stack>
              {cylMaxError && (
                <s-banner tone="critical" heading="Invalid CYL range">
                  {cylMaxError}
                </s-banner>
              )}

              <s-stack direction="inline" gap="base">
                <s-text-field
                  ref={setAddMinRef}
                  label="ADD minimum"
                  name="addMinField"
                  value={addMin}
                  onChange={(e) => {
                    setAddMin(e.currentTarget.value);
                  }}
                  onInput={(e) => {
                    setAddMin(e.currentTarget.value);
                  }}
                />

                <s-text-field
                  ref={setAddMaxRef}
                  label="ADD maximum"
                  name="addMaxField"
                  value={addMax}
                  error={addMaxError}
                  onChange={(e) => {
                    setAddMax(e.currentTarget.value);
                  }}
                  onInput={(e) => {
                    setAddMax(e.currentTarget.value);
                  }}
                />
              </s-stack>
              {addMaxError && (
                <s-banner tone="critical" heading="Invalid ADD range">
                  {addMaxError}
                </s-banner>
              )}
            </s-stack>
          </s-section>

          <s-section heading="Lab code template">
            <s-stack direction="block" gap="base">
              <s-text-field
                ref={setTemplateRef}
                label="Lab code template"
                name="templateField"
                value={template}
                error={effectiveTemplateError}
                details="Use tokens like [key=DEFAULT] to interpolate option values."
                onChange={(e) => {
                  setTemplate(e.currentTarget.value);
                }}
                onInput={(e) => {
                  setTemplate(e.currentTarget.value);
                }}
              />

              {effectiveTemplateError && (
                <s-banner tone="critical" heading="Template error">
                  {effectiveTemplateError}
                </s-banner>
              )}

              {previewCode && (
                <s-section heading="Live preview">
                  <s-paragraph>
                    <s-text>Default compiled code: </s-text>
                    <s-text type="strong">{previewCode}</s-text>
                  </s-paragraph>
                </s-section>
              )}
            </s-stack>
          </s-section>
        </s-stack>
      </form>

      <s-modal
        id="archive-lens-modal"
        ref={modalRef}
        heading="Archive lens"
        onHide={handleModalHide}
      >
        <s-paragraph>
          Are you sure you want to archive this lens? It will be removed from
          active storefront catalog and its Shopify product will be drafted.
        </s-paragraph>
        <s-button
          slot="primary-action"
          tone="critical"
          onClick={handleConfirmArchive}
        >
          Confirm archive
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          onClick={handleCancelArchive}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export default LensForm;
