import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfigError,
  getBillingConfig,
  resetConfigCache,
} from "../../shared/config.server";

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});

describe("billing config", () => {
  it("defaults the app handle to lens-advisor", () => {
    vi.stubEnv("SHOPIFY_APP_HANDLE", "");
    resetConfigCache();

    expect(getBillingConfig().appHandle).toBe("lens-advisor");
  });

  it("reads SHOPIFY_APP_HANDLE when set", () => {
    vi.stubEnv("SHOPIFY_APP_HANDLE", "custom-app-handle");
    resetConfigCache();

    expect(getBillingConfig().appHandle).toBe("custom-app-handle");
  });

  it("throws ConfigError for missing PARTNER_ORGANIZATION_ID only when partner fields are accessed", () => {
    vi.stubEnv("SHOPIFY_APP_HANDLE", "lens-advisor");
    resetConfigCache();

    const config = getBillingConfig();
    expect(config.appHandle).toBe("lens-advisor");
    expect(() => config.partnerOrganizationId).toThrow(ConfigError);
    expect(() => config.partnerOrganizationId).toThrow(/PARTNER_ORGANIZATION_ID/);
  });

  it("throws ConfigError for missing PARTNER_API_ACCESS_TOKEN", () => {
    vi.stubEnv("PARTNER_ORGANIZATION_ID", "org-123");
    resetConfigCache();

    const config = getBillingConfig();
    expect(() => config.partnerAccessToken).toThrow(ConfigError);
    expect(() => config.partnerAccessToken).toThrow(/PARTNER_API_ACCESS_TOKEN/);
  });

  it("throws ConfigError for missing SHOPIFY_APP_GID", () => {
    vi.stubEnv("PARTNER_ORGANIZATION_ID", "org-123");
    vi.stubEnv("PARTNER_API_ACCESS_TOKEN", "token-xyz");
    resetConfigCache();

    const config = getBillingConfig();
    expect(() => config.appGid).toThrow(ConfigError);
    expect(() => config.appGid).toThrow(/SHOPIFY_APP_GID/);
  });

  it("returns partner credentials when all are provided", () => {
    vi.stubEnv("PARTNER_ORGANIZATION_ID", "org-123");
    vi.stubEnv("PARTNER_API_ACCESS_TOKEN", "token-xyz");
    vi.stubEnv("SHOPIFY_APP_GID", "gid://shopify/App/456");
    resetConfigCache();

    const config = getBillingConfig();
    expect(config.partnerOrganizationId).toBe("org-123");
    expect(config.partnerAccessToken).toBe("token-xyz");
    expect(config.appGid).toBe("gid://shopify/App/456");
  });
});
