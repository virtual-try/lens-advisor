import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";

import { authenticate } from "../shopify.server";
import { getConfig } from "../shared/config.server";
import { getPrisma } from "../shared/container/prisma.server";
import {
  BadRequestError,
  errorResponse,
  type ErrorResponseBody,
} from "../shared/http/errors.server";
import { buildPricingPlansUrl } from "../features/billing/plan.server";
import { requireActivePlan } from "../features/billing/require-plan.server";
import {
  getSettings,
  updateSettings,
  ValidationError,
  type ShopSettings,
} from "../features/settings/settings.service.server";
import {
  TICKET_FORMATS,
  type SettingsPatch,
  type TicketFormat,
} from "../features/settings/schema";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, plan } = await requireActivePlan(request);
  const prisma = getPrisma();

  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: session.shop },
    });
  }

  const settings = await getSettings(shop.id, prisma);
  const pricingUrl = buildPricingPlansUrl(
    session.shop,
    getConfig().billing.appHandle,
  );

  return data({
    settings,
    plan,
    pricingUrl,
  });
};

function parseBooleanString(val: unknown): boolean | null {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (s === "true" || s === "on" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return null;
  }
  return null;
}

function parseBooleanInput(val: unknown): boolean | null {
  if (val === undefined) return null;
  if (Array.isArray(val)) {
    if (val.length === 0) return null;
    const last = val[val.length - 1];
    return parseBooleanString(last);
  }
  return parseBooleanString(val);
}

const booleanFieldSchema = z
  .custom<boolean>(
    (val) => {
      if (val === undefined) return true;
      return parseBooleanInput(val) !== null;
    },
    { message: "INVALID_BOOLEAN" },
  )
  .transform((val) => {
    if (val === undefined) return undefined;
    return parseBooleanInput(val)!;
  });

export const LAB_EMAIL_MAX_CHARS = 2000;
export const LAB_EMAIL_MAX_COUNT = 10;

const ticketFormatSchema = z.enum(TICKET_FORMATS, {
  errorMap: () => ({ message: "INVALID_TICKET_FORMAT" }),
});

const labEmailInputSchema = z
  .union([z.string(), z.array(z.string())], {
    errorMap: () => ({ message: "INVALID_LAB_EMAIL" }),
  })
  .optional();

