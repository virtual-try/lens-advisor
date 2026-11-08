import { defineConfig, devices } from "@playwright/test";

if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (!process.env.E2E_RUN_ID) {
  process.env.E2E_RUN_ID = `run-${process.pid}-${Date.now()}`;
}

export default defineConfig({
  testDir: "./e2e",
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
