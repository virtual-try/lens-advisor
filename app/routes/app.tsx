import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { getConfig } from "../shared/config.server";
import {
  getNavItems,
  parseNavModules,
  type NavItem,
  type NavModule,
} from "../shared/nav";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: getConfig().shopify.apiKey };
};

export function AppNav({
  items,
  modules,
}: {
  items?: NavItem[];
  modules?: Record<string, NavModule>;
}) {
  const resolvedItems =
    items ?? (modules ? parseNavModules(modules) : getNavItems());

  if (!resolvedItems || resolvedItems.length === 0) {
    return null;
  }

  return (
    <s-app-nav>
      {resolvedItems.map((item) => (
        <s-link key={item.href} href={item.href}>
          {item.label}
        </s-link>
      ))}
    </s-app-nav>
  );
}

export const NavBuilder = AppNav;

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navItems = getNavItems();

  return (
    <AppProvider apiKey={apiKey}>
      <AppNav items={navItems} />
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
