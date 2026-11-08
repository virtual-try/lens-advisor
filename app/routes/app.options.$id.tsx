import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useActionData, useLoaderData, useNavigate } from "react-router";
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
import { parseMoneyText } from "../../packages/rx-core/src/pricing/index.js";
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
    let rawData: Record<string, unknown> = {};
    if (contentType.includes("application/json")) {
      try {
        rawData = (await request.json()) as Record<string, unknown>;
      } catch {
        return errorResponse(new BadRequestError("Malformed JSON body", "INVALID_INPUT"));
      }
    } else {
      const formData = await request.formData();
      rawData = Object.fromEntries(formData.entries());
    }

    const intent = typeof rawData.intent === "string" ? rawData.intent : "save";

    // Intent: Delete / Archive
    if (intent === "delete" || intent === "archive") {
      const existing = await catalogService.getOptionValue(shop.id, id);
      if (!existing) {
        return errorResponse(new NotFoundError("Option value not found"));
      }

      if (existing.shopifyVariantId) {
        try {
          await archiveItem(admin, shop.id, "optionValue", id);
        } catch {
          // proceed with local archiving even if shopify product archive fails
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
      typeof rawData.label === "string"
        ? rawData.label.trim()
        : existing?.label ?? "";

    if (!label) {
      return errorResponse(
        new BadRequestError("Label is required", "REQUIRED", [
          { path: "label", code: "REQUIRED" },
        ]),
      );
    }

    const currency =
      typeof rawData.currency === "string" && rawData.currency.trim()
        ? rawData.currency.trim().toUpperCase()
        : existing?.priceDelta.currency || "USD";

    // Parse price delta
    let priceDeltaMinor = 0;
    if (rawData.priceDeltaMinor !== undefined && rawData.priceDeltaMinor !== null) {
      const num = Number(rawData.priceDeltaMinor);
      if (!Number.isInteger(num)) {
        return errorResponse(
          new BadRequestError("Price delta must be an integer", "NOT_INTEGER", [
            { path: "priceDelta", code: "NOT_INTEGER" },
          ]),
        );
      }
      if (num < 0) {
        return errorResponse(
          new BadRequestError("Price delta must be at least 0", "NEGATIVE_PRICE", [
            { path: "priceDelta", code: "NEGATIVE_PRICE" },
          ]),
        );
      }
      priceDeltaMinor = num;
    } else if (rawData.priceDelta !== undefined && rawData.priceDelta !== null) {
      const priceStr = String(rawData.priceDelta).trim();
      if (priceStr !== "") {
        const parsed = parseMoneyText(priceStr, currency);
        if (!parsed.ok) {
          if (parsed.error === "MONEY_PRECISION") {
            return errorResponse(
              new BadRequestError(
                `Maximum 2 decimal places allowed for ${currency}`,
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

    if (typeof rawData.token === "string" && rawData.token.trim()) {
      const parts = rawData.token.trim().split("=");
      tokenKey = parts[0]?.trim() || null;
      tokenValue = parts.slice(1).join("=").trim() || null;
    }
    if (typeof rawData.tokenKey === "string" && rawData.tokenKey.trim()) {
      tokenKey = rawData.tokenKey.trim();
    }
    if (typeof rawData.tokenValue === "string" && rawData.tokenValue.trim()) {
      tokenValue = rawData.tokenValue.trim();
    }
    if (typeof rawData.overrideCode === "string" && rawData.overrideCode.trim()) {
      overrideCode = rawData.overrideCode.trim();
    }

    if (rawData.token === "" || rawData.token === null) {
      tokenKey = null;
      tokenValue = null;
    }
    if (rawData.overrideCode === "" || rawData.overrideCode === null) {
      overrideCode = null;
    }

    // Code source exclusivity check
    const hasToken = Boolean(tokenKey || tokenValue);
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
      typeof rawData.swatch === "string"
        ? rawData.swatch.trim() || null
        : existing?.swatch ?? null;

    if (id === "new") {
      const url = new URL(request.url);
      const optionGroupId =
        (typeof rawData.optionGroupId === "string" && rawData.optionGroupId.trim()) ||
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
        try {
          await archiveItem(admin, shop.id, "optionValue", id);
        } catch {
          // ignore shopify archive error
        }
        await catalogService.updateOptionValue(shop.id, id, {
          shopifyVariantId: null,
        });
        const finalValue = await catalogService.getOptionValue(shop.id, id);
        return data({ ok: true, optionValue: finalValue });
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
        fieldErrors[field.path] = field.code;
      }
    }
  }

  const initialData: OptionValueFormData = {
    id: optionValue?.id,
    optionGroupId: optionValue?.optionGroupId ?? group?.id,
    label: optionValue?.label ?? "",
    priceDelta: optionValue ? String(optionValue.priceDelta.amountMinor / 100) : "0",
    tokenKey: optionValue?.tokenKey,
    tokenValue: optionValue?.tokenValue,
    overrideCode: optionValue?.overrideCode,
    swatch: optionValue?.swatch,
  };

  return (
    <s-page heading={optionValue ? `Edit: ${optionValue.label}` : "New option value"}>
      <s-link slot="breadcrumb" href="/app/options">
        Options & add-ons
      </s-link>
      <s-section heading="Option value details">
        <OptionValueForm
          initialData={initialData}
          groupKind={group?.kind ?? "MATERIAL"}
          currency={optionValue?.priceDelta.currency ?? "USD"}
          errors={fieldErrors}
          onCancel={() => navigate("/app/options")}
        />
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useActionData());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
