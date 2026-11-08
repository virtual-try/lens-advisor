import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getConfig } from "../shared/config.server";
import { getPrisma } from "../shared/container/prisma.server";
import { buildPricingPlansUrl } from "../features/billing/plan.server";
import { requireActivePlan } from "../features/billing/require-plan.server";
import {
  getSettings,
  updateSettings,
  ValidationError,
  type ShopSettings,
} from "../features/settings/settings.service.server";
import type {
  SettingsPatch,
  TicketFormat,
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const prisma = getPrisma();

  // INV-1: Ignore any shopId in request body or query; scope to session shop only.
  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: session.shop },
    });
  }

  let rawData: Record<string, unknown> = {};
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    rawData = (await request.json()) as Record<string, unknown>;
  } else {
    const formData = await request.formData();
    for (const [key, val] of formData.entries()) {
      if (key in rawData) {
        const existing = rawData[key];
        if (Array.isArray(existing)) {
          existing.push(val);
        } else {
          rawData[key] = [existing, val];
        }
      } else {
        rawData[key] = val;
      }
    }
  }

  const patch: SettingsPatch = {};

  if ("ticketFormat" in rawData && rawData.ticketFormat !== undefined) {
    patch.ticketFormat = String(rawData.ticketFormat) as TicketFormat;
  }

  if ("storeRxInOrder" in rawData && rawData.storeRxInOrder !== undefined) {
    const val = rawData.storeRxInOrder;
    if (Array.isArray(val)) {
      patch.storeRxInOrder =
        val.includes("true") ||
        val.includes("on") ||
        val.includes("1") ||
        val.includes(true);
    } else {
      patch.storeRxInOrder =
        val === true || val === "true" || val === "on" || val === "1";
    }
  }

  if ("rxUploadEnabled" in rawData && rawData.rxUploadEnabled !== undefined) {
    const val = rawData.rxUploadEnabled;
    if (Array.isArray(val)) {
      patch.rxUploadEnabled =
        val.includes("true") ||
        val.includes("on") ||
        val.includes("1") ||
        val.includes(true);
    } else {
      patch.rxUploadEnabled =
        val === true || val === "true" || val === "on" || val === "1";
    }
  }

  if ("manualRxEnabled" in rawData && rawData.manualRxEnabled !== undefined) {
    const val = rawData.manualRxEnabled;
    if (Array.isArray(val)) {
      patch.manualRxEnabled =
        val.includes("true") ||
        val.includes("on") ||
        val.includes("1") ||
        val.includes(true);
    } else {
      patch.manualRxEnabled =
        val === true || val === "true" || val === "on" || val === "1";
    }
  }

  if ("labEmail" in rawData && rawData.labEmail !== undefined) {
    const rawEmails = rawData.labEmail;
    if (Array.isArray(rawEmails)) {
      patch.labEmail = rawEmails.flatMap((item) =>
        typeof item === "string"
          ? item
              .split(/[\n,]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
      );
    } else if (typeof rawEmails === "string") {
      const trimmed = rawEmails.trim();
      if (trimmed.length === 0) {
        patch.labEmail = [];
      } else if (trimmed.includes(",") || trimmed.includes("\n")) {
        patch.labEmail = trimmed
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        patch.labEmail = [trimmed];
      }
    }
  }

  // INV-3: Privacy toggle cannot be turned on without the confirmation field
  const confirmVal =
    rawData.confirmStoreRxInOrder ??
    rawData.confirm ??
    rawData.confirmed ??
    rawData.privacyConfirmed;
  const isConfirmed =
    confirmVal === true ||
    confirmVal === "true" ||
    confirmVal === "on" ||
    confirmVal === "1";

  if (patch.storeRxInOrder === true && !isConfirmed) {
    return data(
      {
        ok: false,
        code: "CONFIRMATION_REQUIRED",
        error:
          "Confirmation is required to save prescription values in Shopify orders.",
        errors: {
          storeRxInOrder: "CONFIRMATION_REQUIRED",
        },
      },
      { status: 400 },
    );
  }

  try {
    const updated = await updateSettings(shop.id, patch, prisma);
    return data({ ok: true, settings: updated });
  } catch (error) {
    if (error instanceof ValidationError) {
      const fieldErrors: Record<string, string> = {};
      for (const f of error.fields ?? []) {
        const key = f.path.split(".")[0];
        fieldErrors[key] = f.code;
      }
      return data(
        {
          ok: false,
          code: error.code,
          error: error.message,
          errors: fieldErrors,
        },
        { status: 400 },
      );
    }
    throw error;
  }
};

