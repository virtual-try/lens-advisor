import { toShopifyDecimal } from "../../../packages/rx-core/src/pricing/index.js";
import { BadRequestError } from "../../shared/http/errors.server";
import { createCatalogService } from "../catalog/catalog.service.server";
import { SyncError } from "./errors";
import {
  GET_PUBLICATIONS_QUERY,
  GET_VARIANT_PRODUCT_QUERY,
  PRODUCT_CREATE_MUTATION,
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

  // 3. Idempotent check: look up by stored id first, never recreate on retry
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

    await service.markSynced(shopId, entity, id, storedVariantId, productId);

    return {
      ok: true,
      updated: true,
      productId,
      variantId: storedVariantId,
    };
  }

  // 4. Create new product
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
    product: {
      title: itemTitle,
      vendor: "Lens Advisor",
      tags: ["lens-advisor-item"],
      status: "ACTIVE",
      metafields: [
        {
          namespace: "seo",
          key: "hidden",
          value: "1",
          type: "integer",
        },
      ],
    },
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

  // 5. Update variant price and inventory tracking
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

  // 6. Publish to Online Store channel
  const publicationsData = await executeGraphQL<{
    publications: {
      nodes: Array<{ id: string; name: string }>;
    };
  }>(admin, GET_PUBLICATIONS_QUERY);

  const onlineStore = publicationsData.publications?.nodes?.find(
    (node) => node.name.toLowerCase() === "online store",
  );

  if (onlineStore) {
    const publishData = await executeGraphQL<{
      publishablePublish: {
        userErrors?: Array<{ field?: string[]; message: string }>;
      };
    }>(admin, PUBLISHABLE_PUBLISH_MUTATION, {
      id: productId,
      input: [
        {
          publicationId: onlineStore.id,
        },
      ],
    });

    checkUserErrors(publishData.publishablePublish?.userErrors);
  }

  // 7. Mark synced in catalog DB
  await service.markSynced(shopId, entity, id, variantId, productId);

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
