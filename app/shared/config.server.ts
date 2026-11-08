import { z } from "zod";

export class ConfigError extends Error {
  readonly variableName: string;

  constructor(variableName: string, reason: string) {
    super(`Configuration error for ${variableName}: ${reason}`);
    this.name = "ConfigError";
    this.variableName = variableName;
  }
}

export interface DatabaseConfig {
  databaseUrl: string;
  directUrl: string;
  /**
   * Local Postgres used by DB-backed unit tests. Optional so the app can boot
   * without it; specs that need a real database fail loudly when it is absent.
   */
  testDatabaseUrl?: string;
}

export interface ShopifyConfig {
  apiKey: string;
  apiSecretKey: string;
  appUrl: string;
  scopes: string[];
  shopCustomDomain?: string;
}

export interface RxConfig {
  keys: Record<string, string>;
  activeKeyId: string;
}

export interface S3Config {
  bucket: string;
  region: string;
  kmsKeyId: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ResendConfig {
  apiKey: string;
  mailFrom: string;
}

export interface AppProxyConfig {
  subpath: string;
}

export interface BillingConfig {
  appHandle: string;
  partnerOrganizationId: string;
  partnerAccessToken: string;
  appGid: string;
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  database: DatabaseConfig;
  shopify: ShopifyConfig;
  rx: RxConfig;
  s3: S3Config;
  resend: ResendConfig;
  appProxy: AppProxyConfig;
  billing: BillingConfig;
}

let cachedDatabase: DatabaseConfig | undefined;
let cachedShopify: ShopifyConfig | undefined;
let cachedRx: RxConfig | undefined;
let cachedS3: S3Config | undefined;
let cachedResend: ResendConfig | undefined;
let cachedAppProxy: AppProxyConfig | undefined;
let cachedBilling: BillingConfig | undefined;
let cachedPartnerCredentials:
  | { partnerOrganizationId: string; partnerAccessToken: string; appGid: string }
  | undefined;

export function resetConfigCache(): void {
  cachedDatabase = undefined;
  cachedShopify = undefined;
  cachedRx = undefined;
  cachedS3 = undefined;
  cachedResend = undefined;
  cachedAppProxy = undefined;
  cachedBilling = undefined;
  cachedPartnerCredentials = undefined;
}

function validateWithZod<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
  fallbackVarName = "CONFIG"
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const varName = (issue.path[0] as string) || fallbackVarName;
    throw new ConfigError(varName, issue.message);
  }
  return result.data;
}

const databaseSchema = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .trim()
    .min(1, "DATABASE_URL is required")
    .url("DATABASE_URL must be a valid URL"),
  DIRECT_URL: z
    .string()
    .trim()
    .min(1)
    .url("DIRECT_URL must be a valid URL")
    .optional(),
  TEST_DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .url("TEST_DATABASE_URL must be a valid URL")
    .optional(),
});

export function getDatabaseConfig(): DatabaseConfig {
  if (cachedDatabase) return cachedDatabase;

  const parsed = validateWithZod(databaseSchema, {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL?.trim() || undefined,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL?.trim() || undefined,
  });

  const config: DatabaseConfig = {
    databaseUrl: parsed.DATABASE_URL,
    directUrl: parsed.DIRECT_URL || parsed.DATABASE_URL,
    testDatabaseUrl: parsed.TEST_DATABASE_URL,
  };
  cachedDatabase = config;
  return config;
}

const testDatabaseSchema = z.object({
  TEST_DATABASE_URL: z
    .string({ required_error: "TEST_DATABASE_URL is required" })
    .trim()
    .min(1, "TEST_DATABASE_URL is required")
    .url("TEST_DATABASE_URL must be a valid URL"),
});

/**
 * The local Postgres used by DB-backed unit tests. Kept separate from
 * `getDatabaseConfig` so tests do not need the production DATABASE_URL set.
 */
export function getTestDatabaseUrl(): string {
  const parsed = validateWithZod(testDatabaseSchema, {
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  });
  return parsed.TEST_DATABASE_URL;
}

const shopifySchema = z.object({
  SHOPIFY_API_KEY: z
    .string({ required_error: "SHOPIFY_API_KEY is required" })
    .trim()
    .min(1, "SHOPIFY_API_KEY is required"),
  SHOPIFY_API_SECRET: z
    .string({ required_error: "SHOPIFY_API_SECRET is required" })
    .trim()
    .min(1, "SHOPIFY_API_SECRET is required"),
  SHOPIFY_APP_URL: z
    .string({ required_error: "SHOPIFY_APP_URL is required" })
    .trim()
    .min(1, "SHOPIFY_APP_URL is required")
    .url("SHOPIFY_APP_URL must be a valid URL"),
  SCOPES: z
    .string()
    .trim()
    .min(1)
    .default("read_products,write_products,read_orders,write_app_proxy"),
  SHOP_CUSTOM_DOMAIN: z
    .string()
    .trim()
    .min(1)
    .optional(),
});

