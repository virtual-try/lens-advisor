import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { CatalogEntity } from "../catalog/catalog.repository.server";
import type { CatalogService } from "../catalog/catalog.service.server";

export type ProductSyncAdminClient = Pick<AdminApiContext, "graphql">;

export type SyncEntity = CatalogEntity;

export interface ProductSyncDeps {
  catalogService?: CatalogService;
}

export interface SyncItemResult {
  ok: boolean;
  skipped?: boolean;
  created?: boolean;
  updated?: boolean;
  productId?: string;
  variantId?: string;
}

export interface ArchiveItemResult {
  ok: boolean;
  archived: boolean;
  productId?: string;
  status?: string;
  reason?: string;
}
