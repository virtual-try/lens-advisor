import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useActionData, useLoaderData } from "react-router";
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
  const decimals = currency === "JPY" ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
  }).format(amountMinor / 100);
  return prefixPlus && amountMinor > 0 ? `+${formatted}` : formatted;
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

    const intent = typeof rawData.intent === "string" ? rawData.intent : "";

    if (intent === "create_group") {
      const name = typeof rawData.name === "string" ? rawData.name.trim() : "";
      const kind = typeof rawData.kind === "string" ? rawData.kind.trim() : "MATERIAL";
      if (!name) {
        return errorResponse(
          new BadRequestError("Group name is required", "REQUIRED", [
            { path: "name", code: "REQUIRED" },
          ]),
        );
      }
      if (kind !== "MATERIAL" && kind !== "TINT_TYPE" && kind !== "COLOR") {
        return errorResponse(
          new BadRequestError("Invalid option group kind", "INVALID_INPUT", [
            { path: "kind", code: "INVALID_INPUT" },
          ]),
        );
      }
      const group = await catalogService.createOptionGroup(shop.id, {
        name,
        kind: kind as "MATERIAL" | "TINT_TYPE" | "COLOR",
      });
      return data({ ok: true, group });
    }

    if (intent === "delete_group") {
      const groupId = typeof rawData.groupId === "string" ? rawData.groupId.trim() : "";
      if (!groupId) {
        return errorResponse(new BadRequestError("Group ID is required", "REQUIRED"));
      }
      await catalogService.archiveOptionGroup(shop.id, groupId);
      return data({ ok: true, archived: true });
    }

    if (intent === "reorder_groups") {
      const ids = Array.isArray(rawData.ids)
        ? (rawData.ids as string[])
        : typeof rawData.ids === "string"
          ? JSON.parse(rawData.ids)
          : [];
      await catalogService.reorderOptionGroups(shop.id, ids);
      return data({ ok: true });
    }

    if (intent === "reorder_values") {
      const ids = Array.isArray(rawData.ids)
        ? (rawData.ids as string[])
        : typeof rawData.ids === "string"
          ? JSON.parse(rawData.ids)
          : [];
      const optionGroupId =
        typeof rawData.optionGroupId === "string" ? rawData.optionGroupId.trim() : undefined;
      await catalogService.reorderOptionValues(shop.id, ids, optionGroupId);
      return data({ ok: true });
    }

    if (intent === "reorder_add_ons") {
      const ids = Array.isArray(rawData.ids)
        ? (rawData.ids as string[])
        : typeof rawData.ids === "string"
          ? JSON.parse(rawData.ids)
          : [];
      await catalogService.reorderAddOns(shop.id, ids);
      return data({ ok: true });
    }

    if (intent === "delete_option_value") {
      const id = typeof rawData.id === "string" ? rawData.id.trim() : "";
      if (!id) return errorResponse(new BadRequestError("ID is required", "REQUIRED"));
      const existing = await catalogService.getOptionValue(shop.id, id);
      if (!existing) return errorResponse(new NotFoundError("Option value not found"));
      if (existing.shopifyVariantId) {
        try {
          await archiveItem(admin, shop.id, "optionValue", id);
        } catch {
          // ignore shopify archive error
        }
      }
      await catalogService.archiveOptionValue(shop.id, id);
      return data({ ok: true });
    }

    if (intent === "delete_add_on") {
      const id = typeof rawData.id === "string" ? rawData.id.trim() : "";
      if (!id) return errorResponse(new BadRequestError("ID is required", "REQUIRED"));
      const existing = await catalogService.getAddOn(shop.id, id);
      if (!existing) return errorResponse(new NotFoundError("Add-on not found"));
      if (existing.shopifyVariantId) {
        try {
          await archiveItem(admin, shop.id, "addOn", id);
        } catch {
          // ignore shopify archive error
        }
      }
      await catalogService.archiveAddOn(shop.id, id);
      return data({ ok: true });
    }

    if (intent === "retry_sync") {
      const entity = rawData.entity as "optionValue" | "addOn";
      const id = typeof rawData.id === "string" ? rawData.id.trim() : "";
      if (!id || (entity !== "optionValue" && entity !== "addOn")) {
        return errorResponse(new BadRequestError("Invalid sync retry request", "INVALID_INPUT"));
      }
      await syncItem(admin, shop.id, entity, id);
      return data({ ok: true, synced: true });
    }

    return errorResponse(new BadRequestError(`Unknown intent: ${intent}`, "INVALID_INPUT"));
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
  const [modalOpen, setModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupKind, setNewGroupKind] = useState<"MATERIAL" | "TINT_TYPE" | "COLOR">("MATERIAL");

  const materialGroups = groups.filter((g) => g.kind === "MATERIAL");
  const tintAndColorGroups = groups.filter(
    (g) => g.kind === "TINT_TYPE" || g.kind === "COLOR",
  );

  return (
    <s-page heading="Options & add-ons">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => setModalOpen(true)}
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
                  onClick={() => {
                    setNewGroupKind("MATERIAL");
                    setModalOpen(true);
                  }}
                >
                  Add material group
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-stack direction="block" gap="base">
              {materialGroups.map((group) => (
                <s-box key={group.id}>
                  <s-stack direction="block" gap="base">
                    <s-heading>{group.name}</s-heading>
                    {group.values.length === 0 ? (
                      <s-paragraph>No option values yet.</s-paragraph>
                    ) : (
                      <s-stack direction="block" gap="base">
                        {group.values.map((val) => (
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
                              <s-badge tone="info">Included</s-badge>
                            ) : val.shopifyVariantId ? (
                              <s-badge tone="success">Synced</s-badge>
                            ) : (
                              <s-badge tone="warning">Not synced</s-badge>
                            )}
                            <s-link href={`/app/options/${val.id}`}>Edit</s-link>
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
                  onClick={() => {
                    setNewGroupKind("TINT_TYPE");
                    setModalOpen(true);
                  }}
                >
                  Add tint or colour group
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <s-stack direction="block" gap="base">
              {tintAndColorGroups.map((group) => (
                <s-box key={group.id}>
                  <s-stack direction="block" gap="base">
                    <s-heading>
                      {group.name} ({group.kind === "COLOR" ? "Colour" : "Tint type"})
                    </s-heading>
                    {group.values.length === 0 ? (
                      <s-paragraph>No option values yet.</s-paragraph>
                    ) : (
                      <s-stack direction="block" gap="base">
                        {group.values.map((val) => (
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
                              <s-badge tone="info">Included</s-badge>
                            ) : val.shopifyVariantId ? (
                              <s-badge tone="success">Synced</s-badge>
                            ) : (
                              <s-badge tone="warning">Not synced</s-badge>
                            )}
                            <s-link href={`/app/options/${val.id}`}>Edit</s-link>
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
                {addOns.map((addOn) => (
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
                      <s-badge tone="warning">Not synced</s-badge>
                    )}
                    <s-link href={`/app/add-ons/${addOn.id}`}>Edit</s-link>
                  </s-stack>
                ))}
              </s-stack>
              <s-link href="/app/add-ons/new">Add add-on</s-link>
            </s-stack>
          )}
        </s-section>
      </s-stack>

      {/* Modal for creating a new option group */}
      {modalOpen && (
        <s-modal heading="Add option group">
          <form method="post">
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
                <s-button type="submit" variant="primary">
                  Create group
                </s-button>
                <s-button type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </s-button>
              </s-stack>
            </s-stack>
          </form>
        </s-modal>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useActionData());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