type ActionData = {
  ok: boolean;
  settings?: ShopSettings;
  code?: string;
  error?: string;
  errors?: Record<string, string>;
};

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
  const [pendingPrivacyModal, setPendingPrivacyModal] = useState(false);

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data?.ok, shopify]);

  const isSubmitting =
    fetcher.state === "submitting" || fetcher.state === "loading";
  const actionErrors = fetcher.data?.errors;
  const emailError =
    actionErrors?.labEmail === "EMAIL"
      ? "Enter a valid lab email address."
      : actionErrors?.labEmail;
  const rxInputError =
    actionErrors?.rxUploadEnabled === "AT_LEAST_ONE_RX_INPUT" ||
    actionErrors?.manualRxEnabled === "AT_LEAST_ONE_RX_INPUT"
      ? "Keep at least one prescription input on."
      : undefined;

  const showModal = () => {
    setPendingPrivacyModal(true);
    modalRef.current?.showOverlay?.();
  };

  const hideModal = () => {
    setPendingPrivacyModal(false);
    modalRef.current?.hideOverlay?.();
  };

  const handlePrivacyToggleChange = (checked: boolean) => {
    if (checked) {
      showModal();
    } else {
      setStoreRxInOrder(false);
      setPrivacyConfirmed(false);
    }
  };

  const handleConfirmPrivacy = () => {
    setStoreRxInOrder(true);
    setPrivacyConfirmed(true);
    hideModal();
  };

  const handleCancelPrivacy = () => {
    setStoreRxInOrder(false);
    setPrivacyConfirmed(false);
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
        <input
          type="hidden"
          name="ticketFormat"
          value={ticketFormat}
        />
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
          {actionErrors?.storeRxInOrder && (
            <s-banner tone="critical" heading="Privacy confirmation required">
              Confirmation is required to save prescription values in Shopify
              orders.
            </s-banner>
          )}

          {rxInputError && (
            <s-banner tone="critical" heading="Prescription inputs required">
              {rxInputError}
            </s-banner>
          )}

          {emailError && (
            <s-banner tone="critical" heading="Invalid lab email address">
              {emailError}
            </s-banner>
          )}

          <s-section heading="Lab fulfillment">
            <s-stack direction="block" gap="base">
              <s-text-field
                label="Lab email addresses"
                name="labEmail"
                value={labEmailText}
                details="Enter one or more email addresses separated by commas or new lines."
                error={emailError}
                onInput={(e) => {
                  setLabEmailText(e.currentTarget.value);
                }}
              />

              <s-select
                label="Ticket format"
                name="ticketFormatSelect"
                value={ticketFormat}
                onChange={(e) => {
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
              <s-paragraph>
                Choose how shoppers can submit their prescriptions on your
                storefront.
              </s-paragraph>

              <s-checkbox
                label="Shoppers can type their prescription"
                name="manualRxCheckbox"
                checked={manualRxEnabled}
                onChange={(e) => {
                  setManualRxEnabled(e.currentTarget.checked);
                }}
              />

              <s-checkbox
                label="Shoppers can upload a prescription file"
                name="rxUploadCheckbox"
                checked={rxUploadEnabled}
                onChange={(e) => {
                  setRxUploadEnabled(e.currentTarget.checked);
                }}
              />
            </s-stack>
          </s-section>

          <s-section heading="Order privacy">
            <s-stack direction="block" gap="base">
              <s-checkbox
                label="Save prescription values in Shopify orders"
                name="storeRxInOrderCheckbox"
                checked={storeRxInOrder}
                onChange={(e) => {
                  handlePrivacyToggleChange(e.currentTarget.checked);
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
        {...(pendingPrivacyModal ? { open: true } : {})}
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
