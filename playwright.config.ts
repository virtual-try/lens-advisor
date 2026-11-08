import { defineConfig, devices } from "@playwright/test";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (!process.env.E2E_RUN_ID) {
  process.env.E2E_RUN_ID = `run-${process.pid}-${Date.now()}`;
}

if (!process.env.PGBOSS_SCHEMA) {
  process.env.PGBOSS_SCHEMA = `pgboss_e2e_${process.env.E2E_RUN_ID.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

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
if (!process.env.SHOPIFY_API_KEY) {
  process.env.SHOPIFY_API_KEY = "test_api_key";
}
if (!process.env.SHOPIFY_API_SECRET) {
  process.env.SHOPIFY_API_SECRET = "test_api_secret_key_minimum_length";
}
if (!process.env.SHOPIFY_APP_URL) {
  process.env.SHOPIFY_APP_URL = "https://example.com";
}
if (!process.env.SCOPES) {
  process.env.SCOPES = "read_products,write_products,read_orders,write_app_proxy,write_publications";
}
if (!process.env.RX_ENCRYPTION_KEYS) {
  process.env.RX_ENCRYPTION_KEYS = JSON.stringify({
    k1: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
  });
}
if (!process.env.RX_ENCRYPTION_ACTIVE_KEY_ID) {
  process.env.RX_ENCRYPTION_ACTIVE_KEY_ID = "k1";
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/helpers/global-setup.ts",
  globalTeardown: "./e2e/helpers/global-teardown.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "server",
      testDir: "./e2e",
      testMatch: ["server/**/*.spec.ts", "helpers/*.spec.ts"],
      use: {},
    },
    {
      name: "storefront",
      testDir: "./e2e/storefront",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        headless: true,
        baseURL: process.env.E2E_STORE_URL,
      },
    },
  ],
});
