import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  data,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRouteError,
  Form,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { PrismaClient } from "@prisma/client";

import { authenticate } from "../shopify.server";
import { getPrisma } from "../shared/container/prisma.server";
import {
  AppError,
  BadRequestError,
  errorResponse,
  NotFoundError,
} from "../shared/http/errors.server";
import { requireActivePlan } from "../features/billing/require-plan.server";
import {
  createCatalogService,
  ValidationError as CatalogValidationError,
  type CatalogAddOnDto,
} from "../features/catalog/catalog.service.server";
import {
  addOnActionSchema,
  validateInput,
} from "../features/catalog/schema";
import {
  minorUnitDigits,
  parseMoneyText,
  toShopifyDecimal,
} from "../../packages/rx-core/src/pricing/index.js";
import {
  archiveItem,
  syncItem,
  type ProductSyncAdminClient,
} from "../features/product-sync";
import { SHOP_CURRENCY_QUERY } from "../features/product-sync/graphql";

async function getShopCurrency(admin: ProductSyncAdminClient): Promise<string> {
  try {
    const res = await admin.graphql(SHOP_CURRENCY_QUERY);
    const json =
      typeof (res as { json?: () => Promise<{ data?: { shop?: { currencyCode?: string } } }> }).json === "function"
        ? await (res as { json: () => Promise<{ data?: { shop?: { currencyCode?: string } } }> }).json()
        : (res as { data?: { shop?: { currencyCode?: string } } });
    const currency = json?.data?.shop?.currencyCode;
    if (typeof currency === "string" && currency.trim()) {
      return currency.trim().toUpperCase();
    }
    throw new Error("Currency code not found");
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, "CURRENCY_UNAVAILABLE", "Failed to determine shop currency");
  }
}

