import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import crypto from "node:crypto";
import { testConfig } from "@shopify/shopify-app-react-router/test-helpers";
import { resetConfigCache } from "../../app/shared/config.server";

export const shopifyTestConfig = testConfig({
  scopes: [
    "read_products",
    "write_products",
    "read_orders",
    "write_app_proxy",
    "write_publications",
  ],
});

// Configure dummy credentials from testConfig() so the harness works with only TEST_DATABASE_URL
process.env.SHOPIFY_API_KEY = shopifyTestConfig.apiKey;
process.env.SHOPIFY_API_SECRET = shopifyTestConfig.apiSecretKey;
process.env.SHOPIFY_APP_URL = shopifyTestConfig.appUrl;
process.env.SCOPES = shopifyTestConfig.scopes.join(",");

if (!process.env.SHOPIFY_APP_HANDLE) {
  process.env.SHOPIFY_APP_HANDLE = "lens-advisor";
}
if (!process.env.SHOPIFY_APP_GID) {
  process.env.SHOPIFY_APP_GID = "gid://shopify/App/test";
}
if (!process.env.PARTNER_ORGANIZATION_ID) {
  process.env.PARTNER_ORGANIZATION_ID = "test_partner_org_id";
}
if (!process.env.PARTNER_API_ACCESS_TOKEN) {
  process.env.PARTNER_API_ACCESS_TOKEN = "test_partner_token";
}
if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (!process.env.RX_ENCRYPTION_KEYS) {
  process.env.RX_ENCRYPTION_KEYS = JSON.stringify({
    primary: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  });
}
if (!process.env.RX_ENCRYPTION_ACTIVE_KEY_ID) {
  process.env.RX_ENCRYPTION_ACTIVE_KEY_ID = "primary";
}
resetConfigCache();

export function createSessionToken(shop: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: `https://${shop}/admin`,
    dest: `https://${shop}`,
    aud: shopifyTestConfig.apiKey,
    sub: "user_e2e",
    exp: now + 3600,
    nbf: now - 60,
    iat: now,
    jti: crypto.randomUUID(),
    sid: "session_e2e",
  };

  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(payload)}`;
  const sig = crypto
    .createHmac("sha256", shopifyTestConfig.apiSecretKey)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${sig}`;
}

export function createAuthHeaders(shop: string): HeadersInit {
  const token = createSessionToken(shop);
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function createAdminUrl(pathname: string, shop: string): string {
  const host = Buffer.from(`${shop}/admin`).toString("base64url");
  const separator = pathname.includes("?") ? "&" : "?";
  return `https://${shop}${pathname}${separator}shop=${shop}&host=${host}`;
}

export function createSignedProxyRequest(
  pathname: string,
  shop: string,
  options: {
    extraParams?: Record<string, string>;
    forged?: boolean;
    unsigned?: boolean;
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {}
): Request {
  const searchParams = new URLSearchParams({
    path_prefix: "/apps/lens-advisor",
    shop,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(options.extraParams ?? {}),
  });

  if (!options.unsigned) {
    const entries = Array.from(searchParams.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const queryString = entries.map(([k, v]) => `${k}=${v}`).join("");
    const secret = options.forged ? "wrong_secret_key" : shopifyTestConfig.apiSecretKey;
    const signature = crypto
      .createHmac("sha256", secret)
      .update(queryString)
      .digest("hex");
    searchParams.set("signature", signature);
  }

  const url = `https://${shop}${pathname}?${searchParams.toString()}`;
  return new Request(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
  });
}

export function createSignedWebhookRequest(
  pathname: string,
  topic: string,
  shop: string,
  payload: unknown,
  options: {
    forged?: boolean;
    webhookId?: string;
  } = {}
): Request {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  const secret = options.forged ? "wrong_secret" : shopifyTestConfig.apiSecretKey;
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Shopify-Topic": topic,
    "X-Shopify-Shop-Domain": shop,
    "X-Shopify-Webhook-Id": options.webhookId ?? crypto.randomUUID(),
    "X-Shopify-API-Version": "2026-10",
    "X-Shopify-Hmac-Sha256": hmac,
  });

  return new Request(`https://app.test${pathname}`, {
    method: "POST",
    headers,
    body: rawBody,
  });
}

export async function unwrapData<T>(response: unknown): Promise<T> {
  if (response instanceof Response) {
    return (await response.json()) as T;
  }
  if (response && typeof response === "object" && "data" in response) {
    return (response as { data: T }).data;
  }
  return response as T;
}

export function createLoaderArgs(
  request: Request,
  params: Record<string, string | undefined> = {}
): LoaderFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: {},
    url,
    pattern: url.pathname,
  };
}

export function createActionArgs(
  request: Request,
  params: Record<string, string | undefined> = {}
): ActionFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    params,
    context: {},
    url,
    pattern: url.pathname,
  };
}

