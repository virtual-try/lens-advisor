import React, { useState } from "react";
import { Form } from "react-router";
import { minorUnitDigits } from "../../../../packages/rx-core/src/pricing/index.js";

export interface OptionValueFormData {
  id?: string;
  optionGroupId?: string;
  label?: string;
  priceDelta?: string;
  codeType?: "none" | "token" | "override";
  token?: string;
  tokenKey?: string | null;
  tokenValue?: string | null;
  overrideCode?: string | null;
  swatch?: string | null;
}

export interface OptionValueFormProps {
  initialData?: OptionValueFormData;
  groupKind?: "MATERIAL" | "TINT_TYPE" | "COLOR";
  currency?: string;
  errors?: Record<string, string>;
  isSubmitting?: boolean;
  onCancel?: () => void;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
}

export function OptionValueForm({
  initialData,
  groupKind = "MATERIAL",
  currency = "",
  errors = {},
  isSubmitting = false,
  onCancel,
  onSubmit,
}: OptionValueFormProps) {
  const initialToken =
    initialData?.token ||
    (initialData?.tokenKey && initialData?.tokenValue
      ? `${initialData.tokenKey}=${initialData.tokenValue}`
      : initialData?.tokenKey || "");

  const initialCodeType: "none" | "token" | "override" =
    initialData?.codeType ??
    (initialData?.overrideCode
      ? "override"
      : initialToken
        ? "token"
        : "none");

  const [label, setLabel] = useState(initialData?.label ?? "");
  const [priceDelta, setPriceDelta] = useState(initialData?.priceDelta ?? "0");
  const [codeType, setCodeType] = useState<"none" | "token" | "override">(initialCodeType);
  const [token, setToken] = useState(initialToken);
  const [overrideCode, setOverrideCode] = useState(initialData?.overrideCode ?? "");
  const [swatch, setSwatch] = useState(initialData?.swatch ?? "");

  const hasBothCodes = Boolean(token.trim() && overrideCode.trim());
  const showBoth =
    hasBothCodes ||
    Boolean(errors.ONE_CODE_SOURCE || errors.overrideCode === "ONE_CODE_SOURCE");

  const digits = currency ? (minorUnitDigits(currency) ?? 2) : 2;
  const KNOWN_ERROR_KEYS = new Set([
    "ONE_CODE_SOURCE",
    "MONEY_PRECISION",
    "NEGATIVE_PRICE",
    "REQUIRED",
    "label",
    "priceDelta",
    "token",
    "overrideCode",
    "swatch",
  ]);
  const unlistedError =
    errors.form ||
    Object.entries(errors).find(([k]) => !KNOWN_ERROR_KEYS.has(k))?.[1];

  return (
    <Form onSubmit={onSubmit} method="post">
      <s-stack direction="block" gap="base">
        {unlistedError && (
          <s-banner tone="critical" heading="Action failed">
            <s-paragraph>{unlistedError}</s-paragraph>
          </s-banner>
        )}
        {errors.ONE_CODE_SOURCE && (
          <s-banner tone="critical" heading="Code source conflict">
            <s-paragraph>
              Choose either a lab-code token or an override code, not both.
            </s-paragraph>
          </s-banner>
        )}
        {errors.MONEY_PRECISION && (
          <s-banner tone="critical" heading="Invalid price precision">
            <s-paragraph>
              {typeof errors.MONEY_PRECISION === "string" &&
              errors.MONEY_PRECISION !== "MONEY_PRECISION"
                ? errors.MONEY_PRECISION
                : `Maximum ${digits} decimal places allowed for ${currency}.`}
            </s-paragraph>
          </s-banner>
        )}
        {errors.NEGATIVE_PRICE && (
          <s-banner tone="critical" heading="Invalid price delta">
            <s-paragraph>Price delta must be at least 0.</s-paragraph>
          </s-banner>
        )}
        {errors.REQUIRED && (
          <s-banner tone="critical" heading="Missing required fields">
            <s-paragraph>Please fill in all required fields.</s-paragraph>
          </s-banner>
        )}

        <s-text-field
          label="Label"
          name="label"
          value={label}
          onInput={(e) => setLabel(e.currentTarget.value)}
          error={errors.label}
          required
        />

        <s-text-field
          label={currency ? `Price delta (${currency})` : "Price delta"}
          name="priceDelta"
          value={priceDelta}
          onInput={(e) => setPriceDelta(e.currentTarget.value)}
          error={errors.priceDelta || errors.NEGATIVE_PRICE || errors.MONEY_PRECISION}
          details="Additional price for this option in the shop currency's normal units (e.g. 35.00 or 0 for included)."
        />

        {currency && <input type="hidden" name="currency" value={currency} />}
        <input type="hidden" name="codeType" value={codeType} />

        <s-choice-list
          label="Lab-code mapping"
          values={[codeType]}
          onChange={(e) => {
            const target = e.currentTarget as unknown as { values?: string[] };
            const val = target.values?.[0] as "none" | "token" | "override" | undefined;
            if (val) {
              setCodeType(val);
              if (val === "token") {
                setOverrideCode("");
              } else if (val === "override") {
                setToken("");
              } else if (val === "none") {
                setToken("");
                setOverrideCode("");
              }
            }
          }}
        >
          <s-choice value="token">Lab-code token</s-choice>
          <s-choice value="override">Override code</s-choice>
          <s-choice value="none">None</s-choice>
        </s-choice-list>

        {(codeType === "token" || showBoth || Boolean(errors.token)) && (
          <s-text-field
            label="Lab-code token"
            name="token"
            value={token}
            onInput={(e) => setToken(e.currentTarget.value)}
            error={errors.token}
            details="Token format: key=VALUE (e.g. lens_material=PO-67)"
          />
        )}

        {(codeType === "override" || showBoth) && (
          <s-text-field
            label="Override code"
            name="overrideCode"
            value={overrideCode}
            onInput={(e) => setOverrideCode(e.currentTarget.value)}
            error={errors.overrideCode || (errors.ONE_CODE_SOURCE ? "ONE_CODE_SOURCE" : undefined)}
            details="Exact code segment to substitute into the lab-code template."
          />
        )}

        {groupKind === "COLOR" && (
          <s-text-field
            label="Swatch colour"
            name="swatch"
            value={swatch}
            onInput={(e) => setSwatch(e.currentTarget.value)}
            error={errors.swatch}
            details="Merchant colour value (e.g. #1a1a1a or black). Stored as data."
          />
        )}

        <s-stack direction="inline" gap="base">
          <s-button
            type="submit"
            variant="primary"
            {...(isSubmitting ? { loading: true } : {})}
            {...(isSubmitting ? { disabled: true } : {})}
          >
            Save option value
          </s-button>
          {onCancel && (
            <s-button
              type="button"
              onClick={onCancel}
              {...(isSubmitting ? { disabled: true } : {})}
            >
              Cancel
            </s-button>
          )}
        </s-stack>
      </s-stack>
    </Form>
  );
}
