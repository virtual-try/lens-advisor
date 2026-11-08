import { useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useLoaderData, useNavigation, useRouteError } from "react-router";
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
  createGroupActionSchema,
  deleteAddOnActionSchema,
  deleteGroupActionSchema,
  deleteOptionValueActionSchema,
  reorderAddOnsActionSchema,
  reorderGroupsActionSchema,
  reorderValuesActionSchema,
  retrySyncActionSchema,
  validateInput,
} from "../features/catalog/schema";
import { toShopifyDecimal } from "../../packages/rx-core/src/pricing/index.js";
import { archiveItem, syncItem } from "../features/product-sync";

export interface OptionGroupWithValues extends CatalogOptionGroupDto {
  values: CatalogOptionValueDto[];
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

export function formatMoneyDisplay(
  amountMinor: number,
  currency: string = "USD",
  prefixPlus: boolean = false,
): string {
  if (amountMinor === 0) return "Included";
  const decimal = toShopifyDecimal(amountMinor, currency);
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(decimal as unknown as number);
  return prefixPlus && amountMinor > 0 ? `+${formatted}` : formatted;
}

function getReorderedIds(list: Array<{ id: string }>, index: number, direction: -1 | 1): string[] {
  const ids = list.map((item) => item.id);
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= ids.length) return ids;
  const temp = ids[index];
  ids[index] = ids[targetIndex];
  ids[targetIndex] = temp;
  return ids;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, plan } = await requireActivePlan(request);
  const prisma = getPrisma();
  const shop = await getShopByDomain(session.shop, prisma);
  const catalogService = createCatalogService({ prisma });

  const allGroups = await catalogService.listOptionGroups(shop.id);
  const groupsWithValues: OptionGroupWithValues[] = await Promise.all(
    allGroups.map(async (group) => {
      const values = await catalogService.listOptionValues(shop.id, {
        optionGroupId: group.id,
      });
      return {
        ...group,
        values,
      };
    }),
  );

  const addOns = await catalogService.listAddOns(shop.id);

  return data({
    groups: groupsWithValues,
    addOns,
    plan,
    shopDomain: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session, admin } = await authenticate.admin(request);
    const prisma = getPrisma();
    const shop = await getShopByDomain(session.shop, prisma);
    const catalogService = createCatalogService({ prisma });

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

    const payload = rawData as Record<string, unknown>;
    const intent = typeof payload.intent === "string" ? payload.intent : "";

    if (intent === "create_group") {
      const validated = validateInput(createGroupActionSchema, payload);
      const group = await catalogService.createOptionGroup(shop.id, {
        name: validated.name,
        kind: validated.kind,
      });
      return data({ ok: true, group });
    }

    if (intent === "delete_group") {
      const validated = validateInput(deleteGroupActionSchema, payload);
      await catalogService.archiveOptionGroup(shop.id, validated.groupId);
      return data({ ok: true, archived: true });
    }

    if (intent === "reorder_groups") {
      const validated = validateInput(reorderGroupsActionSchema, payload);
      await catalogService.reorderOptionGroups(shop.id, validated.ids as string[]);
      return data({ ok: true });
    }

    if (intent === "reorder_values") {
      const validated = validateInput(reorderValuesActionSchema, payload);
      await catalogService.reorderOptionValues(shop.id, validated.ids as string[], validated.optionGroupId);
      return data({ ok: true });
    }

    if (intent === "reorder_add_ons") {
      const validated = validateInput(reorderAddOnsActionSchema, payload);
      await catalogService.reorderAddOns(shop.id, validated.ids as string[]);
      return data({ ok: true });
    }

    if (intent === "delete_option_value") {
      const validated = validateInput(deleteOptionValueActionSchema, payload);
      const existing = await catalogService.getOptionValue(shop.id, validated.id);
      if (!existing) return errorResponse(new NotFoundError("Option value not found"));
      if (existing.shopifyVariantId) {
        try {
          const res = await archiveItem(admin, shop.id, "optionValue", validated.id);
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
      await catalogService.archiveOptionValue(shop.id, validated.id);
      return data({ ok: true });
    }

    if (intent === "delete_add_on") {
      const validated = validateInput(deleteAddOnActionSchema, payload);
      const existing = await catalogService.getAddOn(shop.id, validated.id);
      if (!existing) return errorResponse(new NotFoundError("Add-on not found"));
      if (existing.shopifyVariantId) {
        try {
          const res = await archiveItem(admin, shop.id, "addOn", validated.id);
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
      await catalogService.archiveAddOn(shop.id, validated.id);
      return data({ ok: true });
    }

    if (intent === "retry_sync") {
      const validated = validateInput(retrySyncActionSchema, payload);
      if (validated.entity === "optionValue") {
        const optVal = await catalogService.getOptionValue(shop.id, validated.id);
        if (optVal && optVal.priceDelta.amountMinor === 0 && optVal.shopifyVariantId) {
          try {
            const res = await archiveItem(admin, shop.id, "optionValue", validated.id);
            if (!res || !res.ok) {
              throw new Error("Shopify archive failed");
            }
          } catch {
            return errorResponse(
              new BadRequestError("Shopify archive failed on retry", "SYNC_FAILED"),
            );
          }
          await catalogService.updateOptionValue(shop.id, validated.id, { shopifyVariantId: null });
          return data({ ok: true, synced: true });
        }
      }
      await syncItem(admin, shop.id, validated.entity, validated.id);
      return data({ ok: true, synced: true });
    }

    return errorResponse(new BadRequestError(`Unknown intent: ${intent || "none"}`, "INVALID_INPUT"));
  } catch (err) {
    if (err instanceof NotFoundError) {
      return errorResponse(err);
    }
    if (err instanceof CatalogValidationError) {
      return errorResponse(new BadRequestError(err.message, err.code, err.fields));
    }
    if (err instanceof AppError) {
      return errorResponse(err);
    }
    throw err;
  }
};

export default function AdminOptionsRoute() {
  const { groups, addOns } = useLoaderData<typeof loader>();
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupKind, setNewGroupKind] = useState<"MATERIAL" | "TINT_TYPE" | "COLOR">("MATERIAL");

  let isSubmitting = false;
  try {
    const navigation = useNavigation();
    isSubmitting = navigation.state === "submitting" || navigation.state === "loading";
  } catch {
    isSubmitting = false;
  }

  const addModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);
  const deleteModalRef = useRef<HTMLElementTagNameMap["s-modal"] | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{
    type: "group" | "value" | "addOn";
    id: string;
    name: string;
  } | null>(null);

  const showAddModal = (kind: "MATERIAL" | "TINT_TYPE" | "COLOR" = "MATERIAL") => {
    setNewGroupKind(kind);
    setNewGroupName("");
    addModalRef.current?.showOverlay?.();
  };

  const hideAddModal = () => {
    addModalRef.current?.hideOverlay?.();
  };

  const showDeleteModal = (target: {
    type: "group" | "value" | "addOn";
    id: string;
    name: string;
  }) => {
    setDeleteTarget(target);
    deleteModalRef.current?.showOverlay?.();
  };

  const hideDeleteModal = () => {
    deleteModalRef.current?.hideOverlay?.();
  };

  const materialGroups = groups.filter((g) => g.kind === "MATERIAL");
  const tintAndColorGroups = groups.filter(
    (g) => g.kind === "TINT_TYPE" || g.kind === "COLOR",
  );

  return (
    <s-page heading="Options & add-ons">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => showAddModal("MATERIAL")}
      >
        Add option group
      </s-button>

      <s-stack direction="block" gap="base">
        {/* Section 1: Material & index */}
        <s-section heading="Material & index">
          {materialGroups.length === 0 ? (
            <s-box id="empty-materials">
              <s-stack direction="block" gap="base">
                <s-paragraph>
                  No material options yet. Add your first material option.
                </s-paragraph>
                <s-button
                  type="button"
                  onClick={() => showAddModal("MATERIAL")}
                >
                  Add material group
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-stack direction="block" gap="base">
              {materialGroups.map((group, gIndex) => (
                <s-box key={group.id}>
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      <s-heading>{group.name}</s-heading>
                      <form method="post">
                        <input type="hidden" name="intent" value="reorder_groups" />
                        <input
                          type="hidden"
                          name="ids"
                          value={JSON.stringify(getReorderedIds(materialGroups, gIndex, -1))}
                        />
                        <s-button type="submit" disabled={gIndex === 0 || isSubmitting}>
                          Move up
                        </s-button>
                      </form>
                      <form method="post">
                        <input type="hidden" name="intent" value="reorder_groups" />
                        <input
                          type="hidden"
                          name="ids"
                          value={JSON.stringify(getReorderedIds(materialGroups, gIndex, 1))}
                        />
                        <s-button
                          type="submit"
                          disabled={gIndex === materialGroups.length - 1 || isSubmitting}
                        >
                          Move down
                        </s-button>
                      </form>
                      <s-button
                        type="button"
                        tone="critical"
                        onClick={() =>
                          showDeleteModal({
                            type: "group",
                            id: group.id,
                            name: group.name,
                          })
                        }
                      >
                        Delete group
                      </s-button>
                    </s-stack>

                    {group.values.length === 0 ? (
                      <s-paragraph>No option values yet.</s-paragraph>
                    ) : (
                      <s-stack direction="block" gap="base">
                        {group.values.map((val, vIndex) => (
                          <s-stack key={val.id} direction="inline" gap="base">
                            <s-text type="strong">{val.label}</s-text>
                            <s-text>
                              {formatMoneyDisplay(
                                val.priceDelta.amountMinor,
                                val.priceDelta.currency,
                                true,
                              )}
                            </s-text>
                            {val.tokenKey && val.tokenValue && (
                              <s-text>Token: {val.tokenKey}={val.tokenValue}</s-text>
                            )}
                            {val.overrideCode && (
                              <s-text>Override: {val.overrideCode}</s-text>
                            )}
                            {val.priceDelta.amountMinor === 0 ? (
                              val.shopifyVariantId ? (
                                <s-stack direction="inline" gap="base">
                                  <s-badge tone="critical">Sync failed</s-badge>
                                  <form method="post">
                                    <input type="hidden" name="intent" value="retry_sync" />
                                    <input type="hidden" name="entity" value="optionValue" />
                                    <input type="hidden" name="id" value={val.id} />
                                    <s-button type="submit" variant="tertiary" disabled={isSubmitting}>
                                      Retry
                                    </s-button>
                                  </form>
                                </s-stack>
                              ) : (
                                <s-badge tone="info">Included</s-badge>
                              )
                            ) : val.shopifyVariantId ? (
                              <s-badge tone="success">Synced</s-badge>
                            ) : (
                              <s-stack direction="inline" gap="base">
                                <s-badge tone="critical">Sync failed</s-badge>
                                <form method="post">
                                  <input type="hidden" name="intent" value="retry_sync" />
                                  <input type="hidden" name="entity" value="optionValue" />
                                  <input type="hidden" name="id" value={val.id} />
                                  <s-button type="submit" variant="tertiary" disabled={isSubmitting}>
                                    Retry
                                  </s-button>
                                </form>
                              </s-stack>
                            )}
                            <form method="post">
                              <input type="hidden" name="intent" value="reorder_values" />
                              <input type="hidden" name="optionGroupId" value={group.id} />
                              <input
                                type="hidden"
                                name="ids"
                                value={JSON.stringify(getReorderedIds(group.values, vIndex, -1))}
                              />
                              <s-button type="submit" disabled={vIndex === 0 || isSubmitting}>
                                Move up
                              </s-button>
                            </form>
                            <form method="post">
                              <input type="hidden" name="intent" value="reorder_values" />
                              <input type="hidden" name="optionGroupId" value={group.id} />
                              <input
                                type="hidden"
                                name="ids"
                                value={JSON.stringify(getReorderedIds(group.values, vIndex, 1))}
                              />
                              <s-button
                                type="submit"
                                disabled={vIndex === group.values.length - 1 || isSubmitting}
                              >
                                Move down
                              </s-button>
                            </form>
                            <s-link href={`/app/options/${val.id}`}>Edit</s-link>
                            <s-button
                              type="button"
                              tone="critical"
                              onClick={() =>
                                showDeleteModal({
                                  type: "value",
                                  id: val.id,
                                  name: val.label,
                                })
                              }
                            >
                              Delete
                            </s-button>
                          </s-stack>
                        ))}
                      </s-stack>
                    )}
                    <s-link href={`/app/options/new?groupId=${group.id}`}>
                      Add option value
                    </s-link>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>

        {/* Section 2: Tint & colour */}
        <s-section heading="Tint & colour">
          {tintAndColorGroups.length === 0 ? (
            <s-box id="empty-tints">
              <s-stack direction="block" gap="base">
                <s-paragraph>
                  No tint or colour options yet. Add your first tint or colour option.
                </s-paragraph>
                <s-button
                  type="button"
                  onClick={() => showAddModal("TINT_TYPE")}
                >
                  Add tint or colour group
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-stack direction="block" gap="base">
              {tintAndColorGroups.map((group, gIndex) => (
                <s-box key={group.id}>
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="base">
                      <s-heading>
                        {group.name} ({group.kind === "COLOR" ? "Colour" : "Tint type"})
                      </s-heading>
                      <form method="post">
                        <input type="hidden" name="intent" value="reorder_groups" />
                        <input
                          type="hidden"
                          name="ids"
                          value={JSON.stringify(getReorderedIds(tintAndColorGroups, gIndex, -1))}
                        />
                        <s-button type="submit" disabled={gIndex === 0 || isSubmitting}>
                          Move up
                        </s-button>
                      </form>
                      <form method="post">
                        <input type="hidden" name="intent" value="reorder_groups" />
                        <input
                          type="hidden"
                          name="ids"
                          value={JSON.stringify(getReorderedIds(tintAndColorGroups, gIndex, 1))}
                        />
                        <s-button
                          type="submit"
                          disabled={gIndex === tintAndColorGroups.length - 1 || isSubmitting}
                        >
                          Move down
                        </s-button>
                      </form>
                      <s-button
                        type="button"
                        tone="critical"
                        onClick={() =>
                          showDeleteModal({
                            type: "group",
                            id: group.id,
                            name: group.name,
                          })
                        }
                      >
                        Delete group
                      </s-button>
                    </s-stack>

                    {group.values.length === 0 ? (
                      <s-paragraph>No option values yet.</s-paragraph>
                    ) : (
                      <s-stack direction="block" gap="base">
                        {group.values.map((val, vIndex) => (
                          <s-stack key={val.id} direction="inline" gap="base">
                            <s-text type="strong">{val.label}</s-text>
                            <s-text>
                              {formatMoneyDisplay(
                                val.priceDelta.amountMinor,
                                val.priceDelta.currency,
                                true,
                              )}
                            </s-text>
                            {val.tokenKey && val.tokenValue && (
                              <s-text>Token: {val.tokenKey}={val.tokenValue}</s-text>
                            )}
                            {val.overrideCode && (
                              <s-text>Override: {val.overrideCode}</s-text>
                            )}
                            {val.swatch && (
                              <s-text>Swatch: {val.swatch}</s-text>
                            )}
                            {val.priceDelta.amountMinor === 0 ? (
                              val.shopifyVariantId ? (
                                <s-stack direction="inline" gap="base">
                                  <s-badge tone="critical">Sync failed</s-badge>
                                  <form method="post">
                                    <input type="hidden" name="intent" value="retry_sync" />
                                    <input type="hidden" name="entity" value="optionValue" />
                                    <input type="hidden" name="id" value={val.id} />
                                    <s-button type="submit" variant="tertiary" disabled={isSubmitting}>
                                      Retry
                                    </s-button>
                                  </form>
                                </s-stack>
                              ) : (
                                <s-badge tone="info">Included</s-badge>
                              )
                            ) : val.shopifyVariantId ? (
                              <s-badge tone="success">Synced</s-badge>
                            ) : (
                              <s-stack direction="inline" gap="base">
                                <s-badge tone="critical">Sync failed</s-badge>
                                <form method="post">
                                  <input type="hidden" name="intent" value="retry_sync" />
                                  <input type="hidden" name="entity" value="optionValue" />
                                  <input type="hidden" name="id" value={val.id} />
                                  <s-button type="submit" variant="tertiary" disabled={isSubmitting}>
                                    Retry
                                  </s-button>
                                </form>
                              </s-stack>
                            )}
                            <form method="post">
                              <input type="hidden" name="intent" value="reorder_values" />
                              <input type="hidden" name="optionGroupId" value={group.id} />
                              <input
                                type="hidden"
                                name="ids"
                                value={JSON.stringify(getReorderedIds(group.values, vIndex, -1))}
                              />
                              <s-button type="submit" disabled={vIndex === 0 || isSubmitting}>
                                Move up
                              </s-button>
                            </form>
                            <form method="post">
                              <input type="hidden" name="intent" value="reorder_values" />
                              <input type="hidden" name="optionGroupId" value={group.id} />
                              <input
                                type="hidden"
                                name="ids"
                                value={JSON.stringify(getReorderedIds(group.values, vIndex, 1))}
                              />
                              <s-button
                                type="submit"
                                disabled={vIndex === group.values.length - 1 || isSubmitting}
                              >
                                Move down
                              </s-button>
                            </form>
                            <s-link href={`/app/options/${val.id}`}>Edit</s-link>
                            <s-button
                              type="button"
                              tone="critical"
                              onClick={() =>
                                showDeleteModal({
                                  type: "value",
                                  id: val.id,
                                  name: val.label,
                                })
                              }
                            >
                              Delete
                            </s-button>
                          </s-stack>
                        ))}
                      </s-stack>
                    )}
                    <s-link href={`/app/options/new?groupId=${group.id}`}>
                      Add option value
                    </s-link>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>

        {/* Section 3: Add-ons */}
        <s-section heading="Add-ons">
          {addOns.length === 0 ? (
            <s-box id="empty-add-ons">
              <s-stack direction="block" gap="base">
                <s-paragraph>
                  No add-ons yet. Add your first add-on.
                </s-paragraph>
                <s-link href="/app/add-ons/new">Add add-on</s-link>
              </s-stack>
            </s-box>
          ) : (
            <s-stack direction="block" gap="base">
              <s-stack direction="block" gap="base">
                {addOns.map((addOn, aIndex) => (
                  <s-stack key={addOn.id} direction="inline" gap="base">
                    <s-text type="strong">{addOn.name}</s-text>
                    <s-text>
                      {formatMoneyDisplay(
                        addOn.price.amountMinor,
                        addOn.price.currency,
                        false,
                      )}
                    </s-text>
                    {addOn.shopifyVariantId ? (
                      <s-badge tone="success">Synced</s-badge>
                    ) : (
                      <s-stack direction="inline" gap="base">
                        <s-badge tone="critical">Sync failed</s-badge>
                        <form method="post">
                          <input type="hidden" name="intent" value="retry_sync" />
                          <input type="hidden" name="entity" value="addOn" />
                          <input type="hidden" name="id" value={addOn.id} />
                          <s-button type="submit" variant="tertiary" disabled={isSubmitting}>
                            Retry
                          </s-button>
                        </form>
                      </s-stack>
                    )}
                    <form method="post">
                      <input type="hidden" name="intent" value="reorder_add_ons" />
                      <input
                        type="hidden"
                        name="ids"
                        value={JSON.stringify(getReorderedIds(addOns, aIndex, -1))}
                      />
                      <s-button type="submit" disabled={aIndex === 0 || isSubmitting}>
                        Move up
                      </s-button>
                    </form>
                    <form method="post">
                      <input type="hidden" name="intent" value="reorder_add_ons" />
                      <input
                        type="hidden"
                        name="ids"
                        value={JSON.stringify(getReorderedIds(addOns, aIndex, 1))}
                      />
                      <s-button
                        type="submit"
                        disabled={aIndex === addOns.length - 1 || isSubmitting}
                      >
                        Move down
                      </s-button>
                    </form>
                    <s-link href={`/app/add-ons/${addOn.id}`}>Edit</s-link>
                    <s-button
                      type="button"
                      tone="critical"
                      onClick={() =>
                        showDeleteModal({
                          type: "addOn",
                          id: addOn.id,
                          name: addOn.name,
                        })
                      }
                    >
                      Delete
                    </s-button>
                  </s-stack>
                ))}
              </s-stack>
              <s-link href="/app/add-ons/new">Add add-on</s-link>
            </s-stack>
          )}
        </s-section>
      </s-stack>

      {/* Modal for creating a new option group */}
      <s-modal id="add-option-group-modal" ref={addModalRef} heading="Add option group">
        <form method="post" onSubmit={hideAddModal}>
          <input type="hidden" name="intent" value="create_group" />
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Group name"
              name="name"
              value={newGroupName}
              onInput={(e) => setNewGroupName(e.currentTarget.value)}
              required
            />
            <s-select
              label="Kind"
              name="kind"
              value={newGroupKind}
              onChange={(e) =>
                setNewGroupKind(
                  (e.currentTarget as unknown as HTMLSelectElement).value as
                    | "MATERIAL"
                    | "TINT_TYPE"
                    | "COLOR",
                )
              }
            >
              <s-option value="MATERIAL">Material / Index</s-option>
              <s-option value="TINT_TYPE">Tint type</s-option>
              <s-option value="COLOR">Colour</s-option>
            </s-select>
            <s-stack direction="inline" gap="base">
              <s-button
                type="submit"
                variant="primary"
                loading={isSubmitting}
                disabled={isSubmitting}
              >
                Create group
              </s-button>
              <s-button type="button" onClick={hideAddModal} disabled={isSubmitting}>
                Cancel
              </s-button>
            </s-stack>
          </s-stack>
        </form>
      </s-modal>

      {/* Modal for confirming deletion */}
      <s-modal id="delete-confirm-modal" ref={deleteModalRef} heading="Confirm delete">
        <s-paragraph>
          Are you sure you want to delete {deleteTarget?.name}?
        </s-paragraph>
        <form method="post" onSubmit={hideDeleteModal}>
          <input
            type="hidden"
            name="intent"
            value={
              deleteTarget?.type === "group"
                ? "delete_group"
                : deleteTarget?.type === "addOn"
                  ? "delete_add_on"
                  : "delete_option_value"
            }
          />
          {deleteTarget?.type === "group" ? (
            <input type="hidden" name="groupId" value={deleteTarget?.id ?? ""} />
          ) : (
            <input type="hidden" name="id" value={deleteTarget?.id ?? ""} />
          )}
          <s-stack direction="inline" gap="base">
            <s-button
              type="submit"
              variant="primary"
              tone="critical"
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              Confirm delete
            </s-button>
            <s-button type="button" onClick={hideDeleteModal} disabled={isSubmitting}>
              Cancel
            </s-button>
          </s-stack>
        </form>
      </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};