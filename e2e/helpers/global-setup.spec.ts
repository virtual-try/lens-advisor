import { test, expect } from "@playwright/test";
import globalSetup, { isStorefrontOnly } from "./global-setup";
import globalTeardown from "./global-teardown";
import type { FullConfig } from "@playwright/test";

test.describe("Global setup and teardown DB isolation (R6-F2)", () => {
  test("isStorefrontOnly correctly identifies storefront-only runs", () => {
    const storefrontOnlyConfig = {
      filteredProjects: [{ name: "storefront" }],
      projects: [{ name: "server" }, { name: "storefront" }],
    } as unknown as FullConfig;

    const serverOnlyConfig = {
      filteredProjects: [{ name: "server" }],
      projects: [{ name: "server" }, { name: "storefront" }],
    } as unknown as FullConfig;

    const allProjectsConfig = {
      filteredProjects: [{ name: "server" }, { name: "storefront" }],
      projects: [{ name: "server" }, { name: "storefront" }],
    } as unknown as FullConfig;

    expect(isStorefrontOnly(storefrontOnlyConfig)).toBe(true);
    expect(isStorefrontOnly(serverOnlyConfig)).toBe(false);
    expect(isStorefrontOnly(allProjectsConfig)).toBe(false);
  });

  test("globalSetup performs no DB setup and does not require TEST_DATABASE_URL for storefront-only run", async () => {
    const origTestDb = process.env.TEST_DATABASE_URL;
    const origDb = process.env.DATABASE_URL;

    try {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = "postgres://dev-production-should-never-be-touched:5432/db";

      const storefrontConfig = {
        filteredProjects: [{ name: "storefront" }],
        projects: [{ name: "server" }, { name: "storefront" }],
      } as unknown as FullConfig;

      // Must not throw even with TEST_DATABASE_URL unset and a dev DATABASE_URL
      await expect(globalSetup(storefrontConfig)).resolves.toBeUndefined();
    } finally {
      if (origTestDb !== undefined) process.env.TEST_DATABASE_URL = origTestDb;
      else delete process.env.TEST_DATABASE_URL;
      if (origDb !== undefined) process.env.DATABASE_URL = origDb;
      else delete process.env.DATABASE_URL;
    }
  });

  test("globalSetup throws clear error when TEST_DATABASE_URL is unset and does not fall back to DATABASE_URL", async () => {
    const origTestDb = process.env.TEST_DATABASE_URL;
    const origDb = process.env.DATABASE_URL;

    try {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = "postgres://dev-production-should-never-be-touched:5432/db";

      const serverConfig = {
        filteredProjects: [{ name: "server" }],
        projects: [{ name: "server" }, { name: "storefront" }],
      } as unknown as FullConfig;

      await expect(globalSetup(serverConfig)).rejects.toThrow(
        /TEST_DATABASE_URL is required/i
      );
    } finally {
      if (origTestDb !== undefined) process.env.TEST_DATABASE_URL = origTestDb;
      else delete process.env.TEST_DATABASE_URL;
      if (origDb !== undefined) process.env.DATABASE_URL = origDb;
      else delete process.env.DATABASE_URL;
    }
  });

  test("globalTeardown skips DB teardown for storefront-only run", async () => {
    const origTestDb = process.env.TEST_DATABASE_URL;
    const origDb = process.env.DATABASE_URL;

    try {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = "postgres://dev-production-should-never-be-touched:5432/db";

      const storefrontConfig = {
        filteredProjects: [{ name: "storefront" }],
        projects: [{ name: "server" }, { name: "storefront" }],
      } as unknown as FullConfig;

      await expect(globalTeardown(storefrontConfig)).resolves.toBeUndefined();
    } finally {
      if (origTestDb !== undefined) process.env.TEST_DATABASE_URL = origTestDb;
      else delete process.env.TEST_DATABASE_URL;
      if (origDb !== undefined) process.env.DATABASE_URL = origDb;
      else delete process.env.DATABASE_URL;
    }
  });

  test("globalTeardown throws clear error when TEST_DATABASE_URL is unset on non-storefront run", async () => {
    const origTestDb = process.env.TEST_DATABASE_URL;
    const origDb = process.env.DATABASE_URL;

    try {
      delete process.env.TEST_DATABASE_URL;
      process.env.DATABASE_URL = "postgres://dev-production-should-never-be-touched:5432/db";

      const serverConfig = {
        filteredProjects: [{ name: "server" }],
        projects: [{ name: "server" }, { name: "storefront" }],
      } as unknown as FullConfig;

      await expect(globalTeardown(serverConfig)).rejects.toThrow(
        /TEST_DATABASE_URL is required/i
      );
    } finally {
      if (origTestDb !== undefined) process.env.TEST_DATABASE_URL = origTestDb;
      else delete process.env.TEST_DATABASE_URL;
      if (origDb !== undefined) process.env.DATABASE_URL = origDb;
      else delete process.env.DATABASE_URL;
    }
  });
});
