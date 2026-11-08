import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  data,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { z } from "zod";

import { formatDiopter } from "../../packages/rx-core/src/format/index.js";
import { toShopifyDecimal } from "../../packages/rx-core/src/pricing/index.js";
import type { RxLimits } from "../../packages/rx-core/src/index.js";

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
  archiveLensGroup,
  listLensGroups,
  reorderLenses,
  reorderLensGroups,
  type CatalogLensDto,
  type CatalogLensGroupDto,
} from "../features/catalog/catalog.service.server";
import { archiveItem, syncItem } from "../features/product-sync/product-sync.server";
import { mapZodIssueToCode } from "../features/catalog/schema";

const retrySyncSchema = z.object({
  intent: z.literal("retry-sync"),
  lensId: z
    .string({
      required_error: "Lens ID is required",
      invalid_type_error: "Lens ID must be a string",
    })
    .trim()
    .min(1, "REQUIRED"),
});

const archiveLensSchema = z.object({
  intent: z.literal("archive-lens"),
  lensId: z
    .string({
      required_error: "Lens ID is required",
      invalid_type_error: "Lens ID must be a string",
    })
    .trim()
    .min(1, "REQUIRED"),
});

const archiveGroupSchema = z.object({
  intent: z.literal("archive-group"),
  groupId: z
    .string({
      required_error: "Group ID is required",
      invalid_type_error: "Group ID must be a string",
    })
    .trim()
    .min(1, "REQUIRED"),
});

const reorderLensesSchema = z.object({
  intent: z.literal("reorder-lenses"),
  groupId: z
    .string({
      required_error: "Group ID is required",
      invalid_type_error: "Group ID must be a string",
    })
    .trim()
    .min(1, "REQUIRED"),
  ids: z.union([
    z.array(
      z.string({ invalid_type_error: "ID must be a string" }).min(1, "REQUIRED"),
      { invalid_type_error: "IDs must be a string or array" },
    ),
    z.string({ invalid_type_error: "IDs must be a string or array" }),
  ]),
});

const reorderGroupsSchema = z.object({
  intent: z.literal("reorder-groups"),
  ids: z.union([
    z.array(
      z.string({ invalid_type_error: "ID must be a string" }).min(1, "REQUIRED"),
      { invalid_type_error: "IDs must be a string or array" },
    ),
    z.string({ invalid_type_error: "IDs must be a string or array" }),
  ]),
});

export function formatLimitsSummary(
  limits: Pick<RxLimits, "sphMin" | "sphMax"> & Partial<RxLimits>,
): string {
  const formatDiopterDisplay = (val: number) => {
    return formatDiopter(val).replace("-", "−");
  };

  const parts: string[] = [];
  parts.push(
    `SPH ${formatDiopterDisplay(limits.sphMin)} to ${formatDiopter(limits.sphMax)}`,
  );
  if (limits.cylMin !== undefined && limits.cylMax !== undefined) {
    parts.push(
      `CYL ${formatDiopterDisplay(limits.cylMin)} to ${formatDiopter(limits.cylMax)}`,
    );
  }
  if (
    limits.addMin !== undefined &&
    limits.addMin !== null &&
    limits.addMax !== undefined &&
    limits.addMax !== null
  ) {
    parts.push(
      `ADD ${formatDiopterDisplay(limits.addMin)} to ${formatDiopter(limits.addMax)}`,
    );
  }
  return parts.join(" · ");
}

