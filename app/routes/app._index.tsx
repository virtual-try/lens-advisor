import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import "@shopify/app-bridge-react";
import { loadHomeData } from "../features/home/home.server";
import { HomeView } from "../features/home/home-view";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return loadHomeData(request);
};

export default function Index() {
  const data = useLoaderData<typeof loader>();
  return <HomeView {...data} />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
