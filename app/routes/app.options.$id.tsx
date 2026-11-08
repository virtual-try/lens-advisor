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
  type CatalogOptionGroupDto,
  type CatalogOptionValueDto,
} from "../features/catalog/catalog.service.server";
import {
  optionValueActionSchema,
  validateInput,
} from "../features/catalog/schema";
import {
  minorUnitDigits,
  parseMoneyText,
  toShopifyDecimal,
} from "../../packages/rx-core/src/pricing/index.js";
import { archiveItem, syncItem } from "../features/product-sync";
import {
  OptionValueForm,
  type OptionValueFormData,
} from "../features/catalog/components/option-value-form";

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
    throw new NotFoundError("Option value ID is required");
  }

  const url = new URL(request.url);
  const allGroups = await catalogService.listOptionGroups(shop.id);

  if (id === "new") {
    const groupId = url.searchParams.get("groupId") || (allGroups[0]?.id ?? "");
    let group: CatalogOptionGroupDto | null = null;
    if (groupId) {
      group = await catalogService.getOptionGroup(shop.id, groupId);
    }
    return data({
      optionValue: null,
      group,
      allGroups,
      plan,
      shopDomain: session.shop,
    });
  }

  const optionValue = await catalogService.getOptionValue(shop.id, id);
  if (!optionValue) {
    throw new NotFoundError("Option value not found");
  }

  const group = await catalogService.getOptionGroup(shop.id, optionValue.optionGroupId);

  return data({
    optionValue,
    group,
    allGroups,
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
      return errorResponse(new NotFoundError("Option value ID is required"));
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

    const payload = validateInput(optionValueActionSchema, rawData);
    const intent = payload.intent ?? "save";

    // Intent: Delete / Archive
    if (intent === "delete" || intent === "archive") {
      const existing = await catalogService.getOptionValue(shop.id, id);
      if (!existing) {
        return errorResponse(new NotFoundError("Option value not found"));
      }

      if (existing.shopifyVariantId) {
        try {
          const res = await archiveItem(admin, shop.id, "optionValue", id);
          if (!res || !res.ok) {
            throw new Error("Shopify archive failed");
          }
        } catch {
          return errorResponse(
            new BadRequestError(
              "Failed to archive item in Shopify. Please retry.",
              "SHOPIFY_ARCHIVE_FAILED",
            ),
          );
        }
      }

      await catalogService.archiveOptionValue(shop.id, id);
      return data({ ok: true, archived: true });
    }

    // Intent: Save / Update
    let existing: CatalogOptionValueDto | null = null;
    if (id !== "new") {
      existing = await catalogService.getOptionValue(shop.id, id);
      if (!existing) {
        return errorResponse(new NotFoundError("Option value not found"));
      }
    }

    const label =
      typeof payload.label === "string"
        ? payload.label.trim()
        : existing?.label ?? "";

    if (!label) {
      return errorResponse(
        new BadRequestError("Label is required", "REQUIRED", [
          { path: "label", code: "REQUIRED" },
        ]),
      );
    }

    const currency =
      typeof payload.currency === "string" && payload.currency.trim()
        ? payload.currency.trim().toUpperCase()
        : existing?.priceDelta.currency || "USD";

    // Parse price delta
    let priceDeltaMinor = 0;
    if (payload.priceDeltaMinor !== undefined && payload.priceDeltaMinor !== null) {
      priceDeltaMinor = payload.priceDeltaMinor;
    } else if (payload.priceDelta !== undefined && payload.priceDelta !== null) {
      const priceStr = String(payload.priceDelta).trim();
      if (priceStr !== "") {
        const parsed = parseMoneyText(priceStr, currency);
        if (!parsed.ok) {
          if (parsed.error === "MONEY_PRECISION") {
            const digits = minorUnitDigits(currency) ?? 2;
            return errorResponse(
              new BadRequestError(
                `Maximum ${digits} decimal places allowed for ${currency}`,
                "MONEY_PRECISION",
                [{ path: "priceDelta", code: "MONEY_PRECISION" }],
              ),
            );
          }
          return errorResponse(
            new BadRequestError("Invalid price format", parsed.error, [
              { path: "priceDelta", code: parsed.error },
            ]),
          );
        }
        if (parsed.amountMinor < 0) {
          return errorResponse(
            new BadRequestError("Price delta must be at least 0", "NEGATIVE_PRICE", [
              { path: "priceDelta", code: "NEGATIVE_PRICE" },
            ]),
          );
        }
        priceDeltaMinor = parsed.amountMinor;
      }
    } else if (existing) {
      priceDeltaMinor = existing.priceDelta.amountMinor;
    }

    // Parse token and overrideCode
    let tokenKey: string | null = null;
    let tokenValue: string | null = null;
    let overrideCode: string | null = null;

    const rawTokenString = typeof payload.token === "string" ? payload.token.trim() : null;
    const rawOverrideString = typeof payload.overrideCode === "string" ? payload.overrideCode.trim() : null;

    if (rawTokenString && rawOverrideString) {
      return errorResponse(
        new BadRequestError(
          "Choose either a lab-code token or an override code, not both",
          "ONE_CODE_SOURCE",
          [
            { path: "overrideCode", code: "ONE_CODE_SOURCE" },
            { path: "token", code: "ONE_CODE_SOURCE" },
          ],
        ),
      );
    }

    if (rawTokenString) {
      const eqIdx = rawTokenString.indexOf("=");
      const key = eqIdx !== -1 ? rawTokenString.slice(0, eqIdx).trim() : "";
      const val = eqIdx !== -1 ? rawTokenString.slice(eqIdx + 1).trim() : "";
      if (eqIdx === -1 || !key || !val) {
        return errorResponse(
          new BadRequestError(
            "Lab-code token must be in key=VALUE format",
            "MALFORMED_TOKEN",
            [{ path: "token", code: "MALFORMED_TOKEN" }],
          ),
        );
      }
      tokenKey = key;
      tokenValue = val;
    }
    if (typeof payload.tokenKey === "string" && payload.tokenKey.trim()) {
      tokenKey = payload.tokenKey.trim();
    }
    if (typeof payload.tokenValue === "string" && payload.tokenValue.trim()) {
      tokenValue = payload.tokenValue.trim();
    }
    if ((tokenKey && !tokenValue) || (!tokenKey && tokenValue)) {
      return errorResponse(
        new BadRequestError(
          "Lab-code token must be in key=VALUE format",
          "MALFORMED_TOKEN",
          [{ path: "token", code: "MALFORMED_TOKEN" }],
        ),
      );
    }

    if (rawOverrideString) {
      overrideCode = rawOverrideString;
    }

    if (payload.token === "" || payload.token === null) {
      tokenKey = null;
      tokenValue = null;
    }
    if (payload.overrideCode === "" || payload.overrideCode === null) {
      overrideCode = null;
    }

    // Code source exclusivity check
    const hasToken = Boolean(tokenKey && tokenValue);
    const hasOverride = Boolean(overrideCode);
    if (hasToken && hasOverride) {
      return errorResponse(
        new BadRequestError(
          "Choose either a lab-code token or an override code, not both",
          "ONE_CODE_SOURCE",
          [
            { path: "overrideCode", code: "ONE_CODE_SOURCE" },
            { path: "token", code: "ONE_CODE_SOURCE" },
          ],
        ),
      );
    }

    const swatch =
      typeof payload.swatch === "string"
        ? payload.swatch.trim() || null
        : existing?.swatch ?? null;

    if (id === "new") {
      const url = new URL(request.url);
      const optionGroupId =
        (typeof payload.optionGroupId === "string" && payload.optionGroupId.trim()) ||
        url.searchParams.get("groupId");

      if (!optionGroupId) {
        return errorResponse(
          new BadRequestError("Option group ID is required", "REQUIRED", [
            { path: "optionGroupId", code: "REQUIRED" },
          ]),
        );
      }

      const group = await catalogService.getOptionGroup(shop.id, optionGroupId);
      if (!group) {
        return errorResponse(new NotFoundError("Option group not found"));
      }

      const created = await catalogService.createOptionValue(shop.id, {
        optionGroupId,
        label,
        priceDeltaMinor,
        currency,
        tokenKey,
        tokenValue,
        overrideCode,
        swatch,
      });

      if (priceDeltaMinor > 0) {
        try {
          await syncItem(admin, shop.id, "optionValue", created.id);
        } catch {
          // Keep the saved item even if Shopify sync fails
        }
      }

      return data({ ok: true, optionValue: created });
    } else {
      const previousDelta = existing!.priceDelta.amountMinor;
      const hadVariant = Boolean(existing!.shopifyVariantId);

      await catalogService.updateOptionValue(shop.id, id, {
        label,
        priceDeltaMinor,
        currency,
        tokenKey,
        tokenValue,
        overrideCode,
        swatch,
      });

      // Price removed: delta changed from > 0 to 0 on an item that had a Shopify variant
      if (previousDelta > 0 && priceDeltaMinor === 0 && hadVariant) {
        let archiveSuccess = false;
        try {
          const res = await archiveItem(admin, shop.id, "optionValue", id);
          archiveSuccess = Boolean(res && res.ok && (res.archived || res.reason === "NOT_SYNCED"));
        } catch {
          archiveSuccess = false;
        }

        if (archiveSuccess) {
          await catalogService.updateOptionValue(shop.id, id, {
            shopifyVariantId: null,
          });
        }

        const finalValue = await catalogService.getOptionValue(shop.id, id);
        return data({ ok: true, optionValue: finalValue, syncFailed: !archiveSuccess });
      }

      // Delta > 0: sync to Shopify
      if (priceDeltaMinor > 0) {
        try {
          await syncItem(admin, shop.id, "optionValue", id);
        } catch {
          // Keep the saved item even if Shopify sync fails
        }
      }

      const finalValue = await catalogService.getOptionValue(shop.id, id);
      return data({ ok: true, optionValue: finalValue });
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

export default function OptionValueRoute() {
  const { optionValue, group } = useLoaderData<typeof loader>();
  const actionResult = useActionData<typeof action>();
  const navigate = useNavigate();

  let isSubmitting = false;
  try {
    const navigation = useNavigation();
    isSubmitting = navigation.state === "submitting" || navigation.state === "loading";
  } catch {
    isSubmitting = false;
  }

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
    if (actionError.code === "NAME_NOT_UNIQUE" && !fieldErrors.label) {
      fieldErrors.label = actionError.message;
    }
    if (actionError.fields) {
      for (const field of actionError.fields) {
        fieldErrors[field.path] = actionError.message || field.code;
        fieldErrors[field.code] = actionError.message;
      }
    }
  }

  const currency = optionValue?.priceDelta.currency ?? "USD";
  const initialData: OptionValueFormData = {
    id: optionValue?.id,
    optionGroupId: optionValue?.optionGroupId ?? group?.id,
    label: optionValue?.label ?? "",
    priceDelta: optionValue
      ? toShopifyDecimal(optionValue.priceDelta.amountMinor, currency)
      : toShopifyDecimal(0, currency),
    tokenKey: optionValue?.tokenKey,
    tokenValue: optionValue?.tokenValue,
    overrideCode: optionValue?.overrideCode,
    swatch: optionValue?.swatch,
  };

  const syncFailed = Boolean(
    (actionResult as { syncFailed?: boolean } | undefined)?.syncFailed ||
      (optionValue &&
        optionValue.priceDelta.amountMinor === 0 &&
        optionValue.shopifyVariantId),
  );

  return (
    <s-page heading={optionValue ? `Edit: ${optionValue.label}` : "New option value"}>
      <s-link slot="breadcrumb" href="/app/options">
        Options & add-ons
      </s-link>
      <s-section heading="Option value details">
        <s-stack direction="block" gap="base">
          {syncFailed && (
            <s-banner tone="critical" heading="Shopify sync failed">
              <s-paragraph>
                Failed to archive product variant in Shopify.
              </s-paragraph>
            </s-banner>
          )}
          <OptionValueForm
            initialData={initialData}
            groupKind={group?.kind ?? "MATERIAL"}
            currency={currency}
            errors={fieldErrors}
            isSubmitting={isSubmitting}
            onCancel={() => navigate("/app/options")}
          />
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