export function formatPriceDisplay(amountMinor: number, currency = "USD"): string {
  return `${currency} ${toShopifyDecimal(amountMinor, currency)}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
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
  const url = new URL(request.url);
  const syncFailed = url.searchParams.get("syncFailed");

  return data({
    groups,
    syncFailedId: syncFailed,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const prisma = getPrisma();

  // INV-1: Scoped strictly to authenticated session shop
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
        new BadRequestError("Invalid JSON payload", "INVALID_INPUT", [
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

  const intent = typeof rawData.intent === "string" ? rawData.intent : "";
  if (!intent) {
    return errorResponse(
      new BadRequestError("Intent is required", "INVALID_INTENT", [
        { path: "intent", code: "REQUIRED" },
      ]),
    );
  }

  try {
    if (intent === "retry-sync") {
      const parseResult = retrySyncSchema.safeParse(rawData);
      if (!parseResult.success) {
        const fields = parseResult.error.issues.map((issue) => ({
          path: issue.path.join(".") || "lensId",
          code: mapZodIssueToCode(issue),
        }));
        return errorResponse(
          new BadRequestError("Invalid retry-sync payload", "INVALID_INPUT", fields),
        );
      }

      const { lensId } = parseResult.data;
      const existing = await prisma.lens.findUnique({
        where: { shopId_id: { shopId: shop.id, id: lensId } },
      });
      if (!existing || existing.archivedAt) {
        return errorResponse(new NotFoundError("Lens not found"));
      }

      try {
        await syncItem(admin, shop.id, "lens", lensId);
        return data({ ok: true, retriedLensId: lensId, synced: true });
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw err;
        }
        return data({
          ok: false,
          retriedLensId: lensId,
          syncFailed: true,
          error: err instanceof Error ? err.message : "Sync failed",
        });
      }
    }

    if (intent === "archive-lens") {
      const parseResult = archiveLensSchema.safeParse(rawData);
      if (!parseResult.success) {
        const fields = parseResult.error.issues.map((issue) => ({
          path: issue.path.join(".") || "lensId",
          code: mapZodIssueToCode(issue),
        }));
        return errorResponse(
          new BadRequestError("Invalid archive-lens payload", "INVALID_INPUT", fields),
        );
      }

      const { lensId } = parseResult.data;
      const existing = await prisma.lens.findUnique({
        where: { shopId_id: { shopId: shop.id, id: lensId } },
      });
      if (!existing || existing.archivedAt) {
        return errorResponse(new NotFoundError("Lens not found"));
      }

      await archiveItem(admin, shop.id, "lens", lensId);
      await archiveLens(shop.id, lensId);
      return data({ ok: true, archivedLensId: lensId });
    }

    if (intent === "archive-group") {
      const parseResult = archiveGroupSchema.safeParse(rawData);
      if (!parseResult.success) {
        const fields = parseResult.error.issues.map((issue) => ({
          path: issue.path.join(".") || "groupId",
          code: mapZodIssueToCode(issue),
        }));
        return errorResponse(
          new BadRequestError("Invalid archive-group payload", "INVALID_INPUT", fields),
        );
      }

      const { groupId } = parseResult.data;
      const existing = await prisma.lensGroup.findUnique({
        where: { shopId_id: { shopId: shop.id, id: groupId } },
      });
      if (!existing || existing.archivedAt) {
        return errorResponse(new NotFoundError("Lens group not found"));
      }

      await archiveLensGroup(shop.id, groupId);
      return data({ ok: true, archivedGroupId: groupId });
    }

    if (intent === "reorder-lenses") {
      const parseResult = reorderLensesSchema.safeParse(rawData);
      if (!parseResult.success) {
        const fields = parseResult.error.issues.map((issue) => ({
          path: issue.path.join(".") || "ids",
          code: mapZodIssueToCode(issue),
        }));
        return errorResponse(
          new BadRequestError("Invalid reorder-lenses payload", "INVALID_INPUT", fields),
        );
      }

      const { groupId, ids: idsRaw } = parseResult.data;
      const targetGroup = await prisma.lensGroup.findUnique({
        where: { shopId_id: { shopId: shop.id, id: groupId } },
      });
      if (!targetGroup || targetGroup.archivedAt) {
        return errorResponse(new NotFoundError("Lens group not found"));
      }

      let ids: string[] = [];
      if (Array.isArray(idsRaw)) {
        ids = idsRaw.map(String);
      } else if (typeof idsRaw === "string") {
        ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      }

      // Query active lenses in the group for this shop
      const existingLenses = await prisma.lens.findMany({
        where: { shopId: shop.id, groupId, archivedAt: null },
        select: { id: true },
      });
      const existingIds = new Set(existingLenses.map((l) => l.id));

      const hasDuplicates = new Set(ids).size !== ids.length;
      const exactCountMatch = ids.length === existingLenses.length;
      const allBelongToGroup = ids.every((id) => existingIds.has(id));

      if (hasDuplicates || !exactCountMatch || !allBelongToGroup) {
        return errorResponse(
          new BadRequestError(
            "Reorder batch must contain exactly the shop's active lenses in the group without duplicates or foreign IDs",
            "INVALID_REORDER_BATCH",
            [{ path: "ids", code: "INVALID_BATCH" }],
          ),
        );
      }

      await reorderLenses(shop.id, ids, groupId);
      return data({ ok: true });
    }

    if (intent === "reorder-groups") {
      const parseResult = reorderGroupsSchema.safeParse(rawData);
      if (!parseResult.success) {
        const fields = parseResult.error.issues.map((issue) => ({
          path: issue.path.join(".") || "ids",
          code: mapZodIssueToCode(issue),
        }));
        return errorResponse(
          new BadRequestError("Invalid reorder-groups payload", "INVALID_INPUT", fields),
        );
      }

      const idsRaw = parseResult.data.ids;
      let ids: string[] = [];
      if (Array.isArray(idsRaw)) {
        ids = idsRaw.map(String);
      } else if (typeof idsRaw === "string") {
        ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      }

      // Query active lens groups for this shop
      const existingGroups = await prisma.lensGroup.findMany({
        where: { shopId: shop.id, archivedAt: null },
        select: { id: true },
      });
      const existingIds = new Set(existingGroups.map((g) => g.id));

      const hasDuplicates = new Set(ids).size !== ids.length;
      const exactCountMatch = ids.length === existingGroups.length;
      const allBelongToShop = ids.every((id) => existingIds.has(id));

      if (hasDuplicates || !exactCountMatch || !allBelongToShop) {
        return errorResponse(
          new BadRequestError(
            "Reorder batch must contain exactly the shop's active lens groups without duplicates or foreign IDs",
            "INVALID_REORDER_BATCH",
            [{ path: "ids", code: "INVALID_BATCH" }],
          ),
        );
      }

      await reorderLensGroups(shop.id, ids);
      return data({ ok: true });
    }

    return errorResponse(
      new BadRequestError(`Unknown intent: ${intent}`, "INVALID_INTENT", [
        { path: "intent", code: "INVALID_INTENT" },
      ]),
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return errorResponse(error);
    }
    if (error instanceof AppError) {
      return errorResponse(error);
    }
    return errorResponse(error);
  }
};

export function LensesList({
  groups: initialGroups,
  syncFailedId: initialSyncFailedId,
  isLoading = false,
}: {
  groups: CatalogLensGroupDto[];
  syncFailedId?: string | null;
  isLoading?: boolean;
}) {
  const fetcher = useFetcher<typeof action>();
  const [syncFailedIds, setSyncFailedIds] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (initialSyncFailedId) s.add(initialSyncFailedId);
    return s;
  });

  useEffect(() => {
    setSyncFailedIds((prev) => {
      const next = new Set(prev);
      if (initialSyncFailedId) {
        next.add(initialSyncFailedId);
      } else if (initialSyncFailedId === null) {
        next.clear();
      }
      return next;
    });
  }, [initialSyncFailedId]);

  const [archiveTarget, setArchiveTarget] = useState<{
    type: "lens" | "group";
    id: string;
    name: string;
  } | null>(null);

  const archiveModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);

  const openArchiveModal = (type: "lens" | "group", id: string, name: string) => {
    setArchiveTarget({ type, id, name });
    archiveModalRef.current?.showOverlay?.();
  };

  const handleModalHide = useCallback(() => {
    archiveModalRef.current?.hideOverlay?.();
    setArchiveTarget(null);
  }, []);

  const handleConfirmArchive = () => {
    if (!archiveTarget) return;
    if (archiveTarget.type === "lens") {
      fetcher.submit(
        { intent: "archive-lens", lensId: archiveTarget.id },
        { method: "POST" },
      );
    } else {
      fetcher.submit(
        { intent: "archive-group", groupId: archiveTarget.id },
        { method: "POST" },
      );
    }
    handleModalHide();
  };

  const handleRetrySync = (lensId: string) => {
    fetcher.submit({ intent: "retry-sync", lensId }, { method: "POST" });
  };

  const handleMoveGroup = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= groups.length) return;
    const reordered = [...groups];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const ids = reordered.map((g) => g.id);
    fetcher.submit(
      { intent: "reorder-groups", ids: ids.join(",") },
      { method: "POST" },
    );
  };

  const handleMoveLens = (
    group: CatalogLensGroupDto,
    index: number,
    direction: -1 | 1,
  ) => {
    const lenses = group.lenses ?? [];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= lenses.length) return;
    const reordered = [...lenses];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const ids = reordered.map((l) => l.id);
    fetcher.submit(
      { intent: "reorder-lenses", groupId: group.id, ids: ids.join(",") },
      { method: "POST" },
    );
  };

  // Process fetcher data updates
  useEffect(() => {
    if (fetcher.data) {
      const d = fetcher.data as {
        retriedLensId?: string;
        synced?: boolean;
        syncFailed?: boolean;
      };
      if (d.retriedLensId) {
        if (d.synced) {
          setSyncFailedIds((prev) => {
            const next = new Set(prev);
            next.delete(d.retriedLensId!);
            return next;
          });
        } else if (d.syncFailed) {
          setSyncFailedIds((prev) => {
            const next = new Set(prev);
            next.add(d.retriedLensId!);
            return next;
          });
        }
      }
    }
  }, [fetcher.data]);

  // Filter out archived items if archived in fetcher
  const archivedLensId = (fetcher.data as { archivedLensId?: string } | undefined)
    ?.archivedLensId;
  const archivedGroupId = (
    fetcher.data as { archivedGroupId?: string } | undefined
  )?.archivedGroupId;

  const groups = initialGroups
    .filter((g) => g.id !== archivedGroupId)
    .map((g) => ({
      ...g,
      lenses: (g.lenses ?? []).filter((l) => l.id !== archivedLensId),
    }));

  if (isLoading) {
    return (
      <s-page heading="Lenses">
        <s-stack direction="block" gap="base">
          <s-spinner accessibilityLabel="Loading lenses..." />
        </s-stack>
      </s-page>
    );
  }

  return (
    <s-page heading="Lenses">
      <s-button slot="primary-action" variant="primary" href="/app/lenses/new">
        Add lens
      </s-button>
      <s-button slot="secondary-actions" href="/app/lens-groups/new">
        Add lens group
      </s-button>

      {groups.length === 0 ? (
        <s-empty-state heading="No lens groups yet">
          <s-paragraph>
            Create a lens group to start organizing and adding lenses to your
            storefront catalog.
          </s-paragraph>
          <s-button slot="primary-action" href="/app/lens-groups/new">
            Add lens group
          </s-button>
        </s-empty-state>
      ) : (
        <s-stack direction="block" gap="base">
          {groups.map((group, groupIdx) => (
            <s-section key={group.id} heading={group.name}>
              <s-stack direction="block" gap="base">
                {group.description && (
                  <s-paragraph>{group.description}</s-paragraph>
                )}

                <s-stack direction="inline" gap="base">
                  <s-link href={`/app/lens-groups/${group.id}`}>
                    Edit group
                  </s-link>
                  <s-link href={`/app/lenses/new?groupId=${group.id}`}>
                    Add lens to group
                  </s-link>
                  <s-button
                    disabled={groupIdx === 0}
                    onClick={() => handleMoveGroup(groupIdx, -1)}
                  >
                    Move group up
                  </s-button>
                  <s-button
                    disabled={groupIdx === groups.length - 1}
                    onClick={() => handleMoveGroup(groupIdx, 1)}
                  >
                    Move group down
                  </s-button>
                  <s-button
                    tone="critical"
                    onClick={() =>
                      openArchiveModal("group", group.id, group.name)
                    }
                  >
                    Archive group
                  </s-button>
                </s-stack>

                {group.lenses.length === 0 ? (
                  <s-paragraph>No lenses in this group.</s-paragraph>
                ) : (
                  <s-stack direction="block" gap="base">
                    {group.lenses.map((lens: CatalogLensDto, lensIdx: number) => {
                      const isFailed = syncFailedIds.has(lens.id);
                      const isSynced = Boolean(lens.shopifyVariantId);
                      const isRetrying =
                        fetcher.state === "submitting" &&
                        fetcher.formData?.get("lensId") === lens.id;

                      const limitsSummary = formatLimitsSummary(lens.limits);
                      const formattedPrice = formatPriceDisplay(
                        lens.price.amountMinor,
                        lens.price.currency,
                      );

                      return (
                        <s-box
                          key={lens.id}
                          padding="base"
                          border="base"
                        >
                          <s-stack direction="block" gap="base">
                            <s-stack direction="inline" gap="base">
                              <s-link href={`/app/lenses/${lens.id}`}>
                                <s-text type="strong">{lens.name}</s-text>
                              </s-link>

                              {isFailed ? (
                                <s-badge tone="critical">Sync failed</s-badge>
                              ) : isSynced ? (
                                <s-badge tone="success">Synced</s-badge>
                              ) : (
                                <s-badge tone="info">Not synced</s-badge>
                              )}

                              {(isFailed || !isSynced) && (
                                <s-button
                                  {...({ role: "button" } as Record<string, unknown>)}
                                  onClick={() => handleRetrySync(lens.id)}
                                  {...(isRetrying ? { loading: true } : {})}
                                >
                                  Retry
                                </s-button>
                              )}
                            </s-stack>

                            {lens.description && (
                              <s-paragraph>{lens.description}</s-paragraph>
                            )}

                            <s-stack direction="inline" gap="base">
                              <s-text>Price: {formattedPrice}</s-text>
                              <s-text>
                                Rx types: {lens.limits.rxTypes.join(", ")}
                              </s-text>
                              <s-text>{limitsSummary}</s-text>
                            </s-stack>

                            <s-stack direction="inline" gap="base">
                              <s-link href={`/app/lenses/${lens.id}`}>
                                Edit lens
                              </s-link>
                              <s-button
                                disabled={lensIdx === 0}
                                onClick={() =>
                                  handleMoveLens(group, lensIdx, -1)
                                }
                              >
                                Move lens up
                              </s-button>
                              <s-button
                                disabled={lensIdx === group.lenses.length - 1}
                                onClick={() =>
                                  handleMoveLens(group, lensIdx, 1)
                                }
                              >
                                Move lens down
                              </s-button>
                              <s-button
                                {...({ role: "button" } as Record<string, unknown>)}
                                tone="critical"
                                onClick={() =>
                                  openArchiveModal("lens", lens.id, lens.name)
                                }
                              >
                                Archive lens
                              </s-button>
                            </s-stack>
                          </s-stack>
                        </s-box>
                      );
                    })}
                  </s-stack>
                )}
              </s-stack>
            </s-section>
          ))}
        </s-stack>
      )}

      <s-modal
        id="archive-confirm-modal"
        ref={archiveModalRef}
        heading={`Archive ${archiveTarget?.type === "lens" ? "lens" : "lens group"}`}
        onHide={handleModalHide}
      >
        <s-paragraph>
          Are you sure you want to archive {archiveTarget?.name}?
          {archiveTarget?.type === "lens"
            ? " It will be removed from your active catalog and its Shopify product will be drafted."
            : " It will be removed from your active groups list."}
        </s-paragraph>
        <s-button
          {...({ role: "button" } as Record<string, unknown>)}
          slot="primary-action"
          tone="critical"
          onClick={handleConfirmArchive}
        >
          Confirm archive
        </s-button>
        <s-button
          {...({ role: "button" } as Record<string, unknown>)}
          slot="secondary-actions"
          variant="secondary"
          onClick={handleModalHide}
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export default function LensesIndexRoute() {
  const { groups, syncFailedId } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();

  const isLoading = navigation.state === "loading";

  return (
    <>
      {actionData &&
        typeof actionData === "object" &&
        "error" in actionData && (
          <s-banner tone="critical" heading="Action error">
            {(actionData as { error?: { message?: string } }).error?.message}
          </s-banner>
        )}
      <LensesList
        groups={groups}
        syncFailedId={syncFailedId}
        isLoading={isLoading}
      />
    </>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "data" in error
        ? String((error as { data?: unknown }).data)
        : "Failed to load lenses from server";

  return (
    <s-page heading="Lenses">
      <s-banner tone="critical" heading="Failed to load lenses">
        {errorMessage}
      </s-banner>
      <s-stack direction="block" gap="base">
        <s-paragraph>
          There was a problem loading your lenses. Please try again.
        </s-paragraph>
        <s-button href="/app/lenses">Retry</s-button>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