async function getShopByDomain(domain: string, prisma: PrismaClient) {
  let shop = await prisma.shop.findUnique({
    where: { domain },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain },
    });
  }
  return shop;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin, plan } = await requireActivePlan(request);
  const prisma = getPrisma();
  const shop = await getShopByDomain(session.shop, prisma);
  const catalogService = createCatalogService({ prisma });

  const shopCurrency = await getShopCurrency(admin);

  const id = params.id;
  if (!id) {
    throw new NotFoundError("Add-on ID is required");
  }

  if (id === "new") {
    return data({
      addOn: null,
      plan,
      shopDomain: session.shop,
      currency: shopCurrency,
    });
  }

  const addOn = await catalogService.getAddOn(shop.id, id);
  if (!addOn) {
    throw new NotFoundError("Add-on not found");
  }

  return data({
    addOn,
    plan,
    shopDomain: session.shop,
    currency: shopCurrency,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const prisma = getPrisma();
    const shop = await getShopByDomain(session.shop, prisma);
    const catalogService = createCatalogService({ prisma });

    const id = params.id;
    if (!id) {
      return errorResponse(new NotFoundError("Add-on ID is required"));
    }

    const contentType = request.headers.get("content-type") || "";
    let rawData: unknown = {};
    if (contentType.includes("application/json")) {
      try {
        rawData = await request.json();
      } catch {
        return errorResponse(new BadRequestError("Malformed JSON body", "INVALID_INPUT"));
      }
    } else {
      const formData = await request.formData();
      rawData = Object.fromEntries(formData.entries());
    }

    if (rawData === null || typeof rawData !== "object" || Array.isArray(rawData)) {
      return errorResponse(new BadRequestError("Invalid request body", "INVALID_INPUT"));
    }

    const payload = validateInput(addOnActionSchema, rawData);
    const intent = payload.intent ?? "save";

    // Intent: Retry sync
    if (intent === "retry_sync") {
      const existing = await catalogService.getAddOn(shop.id, id);
      if (!existing) {
        return errorResponse(new NotFoundError("Add-on not found"));
      }

      let syncFailed = false;
      try {
        await syncItem(admin, shop.id, "addOn", id);
      } catch {
        syncFailed = true;
      }

      const finalAddOn = await catalogService.getAddOn(shop.id, id);
      return data({ ok: true, addOn: finalAddOn, syncFailed, synced: !syncFailed });
    }

    // Intent: Delete / Archive
    if (intent === "delete" || intent === "archive") {
      const existing = await catalogService.getAddOn(shop.id, id);
      if (!existing) {
        return errorResponse(new NotFoundError("Add-on not found"));
      }

      if (existing.shopifyVariantId) {
        try {
          const res = await archiveItem(admin, shop.id, "addOn", id);
          if (!res || !res.ok) {
            throw new Error("Shopify archive failed");
          }
        } catch {
          return errorResponse(
            new BadRequestError(
              "Failed to archive add-on in Shopify. Please retry.",
              "SHOPIFY_ARCHIVE_FAILED",
            ),
          );
        }
      }

      await catalogService.archiveAddOn(shop.id, id);
      return data({ ok: true, archived: true });
    }

    // Intent: Save / Update
    let existing: CatalogAddOnDto | null = null;
    if (id !== "new") {
      existing = await catalogService.getAddOn(shop.id, id);
      if (!existing) {
        return errorResponse(new NotFoundError("Add-on not found"));
      }
    }

    const name =
      typeof payload.name === "string"
        ? payload.name.trim()
        : existing?.name ?? "";

    if (!name) {
      return errorResponse(
        new BadRequestError("Name is required", "REQUIRED", [
          { path: "name", code: "REQUIRED" },
        ]),
      );
    }

    // Validate price presence and positivity prior to currency lookup
    if (payload.priceMinor !== undefined && payload.priceMinor !== null) {
      if (typeof payload.priceMinor !== "number" || isNaN(payload.priceMinor)) {
        return errorResponse(
          new BadRequestError("Price must be a number", "INVALID_PRICE", [
            { path: "price", code: "INVALID_PRICE" },
          ]),
        );
      }
      if (payload.priceMinor <= 0) {
        return errorResponse(
          new BadRequestError(
            "Price must be greater than 0",
            payload.priceMinor < 0 ? "NEGATIVE_PRICE" : "PRICE_NOT_POSITIVE",
            [{ path: "price", code: payload.priceMinor < 0 ? "NEGATIVE_PRICE" : "PRICE_NOT_POSITIVE" }],
          ),
        );
      }
    } else if (payload.price !== undefined && payload.price !== null) {
      const priceStr = String(payload.price).trim();
      if (priceStr === "") {
        return errorResponse(
          new BadRequestError("Price is required", "REQUIRED", [
            { path: "price", code: "REQUIRED" },
          ]),
        );
      }
      const num = Number(priceStr);
      if (!isNaN(num) && num <= 0) {
        return errorResponse(
          new BadRequestError(
            num < 0 ? "Price must be at least 0" : "Price must be greater than 0",
            num < 0 ? "NEGATIVE_PRICE" : "PRICE_NOT_POSITIVE",
            [{ path: "price", code: num < 0 ? "NEGATIVE_PRICE" : "PRICE_NOT_POSITIVE" }],
          ),
        );
      }
    } else if (!existing) {
      return errorResponse(
        new BadRequestError("Price is required", "REQUIRED", [
          { path: "price", code: "REQUIRED" },
        ]),
      );
    }

    let currency: string;
    if (id === "new") {
      currency = await getShopCurrency(admin);
    } else {
      currency =
        typeof payload.currency === "string" && payload.currency.trim()
          ? payload.currency.trim().toUpperCase()
          : (existing?.price.currency ?? (await getShopCurrency(admin)));
    }

    let priceMinor = 0;
    if (payload.priceMinor !== undefined && payload.priceMinor !== null) {
      priceMinor = payload.priceMinor;
    } else if (payload.price !== undefined && payload.price !== null) {
      const priceStr = String(payload.price).trim();
      const parsed = parseMoneyText(priceStr, currency);
      if (!parsed.ok) {
        if (parsed.error === "MONEY_PRECISION") {
          const digits = minorUnitDigits(currency) ?? 2;
          return errorResponse(
            new BadRequestError(
              `Maximum ${digits} decimal places allowed for ${currency}`,
              "MONEY_PRECISION",
              [{ path: "price", code: "MONEY_PRECISION" }],
            ),
          );
        }
        return errorResponse(
          new BadRequestError("Invalid price format", parsed.error, [
            { path: "price", code: parsed.error },
          ]),
        );
      }
      if (parsed.amountMinor <= 0) {
        return errorResponse(
          new BadRequestError(
            parsed.amountMinor < 0 ? "Price must be at least 0" : "Price must be greater than 0",
            parsed.amountMinor < 0 ? "NEGATIVE_PRICE" : "PRICE_NOT_POSITIVE",
            [{ path: "price", code: parsed.amountMinor < 0 ? "NEGATIVE_PRICE" : "PRICE_NOT_POSITIVE" }],
          ),
        );
      }
      priceMinor = parsed.amountMinor;
    } else if (existing) {
      priceMinor = existing.price.amountMinor;
    }

    if (id === "new") {
      const created = await catalogService.createAddOn(shop.id, {
        name,
        priceMinor,
        currency,
      });

      let syncFailed = false;
      try {
        await syncItem(admin, shop.id, "addOn", created.id);
      } catch {
        syncFailed = true;
      }

      const finalCreated = await catalogService.getAddOn(shop.id, created.id);
      return data({ ok: true, addOn: finalCreated ?? created, syncFailed });
    } else {
      await catalogService.updateAddOn(shop.id, id, {
        name,
        priceMinor,
        currency,
      });

      let syncFailed = false;
      try {
        await syncItem(admin, shop.id, "addOn", id);
      } catch {
        syncFailed = true;
      }

      const finalAddOn = await catalogService.getAddOn(shop.id, id);
      return data({ ok: true, addOn: finalAddOn, syncFailed });
    }
  } catch (err) {
    if (err instanceof NotFoundError) {
      return errorResponse(err);
    }
    if (err instanceof CatalogValidationError) {
      return errorResponse(
        new BadRequestError(err.message, err.code, err.fields),
      );
    }
    if (err instanceof AppError) {
      return errorResponse(err);
    }
    throw err;
  }
};

