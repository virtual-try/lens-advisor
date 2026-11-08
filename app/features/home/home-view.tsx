import React, { useState } from "react";
import type { HomeLoaderData } from "./home.server";

export function HomeView({
  hasLens,
  hasLabEmail,
  themeDeepLink,
}: HomeLoaderData) {
  const [themeBlockDone, setThemeBlockDone] = useState(false);

  const allDataItemsDone = hasLens && hasLabEmail;

  return (
    <s-page heading="Lens Advisor">
      {allDataItemsDone && (
        <s-section heading="You're live">
          <s-paragraph>
            Your configurator is ready to take prescription orders.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-link href="/app/lab-orders">Lab orders</s-link>
            <s-link href="/app/lenses">Lenses</s-link>
          </s-stack>
        </s-section>
      )}

      <s-section heading="Setup checklist">
        <s-stack direction="block" gap="base">
          <s-box>
            <s-stack direction="inline" gap="base">
              {hasLens ? (
                <s-badge tone="success">✓ Done</s-badge>
              ) : (
                <s-badge tone="info">To do</s-badge>
              )}
              <s-link href="/app/lenses">Add your first lens</s-link>
            </s-stack>
          </s-box>

          <s-box>
            <s-stack direction="inline" gap="base">
              {hasLabEmail ? (
                <s-badge tone="success">✓ Done</s-badge>
              ) : (
                <s-badge tone="info">To do</s-badge>
              )}
              <s-link href="/app/settings">Add a lab email</s-link>
            </s-stack>
          </s-box>

          <s-box>
            <s-stack direction="inline" gap="base">
              {themeBlockDone ? (
                <s-badge tone="success">✓ Done</s-badge>
              ) : (
                <s-badge tone="info">To do</s-badge>
              )}
              <s-link href={themeDeepLink} target="_top">
                Add the Select lenses button to your product page
              </s-link>
              <s-button
                onClick={() => setThemeBlockDone((prev) => !prev)}
              >
                {themeBlockDone ? "Mark as incomplete" : "Mark as done"}
              </s-button>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}