const actionInputSchema = z
  .object({
    shopId: z.unknown().optional(),
    ticketFormat: ticketFormatSchema.optional(),
    storeRxInOrder: booleanFieldSchema.optional(),
    rxUploadEnabled: booleanFieldSchema.optional(),
    manualRxEnabled: booleanFieldSchema.optional(),
    confirmStoreRxInOrder: booleanFieldSchema.optional(),
    confirm: booleanFieldSchema.optional(),
    confirmed: booleanFieldSchema.optional(),
    privacyConfirmed: booleanFieldSchema.optional(),
    labEmail: labEmailInputSchema,
  })
  .passthrough();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const prisma = getPrisma();

  let rawData: unknown;
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      rawData = await request.json();
    } catch {
      return errorResponse(
        new BadRequestError("Invalid JSON payload", "INVALID_INPUT", [
          { path: "body", code: "INVALID_JSON" },
        ]),
      );
    }
  } else {
    try {
      const formData = await request.formData();
      const obj: Record<string, unknown> = {};
      for (const [key, val] of formData.entries()) {
        if (key in obj) {
          const existing = obj[key];
          if (Array.isArray(existing)) {
            existing.push(val);
          } else {
            obj[key] = [existing, val];
          }
        } else {
          obj[key] = val;
        }
      }
      rawData = obj;
    } catch {
      return errorResponse(
        new BadRequestError("Invalid form data", "INVALID_INPUT", [
          { path: "body", code: "INVALID_FORM_DATA" },
        ]),
      );
    }
  }

  if (
    typeof rawData !== "object" ||
    rawData === null ||
    Array.isArray(rawData)
  ) {
    return errorResponse(
      new BadRequestError(
        "Expected a JSON object or form data",
        "INVALID_INPUT",
        [{ path: "body", code: "INVALID_TYPE" }],
      ),
    );
  }

  const parseResult = actionInputSchema.safeParse(rawData);
  if (!parseResult.success) {
    const fields = parseResult.error.issues.map((issue) => ({
      path: issue.path.join(".") || "input",
      code: issue.message || "INVALID",
    }));
    return errorResponse(
      new BadRequestError("Invalid request input", "INVALID_INPUT", fields),
    );
  }

  const parsed = parseResult.data;

  // INV-1: Ignore any shopId in request body or query; scope to session shop only.
  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: session.shop },
    });
  }

  const patch: SettingsPatch = {};

  if (parsed.ticketFormat !== undefined) {
    patch.ticketFormat = parsed.ticketFormat;
  }

  if (parsed.storeRxInOrder !== undefined) {
    patch.storeRxInOrder = parsed.storeRxInOrder;
  }

  if (parsed.rxUploadEnabled !== undefined) {
    patch.rxUploadEnabled = parsed.rxUploadEnabled;
  }

  if (parsed.manualRxEnabled !== undefined) {
    patch.manualRxEnabled = parsed.manualRxEnabled;
  }

  if (parsed.labEmail !== undefined) {
    const rawEmails = parsed.labEmail;
    const rawLength =
      typeof rawEmails === "string"
        ? rawEmails.length
        : rawEmails.reduce(
            (acc, s) => acc + (typeof s === "string" ? s.length : 0),
            0,
          );

    if (rawLength > LAB_EMAIL_MAX_CHARS) {
      return errorResponse(
        new BadRequestError(
          `Lab email field cannot exceed ${LAB_EMAIL_MAX_CHARS} characters.`,
          "FIELD_TOO_LONG",
          [{ path: "labEmail", code: "FIELD_TOO_LONG" }],
        ),
      );
    }

    if (Array.isArray(rawEmails) && rawEmails.length > LAB_EMAIL_MAX_COUNT) {
      return errorResponse(
        new BadRequestError(
          `At most ${LAB_EMAIL_MAX_COUNT} lab email addresses are allowed.`,
          "TOO_MANY_LAB_EMAILS",
          [{ path: "labEmail", code: "TOO_MANY_LAB_EMAILS" }],
        ),
      );
    }

    let emailList: string[];
    if (Array.isArray(rawEmails)) {
      emailList = rawEmails.flatMap((item) =>
        typeof item === "string"
          ? item
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      );
    } else {
      const trimmed = rawEmails.trim();
      if (trimmed.length === 0) {
        emailList = [];
      } else if (trimmed.includes(",") || trimmed.includes("\n")) {
        emailList = trimmed
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        emailList = [trimmed];
      }
    }

    if (emailList.length > LAB_EMAIL_MAX_COUNT) {
      return errorResponse(
        new BadRequestError(
          `At most ${LAB_EMAIL_MAX_COUNT} lab email addresses are allowed.`,
          "TOO_MANY_LAB_EMAILS",
          [{ path: "labEmail", code: "TOO_MANY_LAB_EMAILS" }],
        ),
      );
    }

    patch.labEmail = emailList;
  }

  // INV-3: Privacy toggle cannot be turned on without the confirmation field
  const isConfirmed = Boolean(
    parsed.confirmStoreRxInOrder ||
      parsed.confirm ||
      parsed.confirmed ||
      parsed.privacyConfirmed,
  );

  if (patch.storeRxInOrder === true && !isConfirmed) {
    return errorResponse(
      new BadRequestError(
        "Confirmation is required to save prescription values in Shopify orders.",
        "CONFIRMATION_REQUIRED",
        [{ path: "storeRxInOrder", code: "CONFIRMATION_REQUIRED" }],
      ),
    );
  }

  try {
    const updated = await updateSettings(shop.id, patch, prisma);
    return data({ ok: true, settings: updated });
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(error);
    }
    throw error;
  }
};

type ActionData =
  | {
      ok: true;
      settings: ShopSettings;
    }
  | ErrorResponseBody;

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

