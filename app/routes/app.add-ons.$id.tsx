import { useState } from "react";
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
} from "react-router";
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
  parseMoneyText,
  toShopifyDecimal,
} from "../../packages/rx-core/src/pricing/index.js";
import { archiveItem, syncItem } from "../features/product-sync";

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
  const { session, plan } = await requireActivePlan(request);
  const prisma = getPrisma();
  const shop = await getShopByDomain(session.shop, prisma);
  const catalogService = createCatalogService({ prisma });

  const id = params.id;
  if (!id) {
    throw new NotFoundError("Add-on ID is required");
  }

  if (id === "new") {
    return data({
      addOn: null,
      plan,
      shopDomain: session.shop,
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
    const intent = typeof payload.intent === "string" ? payload.intent : "save";

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

    const currency =
      typeof payload.currency === "string" && payload.currency.trim()
        ? payload.currency.trim().toUpperCase()
        : existing?.price.currency || "USD";

    let priceMinor = 0;
    if (payload.priceMinor !== undefined && payload.priceMinor !== null) {
      priceMinor = payload.priceMinor;
    } else if (payload.price !== undefined && payload.price !== null) {
      const priceStr = String(payload.price).trim();
      if (priceStr !== "") {
        const parsed = parseMoneyText(priceStr, currency);
        if (!parsed.ok) {
          if (parsed.error === "MONEY_PRECISION") {
            return errorResponse(
              new BadRequestError(
                `Maximum 2 decimal places allowed for ${currency}`,
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
        if (parsed.amountMinor < 0) {
          return errorResponse(
            new BadRequestError("Price must be at least 0", "NEGATIVE_PRICE", [
              { path: "price", code: "NEGATIVE_PRICE" },
            ]),
          );
        }
        priceMinor = parsed.amountMinor;
      }
    } else if (existing) {
      priceMinor = existing.price.amountMinor;
    }

    if (id === "new") {
      const created = await catalogService.createAddOn(shop.id, {
        name,
        priceMinor,
        currency,
      });

      try {
        await syncItem(admin, shop.id, "addOn", created.id);
      } catch {
        // Keep save even if Shopify sync fails
      }

      return data({ ok: true, addOn: created });
    } else {
      await catalogService.updateAddOn(shop.id, id, {
        name,
        priceMinor,
        currency,
      });

      try {
        await syncItem(admin, shop.id, "addOn", id);
      } catch {
        // Keep save even if Shopify sync fails
      }

      const finalAddOn = await catalogService.getAddOn(shop.id, id);
      return data({ ok: true, addOn: finalAddOn });
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
  const { addOn } = useLoaderData<typeof loader>();
  const actionResult = useActionData<typeof action>();
  const navigate = useNavigate();

  let isSubmitting = false;
  try {
    const navigation = useNavigation();
    isSubmitting = navigation.state === "submitting" || navigation.state === "loading";
  } catch {
    isSubmitting = false;
  }

  const currency = addOn?.price.currency ?? "USD";
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
    if (actionError.fields) {
      for (const field of actionError.fields) {
        fieldErrors[field.path] = actionError.message || field.code;
        fieldErrors[field.code] = actionError.message;
      }
    }
  }

  return (
    <s-page heading={addOn ? `Edit: ${addOn.name}` : "New add-on"}>
      <s-link slot="breadcrumb" href="/app/options">
        Options & add-ons
      </s-link>
      <s-section heading="Add-on details">
        <form method="post">
          <s-stack direction="block" gap="base">
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
            {fieldErrors.MONEY_PRECISION && (
              <s-banner tone="critical" heading="Invalid price precision">
                <s-paragraph>Maximum 2 decimal places allowed.</s-paragraph>
              </s-banner>
            )}

            <s-text-field
              label="Name"
              name="name"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              error={fieldErrors.name}
              required
            />

            <s-text-field
              label="Price"
              name="price"
              value={price}
              onInput={(e) => setPrice(e.currentTarget.value)}
              error={fieldErrors.price || fieldErrors.NEGATIVE_PRICE || fieldErrors.MONEY_PRECISION}
              details="Price in minor units or formatted currency (e.g. 15.00)."
              required
            />

            <s-stack direction="inline" gap="base">
              <s-button
                type="submit"
                variant="primary"
                loading={isSubmitting}
                disabled={isSubmitting}
              >
                Save add-on
              </s-button>
              <s-button
                type="button"
                onClick={() => navigate("/app/options")}
                disabled={isSubmitting}
              >
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </form>
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