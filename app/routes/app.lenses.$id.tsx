import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";

import { rxTypeSchema } from "../../packages/rx-core/src/index.js";
import { validateTemplate } from "../../packages/rx-core/src/lab-code/index.js";
import { parseDiopterText } from "../../packages/rx-core/src/rx/parse.js";
import { parseMoneyText } from "../../packages/rx-core/src/pricing/index.js";

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
  archiveLens,
  createLens,
  getLens,
  getLensGroup,
  listLensGroups,
  updateLens,
  ValidationError,
} from "../features/catalog/catalog.service.server";
import { archiveItem, syncItem } from "../features/product-sync/product-sync.server";
import { SHOP_CURRENCY_QUERY } from "../features/product-sync/graphql";
import { mapZodIssueToCode } from "../features/catalog/schema";
import LensForm from "../features/catalog/components/lens-form";

const archiveLensActionSchema = z.object({
  intent: z.literal("archive"),
});

const saveLensActionSchema = z.object({
  intent: z.literal("save").optional().default("save"),
  groupId: z
    .string({
      required_error: "Group is required",
      invalid_type_error: "Group ID must be a string",
    })
    .trim()
    .min(1, "REQUIRED"),
  name: z
    .string({
      required_error: "Name is required",
      invalid_type_error: "Name must be a string",
    })
    .trim()
    .min(1, "REQUIRED"),
  description: z
    .string({
      invalid_type_error: "Description must be a string",
    })
    .optional()
    .default(""),
  price: z.union([
    z.string({ invalid_type_error: "Price must be a string" }),
    z.number({ invalid_type_error: "Price must be a number" }),
  ]),
  sphMin: z.string({
    required_error: "SPH min is required",
    invalid_type_error: "SPH min must be a string",
  }),
  sphMax: z.string({
    required_error: "SPH max is required",
    invalid_type_error: "SPH max must be a string",
  }),
  cylMin: z.string({
    required_error: "CYL min is required",
    invalid_type_error: "CYL min must be a string",
  }),
  cylMax: z.string({
    required_error: "CYL max is required",
    invalid_type_error: "CYL max must be a string",
  }),
  addMin: z
    .union([
      z.string({ invalid_type_error: "ADD min must be a string" }),
      z.null(),
    ])
    .optional()
    .default(""),
  addMax: z
    .union([
      z.string({ invalid_type_error: "ADD max must be a string" }),
      z.null(),
    ])
    .optional()
    .default(""),
  labCodeTemplate: z
    .string({
      invalid_type_error: "Lab code template must be a string",
    })
    .optional()
    .default(""),
  rxTypes: z
    .array(rxTypeSchema, {
      required_error: "At least one Rx type is required",
      invalid_type_error: "rxTypes must be an array",
    })
    .min(1, "At least one Rx type is required"),
});

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await requireActivePlan(request);
  const prisma = getPrisma();

  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: session.shop },
    });
  }

  // Load shop currency via admin GraphQL client (R2-F2)
  let shopCurrency: string | undefined;
  try {
    const currencyRes = await admin.graphql(SHOP_CURRENCY_QUERY);
    if (currencyRes.ok) {
      const currencyJson = (await currencyRes.json()) as {
        data?: { shop?: { currencyCode?: string } };
        errors?: unknown[];
      };
      const code = currencyJson?.data?.shop?.currencyCode;
      if (!currencyJson.errors?.length && typeof code === "string" && code.trim().length === 3) {
        shopCurrency = code.trim().toUpperCase();
      }
    }
  } catch {
    // network or api error
  }

  if (!shopCurrency) {
    throw errorResponse(
      new BadRequestError(
        "Failed to retrieve shop currency from Shopify",
        "CURRENCY_FETCH_FAILED",
      ),
    );
  }

  const groups = await listLensGroups(shop.id, { includeArchived: false });
  const id = params.id;
  const url = new URL(request.url);
  const defaultGroupId = url.searchParams.get("groupId") ?? undefined;

  if (!id || id === "new") {
    return data({
      lens: null,
      groups,
      isNew: true,
      defaultGroupId,
      shopCurrency,
    });
  }

  try {
    const lens = await getLens(shop.id, id);
    if (lens.archivedAt) {
      throw new NotFoundError("Lens not found");
    }
    return data({
      lens,
      groups,
      isNew: false,
      defaultGroupId: lens.groupId,
      shopCurrency,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw errorResponse(error);
    }
    throw error;
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const prisma = getPrisma();

  // INV-1: Tenancy scoped strictly to authenticated session shop
  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: session.shop },
    });
  }

  let rawData: Record<string, unknown> = {};

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return errorResponse(
        new BadRequestError("Invalid JSON", "INVALID_INPUT", [
          { path: "body", code: "INVALID_JSON" },
        ]),
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return errorResponse(
        new BadRequestError("Payload must be a JSON object", "INVALID_INPUT", [
          { path: "body", code: "OBJECT_REQUIRED" },
        ]),
      );
    }
    rawData = parsed as Record<string, unknown>;
  } else {
    try {
      const formData = await request.formData();
      const obj: Record<string, unknown> = {};
      for (const [k, v] of formData.entries()) {
        if (k === "rxTypes") {
          const valStr = String(v);
          const parts = valStr.includes(",")
            ? valStr.split(",").map((s) => s.trim())
            : [valStr.trim()];
          if (!obj.rxTypes) {
            obj.rxTypes = parts;
          } else if (Array.isArray(obj.rxTypes)) {
            (obj.rxTypes as string[]).push(...parts);
          }
        } else {
          obj[k] = v;
        }
      }
      rawData = obj;
    } catch {
      return errorResponse(
        new BadRequestError("Invalid form data", "INVALID_INPUT", [
          { path: "body", code: "INVALID_FORM_DATA" },
        ]),
      );
    }
  }

  const intent = typeof rawData.intent === "string" ? rawData.intent : "save";
  const id = params.id;

  try {
    if (intent === "archive") {
      const parseResult = archiveLensActionSchema.safeParse(rawData);
      if (!parseResult.success) {
        const fields = parseResult.error.issues.map((issue) => ({
          path: issue.path.join(".") || "intent",
          code: mapZodIssueToCode(issue),
        }));
        return errorResponse(
          new BadRequestError("Invalid archive payload", "INVALID_INPUT", fields),
        );
      }

      if (!id || id === "new") {
        return errorResponse(
          new BadRequestError("Cannot archive unsaved lens", "INVALID_INPUT"),
        );
      }

      const existing = await getLens(shop.id, id);
      if (!existing || existing.archivedAt) {
        return errorResponse(new NotFoundError("Lens not found"));
      }

      await archiveItem(admin, shop.id, "lens", id);
      await archiveLens(shop.id, id);
      return redirect("/app/lenses");
    }

    if (intent === "save") {
      // Reject archived lens edits (R2-F3)
      if (id && id !== "new") {
        const existing = await getLens(shop.id, id);
        if (!existing || existing.archivedAt) {
          return errorResponse(new NotFoundError("Lens not found"));
        }
      }

      const parseResult = saveLensActionSchema.safeParse(rawData);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        const fields = parseResult.error.issues.map((issue) => {
          const path = issue.path.join(".");
          let code = mapZodIssueToCode(issue);
          if (issue.path[0] === "name" && issue.code === "too_small") {
            code = "REQUIRED";
          }
          if (
            issue.path[0] === "groupId" &&
            (issue.code === "too_small" || issue.code === "invalid_type")
          ) {
            code = "REQUIRED";
          }
          if (issue.path[0] === "rxTypes" && issue.code === "too_small") {
            code = "REQUIRED";
          }
          return { path, code };
        });

        const topCode =
          fields[0]?.path === "name" && fields[0]?.code === "REQUIRED"
            ? "NAME_REQUIRED"
            : fields[0]?.path === "rxTypes" && fields[0]?.code === "REQUIRED"
              ? "RX_TYPES_REQUIRED"
              : "INVALID_INPUT";

        return errorResponse(
          new BadRequestError(firstIssue?.message || "Invalid input", topCode, fields),
        );
      }

      const lensData = parseResult.data;

      // Reject archived target groups (R2-F3)
      const targetGroup = await getLensGroup(shop.id, lensData.groupId);
      if (!targetGroup || targetGroup.archivedAt) {
        return errorResponse(new NotFoundError("Lens group not found"));
      }

      // Derive currency server-side from shop's currency; never trust form data (R2-F2, R3-F2)
      let shopCurrency: string | undefined;
      try {
        const currencyRes = await admin.graphql(SHOP_CURRENCY_QUERY);
        if (currencyRes.ok) {
          const currencyJson = (await currencyRes.json()) as {
            data?: { shop?: { currencyCode?: string } };
            errors?: unknown[];
          };
          const code = currencyJson?.data?.shop?.currencyCode;
          if (!currencyJson.errors?.length && typeof code === "string" && code.trim().length === 3) {
            shopCurrency = code.trim().toUpperCase();
          }
        }
      } catch {
        // network or admin api failure
      }

      if (!shopCurrency) {
        return errorResponse(
          new BadRequestError(
            "Failed to retrieve shop currency from Shopify",
            "CURRENCY_FETCH_FAILED",
            [{ path: "currency", code: "CURRENCY_FETCH_FAILED" }],
          ),
        );
      }

      const name = lensData.name.trim();
      const description = lensData.description?.trim() ?? "";
      const priceStr = String(lensData.price).trim();
      const labCodeTemplate = lensData.labCodeTemplate?.trim() ?? "";

      // Money validation
      const parsedPrice = parseMoneyText(priceStr, shopCurrency);
      if (!parsedPrice.ok) {
        return errorResponse(
          new BadRequestError("Invalid price format", parsedPrice.error, [
            { path: "price", code: parsedPrice.error },
          ]),
        );
      }
      if (parsedPrice.amountMinor < 0) {
        return errorResponse(
          new BadRequestError("Price cannot be negative", "NEGATIVE_PRICE", [
            { path: "price", code: "NEGATIVE_PRICE" },
          ]),
        );
      }

      // SPH Diopter validation
      const sphMinRes = parseDiopterText(lensData.sphMin, "sph");
      if (!sphMinRes.ok) {
        return errorResponse(
          new BadRequestError("Invalid SPH min", sphMinRes.error, [
            { path: "sphMin", code: sphMinRes.error },
          ]),
        );
      }
      const sphMaxRes = parseDiopterText(lensData.sphMax, "sph");
      if (!sphMaxRes.ok) {
        return errorResponse(
          new BadRequestError("Invalid SPH max", sphMaxRes.error, [
            { path: "sphMax", code: sphMaxRes.error },
          ]),
        );
      }
      if (sphMinRes.value > sphMaxRes.value) {
        return errorResponse(
          new BadRequestError("Limits inverted", "LIMITS_INVERTED", [
            { path: "sphMax", code: "LIMITS_INVERTED" },
          ]),
        );
      }

      // CYL Diopter validation
      const cylMinRes = parseDiopterText(lensData.cylMin, "cyl");
      if (!cylMinRes.ok) {
        return errorResponse(
          new BadRequestError("Invalid CYL min", cylMinRes.error, [
            { path: "cylMin", code: cylMinRes.error },
          ]),
        );
      }
      const cylMaxRes = parseDiopterText(lensData.cylMax, "cyl");
      if (!cylMaxRes.ok) {
        return errorResponse(
          new BadRequestError("Invalid CYL max", cylMaxRes.error, [
            { path: "cylMax", code: cylMaxRes.error },
          ]),
        );
      }
      if (cylMinRes.value > cylMaxRes.value) {
        return errorResponse(
          new BadRequestError("Limits inverted", "LIMITS_INVERTED", [
            { path: "cylMax", code: "LIMITS_INVERTED" },
          ]),
        );
      }

      // Rx types are already validated by saveLensActionSchema
      const validRxTypes = Array.from(new Set(lensData.rxTypes));
      const supportsAdd =
        validRxTypes.includes("PROGRESSIVE") ||
        validRxTypes.includes("READING");

      // ADD Diopter validation
      let addMinVal: number | null = null;
      let addMaxVal: number | null = null;
      if (supportsAdd) {
        const rawAddMin =
          typeof lensData.addMin === "string" ? lensData.addMin.trim() : "";
        if (rawAddMin.length > 0) {
          const addMinRes = parseDiopterText(rawAddMin, "add");
          if (!addMinRes.ok) {
            return errorResponse(
              new BadRequestError("Invalid ADD min", addMinRes.error, [
                { path: "addMin", code: addMinRes.error },
              ]),
            );
          }
          addMinVal = addMinRes.value;
        }

        const rawAddMax =
          typeof lensData.addMax === "string" ? lensData.addMax.trim() : "";
        if (rawAddMax.length > 0) {
          const addMaxRes = parseDiopterText(rawAddMax, "add");
          if (!addMaxRes.ok) {
            return errorResponse(
              new BadRequestError("Invalid ADD max", addMaxRes.error, [
                { path: "addMax", code: addMaxRes.error },
              ]),
            );
          }
          addMaxVal = addMaxRes.value;
        }

        if (
          addMinVal !== null &&
          addMaxVal !== null &&
          addMinVal > addMaxVal
        ) {
          return errorResponse(
            new BadRequestError("Limits inverted", "LIMITS_INVERTED", [
              { path: "addMax", code: "LIMITS_INVERTED" },
            ]),
          );
        }
      }

      // Lab code template validation
      const templateVal = validateTemplate(labCodeTemplate);
      if (!templateVal.valid) {
        const errCode = templateVal.errors[0]?.code || "INVALID_TEMPLATE";
        return errorResponse(
          new BadRequestError("Invalid template", errCode, [
            { path: "labCodeTemplate", code: errCode },
          ]),
        );
      }

      let savedLens;
      if (!id || id === "new") {
        savedLens = await createLens(shop.id, {
          groupId: lensData.groupId,
          name,
          description,
          priceMinor: parsedPrice.amountMinor,
          currency: shopCurrency,
          rxTypes: validRxTypes,
          sphMin: sphMinRes.value,
          sphMax: sphMaxRes.value,
          cylMin: cylMinRes.value,
          cylMax: cylMaxRes.value,
          addMin: addMinVal,
          addMax: addMaxVal,
          labCodeTemplate,
        });
      } else {
        savedLens = await updateLens(shop.id, id, {
          groupId: lensData.groupId,
          name,
          description,
          priceMinor: parsedPrice.amountMinor,
          currency: shopCurrency,
          rxTypes: validRxTypes,
          sphMin: sphMinRes.value,
          sphMax: sphMaxRes.value,
          cylMin: cylMinRes.value,
          cylMax: cylMaxRes.value,
          addMin: addMinVal,
          addMax: addMaxVal,
          labCodeTemplate,
        });
      }

      // Shopify sync: attempt sync immediately
      // INV-1 & Self-check 2: a sync failure never rolls back the DB save!
      let syncFailed = false;
      let syncErrorMessage: string | undefined;
      try {
        await syncItem(admin, shop.id, "lens", savedLens.id);
      } catch (err) {
        syncFailed = true;
        syncErrorMessage = err instanceof Error ? err.message : "Sync failed";
      }

      if (request.headers.get("accept")?.includes("application/json")) {
        return data({
          ok: true,
          lens: savedLens,
          syncFailed,
          syncError: syncErrorMessage,
        });
      }

      if (syncFailed) {
        return redirect(`/app/lenses?syncFailed=${savedLens.id}`);
      }

      return redirect("/app/lenses");
    }

    return errorResponse(
      new BadRequestError(`Unknown intent: ${intent}`, "INVALID_INTENT", [
        { path: "intent", code: "INVALID_INTENT" },
      ]),
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(
        new BadRequestError(error.message, error.code, [
          { path: "form", code: error.code },
        ]),
      );
    }
    if (error instanceof AppError) {
      return errorResponse(error);
    }
    return errorResponse(error);
  }
};

export default function LensEditRoute() {
  const { lens, groups, defaultGroupId, shopCurrency } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" || navigation.state === "loading";

  return (
    <LensForm
      lens={lens}
      groups={groups}
      defaultGroupId={defaultGroupId}
      shopCurrency={shopCurrency}
      isSubmitting={isSubmitting}
      actionData={actionData}
    />
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
