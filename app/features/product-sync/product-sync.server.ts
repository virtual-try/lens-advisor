import { toShopifyDecimal } from "../../../packages/rx-core/src/pricing/index.js";
import { BadRequestError } from "../../shared/http/errors.server";
import { createCatalogService } from "../catalog/catalog.service.server";
import { SyncError } from "./errors";
import {
  GET_PUBLICATIONS_QUERY,
  GET_VARIANT_PRODUCT_QUERY,
  PRODUCT_CREATE_MUTATION,
  PRODUCT_DELETE_MUTATION,
  PRODUCT_UPDATE_MUTATION,
  PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
  PUBLISHABLE_PUBLISH_MUTATION,
  SHOP_CURRENCY_QUERY,
} from "./graphql";
import type {
  ArchiveItemResult,
  ProductSyncAdminClient,
  ProductSyncDeps,
  SyncEntity,
  SyncItemResult,
} from "./types";

export const LENS_ADVISOR_VENDOR = "Lens Advisor";
export const LENS_ADVISOR_TAG = "lens-advisor-item";

export interface LensAdvisorProductInput {
  title: string;
  vendor: string;
  tags: string[];
  status: "ACTIVE";
  metafields: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
  }>;
}

export function buildProductInput(title: string): LensAdvisorProductInput {
  return {
    title,
    vendor: LENS_ADVISOR_VENDOR,
    tags: [LENS_ADVISOR_TAG],
    status: "ACTIVE",
    metafields: [
      {
        namespace: "seo",
        key: "hidden",
        value: "1",
        type: "number_integer",
      },
    ],
  };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function executeGraphQL<T>(
  admin: ProductSyncAdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  let json: GraphQLResponse<T>;
  if (typeof (response as { json?: () => Promise<GraphQLResponse<T>> }).json === "function") {
    json = await (response as { json: () => Promise<GraphQLResponse<T>> }).json();
  } else {
    json = response as GraphQLResponse<T>;
  }

  if (json.errors && json.errors.length > 0) {
    throw new SyncError(json.errors[0]?.message ?? "GraphQL error");
  }
  if (!json.data) {
    throw new SyncError("No data returned from Shopify GraphQL");
  }
  return json.data;
}

function checkUserErrors(userErrors?: Array<{ field?: string[]; message: string }>): void {
  if (userErrors && userErrors.length > 0) {
    throw new SyncError(userErrors[0].message, "SYNC_FAILED");
  }
}

interface PublicationsData {
  publications?: {
    nodes?: Array<{ id: string; name: string }>;
    pageInfo?: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
  };
}

async function findOnlineStorePublicationId(
  admin: ProductSyncAdminClient,
): Promise<string> {
  let cursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;
  const maxPages = 50;

  while (hasNextPage && pageCount < maxPages) {
    pageCount++;
    const publicationsData: PublicationsData = await executeGraphQL<PublicationsData>(
      admin,
      GET_PUBLICATIONS_QUERY,
      cursor ? { after: cursor } : undefined,
    );

    const nodes = publicationsData.publications?.nodes ?? [];
    const onlineStore = nodes.find(
      (node) => node.name.trim().toLowerCase() === "online store",
    );
    if (onlineStore) {
      return onlineStore.id;
    }

    hasNextPage = publicationsData.publications?.pageInfo?.hasNextPage === true;
    cursor = publicationsData.publications?.pageInfo?.endCursor ?? null;
    if (hasNextPage && !cursor) {
      break;
    }
  }

  throw new SyncError("Online Store publication not found", "SYNC_FAILED");
}

export async function syncItem(
  admin: ProductSyncAdminClient,
  shopId: string,
  entity: SyncEntity,
  id: string,
  deps?: ProductSyncDeps,
): Promise<SyncItemResult> {
  if (entity !== "lens" && entity !== "optionValue" && entity !== "addOn") {
    throw new BadRequestError(`Unknown entity type: ${String(entity)}`);
  }

  const service = deps?.catalogService ?? createCatalogService();

  let itemTitle = "";
  let itemPriceMinor = 0;
  let itemCurrency = "";
  let storedVariantId: string | null = null;
  let storedProductId: string | null = null;

  if (entity === "lens") {
    const lens = await service.getLens(shopId, id);
    itemTitle = `Lens: ${lens.name}`;
    itemPriceMinor = lens.price.amountMinor;
    itemCurrency = lens.price.currency;
    storedVariantId = lens.shopifyVariantId;
    storedProductId = lens.shopifyProductId;
  } else if (entity === "optionValue") {
    const optVal = await service.getOptionValue(shopId, id);
    itemTitle = `Option: ${optVal.label}`;
    itemPriceMinor = optVal.priceDelta.amountMinor;
    itemCurrency = optVal.priceDelta.currency;
    storedVariantId = optVal.shopifyVariantId ?? null;
    storedProductId = null;

    if (itemPriceMinor === 0) {
      return { ok: true, skipped: true };
    }
  } else if (entity === "addOn") {
    const addOn = await service.getAddOn(shopId, id);
    itemTitle = `Add-on: ${addOn.name}`;
    itemPriceMinor = addOn.price.amountMinor;
    itemCurrency = addOn.price.currency;
    storedVariantId = addOn.shopifyVariantId;
    storedProductId = addOn.shopifyProductId;
  }

  // 1. Check shop currency
  const currencyData = await executeGraphQL<{ shop: { currencyCode: string } }>(
    admin,
    SHOP_CURRENCY_QUERY,
  );
  const shopCurrency = currencyData.shop.currencyCode;
  if (itemCurrency !== shopCurrency) {
    throw new SyncError(
      `Currency mismatch: shop is ${shopCurrency}, item is ${itemCurrency}`,
      "CURRENCY_MISMATCH",
    );
  }

  // 2. Convert minor units to decimal string via integer split (INV-4)
  const decimalPrice = toShopifyDecimal(itemPriceMinor, itemCurrency);

  // 3. Resolve Online Store publication (paginate until found; if absent, throw SyncError and do not markSynced)
  const publicationId = await findOnlineStorePublicationId(admin);

  // 4. Idempotent check: look up by stored id first, never recreate on retry
  if (storedVariantId) {
    let productId = storedProductId;
    if (!productId) {
      const variantData = await executeGraphQL<{
        productVariant: { id: string; product: { id: string } } | null;
      }>(admin, GET_VARIANT_PRODUCT_QUERY, { id: storedVariantId });

      if (!variantData.productVariant) {
        throw new SyncError(`Variant not found on Shopify: ${storedVariantId}`);
      }
      productId = variantData.productVariant.product.id;
    }

    // Converge to the same end state as a fresh sync:
    // Update product title, vendor, tags, ensure ACTIVE status, set metafields
    const productUpdateData = await executeGraphQL<{
      productUpdate: {
        product?: { id: string; title?: string; status: string };
        userErrors?: Array<{ field?: string[]; message: string }>;
      };
    }>(admin, PRODUCT_UPDATE_MUTATION, {
      product: {
        id: productId,
        ...buildProductInput(itemTitle),
      },
    });

    checkUserErrors(productUpdateData.productUpdate?.userErrors);

    // Update variant price and inventory tracking
    const updateData = await executeGraphQL<{
      productVariantsBulkUpdate: {
        productVariants?: Array<{ id: string; price: string }>;
        userErrors?: Array<{ field?: string[]; message: string }>;
      };
    }>(admin, PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
      productId,
      variants: [
        {
          id: storedVariantId,
          price: decimalPrice,
          inventoryItem: {
            tracked: false,
          },
        },
      ],
    });

    checkUserErrors(updateData.productVariantsBulkUpdate?.userErrors);

    // Publish to Online Store channel
    const publishData = await executeGraphQL<{
      publishablePublish: {
        userErrors?: Array<{ field?: string[]; message: string }>;
      };
    }>(admin, PUBLISHABLE_PUBLISH_MUTATION, {
      id: productId,
      input: [
        {
          publicationId,
        },
      ],
    });

    checkUserErrors(publishData.publishablePublish?.userErrors);

    await service.markSynced(shopId, entity, id, storedVariantId, productId);

    return {
      ok: true,
      updated: true,
      productId,
      variantId: storedVariantId,
    };
  }

  // 5. Create new product
  const createData = await executeGraphQL<{
    productCreate: {
      product?: {
        id: string;
        title: string;
        status: string;
        variants?: {
          nodes?: Array<{ id: string; price: string }>;
          edges?: Array<{ node: { id: string; price: string } }>;
        };
      };
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  }>(admin, PRODUCT_CREATE_MUTATION, {
    product: buildProductInput(itemTitle),
  });

  checkUserErrors(createData.productCreate?.userErrors);

  const product = createData.productCreate?.product;
  if (!product) {
    throw new SyncError("No product returned from Shopify productCreate");
  }

  const productId = product.id;
  const variantId =
    product.variants?.nodes?.[0]?.id ??
    product.variants?.edges?.[0]?.node?.id;

  if (!variantId) {
    throw new SyncError("No variant generated for created product");
  }

  // Persist the Shopify product id immediately after productCreate succeeds (before variant update and publish).
  // If persisting fails right after create, delete the just-created product (compensate) before throwing SyncError.
  try {
    await service.markSynced(shopId, entity, id, variantId, productId);
  } catch (persistError) {
    let deletionConfirmed = false;
    try {
      const deleteData = await executeGraphQL<{
        productDelete?: {
          deletedProductId?: string | null;
          userErrors?: Array<{ field?: string[]; message: string }>;
        };
      }>(admin, PRODUCT_DELETE_MUTATION, {
        input: { id: productId },
      });

      const userErrors = deleteData.productDelete?.userErrors;
      const deletedProductId = deleteData.productDelete?.deletedProductId;

      if ((!userErrors || userErrors.length === 0) && deletedProductId === productId) {
        deletionConfirmed = true;
      }
    } catch {
      deletionConfirmed = false;
    }

    if (!deletionConfirmed) {
      console.error(
        `Orphan Shopify product: ${productId} for catalog item: ${id}`,
      );
      throw new SyncError(
        `Failed to persist synced product and compensation failed; orphan Shopify product: ${productId}`,
        "ORPHAN_PRODUCT",
      );
    }

    if (persistError instanceof SyncError) {
      throw persistError;
    }
    throw new SyncError(
      `Failed to persist synced product: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
    );
  }

  // 6. Update variant price and inventory tracking
  const variantUpdateData = await executeGraphQL<{
    productVariantsBulkUpdate: {
      productVariants?: Array<{ id: string; price: string }>;
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  }>(admin, PRODUCT_VARIANTS_BULK_UPDATE_MUTATION, {
    productId,
    variants: [
      {
        id: variantId,
        price: decimalPrice,
        inventoryItem: {
          tracked: false,
        },
      },
    ],
  });

  checkUserErrors(variantUpdateData.productVariantsBulkUpdate?.userErrors);

  // 7. Publish to Online Store channel
  const publishData = await executeGraphQL<{
    publishablePublish: {
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  }>(admin, PUBLISHABLE_PUBLISH_MUTATION, {
    id: productId,
    input: [
      {
        publicationId,
      },
    ],
  });

  checkUserErrors(publishData.publishablePublish?.userErrors);

  return {
    ok: true,
    created: true,
    productId,
    variantId,
  };
}

export async function archiveItem(
  admin: ProductSyncAdminClient,
  shopId: string,
  entity: SyncEntity,
  id: string,
  deps?: ProductSyncDeps,
): Promise<ArchiveItemResult> {
  if (entity !== "lens" && entity !== "optionValue" && entity !== "addOn") {
    throw new BadRequestError(`Unknown entity type: ${String(entity)}`);
  }

  const service = deps?.catalogService ?? createCatalogService();

  let storedProductId: string | null = null;
  let storedVariantId: string | null = null;

  if (entity === "lens") {
    const lens = await service.getLens(shopId, id);
    storedProductId = lens.shopifyProductId;
    storedVariantId = lens.shopifyVariantId;
  } else if (entity === "optionValue") {
    const optVal = await service.getOptionValue(shopId, id);
    storedVariantId = optVal.shopifyVariantId ?? null;
  } else if (entity === "addOn") {
    const addOn = await service.getAddOn(shopId, id);
    storedProductId = addOn.shopifyProductId;
    storedVariantId = addOn.shopifyVariantId;
  }

  let productId = storedProductId;
  if (!productId && storedVariantId) {
    const variantData = await executeGraphQL<{
      productVariant: { id: string; product: { id: string } } | null;
    }>(admin, GET_VARIANT_PRODUCT_QUERY, { id: storedVariantId });

    if (variantData.productVariant?.product?.id) {
      productId = variantData.productVariant.product.id;
    }
  }

  if (!productId) {
    return {
      ok: true,
      archived: false,
      reason: "NOT_SYNCED",
    };
  }

  const updateData = await executeGraphQL<{
    productUpdate: {
      product?: { id: string; status: string };
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  }>(admin, PRODUCT_UPDATE_MUTATION, {
    product: {
      id: productId,
      status: "DRAFT",
    },
  });

  checkUserErrors(updateData.productUpdate?.userErrors);

  return {
    ok: true,
    archived: true,
    productId,
    status: "DRAFT",
  };
}