export default function SettingsRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const initialSettings = loaderData.settings;
  const plan = loaderData.plan;
  const pricingUrl = loaderData.pricingUrl;

  const fetcher = useFetcher<ActionData>();
  const shopify = useAppBridge();
  const modalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);

  const [labEmailText, setLabEmailText] = useState(
    initialSettings.labEmail.join("\n"),
  );
  const [ticketFormat, setTicketFormat] = useState<TicketFormat>(
    initialSettings.ticketFormat,
  );
  const [manualRxEnabled, setManualRxEnabled] = useState(
    initialSettings.manualRxEnabled,
  );
  const [rxUploadEnabled, setRxUploadEnabled] = useState(
    initialSettings.rxUploadEnabled,
  );
  const [storeRxInOrder, setStoreRxInOrder] = useState(
    initialSettings.storeRxInOrder,
  );
  const [privacyConfirmed, setPrivacyConfirmed] = useState(
    initialSettings.storeRxInOrder,
  );

  const [, setLabEmailRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-area"]
  >("value", labEmailText);
  const [, setTicketFormatRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-select"]
  >("value", ticketFormat);
  const [, setManualRxRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-checkbox"]
  >("checked", manualRxEnabled);
  const [, setRxUploadRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-checkbox"]
  >("checked", rxUploadEnabled);
  const [storeRxRef, setStoreRxRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-checkbox"]
  >("checked", storeRxInOrder);

  const prevStateRef = useRef(fetcher.state);
  const lastToastDataRef = useRef<ActionData | null | undefined>(null);

  useEffect(() => {
    const isTransitionToIdle =
      prevStateRef.current !== "idle" && fetcher.state === "idle";
    const isNewData =
      fetcher.data !== undefined && fetcher.data !== lastToastDataRef.current;

    const isOk =
      fetcher.data && "ok" in fetcher.data && Boolean(fetcher.data.ok);

    if (isOk && (isTransitionToIdle || isNewData)) {
      shopify.toast.show("Settings saved");
      lastToastDataRef.current = fetcher.data;
    }

    prevStateRef.current = fetcher.state;
  }, [fetcher.state, fetcher.data, shopify]);

  const isSubmitting =
    fetcher.state === "submitting" || fetcher.state === "loading";

  const actionError =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : undefined;
  const fieldErrors = actionError?.fields;

  const emailField = fieldErrors?.find(
    (f) => f.path === "labEmail" || f.path.startsWith("labEmail."),
  );
  const emailCode = emailField?.code ?? actionError?.code;
  const emailError =
    emailField ||
    actionError?.code === "TOO_MANY_LAB_EMAILS" ||
    actionError?.code === "FIELD_TOO_LONG"
      ? emailCode === "EMAIL"
        ? "Enter a valid lab email address."
        : emailCode === "TOO_MANY_LAB_EMAILS"
          ? "At most 10 lab email addresses are allowed."
          : emailCode === "FIELD_TOO_LONG"
            ? "Lab email field cannot exceed 2,000 characters."
            : actionError?.message || emailCode
      : undefined;

  const rxInputError = fieldErrors?.some(
    (f) =>
      (f.path === "rxUploadEnabled" || f.path === "manualRxEnabled") &&
      f.code === "AT_LEAST_ONE_RX_INPUT",
  )
    ? "Keep at least one prescription input on."
    : undefined;

  const privacyConfirmationError =
    fieldErrors?.some(
      (f) =>
        f.path === "storeRxInOrder" && f.code === "CONFIRMATION_REQUIRED",
    ) || actionError?.code === "CONFIRMATION_REQUIRED";

  const isConfirmedRef = useRef(false);

  const handleModalHide = useCallback(() => {
    if (!isConfirmedRef.current) {
      setStoreRxInOrder(false);
      setPrivacyConfirmed(false);
      if (storeRxRef.current) {
        storeRxRef.current.checked = false;
      }
    }
    isConfirmedRef.current = false;
  }, [storeRxRef]);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;

    (modal as unknown as Record<string, unknown>).onHide = handleModalHide;

    const onHideListener = () => {
      handleModalHide();
    };

    const onKeyDownListener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleModalHide();
      }
    };

    const onClickListener = (e: MouseEvent) => {
      if (e.target === modal) {
        handleModalHide();
      }
    };

    modal.addEventListener("hide", onHideListener);
    modal.addEventListener("keydown", onKeyDownListener);
    modal.addEventListener("click", onClickListener);

    return () => {
      modal.removeEventListener("hide", onHideListener);
      modal.removeEventListener("keydown", onKeyDownListener);
      modal.removeEventListener("click", onClickListener);
      if (
        (modal as unknown as Record<string, unknown>).onHide === handleModalHide
      ) {
        (modal as unknown as Record<string, unknown>).onHide = undefined;
      }
    };
  }, [handleModalHide]);

  const showModal = () => {
    modalRef.current?.showOverlay?.();
  };

  const hideModal = () => {
    modalRef.current?.hideOverlay?.();
  };

  const handlePrivacyToggleChange = (checked: boolean) => {
    if (checked) {
      isConfirmedRef.current = false;
      showModal();
    } else {
      setStoreRxInOrder(false);
      setPrivacyConfirmed(false);
      if (storeRxRef.current) {
        storeRxRef.current.checked = false;
      }
    }
  };

  const handleConfirmPrivacy = () => {
    isConfirmedRef.current = true;
    setStoreRxInOrder(true);
    setPrivacyConfirmed(true);
    if (storeRxRef.current) {
      storeRxRef.current.checked = true;
    }
    hideModal();
  };

  const handleCancelPrivacy = () => {
    isConfirmedRef.current = false;
    setStoreRxInOrder(false);
    setPrivacyConfirmed(false);
    if (storeRxRef.current) {
      storeRxRef.current.checked = false;
    }
    hideModal();
  };

  const handleSubmit = () => {
    const form = document.getElementById(
      "settings-form",
    ) as HTMLFormElement | null;
    form?.requestSubmit();
  };

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        onClick={handleSubmit}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>

      <fetcher.Form method="post" id="settings-form">
        <input type="hidden" name="ticketFormat" value={ticketFormat} />
        <input
          type="hidden"
          name="manualRxEnabled"
          value={manualRxEnabled ? "true" : "false"}
        />
        <input
          type="hidden"
          name="rxUploadEnabled"
          value={rxUploadEnabled ? "true" : "false"}
        />
        <input
          type="hidden"
          name="storeRxInOrder"
          value={storeRxInOrder ? "true" : "false"}
        />
        <input
          type="hidden"
          name="confirmStoreRxInOrder"
          value={privacyConfirmed ? "true" : "false"}
        />

        <s-stack direction="block" gap="base">
          {privacyConfirmationError && (
            <s-banner tone="critical" heading="Privacy confirmation required">
              Confirmation is required to save prescription values in Shopify
              orders.
            </s-banner>
          )}

          {emailError && (
            <s-banner tone="critical" heading="Invalid lab email address">
              {emailError}
            </s-banner>
          )}

          {actionError &&
            !privacyConfirmationError &&
            !emailError &&
            !rxInputError && (
              <s-banner tone="critical" heading="Invalid settings">
                {actionError.message}
              </s-banner>
            )}

          <s-section heading="Lab fulfillment">
            <s-stack direction="block" gap="base">
              <s-text-area
                ref={setLabEmailRef}
                label="Lab email addresses"
                name="labEmail"
                value={labEmailText}
                details="Enter one or more email addresses (one per line)."
                error={emailError}
                onInput={(e) => {
                  setLabEmailText(e.currentTarget.value);
                }}
                onChange={(e) => {
                  setLabEmailText(e.currentTarget.value);
                }}
              />

              <s-select
                ref={setTicketFormatRef}
                label="Ticket format"
                name="ticketFormatSelect"
                value={ticketFormat}
                onChange={(e) => {
                  const val = e.currentTarget.value as TicketFormat;
                  if (val) setTicketFormat(val);
                }}
                onInput={(e) => {
                  const val = e.currentTarget.value as TicketFormat;
                  if (val) setTicketFormat(val);
                }}
              >
                <s-option value="PDF">PDF</s-option>
                <s-option value="CSV">CSV</s-option>
                <s-option value="BOTH">Both (PDF & CSV)</s-option>
              </s-select>
            </s-stack>
          </s-section>

          <s-section heading="Prescription inputs">
            <s-stack direction="block" gap="base">
              {rxInputError && (
                <s-banner
                  tone="critical"
                  heading="Prescription inputs required"
                >
                  {rxInputError}
                </s-banner>
              )}

              <s-paragraph>
                Choose how shoppers can submit their prescriptions on your
                storefront.
              </s-paragraph>

              <s-checkbox
                ref={setManualRxRef}
                label="Shoppers can type their prescription"
                name="manualRxCheckbox"
                checked={manualRxEnabled}
                onChange={(e) => {
                  const checked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  setManualRxEnabled(checked);
                }}
                onInput={(e) => {
                  const checked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  setManualRxEnabled(checked);
                }}
              />

              <s-checkbox
                ref={setRxUploadRef}
                label="Shoppers can upload a prescription file"
                name="rxUploadCheckbox"
                checked={rxUploadEnabled}
                onChange={(e) => {
                  const checked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  setRxUploadEnabled(checked);
                }}
                onInput={(e) => {
                  const checked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  setRxUploadEnabled(checked);
                }}
              />
            </s-stack>
          </s-section>

          <s-section heading="Order privacy">
            <s-stack direction="block" gap="base">
              <s-checkbox
                ref={setStoreRxRef}
                label="Save prescription values in Shopify orders"
                name="storeRxInOrderCheckbox"
                checked={storeRxInOrder}
                onChange={(e) => {
                  const checked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  handlePrivacyToggleChange(checked);
                }}
                onInput={(e) => {
                  const checked = Boolean(
                    e.currentTarget.checked ??
                      (e.target as HTMLInputElement).checked,
                  );
                  handlePrivacyToggleChange(checked);
                }}
              />

              <s-paragraph>
                When off, orders show &apos;Prescription on file&apos; and values
                stay encrypted in this app.
              </s-paragraph>
            </s-stack>
          </s-section>

          <s-section heading="Plan">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                <s-text>Current plan: </s-text>
                <s-text type="strong">{plan.planName || "Active"}</s-text>
              </s-paragraph>
              <s-link href={pricingUrl} target="_top">
                Change plan
              </s-link>
            </s-stack>
          </s-section>
        </s-stack>
      </fetcher.Form>

      <s-modal
        id="privacy-confirm-modal"
        ref={modalRef}
        heading="Confirm saving prescription values in orders"
        onHide={handleModalHide}
      >
        <s-paragraph>
          Shopify order properties are visible to every staff account with order
          access and any installed app with order read permissions.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={handleConfirmPrivacy}
        >
          Confirm
        </s-button>
        <s-button
          slot="secondary-actions"
          variant="secondary"
          onClick={handleCancelPrivacy}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
