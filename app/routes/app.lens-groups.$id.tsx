import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  data,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";

import { authenticate } from "../shopify.server";
import { getPrisma } from "../shared/container/prisma.server";
import {
  AppError,
  BadRequestError,
  ConflictError,
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
import { mapZodIssueToCode } from "../features/catalog/schema";

const saveLensGroupSchema = z.object({
  intent: z.literal("save").optional().default("save"),
  name: z
    .string({
      required_error: "Name is required",
      invalid_type_error: "Name must be a string",
    })
    .trim()
    .min(1, "Name is required"),
  description: z
    .string({
      invalid_type_error: "Description must be a string",
    })
    .optional()
    .default(""),
});

const archiveLensGroupSchema = z.object({
  intent: z.literal("archive"),
});

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
    if (group.archivedAt) {
      throw new NotFoundError("Lens group not found");
    }
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

  const intent = typeof rawData.intent === "string" ? rawData.intent : "save";
  const id = params.id;

  try {
    if (intent === "archive") {
      const parseResult = archiveLensGroupSchema.safeParse(rawData);
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
          new BadRequestError("Cannot archive unsaved group", "INVALID_INPUT"),
        );
      }
      const existing = await getLensGroup(shop.id, id);
      if (!existing || existing.archivedAt) {
        return errorResponse(new NotFoundError("Lens group not found"));
      }

      const activeLensesCount = await prisma.lens.count({
        where: {
          shopId: shop.id,
          groupId: id,
          archivedAt: null,
        },
      });
      if (activeLensesCount > 0) {
        return errorResponse(
          new ConflictError(
            "Cannot archive a group that still has active lenses. Archive its lenses first.",
            "GROUP_NOT_EMPTY",
          ),
        );
      }

      await archiveLensGroup(shop.id, id);
      return redirect("/app/lenses");
    }

    if (intent === "save") {
      const parseResult = saveLensGroupSchema.safeParse(rawData);
      if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        const fields = parseResult.error.issues.map((issue) => {
          const path = issue.path.join(".") || "name";
          const code =
            path === "name" && (issue.code === "too_small" || issue.message === "Name is required")
              ? "REQUIRED"
              : mapZodIssueToCode(issue);
          return { path, code };
        });
        const topCode =
          fields[0]?.path === "name" && fields[0]?.code === "REQUIRED"
            ? "NAME_REQUIRED"
            : "INVALID_INPUT";
        return errorResponse(
          new BadRequestError(firstIssue?.message || "Invalid input", topCode, fields),
        );
      }

      if (id && id !== "new") {
        const existing = await getLensGroup(shop.id, id);
        if (!existing || existing.archivedAt) {
          return errorResponse(new NotFoundError("Lens group not found"));
        }
      }

      const { name, description } = parseResult.data;
      if (!id || id === "new") {
        await createLensGroup(shop.id, { name, description });
        return redirect("/app/lenses");
      } else {
        await updateLensGroup(shop.id, id, { name, description });
        return redirect("/app/lenses");
      }
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

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function usePolarisProperty<T extends HTMLElement>(
  propName: "checked" | "value",
  val: boolean | string,
) {
  const ref = useRef<T | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (ref.current) {
      (ref.current as Record<string, unknown>)[propName] = val;
    }
  });

  const refCallback = (el: T | null) => {
    ref.current = el;
    if (el) {
      (el as Record<string, unknown>)[propName] = val;
    }
  };

  return [ref, refCallback] as const;
}

export default function LensGroupEditRoute() {
  const { group, isNew } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const routeActionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    fetcher.state === "submitting" ||
    fetcher.state === "loading" ||
    navigation.state === "submitting" ||
    navigation.state === "loading";

  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const modalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);

  const [, setNameRef] = usePolarisProperty<HTMLElementTagNameMap["s-text-field"]>(
    "value",
    name,
  );
  const [, setDescriptionRef] = usePolarisProperty<
    HTMLElementTagNameMap["s-text-area"]
  >("value", description);

  const hasActiveLenses = Boolean(
    group?.lenses && group.lenses.some((l) => !l.archivedAt),
  );

  const rawActionData = fetcher.data ?? routeActionData;
  const actionError =
    rawActionData && typeof rawActionData === "object" && "error" in rawActionData
      ? (
          rawActionData as {
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
    fetcher.submit({ intent: "archive" }, { method: "post" });
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
        {...(!name.trim() || isSubmitting ? { disabled: true } : {})}
        {...(isSubmitting ? { loading: true } : {})}
      >
        Save
      </s-button>

      {!isNew && (
        <s-button
          slot="secondary-actions"
          tone="critical"
          {...(hasActiveLenses ? { disabled: true } : {})}
          onClick={openArchiveModal}
        >
          Archive
        </s-button>
      )}

      <fetcher.Form method="post" id="lens-group-form">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="description" value={description} />

        <s-stack direction="block" gap="base">
          {actionError && (
            <s-banner tone="critical" heading="Error">
              {actionError.message || actionError.code}
            </s-banner>
          )}

          {hasActiveLenses && (
            <s-banner tone="info" heading="Active lenses">
              Archive all lenses in this group before archiving the group.
            </s-banner>
          )}

          <s-section heading="Lens group details">
            <s-stack direction="block" gap="base">
              <s-text-field
                ref={setNameRef}
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
                ref={setDescriptionRef}
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
      </fetcher.Form>

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
