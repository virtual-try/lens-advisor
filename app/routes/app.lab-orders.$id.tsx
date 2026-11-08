import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  data,
  useFetcher,
  useLoaderData,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { getPrisma } from "../shared/container/prisma.server";
import {
  BadRequestError,
  errorResponse,
  NotFoundError,
} from "../shared/http/errors.server";
import { requireActivePlan } from "../features/billing/require-plan.server";
import { fromOrderGid } from "../features/lab-orders/constants";
import { formatLabOrderError } from "../features/lab-orders-admin/errors";
import { formatPrescriptionSummary } from "../features/lab-orders-admin/summary";
import {
  getLabOrderDetailService,
  getTicketDownloadUrlService,
  resendLabOrderService,
} from "../features/lab-orders-admin/lab-orders-admin.service.server";
import type { LabOrderDetail } from "../features/lab-orders-admin/lab-orders-admin.repository.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await requireActivePlan(request);
  const prisma = getPrisma();

  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: session.shop },
    });
  }

  const { id } = params;
  if (!id) {
    throw errorResponse(new NotFoundError("Lab order not found"));
  }

  // Scoped strictly to shop.id (INV-1: detail of another shop returns 404)
  const order = await getLabOrderDetailService(shop.id, id);
  if (!order) {
    throw errorResponse(new NotFoundError("Lab order not found"));
  }

  const storeHandle = session.shop.replace(/\.myshopify\.com$/i, "").trim();

  return data({
    order,
    shopId: shop.id,
    storeHandle,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await requireActivePlan(request);
  const prisma = getPrisma();

  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: session.shop },
    });
  }

  const { id } = params;
  if (!id) {
    return errorResponse(new NotFoundError("Lab order not found"));
  }

  // Tenancy check (INV-1): order must exist for this shop
  const order = await getLabOrderDetailService(shop.id, id);
  if (!order) {
    return errorResponse(new NotFoundError("Lab order not found"));
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "resend") {
    await resendLabOrderService(shop.id, id);
    return data({ ok: true, resent: true });
  }

  if (intent === "download-ticket") {
    const ticketKey = formData.get("ticketKey");
    if (typeof ticketKey !== "string" || !ticketKey) {
      return errorResponse(
        new BadRequestError("Ticket key is required", "MISSING_TICKET_KEY"),
      );
    }

    try {
      const result = await getTicketDownloadUrlService(shop.id, id, ticketKey);
      return data({ ok: true, downloadUrl: result.downloadUrl });
    } catch (err: unknown) {
      return errorResponse(err);
    }
  }

  return errorResponse(
    new BadRequestError("Invalid action intent", "INVALID_INTENT"),
  );
};

function renderStatusBadge(order: LabOrderDetail) {
  switch (order.status) {
    case "PENDING":
      return <s-badge tone="caution">Pending</s-badge>;
    case "SENDING":
      return <s-badge tone="info">Sending</s-badge>;
    case "SENT":
      return <s-badge tone="success">Sent</s-badge>;
    case "FAILED":
      return (
        <s-stack direction="inline" gap="base">
          <s-badge tone="critical">Failed</s-badge>
          <s-text>{formatLabOrderError(order.lastErrorCode)}</s-text>
          {order.lastErrorCode === "NO_LAB_EMAIL" && (
            <s-link href="/app/settings">Settings</s-link>
          )}
        </s-stack>
      );
    default:
      return <s-badge tone="info">{order.status}</s-badge>;
  }
}

