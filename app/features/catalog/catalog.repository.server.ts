import type {
  AddOn,
  Lens,
  LensGroup,
  OptionGroup,
  OptionKind,
  OptionValue,
  Prisma,
  PrismaClient,
  RxType,
  ShopSettings,
} from "@prisma/client";
import { getPrisma } from "../../shared/container/prisma.server";
import { NotFoundError } from "../../shared/http/errors.server";

export type LensGroupWithLenses = LensGroup & { lenses: Lens[] };
export type OptionGroupWithValues = OptionGroup & { values: OptionValue[] };

export interface CreateLensGroupData {
  name: string;
  description?: string;
  position?: number;
}

export interface UpdateLensGroupData {
  name?: string;
  description?: string;
  position?: number;
  archivedAt?: Date | null;
}

export interface CreateLensData {
  groupId: string;
  name: string;
  description?: string;
  priceMinor: number;
  currency?: string;
  rxTypes: RxType[];
  sphMin: number;
  sphMax: number;
  cylMin: number;
  cylMax: number;
  addMin?: number | null;
  addMax?: number | null;
  labCodeTemplate?: string;
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  position?: number;
}

export interface UpdateLensData {
  groupId?: string;
  name?: string;
  description?: string;
  priceMinor?: number;
  currency?: string;
  rxTypes?: RxType[];
  sphMin?: number;
  sphMax?: number;
  cylMin?: number;
  cylMax?: number;
  addMin?: number | null;
  addMax?: number | null;
  labCodeTemplate?: string;
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  position?: number;
  archivedAt?: Date | null;
}

export interface CreateOptionGroupData {
  kind: OptionKind;
  name: string;
  position?: number;
}

export interface UpdateOptionGroupData {
  kind?: OptionKind;
  name?: string;
  position?: number;
  archivedAt?: Date | null;
}

export interface CreateOptionValueData {
  optionGroupId: string;
  label: string;
  priceDeltaMinor?: number;
  currency?: string;
  tokenKey?: string | null;
  tokenValue?: string | null;
  overrideCode?: string | null;
  swatch?: string | null;
  shopifyVariantId?: string | null;
  position?: number;
}

export interface UpdateOptionValueData {
  optionGroupId?: string;
  label?: string;
  priceDeltaMinor?: number;
  currency?: string;
  tokenKey?: string | null;
  tokenValue?: string | null;
  overrideCode?: string | null;
  swatch?: string | null;
  shopifyVariantId?: string | null;
  position?: number;
  archivedAt?: Date | null;
}

export interface CreateAddOnData {
  name: string;
  priceMinor: number;
  currency?: string;
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  position?: number;
}

export interface UpdateAddOnData {
  name?: string;
  priceMinor?: number;
  currency?: string;
  shopifyProductId?: string | null;
  shopifyVariantId?: string | null;
  position?: number;
  archivedAt?: Date | null;
}

export type CatalogEntity = "lens" | "optionValue" | "addOn";

export interface StorefrontCatalogDbData {
  lensGroups: LensGroupWithLenses[];
  optionGroups: OptionGroupWithValues[];
  addOns: AddOn[];
  settings: ShopSettings | null;
}

function handlePrismaNotFound(error: unknown, entityName: string): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  ) {
    throw new NotFoundError(`${entityName} not found`);
  }
  throw error;
}

