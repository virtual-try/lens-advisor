import { z } from "zod";

export class ConfigError extends Error {
  constructor(public readonly variableName: string, reason: string) {
    super(`Configuration error for ${variableName}: ${reason}`);
    this.name = "ConfigError";
  }
}

export interface DatabaseConfig {
  databaseUrl: string;
  directUrl: string;
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
}

let cachedDatabase: DatabaseConfig | undefined;
let cachedShopify: ShopifyConfig | undefined;
let cachedRx: RxConfig | undefined;
let cachedS3: S3Config | undefined;
let cachedResend: ResendConfig | undefined;
let cachedAppProxy: AppProxyConfig | undefined;

export function resetConfigCache(): void {
  cachedDatabase = undefined;
  cachedShopify = undefined;
  cachedRx = undefined;
  cachedS3 = undefined;
  cachedResend = undefined;
  cachedAppProxy = undefined;
}

export function getDatabaseConfig(): DatabaseConfig {
  if (cachedDatabase) return cachedDatabase;

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl || rawUrl.trim() === "") {
    throw new ConfigError("DATABASE_URL", "Variable is required but missing or empty");
  }

  const directUrl = process.env.DIRECT_URL?.trim() || rawUrl;

  cachedDatabase = {
    databaseUrl: rawUrl,
    directUrl,
  };
  return cachedDatabase;
}

export function getShopifyConfig(): ShopifyConfig {
  if (cachedShopify) return cachedShopify;

  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new ConfigError("SHOPIFY_API_KEY", "Variable is required but missing or empty");
  }

  const apiSecretKey = process.env.SHOPIFY_API_SECRET;
  if (!apiSecretKey || apiSecretKey.trim() === "") {
    throw new ConfigError("SHOPIFY_API_SECRET", "Variable is required but missing or empty");
  }

  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const rawScopes = process.env.SCOPES || "read_products,write_products,read_orders,write_app_proxy";
  const scopes = rawScopes.split(",").map((s) => s.trim()).filter(Boolean);
  const shopCustomDomain = process.env.SHOP_CUSTOM_DOMAIN?.trim() || undefined;

  cachedShopify = {
    apiKey,
    apiSecretKey,
    appUrl,
    scopes,
    shopCustomDomain,
  };
  return cachedShopify;
}

export function getRxConfig(): RxConfig {
  if (cachedRx) return cachedRx;

  const rawKeys = process.env.RX_ENCRYPTION_KEYS;
  if (!rawKeys || rawKeys.trim() === "") {
    throw new ConfigError("RX_ENCRYPTION_KEYS", "Variable is required but missing or empty");
  }

  let parsedKeys: Record<string, string>;
  try {
    parsedKeys = JSON.parse(rawKeys);
  } catch {
    throw new ConfigError("RX_ENCRYPTION_KEYS", "Invalid JSON format: malformed key list");
  }

  if (typeof parsedKeys !== "object" || parsedKeys === null || Array.isArray(parsedKeys)) {
    throw new ConfigError("RX_ENCRYPTION_KEYS", "Must be a key-value object of keyId to base64 key");
  }

  const keyEntries = Object.entries(parsedKeys);
  if (keyEntries.length === 0) {
    throw new ConfigError("RX_ENCRYPTION_KEYS", "Key list is empty; at least one key required");
  }

  for (const [keyId, keyVal] of keyEntries) {
    if (typeof keyVal !== "string") {
      throw new ConfigError("RX_ENCRYPTION_KEYS", `Key value for '${keyId}' must be a string`);
    }
    const buf = Buffer.from(keyVal, "base64");
    if (buf.length !== 32) {
      throw new ConfigError(
        "RX_ENCRYPTION_KEYS",
        `Key '${keyId}' must decode to exactly 32 bytes (got ${buf.length})`
      );
    }
  }

  const activeKeyId = process.env.RX_ENCRYPTION_ACTIVE_KEY_ID;
  if (!activeKeyId || activeKeyId.trim() === "") {
    throw new ConfigError("RX_ENCRYPTION_ACTIVE_KEY_ID", "Variable is required but missing or empty");
  }

  if (!(activeKeyId in parsedKeys)) {
    throw new ConfigError(
      "RX_ENCRYPTION_ACTIVE_KEY_ID",
      `Active key id '${activeKeyId}' not found in RX_ENCRYPTION_KEYS`
    );
  }

  cachedRx = {
    keys: parsedKeys,
    activeKeyId,
  };
  return cachedRx;
}

export function getS3Config(): S3Config {
  if (cachedS3) return cachedS3;

  const schema = z.object({
    S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
    S3_REGION: z.string().min(1, "S3_REGION is required"),
    S3_KMS_KEY_ID: z.string().min(1, "S3_KMS_KEY_ID is required"),
    AWS_ACCESS_KEY_ID: z.string().min(1, "AWS_ACCESS_KEY_ID is required"),
    AWS_SECRET_ACCESS_KEY: z.string().min(1, "AWS_SECRET_ACCESS_KEY is required"),
  });

  const parsed = schema.safeParse({
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_KMS_KEY_ID: process.env.S3_KMS_KEY_ID,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const varName = String(firstIssue.path[0] || "S3_CONFIG");
    throw new ConfigError(varName, firstIssue.message);
  }

  cachedS3 = {
    bucket: parsed.data.S3_BUCKET,
    region: parsed.data.S3_REGION,
    kmsKeyId: parsed.data.S3_KMS_KEY_ID,
    accessKeyId: parsed.data.AWS_ACCESS_KEY_ID,
    secretAccessKey: parsed.data.AWS_SECRET_ACCESS_KEY,
  };
  return cachedS3;
}

export function getResendConfig(): ResendConfig {
  if (cachedResend) return cachedResend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new ConfigError("RESEND_API_KEY", "Variable is required but missing or empty");
  }

  const mailFrom = process.env.MAIL_FROM || "Lens Advisor <orders@mail.lensadvisor.io>";

  cachedResend = {
    apiKey,
    mailFrom,
  };
  return cachedResend;
}

export function getAppProxyConfig(): AppProxyConfig {
  if (cachedAppProxy) return cachedAppProxy;

  const subpath = process.env.APP_PROXY_SUBPATH?.trim() || "lens-advisor";
  cachedAppProxy = { subpath };
  return cachedAppProxy;
}

export function getConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const port = Number(process.env.PORT || 3000);

  return {
    nodeEnv,
    isProduction,
    port,
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
  };
}