export default function LabOrderDetailRoute() {
  const { order: initialOrder, shopId, storeHandle } =
    useLoaderData<typeof loader>();
  const resendFetcher = useFetcher<{ ok?: boolean; resent?: boolean }>();
  const downloadFetcher = useFetcher<{
    ok?: boolean;
    downloadUrl?: string;
    error?: { message?: string };
  }>();
  const isResending = resendFetcher.state !== "idle";
  const resendModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);

  // If resend succeeded, locally reflect Pending status until revalidation completes
  const order: LabOrderDetail =
    resendFetcher.data?.resent && orderIsSentOrFailed(initialOrder.status)
      ? {
          ...initialOrder,
          status: "PENDING",
          lastErrorCode: null,
        }
      : initialOrder;

  function orderIsSentOrFailed(status: string) {
    return status === "SENT" || status === "FAILED";
  }

  const handleOpenResendModal = () => {
    resendModalRef.current?.showOverlay?.();
  };

  const handleCloseResendModal = () => {
    resendModalRef.current?.hideOverlay?.();
  };

  const handleConfirmResend = () => {
    resendFetcher.submit({ intent: "resend" }, { method: "POST" });
    handleCloseResendModal();
  };

  const handleDownloadTicket = (ticketKey: string) => {
    downloadFetcher.submit(
      { intent: "download-ticket", ticketKey },
      { method: "POST" },
    );
  };

  useEffect(() => {
    if (downloadFetcher.data?.downloadUrl) {
      if (typeof window !== "undefined") {
        window.open(downloadFetcher.data.downloadUrl, "_blank");
      }
    }
  }, [downloadFetcher.data]);

  const shopifyOrderUrl = `https://admin.shopify.com/store/${storeHandle}/orders/${fromOrderGid(
    order.shopifyOrderId,
  )}`;

  // Determine ticket keys available for download
  const ticketKeysToOffer: string[] =
    order.ticketKeys && order.ticketKeys.length > 0
      ? order.ticketKeys
      : order.status === "SENT"
        ? [
            `shops/${shopId}/tickets/${order.id}.pdf`,
            `shops/${shopId}/tickets/${order.id}.csv`,
          ]
        : [];

  const canResend = order.status === "FAILED" || order.status === "SENT";

  return (
    <s-page heading={`Lab Order ${order.orderName}`}>
      <s-link slot="secondary-actions" href="/app/lab-orders">
        ← Lab orders
      </s-link>

      <s-stack direction="block" gap="base">
        {downloadFetcher.data?.error && (
          <s-banner tone="critical" heading="Download failed">
            {downloadFetcher.data.error.message ?? "Could not generate download URL"}
          </s-banner>
        )}

        <s-section heading="Order details">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <s-text>Shopify order:</s-text>
              <s-link href={shopifyOrderUrl} target="_blank">
                {order.orderName}
              </s-link>
            </s-stack>

            <s-text>
              Frame: {order.frameTitle}
              {order.frameSku ? ` (${order.frameSku})` : ""}
            </s-text>

            <s-text>Lens: {order.lens?.name ?? "No lens"}</s-text>
            {order.lens?.description && (
              <s-paragraph>{order.lens.description}</s-paragraph>
            )}

            {order.optionValues.length > 0 && (
              <s-stack direction="block" gap="base">
                <s-heading>Selected options:</s-heading>
                {order.optionValues.map((ov) => (
                  <s-text key={ov.id}>
                    • {ov.optionGroup.name}: {ov.label}
                  </s-text>
                ))}
              </s-stack>
            )}

            {order.addOns.length > 0 && (
              <s-stack direction="block" gap="base">
                <s-heading>Selected add-ons:</s-heading>
                {order.addOns.map((addon) => (
                  <s-text key={addon.id}>• {addon.name}</s-text>
                ))}
              </s-stack>
            )}

            <s-stack direction="inline" gap="base">
              <s-text>Status:</s-text>
              {renderStatusBadge(order)}
            </s-stack>

            {order.rxOutOfLimits && (
              <s-stack direction="inline" gap="base">
                <s-badge tone="warning">Out of limits</s-badge>
              </s-stack>
            )}

            {/* Prescription summary (INV-2: never shows clinical Rx diopters/notes) */}
            <s-text>{formatPrescriptionSummary(order.prescription)}</s-text>

            <s-text>
              Created: {new Date(order.createdAt).toLocaleDateString()}
            </s-text>

            {order.sentAt && (
              <s-text>
                Sent at: {new Date(order.sentAt).toLocaleDateString()}
              </s-text>
            )}

            <s-text>Dispatch attempts: {order.attempts}</s-text>

            {order.providerId && (
              <s-text>Provider message ID: {order.providerId}</s-text>
            )}
          </s-stack>
        </s-section>

        {/* Ticket download section (Self-check 1: minted on click by action, never in loader) */}
        {ticketKeysToOffer.length > 0 && (
          <s-section heading="Lab tickets">
            <s-stack direction="inline" gap="base">
              {ticketKeysToOffer.map((ticketKey) => {
                const label = ticketKey.endsWith(".pdf")
                  ? "Download PDF"
                  : ticketKey.endsWith(".csv")
                    ? "Download CSV"
                    : "Download ticket";

                return (
                  <s-button
                    key={ticketKey}
                    onClick={() => handleDownloadTicket(ticketKey)}
                  >
                    {label}
                  </s-button>
                );
              })}
            </s-stack>
          </s-section>
        )}

        {/* Resend to lab section */}
        {canResend && (
          <s-section heading="Actions">
            <s-stack direction="inline" gap="base">
              <s-button onClick={handleOpenResendModal}>Resend to lab</s-button>
            </s-stack>
          </s-section>
        )}

        {/* Resend confirmation modal */}
        <s-modal ref={resendModalRef} heading="Resend to lab">
          <s-paragraph>
            Are you sure you want to resend this order to the lab?
          </s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={handleConfirmResend}
            {...(isResending ? { disabled: true } : {})}
          >
            Resend
          </s-button>
          <s-button slot="secondary-actions" onClick={handleCloseResendModal}>
            Cancel
          </s-button>
        </s-modal>
      </s-stack>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
