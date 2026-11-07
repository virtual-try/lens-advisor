import { afterEach, describe, expect, it, vi } from "vitest";

import { getBillingConfig, resetConfigCache } from "../../shared/config.server";

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
});