export default function AddOnRoute() {
  const { addOn, currency: shopCurrency } = useLoaderData<typeof loader>();
  const actionResult = useActionData<typeof action>();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const lastActionRef = useRef<typeof actionResult | undefined>(undefined);

  useEffect(() => {
    if (actionResult && actionResult !== lastActionRef.current) {
      lastActionRef.current = actionResult;
      const res = actionResult as { ok?: boolean; syncFailed?: boolean };
      if (res.ok && !res.syncFailed) {
        shopify.toast.show("Saved");
        navigate("/app/options");
      }
    }
  }, [actionResult, navigate, shopify]);

  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting" || navigation.state === "loading";

  const currency = addOn?.price.currency ?? shopCurrency ?? "USD";
  const [name, setName] = useState(addOn?.name ?? "");
  const [price, setPrice] = useState(
    addOn
      ? toShopifyDecimal(addOn.price.amountMinor, currency)
      : toShopifyDecimal(0, currency),
  );

  const actionError = (
    actionResult as {
      error?: {
        code: string;
        message: string;
        fields?: Array<{ path: string; code: string }>;
      };
    }
  )?.error;

  const fieldErrors: Record<string, string> = {};
  if (actionError) {
    fieldErrors[actionError.code] = actionError.message;
    if (actionError.code === "NAME_NOT_UNIQUE" && !fieldErrors.name) {
      fieldErrors.name = actionError.message;
    }
    if (actionError.fields) {
      for (const field of actionError.fields) {
        fieldErrors[field.path] = actionError.message || field.code;
        fieldErrors[field.code] = actionError.message;
      }
    }
  }

  const digits = minorUnitDigits(currency) ?? 2;
  const KNOWN_ERROR_KEYS = new Set([
    "REQUIRED",
    "NEGATIVE_PRICE",
    "PRICE_NOT_POSITIVE",
    "MONEY_PRECISION",
    "name",
    "price",
  ]);
  const unlistedError =
    Object.entries(fieldErrors).find(([k]) => !KNOWN_ERROR_KEYS.has(k))?.[1];

  const syncFailed = Boolean(
    (actionResult as { syncFailed?: boolean } | undefined)?.syncFailed ??
      (addOn && !addOn.shopifyVariantId),
  );

  return (
    <s-page heading={addOn ? `Edit: ${addOn.name}` : "New add-on"}>
      <s-link slot="breadcrumb" href="/app/options">
        Options & add-ons
      </s-link>
      <s-section heading="Add-on details">
        <s-stack direction="block" gap="base">
          {syncFailed && (
            <s-stack direction="block" gap="base">
              <s-banner tone="critical" heading="Shopify sync failed">
                <s-paragraph>
                  Failed to synchronize add-on with Shopify.
                </s-paragraph>
              </s-banner>
              <s-stack direction="inline" gap="base">
                <s-badge tone="critical">Sync failed</s-badge>
                <Form method="post">
                  <input type="hidden" name="intent" value="retry_sync" />
                  <s-button
                    type="submit"
                    variant="tertiary"
                    {...(isSubmitting ? { disabled: true } : {})}
                  >
                    Retry
                  </s-button>
                </Form>
              </s-stack>
            </s-stack>
          )}
          <Form method="post">
            <s-stack direction="block" gap="base">
            {unlistedError && (
              <s-banner tone="critical" heading="Action failed">
                <s-paragraph>{unlistedError}</s-paragraph>
              </s-banner>
            )}
            {fieldErrors.REQUIRED && (
              <s-banner tone="critical" heading="Missing required fields">
                <s-paragraph>Please fill in all required fields.</s-paragraph>
              </s-banner>
            )}
            {fieldErrors.NEGATIVE_PRICE && (
              <s-banner tone="critical" heading="Invalid price">
                <s-paragraph>Price must be at least 0.</s-paragraph>
              </s-banner>
            )}
            {fieldErrors.PRICE_NOT_POSITIVE && (
              <s-banner tone="critical" heading="Invalid price">
                <s-paragraph>Price must be greater than 0.</s-paragraph>
              </s-banner>
            )}
            {fieldErrors.MONEY_PRECISION && (
              <s-banner tone="critical" heading="Invalid price precision">
                <s-paragraph>
                  {typeof fieldErrors.MONEY_PRECISION === "string" &&
                  fieldErrors.MONEY_PRECISION !== "MONEY_PRECISION"
                    ? fieldErrors.MONEY_PRECISION
                    : `Maximum ${digits} decimal places allowed for ${currency}.`}
                </s-paragraph>
              </s-banner>
            )}

            <input type="hidden" name="currency" value={currency} />

            <s-text-field
              label="Name"
              name="name"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              error={fieldErrors.name}
              required
            />

            <s-text-field
              label={currency ? `Price (${currency})` : "Price"}
              name="price"
              value={price}
              onInput={(e) => setPrice(e.currentTarget.value)}
              error={fieldErrors.price || fieldErrors.NEGATIVE_PRICE || fieldErrors.PRICE_NOT_POSITIVE || fieldErrors.MONEY_PRECISION}
              details="Price in the shop currency's normal units (e.g. 15.00)."
              required
            />

            <s-stack direction="inline" gap="base">
              <s-button
                type="submit"
                variant="primary"
                {...(isSubmitting ? { loading: true } : {})}
                {...(isSubmitting ? { disabled: true } : {})}
              >
                Save add-on
              </s-button>
              <s-button
                type="button"
                onClick={() => navigate("/app/options")}
                {...(isSubmitting ? { disabled: true } : {})}
              >
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};