export function getShopifyConfig(): ShopifyConfig {
  if (cachedShopify) return cachedShopify;

  const parsed = validateWithZod(shopifySchema, {
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
    SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
    SCOPES: process.env.SCOPES?.trim() || undefined,
    SHOP_CUSTOM_DOMAIN: process.env.SHOP_CUSTOM_DOMAIN?.trim() || undefined,
  });

  const scopes = parsed.SCOPES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (scopes.length === 0) {
    throw new ConfigError("SCOPES", "At least one scope is required");
  }

  const config: ShopifyConfig = {
    apiKey: parsed.SHOPIFY_API_KEY,
    apiSecretKey: parsed.SHOPIFY_API_SECRET,
    appUrl: parsed.SHOPIFY_APP_URL,
    scopes,
    shopCustomDomain: parsed.SHOP_CUSTOM_DOMAIN,
  };
  cachedShopify = config;
  return config;
}

const rxEnvSchema = z.object({
  RX_ENCRYPTION_KEYS: z
    .string({ required_error: "RX_ENCRYPTION_KEYS is required" })
    .trim()
    .min(1, "RX_ENCRYPTION_KEYS is required"),
  RX_ENCRYPTION_ACTIVE_KEY_ID: z
    .string({ required_error: "RX_ENCRYPTION_ACTIVE_KEY_ID is required" })
    .trim()
    .min(1, "RX_ENCRYPTION_ACTIVE_KEY_ID is required"),
});

export function getRxConfig(): RxConfig {
  if (cachedRx) return cachedRx;

  const parsedEnv = validateWithZod(rxEnvSchema, {
    RX_ENCRYPTION_KEYS: process.env.RX_ENCRYPTION_KEYS,
    RX_ENCRYPTION_ACTIVE_KEY_ID: process.env.RX_ENCRYPTION_ACTIVE_KEY_ID,
  });

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(parsedEnv.RX_ENCRYPTION_KEYS);
  } catch {
    throw new ConfigError("RX_ENCRYPTION_KEYS", "Invalid JSON format: malformed key list");
  }

  const rxKeysRecordSchema = z
    .record(
      z.string().min(1, "Key id must not be empty"),
      z.string({ required_error: "Key value must be a string" }).refine(
        (val) => {
          try {
            return Buffer.from(val, "base64").length === 32;
          } catch {
            return false;
          }
        },
        (val) => ({
          message: `Key must decode to exactly 32 bytes (got ${Buffer.from(val, "base64").length})`,
        })
      )
    )
    .refine((obj) => Object.keys(obj).length > 0, "Key list is empty; at least one key required");

  const keysResult = rxKeysRecordSchema.safeParse(rawJson);
  if (!keysResult.success) {
    const firstIssue = keysResult.error.issues[0];
    throw new ConfigError("RX_ENCRYPTION_KEYS", firstIssue.message);
  }

  const parsedKeys = keysResult.data;
  const activeKeyId = parsedEnv.RX_ENCRYPTION_ACTIVE_KEY_ID;

  if (!(activeKeyId in parsedKeys)) {
    throw new ConfigError(
      "RX_ENCRYPTION_ACTIVE_KEY_ID",
      `Active key id '${activeKeyId}' not found in RX_ENCRYPTION_KEYS`
    );
  }

  const config: RxConfig = {
    keys: parsedKeys,
    activeKeyId,
  };
  cachedRx = config;
  return config;
}

const s3Schema = z.object({
  S3_BUCKET: z
    .string({ required_error: "S3_BUCKET is required" })
    .trim()
    .min(1, "S3_BUCKET is required"),
  S3_REGION: z
    .string({ required_error: "S3_REGION is required" })
    .trim()
    .min(1, "S3_REGION is required"),
  S3_KMS_KEY_ID: z
    .string({ required_error: "S3_KMS_KEY_ID is required" })
    .trim()
    .min(1, "S3_KMS_KEY_ID is required"),
  AWS_ACCESS_KEY_ID: z
    .string({ required_error: "AWS_ACCESS_KEY_ID is required" })
    .trim()
    .min(1, "AWS_ACCESS_KEY_ID is required"),
  AWS_SECRET_ACCESS_KEY: z
    .string({ required_error: "AWS_SECRET_ACCESS_KEY is required" })
    .trim()
    .min(1, "AWS_SECRET_ACCESS_KEY is required"),
});

export function getS3Config(): S3Config {
  if (cachedS3) return cachedS3;

  const parsed = validateWithZod(s3Schema, {
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_KMS_KEY_ID: process.env.S3_KMS_KEY_ID,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  });

  const config: S3Config = {
    bucket: parsed.S3_BUCKET,
    region: parsed.S3_REGION,
    kmsKeyId: parsed.S3_KMS_KEY_ID,
    accessKeyId: parsed.AWS_ACCESS_KEY_ID,
    secretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
  };
  cachedS3 = config;
  return config;
}

