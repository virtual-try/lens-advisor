import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { getPrisma } from "./shared/container/prisma.server";
import { getConfig } from "./shared/config.server";

type ShopifyInstance = ReturnType<typeof shopifyApp>;

let _shopify: ShopifyInstance | undefined;

export function getShopify(): ShopifyInstance {
  if (!_shopify) {
    const shopifyConfig = getConfig().shopify;
    _shopify = shopifyApp({
      apiKey: shopifyConfig.apiKey,
      apiSecretKey: shopifyConfig.apiSecretKey,
      apiVersion: ApiVersion.October26,
      scopes: shopifyConfig.scopes,
      appUrl: shopifyConfig.appUrl,
      authPathPrefix: "/auth",
      sessionStorage: new PrismaSessionStorage(getPrisma()),
      distribution: AppDistribution.AppStore,
      future: {
        expiringOfflineAccessTokens: true,
      },
      ...(shopifyConfig.shopCustomDomain
        ? { customShopDomains: [shopifyConfig.shopCustomDomain] }
        : {}),
    });
  }
  return _shopify;
}

const shopifyProxy = new Proxy({} as ShopifyInstance, {
  get(_target, prop, receiver) {
    const instance = getShopify();
    const value = Reflect.get(instance, prop, receiver);
    if (typeof value === "function") {
      return value.bind(instance);
    }
    return value;
  },
});

export default shopifyProxy;
export const apiVersion = ApiVersion.October26;

export const authenticate = new Proxy({} as ShopifyInstance["authenticate"], {
  get(_target, prop, receiver) {
    const auth = getShopify().authenticate;
    const value = Reflect.get(auth, prop, receiver);
    if (typeof value === "function") {
      return value.bind(auth);
    }
    return value;
  },
});

export const unauthenticated = new Proxy({} as ShopifyInstance["unauthenticated"], {
  get(_target, prop, receiver) {
    const unauth = getShopify().unauthenticated;
    const value = Reflect.get(unauth, prop, receiver);
    if (typeof value === "function") {
      return value.bind(unauth);
    }
    return value;
  },
});

export const login: ShopifyInstance["login"] = (...args) => {
  return getShopify().login(...args);
};

export const registerWebhooks: ShopifyInstance["registerWebhooks"] = (...args) => {
  return getShopify().registerWebhooks(...args);
};

export const addDocumentResponseHeaders: ShopifyInstance["addDocumentResponseHeaders"] = (
  ...args
) => {
  return getShopify().addDocumentResponseHeaders(...args);
};

export const sessionStorage = new Proxy({} as ShopifyInstance["sessionStorage"], {
  get(_target, prop, receiver) {
    const storage = getShopify().sessionStorage;
    const value = Reflect.get(storage, prop, receiver);
    if (typeof value === "function") {
      return value.bind(storage);
    }
    return value;
  },
});