export class CatalogRepository {
  public readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private async runInTx<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if ("$transaction" in this.prisma && typeof this.prisma.$transaction === "function") {
      return this.prisma.$transaction(fn);
    }
    return fn(this.prisma as unknown as Prisma.TransactionClient);
  }

  // -------------------------------------------------------------------------
  // Lens Groups
  // -------------------------------------------------------------------------

  async listLensGroups(
    shopId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<LensGroupWithLenses[]> {
    return this.prisma.lensGroup.findMany({
      where: {
        shopId,
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { position: "asc" },
      include: {
        lenses: {
          where: {
            shopId,
            ...(options.includeArchived ? {} : { archivedAt: null }),
          },
          orderBy: { position: "asc" },
        },
      },
    });
  }

  async getLensGroup(
    shopId: string,
    id: string,
  ): Promise<LensGroupWithLenses | null> {
    return this.prisma.lensGroup.findUnique({
      where: { shopId_id: { shopId, id } },
      include: {
        lenses: {
          where: { shopId },
          orderBy: { position: "asc" },
        },
      },
    });
  }

  async createLensGroup(
    shopId: string,
    data: CreateLensGroupData,
  ): Promise<LensGroup> {
    return this.runInTx(async (tx) => {
      let position = data.position;
      if (position === undefined) {
        const max = await tx.lensGroup.aggregate({
          where: { shopId },
          _max: { position: true },
        });
        position = max._max.position !== null ? max._max.position + 1 : 0;
      }
      return tx.lensGroup.create({
        data: {
          shopId,
          name: data.name,
          description: data.description ?? "",
          position,
        },
      });
    });
  }

  async updateLensGroup(
    shopId: string,
    id: string,
    data: UpdateLensGroupData,
  ): Promise<LensGroup> {
    try {
      return await this.prisma.lensGroup.update({
        where: { shopId_id: { shopId, id } },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
          ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt } : {}),
        },
      });
    } catch (error) {
      handlePrismaNotFound(error, "LensGroup");
    }
  }

  async deleteLensGroup(shopId: string, id: string): Promise<LensGroup> {
    try {
      return await this.prisma.lensGroup.update({
        where: { shopId_id: { shopId, id } },
        data: { archivedAt: new Date() },
      });
    } catch (error) {
      handlePrismaNotFound(error, "LensGroup");
    }
  }

  async reorderLensGroups(shopId: string, ids: string[]): Promise<void> {
    await this.runInTx(async (tx) => {
      const rows = await tx.lensGroup.findMany({
        where: { shopId, id: { in: ids }, archivedAt: null },
        select: { id: true },
      });
      if (rows.length !== ids.length) {
        throw new NotFoundError("One or more lens groups not found");
      }
      for (let i = 0; i < ids.length; i++) {
        await tx.lensGroup.update({
          where: { shopId_id: { shopId, id: ids[i] } },
          data: { position: i },
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Lenses
  // -------------------------------------------------------------------------

  async listLenses(
    shopId: string,
    options: { groupId?: string; includeArchived?: boolean } = {},
  ): Promise<Lens[]> {
    return this.prisma.lens.findMany({
      where: {
        shopId,
        ...(options.groupId ? { groupId: options.groupId } : {}),
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { position: "asc" },
    });
  }

  async getLens(shopId: string, id: string): Promise<Lens | null> {
    return this.prisma.lens.findUnique({
      where: { shopId_id: { shopId, id } },
    });
  }

  async createLens(shopId: string, data: CreateLensData): Promise<Lens> {
    return this.runInTx(async (tx) => {
      // Verify groupId belongs to shopId and is not archived
      const group = await tx.lensGroup.findUnique({
        where: { shopId_id: { shopId, id: data.groupId } },
      });
      if (!group || group.archivedAt) {
        throw new NotFoundError("LensGroup not found");
      }

      let position = data.position;
      if (position === undefined) {
        const max = await tx.lens.aggregate({
          where: { shopId, groupId: data.groupId },
          _max: { position: true },
        });
        position = max._max.position !== null ? max._max.position + 1 : 0;
      }

      return tx.lens.create({
        data: {
          shopId,
          groupId: data.groupId,
          name: data.name,
          description: data.description ?? "",
          priceMinor: data.priceMinor,
          currency: data.currency ?? "USD",
          rxTypes: data.rxTypes,
          sphMin: data.sphMin,
          sphMax: data.sphMax,
          cylMin: data.cylMin,
          cylMax: data.cylMax,
          addMin: data.addMin,
          addMax: data.addMax,
          labCodeTemplate: data.labCodeTemplate ?? "",
          shopifyProductId: data.shopifyProductId,
          shopifyVariantId: data.shopifyVariantId,
          position,
        },
      });
    });
  }

  async updateLens(
    shopId: string,
    id: string,
    data: UpdateLensData,
  ): Promise<Lens> {
    return this.runInTx(async (tx) => {
      if (data.groupId !== undefined) {
        const group = await tx.lensGroup.findUnique({
          where: { shopId_id: { shopId, id: data.groupId } },
        });
        if (!group || group.archivedAt) {
          throw new NotFoundError("LensGroup not found");
        }
      }

      try {
        return await tx.lens.update({
          where: { shopId_id: { shopId, id } },
          data: {
            ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.priceMinor !== undefined ? { priceMinor: data.priceMinor } : {}),
            ...(data.currency !== undefined ? { currency: data.currency } : {}),
            ...(data.rxTypes !== undefined ? { rxTypes: data.rxTypes } : {}),
            ...(data.sphMin !== undefined ? { sphMin: data.sphMin } : {}),
            ...(data.sphMax !== undefined ? { sphMax: data.sphMax } : {}),
            ...(data.cylMin !== undefined ? { cylMin: data.cylMin } : {}),
            ...(data.cylMax !== undefined ? { cylMax: data.cylMax } : {}),
            ...(data.addMin !== undefined ? { addMin: data.addMin } : {}),
            ...(data.addMax !== undefined ? { addMax: data.addMax } : {}),
            ...(data.labCodeTemplate !== undefined ? { labCodeTemplate: data.labCodeTemplate } : {}),
            ...(data.shopifyProductId !== undefined ? { shopifyProductId: data.shopifyProductId } : {}),
            ...(data.shopifyVariantId !== undefined ? { shopifyVariantId: data.shopifyVariantId } : {}),
            ...(data.position !== undefined ? { position: data.position } : {}),
            ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt } : {}),
          },
        });
      } catch (error) {
        handlePrismaNotFound(error, "Lens");
      }
    });
  }

  async deleteLens(shopId: string, id: string): Promise<Lens> {
    try {
      return await this.prisma.lens.update({
        where: { shopId_id: { shopId, id } },
        data: { archivedAt: new Date() },
      });
    } catch (error) {
      handlePrismaNotFound(error, "Lens");
    }
  }

  async reorderLenses(
    shopId: string,
    ids: string[],
    groupId?: string,
  ): Promise<void> {
    await this.runInTx(async (tx) => {
      const rows = await tx.lens.findMany({
        where: {
          shopId,
          id: { in: ids },
          archivedAt: null,
          ...(groupId ? { groupId } : {}),
        },
        select: { id: true },
      });
      if (rows.length !== ids.length) {
        throw new NotFoundError("One or more lenses not found");
      }
      for (let i = 0; i < ids.length; i++) {
        await tx.lens.update({
          where: { shopId_id: { shopId, id: ids[i] } },
          data: { position: i },
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Option Groups
  // -------------------------------------------------------------------------

  async listOptionGroups(
    shopId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<OptionGroupWithValues[]> {
    return this.prisma.optionGroup.findMany({
      where: {
        shopId,
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { position: "asc" },
      include: {
        values: {
          where: {
            shopId,
            ...(options.includeArchived ? {} : { archivedAt: null }),
          },
          orderBy: { position: "asc" },
        },
      },
    });
  }

  async getOptionGroup(
    shopId: string,
    id: string,
  ): Promise<OptionGroupWithValues | null> {
    return this.prisma.optionGroup.findUnique({
      where: { shopId_id: { shopId, id } },
      include: {
        values: {
          where: { shopId },
          orderBy: { position: "asc" },
        },
      },
    });
  }

  async createOptionGroup(
    shopId: string,
    data: CreateOptionGroupData,
  ): Promise<OptionGroup> {
    return this.runInTx(async (tx) => {
      let position = data.position;
      if (position === undefined) {
        const max = await tx.optionGroup.aggregate({
          where: { shopId },
          _max: { position: true },
        });
        position = max._max.position !== null ? max._max.position + 1 : 0;
      }
      return tx.optionGroup.create({
        data: {
          shopId,
          kind: data.kind,
          name: data.name,
          position,
        },
      });
    });
  }

  async updateOptionGroup(
    shopId: string,
    id: string,
    data: UpdateOptionGroupData,
  ): Promise<OptionGroup> {
    try {
      return await this.prisma.optionGroup.update({
        where: { shopId_id: { shopId, id } },
        data: {
          ...(data.kind !== undefined ? { kind: data.kind } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
          ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt } : {}),
        },
      });
    } catch (error) {
      handlePrismaNotFound(error, "OptionGroup");
    }
  }

  async deleteOptionGroup(shopId: string, id: string): Promise<OptionGroup> {
    try {
      return await this.prisma.optionGroup.update({
        where: { shopId_id: { shopId, id } },
        data: { archivedAt: new Date() },
      });
    } catch (error) {
      handlePrismaNotFound(error, "OptionGroup");
    }
  }

  async reorderOptionGroups(shopId: string, ids: string[]): Promise<void> {
    await this.runInTx(async (tx) => {
      const rows = await tx.optionGroup.findMany({
        where: { shopId, id: { in: ids }, archivedAt: null },
        select: { id: true },
      });
      if (rows.length !== ids.length) {
        throw new NotFoundError("One or more option groups not found");
      }
      for (let i = 0; i < ids.length; i++) {
        await tx.optionGroup.update({
          where: { shopId_id: { shopId, id: ids[i] } },
          data: { position: i },
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Option Values
  // -------------------------------------------------------------------------

  async listOptionValues(
    shopId: string,
    options: { optionGroupId?: string; includeArchived?: boolean } = {},
  ): Promise<OptionValue[]> {
    return this.prisma.optionValue.findMany({
      where: {
        shopId,
        ...(options.optionGroupId ? { optionGroupId: options.optionGroupId } : {}),
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { position: "asc" },
    });
  }

  async getOptionValue(shopId: string, id: string): Promise<OptionValue | null> {
    return this.prisma.optionValue.findUnique({
      where: { shopId_id: { shopId, id } },
    });
  }

  async createOptionValue(
    shopId: string,
    data: CreateOptionValueData,
  ): Promise<OptionValue> {
    return this.runInTx(async (tx) => {
      const group = await tx.optionGroup.findUnique({
        where: { shopId_id: { shopId, id: data.optionGroupId } },
      });
      if (!group) {
        throw new NotFoundError("OptionGroup not found");
      }

      let position = data.position;
      if (position === undefined) {
        const max = await tx.optionValue.aggregate({
          where: { shopId, optionGroupId: data.optionGroupId },
          _max: { position: true },
        });
        position = max._max.position !== null ? max._max.position + 1 : 0;
      }

      return tx.optionValue.create({
        data: {
          shopId,
          optionGroupId: data.optionGroupId,
          label: data.label,
          priceDeltaMinor: data.priceDeltaMinor ?? 0,
          currency: data.currency ?? "USD",
          tokenKey: data.tokenKey,
          tokenValue: data.tokenValue,
          overrideCode: data.overrideCode,
          swatch: data.swatch,
          shopifyVariantId: data.shopifyVariantId,
          position,
        },
      });
    });
  }

  async updateOptionValue(
    shopId: string,
    id: string,
    data: UpdateOptionValueData,
  ): Promise<OptionValue> {
    return this.runInTx(async (tx) => {
      if (data.optionGroupId !== undefined) {
        const group = await tx.optionGroup.findUnique({
          where: { shopId_id: { shopId, id: data.optionGroupId } },
        });
        if (!group) {
          throw new NotFoundError("OptionGroup not found");
        }
      }

      try {
        return await tx.optionValue.update({
          where: { shopId_id: { shopId, id } },
          data: {
            ...(data.optionGroupId !== undefined ? { optionGroupId: data.optionGroupId } : {}),
            ...(data.label !== undefined ? { label: data.label } : {}),
            ...(data.priceDeltaMinor !== undefined ? { priceDeltaMinor: data.priceDeltaMinor } : {}),
            ...(data.currency !== undefined ? { currency: data.currency } : {}),
            ...(data.tokenKey !== undefined ? { tokenKey: data.tokenKey } : {}),
            ...(data.tokenValue !== undefined ? { tokenValue: data.tokenValue } : {}),
            ...(data.overrideCode !== undefined ? { overrideCode: data.overrideCode } : {}),
            ...(data.swatch !== undefined ? { swatch: data.swatch } : {}),
            ...(data.shopifyVariantId !== undefined ? { shopifyVariantId: data.shopifyVariantId } : {}),
            ...(data.position !== undefined ? { position: data.position } : {}),
            ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt } : {}),
          },
        });
      } catch (error) {
        handlePrismaNotFound(error, "OptionValue");
      }
    });
  }

  async deleteOptionValue(shopId: string, id: string): Promise<OptionValue> {
    try {
      return await this.prisma.optionValue.update({
        where: { shopId_id: { shopId, id } },
        data: { archivedAt: new Date() },
      });
    } catch (error) {
      handlePrismaNotFound(error, "OptionValue");
    }
  }

  async reorderOptionValues(
    shopId: string,
    ids: string[],
    optionGroupId?: string,
  ): Promise<void> {
    await this.runInTx(async (tx) => {
      const rows = await tx.optionValue.findMany({
        where: {
          shopId,
          id: { in: ids },
          archivedAt: null,
          ...(optionGroupId ? { optionGroupId } : {}),
        },
        select: { id: true },
      });
      if (rows.length !== ids.length) {
        throw new NotFoundError("One or more option values not found");
      }
      for (let i = 0; i < ids.length; i++) {
        await tx.optionValue.update({
          where: { shopId_id: { shopId, id: ids[i] } },
          data: { position: i },
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Add-Ons
  // -------------------------------------------------------------------------

  async listAddOns(
    shopId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<AddOn[]> {
    return this.prisma.addOn.findMany({
      where: {
        shopId,
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { position: "asc" },
    });
  }

  async getAddOn(shopId: string, id: string): Promise<AddOn | null> {
    return this.prisma.addOn.findUnique({
      where: { shopId_id: { shopId, id } },
    });
  }

  async createAddOn(shopId: string, data: CreateAddOnData): Promise<AddOn> {
    return this.runInTx(async (tx) => {
      let position = data.position;
      if (position === undefined) {
        const max = await tx.addOn.aggregate({
          where: { shopId },
          _max: { position: true },
        });
        position = max._max.position !== null ? max._max.position + 1 : 0;
      }
      return tx.addOn.create({
        data: {
          shopId,
          name: data.name,
          priceMinor: data.priceMinor,
          currency: data.currency ?? "USD",
          shopifyProductId: data.shopifyProductId,
          shopifyVariantId: data.shopifyVariantId,
          position,
        },
      });
    });
  }

  async updateAddOn(
    shopId: string,
    id: string,
    data: UpdateAddOnData,
  ): Promise<AddOn> {
    try {
      return await this.prisma.addOn.update({
        where: { shopId_id: { shopId, id } },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.priceMinor !== undefined ? { priceMinor: data.priceMinor } : {}),
          ...(data.currency !== undefined ? { currency: data.currency } : {}),
          ...(data.shopifyProductId !== undefined ? { shopifyProductId: data.shopifyProductId } : {}),
          ...(data.shopifyVariantId !== undefined ? { shopifyVariantId: data.shopifyVariantId } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
          ...(data.archivedAt !== undefined ? { archivedAt: data.archivedAt } : {}),
        },
      });
    } catch (error) {
      handlePrismaNotFound(error, "AddOn");
    }
  }

  async deleteAddOn(shopId: string, id: string): Promise<AddOn> {
    try {
      return await this.prisma.addOn.update({
        where: { shopId_id: { shopId, id } },
        data: { archivedAt: new Date() },
      });
    } catch (error) {
      handlePrismaNotFound(error, "AddOn");
    }
  }

  async reorderAddOns(shopId: string, ids: string[]): Promise<void> {
    await this.runInTx(async (tx) => {
      const rows = await tx.addOn.findMany({
        where: { shopId, id: { in: ids }, archivedAt: null },
        select: { id: true },
      });
      if (rows.length !== ids.length) {
        throw new NotFoundError("One or more add-ons not found");
      }
      for (let i = 0; i < ids.length; i++) {
        await tx.addOn.update({
          where: { shopId_id: { shopId, id: ids[i] } },
          data: { position: i },
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  async markSynced(
    shopId: string,
    entity: CatalogEntity,
    id: string,
    variantId: string,
    productId?: string,
  ): Promise<Lens | OptionValue | AddOn> {
    try {
      if (entity === "lens") {
        return await this.prisma.lens.update({
          where: { shopId_id: { shopId, id } },
          data: {
            shopifyVariantId: variantId,
            ...(productId ? { shopifyProductId: productId } : {}),
          },
        });
      }
      if (entity === "optionValue") {
        return await this.prisma.optionValue.update({
          where: { shopId_id: { shopId, id } },
          data: {
            shopifyVariantId: variantId,
          },
        });
      }
      if (entity === "addOn") {
        return await this.prisma.addOn.update({
          where: { shopId_id: { shopId, id } },
          data: {
            shopifyVariantId: variantId,
            ...(productId ? { shopifyProductId: productId } : {}),
          },
        });
      }
      throw new NotFoundError(`Unknown entity type: ${String(entity)}`);
    } catch (error) {
      handlePrismaNotFound(error, entity);
    }
  }

  // -------------------------------------------------------------------------
  // Storefront Catalog DB Data
  // -------------------------------------------------------------------------

  async getStorefrontCatalogData(shopId: string): Promise<StorefrontCatalogDbData> {
    const [lensGroups, optionGroups, addOns, settings] = await Promise.all([
      this.prisma.lensGroup.findMany({
        where: { shopId, archivedAt: null },
        orderBy: { position: "asc" },
        include: {
          lenses: {
            where: {
              shopId,
              archivedAt: null,
              shopifyVariantId: { not: null },
            },
            orderBy: { position: "asc" },
          },
        },
      }),
      this.prisma.optionGroup.findMany({
        where: { shopId, archivedAt: null },
        orderBy: { position: "asc" },
        include: {
          values: {
            where: { shopId, archivedAt: null },
            orderBy: { position: "asc" },
          },
        },
      }),
      this.prisma.addOn.findMany({
        where: {
          shopId,
          archivedAt: null,
          shopifyVariantId: { not: null },
        },
        orderBy: { position: "asc" },
      }),
      this.prisma.shopSettings.findUnique({
        where: { shopId },
      }),
    ]);

    return { lensGroups, optionGroups, addOns, settings };
  }
}

export function createCatalogRepository(
  prisma: PrismaClient = getPrisma(),
): CatalogRepository {
  return new CatalogRepository(prisma);
}

// ---------------------------------------------------------------------------
// Standalone repository functions (each taking shopId first, INV-1)
// ---------------------------------------------------------------------------

export async function listLensGroups(
  shopId: string,
  options?: { includeArchived?: boolean },
  db?: PrismaClient,
): Promise<LensGroupWithLenses[]> {
  return createCatalogRepository(db ?? getPrisma()).listLensGroups(shopId, options);
}

export async function getLensGroup(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<LensGroupWithLenses | null> {
  return createCatalogRepository(db ?? getPrisma()).getLensGroup(shopId, id);
}

export async function createLensGroup(
  shopId: string,
  data: CreateLensGroupData,
  db?: PrismaClient,
): Promise<LensGroup> {
  return createCatalogRepository(db ?? getPrisma()).createLensGroup(shopId, data);
}

export async function updateLensGroup(
  shopId: string,
  id: string,
  data: UpdateLensGroupData,
  db?: PrismaClient,
): Promise<LensGroup> {
  return createCatalogRepository(db ?? getPrisma()).updateLensGroup(shopId, id, data);
}

export async function deleteLensGroup(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<LensGroup> {
  return createCatalogRepository(db ?? getPrisma()).deleteLensGroup(shopId, id);
}

export async function reorderLensGroups(
  shopId: string,
  ids: string[],
  db?: PrismaClient,
): Promise<void> {
  return createCatalogRepository(db ?? getPrisma()).reorderLensGroups(shopId, ids);
}

export async function listLenses(
  shopId: string,
  options?: { groupId?: string; includeArchived?: boolean },
  db?: PrismaClient,
): Promise<Lens[]> {
  return createCatalogRepository(db ?? getPrisma()).listLenses(shopId, options);
}

export async function getLens(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<Lens | null> {
  return createCatalogRepository(db ?? getPrisma()).getLens(shopId, id);
}

export async function createLens(
  shopId: string,
  data: CreateLensData,
  db?: PrismaClient,
): Promise<Lens> {
  return createCatalogRepository(db ?? getPrisma()).createLens(shopId, data);
}

export async function updateLens(
  shopId: string,
  id: string,
  data: UpdateLensData,
  db?: PrismaClient,
): Promise<Lens> {
  return createCatalogRepository(db ?? getPrisma()).updateLens(shopId, id, data);
}

export async function deleteLens(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<Lens> {
  return createCatalogRepository(db ?? getPrisma()).deleteLens(shopId, id);
}

export async function reorderLenses(
  shopId: string,
  ids: string[],
  groupId?: string,
  db?: PrismaClient,
): Promise<void> {
  return createCatalogRepository(db ?? getPrisma()).reorderLenses(shopId, ids, groupId);
}

export async function listOptionGroups(
  shopId: string,
  options?: { includeArchived?: boolean },
  db?: PrismaClient,
): Promise<OptionGroupWithValues[]> {
  return createCatalogRepository(db ?? getPrisma()).listOptionGroups(shopId, options);
}

export async function getOptionGroup(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<OptionGroupWithValues | null> {
  return createCatalogRepository(db ?? getPrisma()).getOptionGroup(shopId, id);
}

export async function createOptionGroup(
  shopId: string,
  data: CreateOptionGroupData,
  db?: PrismaClient,
): Promise<OptionGroup> {
  return createCatalogRepository(db ?? getPrisma()).createOptionGroup(shopId, data);
}

export async function updateOptionGroup(
  shopId: string,
  id: string,
  data: UpdateOptionGroupData,
  db?: PrismaClient,
): Promise<OptionGroup> {
  return createCatalogRepository(db ?? getPrisma()).updateOptionGroup(shopId, id, data);
}

export async function deleteOptionGroup(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<OptionGroup> {
  return createCatalogRepository(db ?? getPrisma()).deleteOptionGroup(shopId, id);
}

export async function reorderOptionGroups(
  shopId: string,
  ids: string[],
  db?: PrismaClient,
): Promise<void> {
  return createCatalogRepository(db ?? getPrisma()).reorderOptionGroups(shopId, ids);
}

export async function listOptionValues(
  shopId: string,
  options?: { optionGroupId?: string; includeArchived?: boolean },
  db?: PrismaClient,
): Promise<OptionValue[]> {
  return createCatalogRepository(db ?? getPrisma()).listOptionValues(shopId, options);
}

export async function getOptionValue(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<OptionValue | null> {
  return createCatalogRepository(db ?? getPrisma()).getOptionValue(shopId, id);
}

export async function createOptionValue(
  shopId: string,
  data: CreateOptionValueData,
  db?: PrismaClient,
): Promise<OptionValue> {
  return createCatalogRepository(db ?? getPrisma()).createOptionValue(shopId, data);
}

export async function updateOptionValue(
  shopId: string,
  id: string,
  data: UpdateOptionValueData,
  db?: PrismaClient,
): Promise<OptionValue> {
  return createCatalogRepository(db ?? getPrisma()).updateOptionValue(shopId, id, data);
}

export async function deleteOptionValue(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<OptionValue> {
  return createCatalogRepository(db ?? getPrisma()).deleteOptionValue(shopId, id);
}

export async function reorderOptionValues(
  shopId: string,
  ids: string[],
  optionGroupId?: string,
  db?: PrismaClient,
): Promise<void> {
  return createCatalogRepository(db ?? getPrisma()).reorderOptionValues(
    shopId,
    ids,
    optionGroupId,
  );
}

export async function listAddOns(
  shopId: string,
  options?: { includeArchived?: boolean },
  db?: PrismaClient,
): Promise<AddOn[]> {
  return createCatalogRepository(db ?? getPrisma()).listAddOns(shopId, options);
}

export async function getAddOn(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<AddOn | null> {
  return createCatalogRepository(db ?? getPrisma()).getAddOn(shopId, id);
}

export async function createAddOn(
  shopId: string,
  data: CreateAddOnData,
  db?: PrismaClient,
): Promise<AddOn> {
  return createCatalogRepository(db ?? getPrisma()).createAddOn(shopId, data);
}

export async function updateAddOn(
  shopId: string,
  id: string,
  data: UpdateAddOnData,
  db?: PrismaClient,
): Promise<AddOn> {
  return createCatalogRepository(db ?? getPrisma()).updateAddOn(shopId, id, data);
}

export async function deleteAddOn(
  shopId: string,
  id: string,
  db?: PrismaClient,
): Promise<AddOn> {
  return createCatalogRepository(db ?? getPrisma()).deleteAddOn(shopId, id);
}

export async function reorderAddOns(
  shopId: string,
  ids: string[],
  db?: PrismaClient,
): Promise<void> {
  return createCatalogRepository(db ?? getPrisma()).reorderAddOns(shopId, ids);
}

export async function markSynced(
  shopId: string,
  entity: CatalogEntity,
  id: string,
  variantId: string,
  productId?: string,
  db?: PrismaClient,
): Promise<Lens | OptionValue | AddOn> {
  return createCatalogRepository(db ?? getPrisma()).markSynced(
    shopId,
    entity,
    id,
    variantId,
    productId,
  );
}

export async function getStorefrontCatalogData(
  shopId: string,
  db?: PrismaClient,
): Promise<StorefrontCatalogDbData> {
  return createCatalogRepository(db ?? getPrisma()).getStorefrontCatalogData(shopId);
}