const resendSchema = z.object({
  RESEND_API_KEY: z
    .string({ required_error: "RESEND_API_KEY is required" })
    .trim()
    .min(1, "RESEND_API_KEY is required"),
  MAIL_FROM: z
    .string()
    .trim()
    .min(1)
    .default("Lens Advisor <orders@mail.lensadvisor.io>"),
});

export function getResendConfig(): ResendConfig {
  if (cachedResend) return cachedResend;

  const parsed = validateWithZod(resendSchema, {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    MAIL_FROM: process.env.MAIL_FROM?.trim() || undefined,
  });

  const config: ResendConfig = {
    apiKey: parsed.RESEND_API_KEY,
    mailFrom: parsed.MAIL_FROM,
  };
  cachedResend = config;
  return config;
}

const appProxySchema = z.object({
  APP_PROXY_SUBPATH: z
    .string()
    .trim()
    .min(1)
    .default("lens-advisor"),
});

export function getAppProxyConfig(): AppProxyConfig {
  if (cachedAppProxy) return cachedAppProxy;

  const parsed = validateWithZod(appProxySchema, {
    APP_PROXY_SUBPATH: process.env.APP_PROXY_SUBPATH?.trim() || undefined,
  });

  const config: AppProxyConfig = {
    subpath: parsed.APP_PROXY_SUBPATH,
  };
  cachedAppProxy = config;
  return config;
}

const billingHandleSchema = z.object({
  SHOPIFY_APP_HANDLE: z
    .string()
    .trim()
    .min(1)
    .default("lens-advisor"),
});

const partnerCredentialsSchema = z.object({
  PARTNER_ORGANIZATION_ID: z
    .string({ required_error: "PARTNER_ORGANIZATION_ID is required" })
    .trim()
    .min(1, "PARTNER_ORGANIZATION_ID is required"),
  PARTNER_API_ACCESS_TOKEN: z
    .string({ required_error: "PARTNER_API_ACCESS_TOKEN is required" })
    .trim()
    .min(1, "PARTNER_API_ACCESS_TOKEN is required"),
  SHOPIFY_APP_GID: z
    .string({ required_error: "SHOPIFY_APP_GID is required" })
    .trim()
    .min(1, "SHOPIFY_APP_GID is required"),
});

function getPartnerCredentials(): {
  partnerOrganizationId: string;
  partnerAccessToken: string;
  appGid: string;
} {
  if (cachedPartnerCredentials) return cachedPartnerCredentials;

  const parsed = validateWithZod(partnerCredentialsSchema, {
    PARTNER_ORGANIZATION_ID: process.env.PARTNER_ORGANIZATION_ID?.trim() || undefined,
    PARTNER_API_ACCESS_TOKEN: process.env.PARTNER_API_ACCESS_TOKEN?.trim() || undefined,
    SHOPIFY_APP_GID: process.env.SHOPIFY_APP_GID?.trim() || undefined,
  });

  const credentials = {
    partnerOrganizationId: parsed.PARTNER_ORGANIZATION_ID,
    partnerAccessToken: parsed.PARTNER_API_ACCESS_TOKEN,
    appGid: parsed.SHOPIFY_APP_GID,
  };
  cachedPartnerCredentials = credentials;
  return credentials;
}

export function getBillingConfig(): BillingConfig {
  if (cachedBilling) return cachedBilling;

  const parsed = validateWithZod(billingHandleSchema, {
    SHOPIFY_APP_HANDLE: process.env.SHOPIFY_APP_HANDLE?.trim() || undefined,
  });

  const config: BillingConfig = {
    appHandle: parsed.SHOPIFY_APP_HANDLE,
    get partnerOrganizationId() {
      return getPartnerCredentials().partnerOrganizationId;
    },
    get partnerAccessToken() {
      return getPartnerCredentials().partnerAccessToken;
    },
    get appGid() {
      return getPartnerCredentials().appGid;
    },
  };
  cachedBilling = config;
  return config;
}

const baseEnvSchema = z.object({
  NODE_ENV: z
    .string()
    .trim()
    .min(1)
    .default("development"),
  PORT: z
    .string()
    .trim()
    .min(1)
    .optional()
    .refine((val) => {
      if (val === undefined) return true;
      const n = Number(val);
      return Number.isInteger(n) && n > 0;
    }, "PORT must be a positive integer")
    .transform((val) => (val === undefined ? 3000 : Number(val))),
});

export function getConfig(): AppConfig {
  const base = validateWithZod(baseEnvSchema, {
    NODE_ENV: process.env.NODE_ENV?.trim() || undefined,
    PORT: process.env.PORT?.trim() || undefined,
  });

  return {
    nodeEnv: base.NODE_ENV,
    isProduction: base.NODE_ENV === "production",
    port: base.PORT,
    get database() {
      return getDatabaseConfig();
    },
    get shopify() {
      return getShopifyConfig();
    },
    get rx() {
      return getRxConfig();
    },
    get s3() {
      return getS3Config();
    },
    get resend() {
      return getResendConfig();
    },
    get appProxy() {
      return getAppProxyConfig();
    },
    get billing() {
      return getBillingConfig();
    },
  };
}
