import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigError,
  getConfig,
  resetConfigCache,
} from "./config.server";

describe("config.server", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigCache();
  });

  it("throws for missing RESEND_API_KEY only when getConfig().resend is read", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
    vi.stubEnv("SHOPIFY_API_KEY", "test_key");
    vi.stubEnv("SHOPIFY_API_SECRET", "test_secret");
    vi.stubEnv("SHOPIFY_APP_URL", "https://example.com");

    const config = getConfig();

    // Accessing database and shopify does not throw
    expect(() => config.database).not.toThrow();
    expect(config.database.databaseUrl).toBe("postgresql://localhost:5432/test");
    expect(() => config.shopify).not.toThrow();

    // Accessing resend throws because RESEND_API_KEY is missing
    expect(() => config.resend).toThrow(ConfigError);
    expect(() => config.resend).toThrow(/RESEND_API_KEY/);
  });

  it("fails validation on malformed key list with variable name and no secret value in message", () => {
    const sensitiveSecretValue = "ultra_sensitive_secret_raw_key_payload_do_not_leak";
    vi.stubEnv("RX_ENCRYPTION_KEYS", sensitiveSecretValue); // not valid JSON
    vi.stubEnv("RX_ENCRYPTION_ACTIVE_KEY_ID", "k1");

    const config = getConfig();

    let thrownError: unknown;
    try {
      void config.rx;
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(ConfigError);
    const err = thrownError as ConfigError;

    // Must identify the variable name
    expect(err.variableName).toBe("RX_ENCRYPTION_KEYS");
    expect(err.message).toContain("RX_ENCRYPTION_KEYS");

    // Must NOT contain the secret value in the message
    expect(err.message).not.toContain(sensitiveSecretValue);
    expect(String(err)).not.toContain(sensitiveSecretValue);
  });

  it("fails validation when a key in RX_ENCRYPTION_KEYS is not 32 bytes, hiding key value", () => {
    const shortSecretKey = Buffer.from("1234567890123456").toString("base64");
    vi.stubEnv("RX_ENCRYPTION_KEYS", JSON.stringify({ k1: shortSecretKey }));
    vi.stubEnv("RX_ENCRYPTION_ACTIVE_KEY_ID", "k1");

    const config = getConfig();

    let thrownError: unknown;
    try {
      void config.rx;
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(ConfigError);
    const err = thrownError as ConfigError;
    expect(err.variableName).toBe("RX_ENCRYPTION_KEYS");
    expect(err.message).toContain("RX_ENCRYPTION_KEYS");
    expect(err.message).not.toContain(shortSecretKey);
  });

  it("boots with only template env vars set without throwing", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
    vi.stubEnv("SHOPIFY_API_KEY", "shopify_key");
    vi.stubEnv("SHOPIFY_API_SECRET", "shopify_secret");
    vi.stubEnv("SHOPIFY_APP_URL", "https://app.example.com");

    const config = getConfig();

    expect(config.nodeEnv).toBeDefined();
    expect(config.port).toBeTypeOf("number");
    expect(config.shopify.apiKey).toBe("shopify_key");
    expect(config.database.databaseUrl).toBe("postgresql://localhost:5432/test");
  });

  it("returns full valid config when all variables are provided", () => {
    const valid32ByteKey = Buffer.alloc(32, 7).toString("base64");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/test");
    vi.stubEnv("DIRECT_URL", "postgresql://localhost:5432/direct");
    vi.stubEnv("SHOPIFY_API_KEY", "shopify_key");
    vi.stubEnv("SHOPIFY_API_SECRET", "shopify_secret");
    vi.stubEnv("SHOPIFY_APP_URL", "https://app.example.com");
    vi.stubEnv("SCOPES", "read_products,write_products");
    vi.stubEnv("RX_ENCRYPTION_KEYS", JSON.stringify({ k1: valid32ByteKey }));
    vi.stubEnv("RX_ENCRYPTION_ACTIVE_KEY_ID", "k1");
    vi.stubEnv("S3_BUCKET", "test-bucket");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_KMS_KEY_ID", "test-kms");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "test-aws-key");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-aws-secret");
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("MAIL_FROM", "test@example.com");
    vi.stubEnv("APP_PROXY_SUBPATH", "lens-advisor");

    const config = getConfig();

    expect(config.database.directUrl).toBe("postgresql://localhost:5432/direct");
    expect(config.shopify.scopes).toEqual(["read_products", "write_products"]);
    expect(config.rx.activeKeyId).toBe("k1");
    expect(config.rx.keys.k1).toBe(valid32ByteKey);
    expect(config.s3.bucket).toBe("test-bucket");
    expect(config.resend.apiKey).toBe("re_test_123");
    expect(config.appProxy.subpath).toBe("lens-advisor");
  });
});
