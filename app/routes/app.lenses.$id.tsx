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

import type { RxType } from "../../packages/rx-core/src/index.js";
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
  listLensGroups,
  updateLens,
  ValidationError,
} from "../features/catalog/catalog.service.server";
import { archiveItem, syncItem } from "../features/product-sync/product-sync.server";
import LensForm from "../features/catalog/components/lens-form";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await requireActivePlan(request);
  const prisma = getPrisma();

  let shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) {
    shop = await prisma.shop.create({
      data: { domain: session.shop },
    });
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
      shopCurrency: "USD",
    });
  }

  try {
    const lens = await getLens(shop.id, id);
    return data({
      lens,
      groups,
      isNew: false,
      defaultGroupId: lens.groupId,
      shopCurrency: lens.price.currency,
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
  let rawRxTypes: string[] = [];

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      rawData = (await request.json()) as Record<string, unknown>;
      if (Array.isArray(rawData.rxTypes)) {
        rawRxTypes = rawData.rxTypes.map(String);
      }
    } catch {
      return errorResponse(
        new BadRequestError("Invalid JSON", "INVALID_INPUT"),
      );
    }
  } else {
    try {
      const formData = await request.formData();
      for (const [k, v] of formData.entries()) {
        if (k === "rxTypes") {
          const valStr = String(v);
          if (valStr.includes(",")) {
            rawRxTypes.push(...valStr.split(",").map((s) => s.trim()));
          } else {
            rawRxTypes.push(valStr);
          }
        } else {
          rawData[k] = v;
        }
      }
    } catch {
      return errorResponse(
        new BadRequestError("Invalid form data", "INVALID_INPUT"),
      );
    }
  }

  const intent = String(rawData.intent ?? "save");
  const id = params.id;

  try {
    if (intent === "archive") {
      if (!id || id === "new") {
        return errorResponse(
          new BadRequestError("Cannot archive unsaved lens", "INVALID_INPUT"),
        );
      }
      await archiveLens(shop.id, id);
      await archiveItem(admin, shop.id, "lens", id);
      return redirect("/app/lenses");
    }

    const groupId = String(rawData.groupId ?? "").trim();
    const name = String(rawData.name ?? "").trim();
    const description = String(rawData.description ?? "").trim();
    const price = String(rawData.price ?? "").trim();
    const currency = String(rawData.currency ?? "USD").trim();
    const sphMin = String(rawData.sphMin ?? "").trim();
    const sphMax = String(rawData.sphMax ?? "").trim();
    const cylMin = String(rawData.cylMin ?? "").trim();
    const cylMax = String(rawData.cylMax ?? "").trim();
    const addMin = String(rawData.addMin ?? "").trim();
    const addMax = String(rawData.addMax ?? "").trim();
    const labCodeTemplate = String(rawData.labCodeTemplate ?? "").trim();

    if (!groupId) {
      return errorResponse(
        new BadRequestError("Group is required", "REQUIRED", [
          { path: "groupId", code: "REQUIRED" },
        ]),
      );
    }
    if (!name) {
      return errorResponse(
        new BadRequestError("Name is required", "NAME_REQUIRED", [
          { path: "name", code: "REQUIRED" },
        ]),
      );
    }

    // Money validation
    const parsedPrice = parseMoneyText(price, currency);
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
    const sphMinRes = parseDiopterText(sphMin, "sph");
    if (!sphMinRes.ok) {
      return errorResponse(
        new BadRequestError("Invalid SPH min", sphMinRes.error, [
          { path: "sphMin", code: sphMinRes.error },
        ]),
      );
    }
    const sphMaxRes = parseDiopterText(sphMax, "sph");
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
    const cylMinRes = parseDiopterText(cylMin, "cyl");
    if (!cylMinRes.ok) {
      return errorResponse(
        new BadRequestError("Invalid CYL min", cylMinRes.error, [
          { path: "cylMin", code: cylMinRes.error },
        ]),
      );
    }
    const cylMaxRes = parseDiopterText(cylMax, "cyl");
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

    // ADD Diopter validation
    let addMinVal: number | undefined;
    let addMaxVal: number | undefined;
    if (addMin) {
      const addMinRes = parseDiopterText(addMin, "add");
      if (!addMinRes.ok) {
        return errorResponse(
          new BadRequestError("Invalid ADD min", addMinRes.error, [
            { path: "addMin", code: addMinRes.error },
          ]),
        );
      }
      addMinVal = addMinRes.value;
    }
    if (addMax) {
      const addMaxRes = parseDiopterText(addMax, "add");
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
      addMinVal !== undefined &&
      addMaxVal !== undefined &&
      addMinVal > addMaxVal
    ) {
      return errorResponse(
        new BadRequestError("Limits inverted", "LIMITS_INVERTED", [
          { path: "addMax", code: "LIMITS_INVERTED" },
        ]),
      );
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

    // Rx types validation
    const validRxTypes = Array.from(new Set(rawRxTypes)).filter((t) =>
      ["SINGLE_VISION", "PROGRESSIVE", "READING", "NON_PRESCRIPTION"].includes(
        t,
      ),
    ) as RxType[];
    if (validRxTypes.length === 0) {
      return errorResponse(
        new BadRequestError(
          "At least one Rx type is required",
          "RX_TYPES_REQUIRED",
          [{ path: "rxTypes", code: "REQUIRED" }],
        ),
      );
    }

    let savedLens;
    if (!id || id === "new") {
      savedLens = await createLens(shop.id, {
        groupId,
        name,
        description,
        priceMinor: parsedPrice.amountMinor,
        currency,
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
        groupId,
        name,
        description,
        priceMinor: parsedPrice.amountMinor,
        currency,
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
    throw error;
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
