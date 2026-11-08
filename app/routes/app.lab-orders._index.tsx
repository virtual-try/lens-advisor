import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { LabOrderStatus } from "@prisma/client";

import { getPrisma } from "../shared/container/prisma.server";
import { requireActivePlan } from "../features/billing/require-plan.server";
import { fromOrderGid } from "../features/lab-orders/constants";
import { formatLabOrderError } from "../features/lab-orders-admin/errors";
import { listLabOrdersService } from "../features/lab-orders-admin/lab-orders-admin.service.server";
import type { LabOrderListItem } from "../features/lab-orders-admin/lab-orders-admin.repository.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
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

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const rawStatus = url.searchParams.get("status") || undefined;
  const validStatuses: LabOrderStatus[] = [
    "PENDING",
    "SENDING",
    "SENT",
    "FAILED",
  ];
  const status =
    rawStatus && validStatuses.includes(rawStatus as LabOrderStatus)
      ? (rawStatus as LabOrderStatus)
      : undefined;

  const { items, hasNext, nextCursor } = await listLabOrdersService(shop.id, {
    cursor,
    status,
    limit: 50,
  });

  const storeHandle = session.shop.replace(/\.myshopify\.com$/i, "").trim();

  return data({
    orders: items,
    hasNext,
    nextCursor,
    currentStatus: rawStatus ?? "ALL",
    storeHandle,
  });
};

function renderStatusBadge(order: LabOrderListItem) {
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

export default function LabOrdersIndexRoute() {
  const { orders, hasNext, nextCursor, currentStatus, storeHandle } =
    useLoaderData<typeof loader>();

  return (
    <s-page heading="Lab orders">
      <s-stack direction="block" gap="base">
        <s-section heading="Filter by status">
          <s-stack direction="inline" gap="base">
            <s-link href="/app/lab-orders">
              {currentStatus === "ALL" ? "[All]" : "All"}
            </s-link>
            <s-link href="/app/lab-orders?status=PENDING">
              {currentStatus === "PENDING" ? "[Pending]" : "Pending"}
            </s-link>
            <s-link href="/app/lab-orders?status=SENDING">
              {currentStatus === "SENDING" ? "[Sending]" : "Sending"}
            </s-link>
            <s-link href="/app/lab-orders?status=SENT">
              {currentStatus === "SENT" ? "[Sent]" : "Sent"}
            </s-link>
            <s-link href="/app/lab-orders?status=FAILED">
              {currentStatus === "FAILED" ? "[Failed]" : "Failed"}
            </s-link>
          </s-stack>
        </s-section>

        {orders.length === 0 ? (
          <s-empty-state heading="No lab orders yet">
            <s-paragraph>
              Orders appear here after a customer buys lenses.
            </s-paragraph>
          </s-empty-state>
        ) : (
          <s-stack direction="block" gap="base">
            {orders.map((order) => {
              const shopifyOrderUrl = `https://admin.shopify.com/store/${storeHandle}/orders/${fromOrderGid(
                order.shopifyOrderId,
              )}`;
              const createdDateFormatted = new Date(
                order.createdAt,
              ).toLocaleDateString();

              return (
                <s-section key={order.id} heading={order.orderName}>
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      <s-text>Shopify order:</s-text>
                      <s-link href={shopifyOrderUrl} target="_blank">
                        {order.orderName}
                      </s-link>
                      <s-link href={`/app/lab-orders/${order.id}`}>
                        View details
                      </s-link>
                    </s-stack>

                    <s-stack direction="inline" gap="base">
                      <s-text>
                        Frame: {order.frameTitle}
                        {order.frameSku ? ` (${order.frameSku})` : ""}
                      </s-text>
                      <s-text>·</s-text>
                      <s-text>Lens: {order.lens?.name ?? "No lens"}</s-text>
                    </s-stack>

                    <s-stack direction="inline" gap="base">
                      <s-text>Status:</s-text>
                      {renderStatusBadge(order)}
                    </s-stack>

                    {order.rxOutOfLimits && (
                      <s-stack direction="inline" gap="base">
                        <s-badge tone="warning">Out of limits</s-badge>
                      </s-stack>
                    )}

                    <s-text>Created: {createdDateFormatted}</s-text>
                  </s-stack>
                </s-section>
              );
            })}

            {hasNext && nextCursor && (
              <s-stack direction="inline" gap="base">
                <s-button
                  href={`/app/lab-orders?cursor=${encodeURIComponent(
                    nextCursor,
                  )}${currentStatus !== "ALL" ? `&status=${currentStatus}` : ""}`}
                >
                  Next
                </s-button>
              </s-stack>
            )}
          </s-stack>
        )}
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
