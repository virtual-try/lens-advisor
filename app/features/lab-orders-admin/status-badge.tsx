import type { ReactNode } from "react";
import { formatLabOrderError, UNKNOWN_ERROR_MESSAGE } from "./errors";

export interface StatusBadgeOrder {
  status: string;
  lastErrorCode?: string | null;
}

/**
 * Shared status badge component for lab orders list and detail routes (R1-F5).
 * Maps order status to Polaris badge and renders English error sentence for FAILED orders.
 */
export function renderStatusBadge(order: StatusBadgeOrder): ReactNode {
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
          <s-text>
            {formatLabOrderError(order.lastErrorCode) || UNKNOWN_ERROR_MESSAGE}
          </s-text>
          {order.lastErrorCode === "NO_LAB_EMAIL" && (
            <s-link href="/app/settings">Settings</s-link>
          )}
        </s-stack>
      );
    default:
      return <s-badge tone="info">{order.status}</s-badge>;
  }
}

export function LabOrderStatusBadge({ order }: { order: StatusBadgeOrder }) {
  return renderStatusBadge(order);
}
