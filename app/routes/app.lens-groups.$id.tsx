import { useCallback, useRef, useState } from "react";
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
  archiveLensGroup,
  createLensGroup,
  getLensGroup,
  updateLensGroup,
  ValidationError,
} from "../features/catalog/catalog.service.server";

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

  const id = params.id;
  if (!id || id === "new") {
    return data({ group: null, isNew: true });
  }

  try {
    const group = await getLensGroup(shop.id, id);
    return data({ group, isNew: false });
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw errorResponse(error);
    }
    throw error;
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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
      for (const [k, v] of formData.entries()) {
        rawData[k] = v;
      }
    } catch {
      return errorResponse(
        new BadRequestError("Invalid form data", "INVALID_INPUT", [
          { path: "body", code: "INVALID_FORM_DATA" },
        ]),
      );
    }
  }

  const intent = String(rawData.intent ?? "save");
  const id = params.id;

  try {
    if (intent === "archive") {
      if (!id || id === "new") {
        return errorResponse(
          new BadRequestError("Cannot archive unsaved group", "INVALID_INPUT"),
        );
      }
      await archiveLensGroup(shop.id, id);
      return redirect("/app/lenses");
    }

    const name = String(rawData.name ?? "").trim();
    const description = String(rawData.description ?? "").trim();

    if (!name) {
      return errorResponse(
        new BadRequestError("Name is required", "NAME_REQUIRED", [
          { path: "name", code: "REQUIRED" },
        ]),
      );
    }

    if (!id || id === "new") {
      await createLensGroup(shop.id, { name, description });
      return redirect("/app/lenses");
    } else {
      await updateLensGroup(shop.id, id, { name, description });
      return redirect("/app/lenses");
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return errorResponse(
        new BadRequestError(error.message, error.code, [
          { path: "name", code: error.code },
        ]),
      );
    }
    if (error instanceof AppError) {
      return errorResponse(error);
    }
    throw error;
  }
};

export default function LensGroupEditRoute() {
  const { group, isNew } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" || navigation.state === "loading";

  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const modalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);

  const actionError =
    actionData && typeof actionData === "object" && "error" in actionData
      ? (
          actionData as {
            error?: {
              code?: string;
              message?: string;
              fields?: Array<{ path: string; code: string }>;
            };
          }
        ).error
      : undefined;

  const handleModalHide = useCallback(() => {
    modalRef.current?.hideOverlay?.();
  }, []);

  const openArchiveModal = () => {
    modalRef.current?.showOverlay?.();
  };

  const handleCancelArchive = () => {
    handleModalHide();
  };

  const handleConfirmArchive = () => {
    handleModalHide();
    const form = document.getElementById(
      "lens-group-form",
    ) as HTMLFormElement | null;
    if (form) {
      const intentInput = form.querySelector(
        'input[name="intent"]',
      ) as HTMLInputElement | null;
      if (intentInput) {
        intentInput.value = "archive";
      }
      form.requestSubmit();
    }
  };

  const handleSubmit = () => {
    const form = document.getElementById(
      "lens-group-form",
    ) as HTMLFormElement | null;
    form?.requestSubmit();
  };

  return (
    <s-page heading={isNew ? "New lens group" : `Edit ${group?.name}`}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSubmit}
        disabled={!name.trim() || isSubmitting}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>

      {!isNew && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          onClick={openArchiveModal}
        >
          Archive
        </s-button>
      )}

      <form method="post" id="lens-group-form">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="description" value={description} />

        <s-stack direction="block" gap="base">
          {actionError && (
            <s-banner tone="critical" heading="Error">
              {actionError.message || actionError.code}
            </s-banner>
          )}

          <s-section heading="Lens group details">
            <s-stack direction="block" gap="base">
              <s-text-field
                label="Group name"
                name="nameField"
                value={name}
                error={
                  actionError?.fields?.find((f) => f.path === "name")?.code
                }
                onChange={(e) => {
                  setName(e.currentTarget.value);
                }}
                onInput={(e) => {
                  setName(e.currentTarget.value);
                }}
              />

              <s-text-area
                label="Description"
                name="descriptionField"
                value={description}
                onChange={(e) => {
                  setDescription(e.currentTarget.value);
                }}
                onInput={(e) => {
                  setDescription(e.currentTarget.value);
                }}
              />
            </s-stack>
          </s-section>
        </s-stack>
      </form>

      {!isNew && (
        <s-modal
          id="archive-group-modal"
          ref={modalRef}
          heading="Archive lens group"
          onHide={handleModalHide}
        >
          <s-paragraph>
            Are you sure you want to archive this lens group?
          </s-paragraph>
          <s-button
            slot="primary-action"
            tone="critical"
            onClick={handleConfirmArchive}
          >
            Confirm archive
          </s-button>
          <s-button
            slot="secondary-actions"
            variant="secondary"
            onClick={handleCancelArchive}
          >
            Cancel
          </s-button>
        </s-modal>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
