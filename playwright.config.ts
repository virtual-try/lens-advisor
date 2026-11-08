import { defineConfig, devices } from "@playwright/test";

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
      testDir: "./e2e/server",
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
