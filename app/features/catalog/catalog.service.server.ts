import crypto from "node:crypto";
import {
  Prisma,
  type AddOn as PrismaAddOn,
  type Lens as PrismaLens,
  type OptionValue as PrismaOptionValue,
  type PrismaClient,
} from "@prisma/client";
import {
  catalogResponseSchema,
  type AddOn as StorefrontAddOn,
  type CatalogResponse,
  type CatalogSettings,
  type Lens as StorefrontLens,
  type LensGroup as StorefrontLensGroup,
  type Money,
  type OptionGroup as StorefrontOptionGroup,
  type OptionGroupKind,
  type OptionValue as StorefrontOptionValue,
  type RxLimits,
  type RxType,
} from "../../../packages/rx-core/src/index.js";
import { getPrisma } from "../../shared/container/prisma.server";
import { ConflictError, NotFoundError } from "../../shared/http/errors.server";
import {
  CatalogRepository,
  createCatalogRepository,
  type CatalogEntity,
  type LensGroupWithLenses,
  type OptionGroupWithValues,
} from "./catalog.repository.server";
import {
  addOnInputSchema,
  addOnUpdateSchema,
  lensGroupInputSchema,
  lensGroupUpdateSchema,
  lensInputSchema,
  lensUpdateSchema,
  optionGroupInputSchema,
  optionGroupUpdateSchema,
  optionValueInputSchema,
  optionValueUpdateSchema,
  reorderSchema,
  validateInput,
  ValidationError,
  type AddOnInput,
  type AddOnUpdateInput,
  type LensGroupInput,
  type LensGroupUpdateInput,
  type LensInput,
  type LensUpdateInput,
  type OptionGroupInput,
  type OptionGroupUpdateInput,
  type OptionValueInput,
  type OptionValueUpdateInput,
} from "./schema";

export { ValidationError };

export interface CatalogLensDto {
  id: string;
  groupId: string;
  name: string;
  description?: string;
  price: Money;
  limits: RxLimits;
  labCodeTemplate: string;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  position: number;
  archivedAt: Date | null;
}

export interface CatalogLensGroupDto {
  id: string;
  name: string;
  description?: string;
  position: number;
  lenses: CatalogLensDto[];
  archivedAt: Date | null;
}

export interface CatalogOptionValueDto {
  id: string;
  optionGroupId: string;
  label: string;
  priceDelta: Money;
  tokenKey?: string;
  tokenValue?: string;
  overrideCode?: string;
  swatch?: string;
  shopifyVariantId?: string | null;
  position: number;
  archivedAt: Date | null;
}

export interface CatalogOptionGroupDto {
  id: string;
  kind: OptionGroupKind;
  name: string;
  position: number;
  values: CatalogOptionValueDto[];
  archivedAt: Date | null;
}

export interface CatalogAddOnDto {
  id: string;
  name: string;
  price: Money;
  shopifyProductId: string | null;
  shopifyVariantId: string | null;
  position: number;
  archivedAt: Date | null;
}

function mapLensToDto(lens: PrismaLens): CatalogLensDto {
  return {
    id: lens.id,
    groupId: lens.groupId,
    name: lens.name,
    description: lens.description || undefined,
    price: {
      amountMinor: lens.priceMinor,
      currency: lens.currency,
    },
    limits: {
      sphMin: lens.sphMin,
      sphMax: lens.sphMax,
      cylMin: lens.cylMin,
      cylMax: lens.cylMax,
      ...(lens.addMin !== null && lens.addMin !== undefined ? { addMin: lens.addMin } : {}),
      ...(lens.addMax !== null && lens.addMax !== undefined ? { addMax: lens.addMax } : {}),
      rxTypes: lens.rxTypes as RxType[],
    },
    labCodeTemplate: lens.labCodeTemplate,
    shopifyProductId: lens.shopifyProductId ?? null,
    shopifyVariantId: lens.shopifyVariantId ?? null,
    position: lens.position,
    archivedAt: lens.archivedAt ?? null,
  };
}

function mapLensGroupToDto(group: LensGroupWithLenses): CatalogLensGroupDto {
  return {
    id: group.id,
    name: group.name,
    description: group.description || undefined,
    position: group.position,
    lenses: (group.lenses ?? []).map(mapLensToDto),
    archivedAt: group.archivedAt ?? null,
  };
}

function mapOptionValueToDto(val: PrismaOptionValue): CatalogOptionValueDto {
  return {
    id: val.id,
    optionGroupId: val.optionGroupId,
    label: val.label,
    priceDelta: {
      amountMinor: val.priceDeltaMinor,
      currency: val.currency,
    },
    tokenKey: val.tokenKey ?? undefined,
    tokenValue: val.tokenValue ?? undefined,
    overrideCode: val.overrideCode ?? undefined,
    swatch: val.swatch ?? undefined,
    shopifyVariantId: val.shopifyVariantId ?? null,
    position: val.position,
    archivedAt: val.archivedAt ?? null,
  };
}

function mapOptionGroupToDto(group: OptionGroupWithValues): CatalogOptionGroupDto {
  return {
    id: group.id,
    kind: group.kind as OptionGroupKind,
    name: group.name,
    position: group.position,
    values: (group.values ?? []).map(mapOptionValueToDto),
    archivedAt: group.archivedAt ?? null,
  };
}

function mapAddOnToDto(addOn: PrismaAddOn): CatalogAddOnDto {
  return {
    id: addOn.id,
    name: addOn.name,
    price: {
      amountMinor: addOn.priceMinor,
      currency: addOn.currency,
    },
    shopifyProductId: addOn.shopifyProductId ?? null,
    shopifyVariantId: addOn.shopifyVariantId ?? null,
    position: addOn.position,
    archivedAt: addOn.archivedAt ?? null,
  };
}

export class CatalogService {
  private readonly repository: CatalogRepository;
  private readonly prisma: PrismaClient;

  constructor(deps: { repository?: CatalogRepository; prisma?: PrismaClient } = {}) {
    this.repository = deps.repository ?? createCatalogRepository(deps.prisma ?? getPrisma());
    this.prisma = deps.prisma ?? this.repository.prisma ?? getPrisma();
  }

  private async withAdvisoryLock<T>(
    shopId: string,
    entity: string,
    parentId: string | undefined,
    fn: (repo: CatalogRepository) => Promise<T>,
  ): Promise<T> {
    const key = `${shopId}:${entity}:${parentId ?? ""}`;
    const hash = crypto.createHash("sha256").update(key).digest().readBigInt64BE(0);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${hash})`);
      const txRepo = createCatalogRepository(tx as unknown as PrismaClient);
      return fn(txRepo);
    });
  }

  // -------------------------------------------------------------------------
  // Lens Groups
  // -------------------------------------------------------------------------

  async listLensGroups(
    shopId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<CatalogLensGroupDto[]> {
    const groups = await this.repository.listLensGroups(shopId, options);
    return groups.map(mapLensGroupToDto);
  }

  async getLensGroup(shopId: string, id: string): Promise<CatalogLensGroupDto> {
    const group = await this.repository.getLensGroup(shopId, id);
    if (!group) {
      throw new NotFoundError("LensGroup not found");
    }
    return mapLensGroupToDto(group);
  }

  async createLensGroup(shopId: string, input: LensGroupInput): Promise<CatalogLensGroupDto> {
    const valid = validateInput(lensGroupInputSchema, input);

    return this.withAdvisoryLock(shopId, "lensGroup", undefined, async (repo) => {
      const existing = await repo.listLensGroups(shopId, { includeArchived: false });
      const duplicate = existing.some(
        (g) => g.name.trim().toLowerCase() === valid.name.trim().toLowerCase(),
      );
      if (duplicate) {
        throw new ValidationError("NAME_NOT_UNIQUE", "A lens group with this name already exists");
      }

      const created = await repo.createLensGroup(shopId, valid);
      return mapLensGroupToDto({ ...created, lenses: [] });
    });
  }

  async updateLensGroup(
    shopId: string,
    id: string,
    input: LensGroupUpdateInput,
  ): Promise<CatalogLensGroupDto> {
    const valid = validateInput(lensGroupUpdateSchema, input);

    const existing = await this.repository.getLensGroup(shopId, id);
    if (!existing) {
      throw new NotFoundError("LensGroup not found");
    }

    if (valid.name !== undefined) {
      return this.withAdvisoryLock(shopId, "lensGroup", undefined, async (repo) => {
        const allGroups = await repo.listLensGroups(shopId, { includeArchived: false });
        const duplicate = allGroups.some(
          (g) => g.id !== id && g.name.trim().toLowerCase() === valid.name!.trim().toLowerCase(),
        );
        if (duplicate) {
          throw new ValidationError("NAME_NOT_UNIQUE", "A lens group with this name already exists");
        }

        const updated = await repo.updateLensGroup(shopId, id, valid);
        return mapLensGroupToDto({ ...updated, lenses: existing.lenses });
      });
    }

    const updated = await this.repository.updateLensGroup(shopId, id, valid);
    return mapLensGroupToDto({ ...updated, lenses: existing.lenses });
  }

  async deleteLensGroup(shopId: string, id: string): Promise<CatalogLensGroupDto> {
    const existing = await this.repository.getLensGroup(shopId, id);
    if (!existing || existing.archivedAt) {
      throw new NotFoundError("LensGroup not found");
    }
    const activeLenses = (existing.lenses ?? []).filter((l) => !l.archivedAt);
    if (activeLenses.length > 0) {
      throw new ConflictError(
        "Cannot archive a group that still has active lenses. Archive its lenses first.",
        "GROUP_NOT_EMPTY",
      );
    }
    const deleted = await this.repository.deleteLensGroup(shopId, id);
    return mapLensGroupToDto({ ...deleted, lenses: existing.lenses });
  }

  async archiveLensGroup(shopId: string, id: string): Promise<CatalogLensGroupDto> {
    return this.deleteLensGroup(shopId, id);
  }

  async reorderLensGroups(shopId: string, ids: string[]): Promise<void> {
    validateInput(reorderSchema, { ids });
    await this.repository.reorderLensGroups(shopId, ids);
  }

  // -------------------------------------------------------------------------
  // Lenses
  // -------------------------------------------------------------------------

  async listLenses(
    shopId: string,
    options: { groupId?: string; includeArchived?: boolean } = {},
  ): Promise<CatalogLensDto[]> {
    const lenses = await this.repository.listLenses(shopId, options);
    return lenses.map(mapLensToDto);
  }

  async getLens(shopId: string, id: string): Promise<CatalogLensDto> {
    const lens = await this.repository.getLens(shopId, id);
    if (!lens) {
      throw new NotFoundError("Lens not found");
    }
    return mapLensToDto(lens);
  }

  async createLens(shopId: string, input: LensInput): Promise<CatalogLensDto> {
    const valid = validateInput(lensInputSchema, input);

    const priceMinor = valid.priceMinor;
    if (priceMinor === undefined) {
      throw new ValidationError("REQUIRED", "Price is required");
    }
    if (priceMinor < 0) {
      throw new ValidationError("NEGATIVE_PRICE");
    }
    if (valid.sphMin > valid.sphMax || valid.cylMin > valid.cylMax) {
      throw new ValidationError("LIMITS_INVERTED");
    }
    if (
      valid.addMin !== undefined &&
      valid.addMin !== null &&
      valid.addMax !== undefined &&
      valid.addMax !== null &&
      valid.addMin > valid.addMax
    ) {
      throw new ValidationError("LIMITS_INVERTED");
    }

    // Verify groupId exists and belongs to shopId and is not archived
    const group = await this.repository.getLensGroup(shopId, valid.groupId);
    if (!group || group.archivedAt) {
      throw new NotFoundError("LensGroup not found");
    }

    return this.withAdvisoryLock(shopId, "lens", valid.groupId, async (repo) => {
      const lockedGroup = await repo.getLensGroup(shopId, valid.groupId);
      if (!lockedGroup || lockedGroup.archivedAt) {
        throw new NotFoundError("LensGroup not found");
      }
      // Enforce unique name within groupId among active lenses
      const lensesInGroup = await repo.listLenses(shopId, {
        groupId: valid.groupId,
        includeArchived: false,
      });
      const duplicate = lensesInGroup.some(
        (l) => l.name.trim().toLowerCase() === valid.name.trim().toLowerCase(),
      );
      if (duplicate) {
        throw new ValidationError("NAME_NOT_UNIQUE", "A lens with this name already exists in this group");
      }

      const created = await repo.createLens(shopId, {
        groupId: valid.groupId,
        name: valid.name,
        description: valid.description,
        priceMinor,
        currency: valid.currency ?? "USD",
        rxTypes: valid.rxTypes as RxType[],
        sphMin: valid.sphMin,
        sphMax: valid.sphMax,
        cylMin: valid.cylMin,
        cylMax: valid.cylMax,
        addMin: valid.addMin,
        addMax: valid.addMax,
        labCodeTemplate: valid.labCodeTemplate,
        shopifyProductId: valid.shopifyProductId,
        shopifyVariantId: valid.shopifyVariantId,
        position: valid.position,
      });

      return mapLensToDto(created);
    });
  }

  async updateLens(
    shopId: string,
    id: string,
    input: LensUpdateInput,
  ): Promise<CatalogLensDto> {
    const valid = validateInput(lensUpdateSchema, input);

    const existing = await this.repository.getLens(shopId, id);
    if (!existing || existing.archivedAt) {
      throw new NotFoundError("Lens not found");
    }

    const targetGroupId = valid.groupId ?? existing.groupId;
    if (valid.groupId !== undefined) {
      const group = await this.repository.getLensGroup(shopId, valid.groupId);
      if (!group || group.archivedAt) {
        throw new NotFoundError("LensGroup not found");
      }
    }

    // Check merged limits
    const mergedSphMin = valid.sphMin ?? existing.sphMin;
    const mergedSphMax = valid.sphMax ?? existing.sphMax;
    if (mergedSphMin > mergedSphMax) {
      throw new ValidationError("LIMITS_INVERTED");
    }

    const mergedCylMin = valid.cylMin ?? existing.cylMin;
    const mergedCylMax = valid.cylMax ?? existing.cylMax;
    if (mergedCylMin > mergedCylMax) {
      throw new ValidationError("LIMITS_INVERTED");
    }

    const targetRxTypes = (valid.rxTypes ?? existing.rxTypes) as RxType[];
    const supportsAdd =
      targetRxTypes.includes("PROGRESSIVE") || targetRxTypes.includes("READING");

    let addMinToSave = valid.addMin;
    let addMaxToSave = valid.addMax;
    if (!supportsAdd && valid.rxTypes !== undefined) {
      if (addMinToSave === undefined) addMinToSave = null;
      if (addMaxToSave === undefined) addMaxToSave = null;
    }

    const mergedAddMin = addMinToSave !== undefined ? addMinToSave : existing.addMin;
    const mergedAddMax = addMaxToSave !== undefined ? addMaxToSave : existing.addMax;
    if (
      mergedAddMin !== null &&
      mergedAddMin !== undefined &&
      mergedAddMax !== null &&
      mergedAddMax !== undefined &&
      mergedAddMin > mergedAddMax
    ) {
      throw new ValidationError("LIMITS_INVERTED");
    }

    // Check merged price
    const priceMinor = valid.priceMinor;
    if (priceMinor !== undefined && priceMinor < 0) {
      throw new ValidationError("NEGATIVE_PRICE");
    }

    const updateData = {
      groupId: valid.groupId,
      name: valid.name,
      description: valid.description,
      priceMinor,
      currency: valid.currency,
      rxTypes: valid.rxTypes as RxType[] | undefined,
      sphMin: valid.sphMin,
      sphMax: valid.sphMax,
      cylMin: valid.cylMin,
      cylMax: valid.cylMax,
      addMin: addMinToSave,
      addMax: addMaxToSave,
      labCodeTemplate: valid.labCodeTemplate,
      shopifyProductId: valid.shopifyProductId,
      shopifyVariantId: valid.shopifyVariantId,
      position: valid.position,
    };

    if (valid.name !== undefined || (valid.groupId && valid.groupId !== existing.groupId)) {
      const targetName = valid.name ?? existing.name;
      return this.withAdvisoryLock(shopId, "lens", targetGroupId, async (repo) => {
        if (valid.groupId !== undefined) {
          const group = await repo.getLensGroup(shopId, valid.groupId);
          if (!group || group.archivedAt) {
            throw new NotFoundError("LensGroup not found");
          }
        }
        const lensesInGroup = await repo.listLenses(shopId, {
          groupId: targetGroupId,
          includeArchived: false,
        });
        const duplicate = lensesInGroup.some(
          (l) => l.id !== id && l.name.trim().toLowerCase() === targetName.trim().toLowerCase(),
        );
        if (duplicate) {
          throw new ValidationError("NAME_NOT_UNIQUE", "A lens with this name already exists in this group");
        }

        const updated = await repo.updateLens(shopId, id, updateData);
        return mapLensToDto(updated);
      });
    }

    const updated = await this.repository.updateLens(shopId, id, updateData);
    return mapLensToDto(updated);
  }

  async deleteLens(shopId: string, id: string): Promise<CatalogLensDto> {
    const existing = await this.repository.getLens(shopId, id);
    if (!existing) {
      throw new NotFoundError("Lens not found");
    }
    const deleted = await this.repository.deleteLens(shopId, id);
    return mapLensToDto(deleted);
  }

  async archiveLens(shopId: string, id: string): Promise<CatalogLensDto> {
    return this.deleteLens(shopId, id);
  }

  async reorderLenses(
    shopId: string,
    ids: string[],
    groupId?: string,
  ): Promise<void> {
    validateInput(reorderSchema, { ids });
    await this.repository.reorderLenses(shopId, ids, groupId);
  }

  // -------------------------------------------------------------------------
  // Option Groups
  // -------------------------------------------------------------------------

  async listOptionGroups(
    shopId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<CatalogOptionGroupDto[]> {
    const groups = await this.repository.listOptionGroups(shopId, options);
    return groups.map(mapOptionGroupToDto);
  }

  async getOptionGroup(shopId: string, id: string): Promise<CatalogOptionGroupDto> {
    const group = await this.repository.getOptionGroup(shopId, id);
    if (!group) {
      throw new NotFoundError("OptionGroup not found");
    }
    return mapOptionGroupToDto(group);
  }

  async createOptionGroup(
    shopId: string,
    input: OptionGroupInput,
  ): Promise<CatalogOptionGroupDto> {
    const valid = validateInput(optionGroupInputSchema, input);

    return this.withAdvisoryLock(shopId, "optionGroup", undefined, async (repo) => {
      const existing = await repo.listOptionGroups(shopId, { includeArchived: false });
      const duplicate = existing.some(
        (g) => g.name.trim().toLowerCase() === valid.name.trim().toLowerCase(),
      );
      if (duplicate) {
        throw new ValidationError("NAME_NOT_UNIQUE", "An option group with this name already exists");
      }

      const created = await repo.createOptionGroup(shopId, valid);
      return mapOptionGroupToDto({ ...created, values: [] });
    });
  }

  async updateOptionGroup(
    shopId: string,
    id: string,
    input: OptionGroupUpdateInput,
  ): Promise<CatalogOptionGroupDto> {
    const valid = validateInput(optionGroupUpdateSchema, input);

    const existing = await this.repository.getOptionGroup(shopId, id);
    if (!existing) {
      throw new NotFoundError("OptionGroup not found");
    }

    if (valid.name !== undefined) {
      return this.withAdvisoryLock(shopId, "optionGroup", undefined, async (repo) => {
        const allGroups = await repo.listOptionGroups(shopId, { includeArchived: false });
        const duplicate = allGroups.some(
          (g) => g.id !== id && g.name.trim().toLowerCase() === valid.name!.trim().toLowerCase(),
        );
        if (duplicate) {
          throw new ValidationError("NAME_NOT_UNIQUE", "An option group with this name already exists");
        }

        const updated = await repo.updateOptionGroup(shopId, id, valid);
        return mapOptionGroupToDto({ ...updated, values: existing.values });
      });
    }

    const updated = await this.repository.updateOptionGroup(shopId, id, valid);
    return mapOptionGroupToDto({ ...updated, values: existing.values });
  }

  async deleteOptionGroup(shopId: string, id: string): Promise<CatalogOptionGroupDto> {
    const existing = await this.repository.getOptionGroup(shopId, id);
    if (!existing) {
      throw new NotFoundError("OptionGroup not found");
    }
    const deleted = await this.repository.deleteOptionGroup(shopId, id);
    return mapOptionGroupToDto({ ...deleted, values: existing.values });
  }

  async archiveOptionGroup(shopId: string, id: string): Promise<CatalogOptionGroupDto> {
    return this.deleteOptionGroup(shopId, id);
  }

  async reorderOptionGroups(shopId: string, ids: string[]): Promise<void> {
    validateInput(reorderSchema, { ids });
    await this.repository.reorderOptionGroups(shopId, ids);
  }

  // -------------------------------------------------------------------------
  // Option Values
  // -------------------------------------------------------------------------

  async listOptionValues(
    shopId: string,
    options: { optionGroupId?: string; includeArchived?: boolean } = {},
  ): Promise<CatalogOptionValueDto[]> {
    const values = await this.repository.listOptionValues(shopId, options);
    return values.map(mapOptionValueToDto);
  }

  async getOptionValue(shopId: string, id: string): Promise<CatalogOptionValueDto> {
    const val = await this.repository.getOptionValue(shopId, id);
    if (!val) {
      throw new NotFoundError("OptionValue not found");
    }
    return mapOptionValueToDto(val);
  }

  async createOptionValue(
    shopId: string,
    input: OptionValueInput,
  ): Promise<CatalogOptionValueDto> {
    const valid = validateInput(optionValueInputSchema, input);

    const delta = valid.priceDeltaMinor ?? 0;
    if (delta < 0) {
      throw new ValidationError("NEGATIVE_PRICE");
    }

    const hasToken = Boolean(valid.tokenKey || valid.tokenValue);
    const hasOverride = Boolean(valid.overrideCode);
    if (hasToken && hasOverride) {
      throw new ValidationError("ONE_CODE_SOURCE");
    }

    const group = await this.repository.getOptionGroup(shopId, valid.optionGroupId);
    if (!group) {
      throw new NotFoundError("OptionGroup not found");
    }

    return this.withAdvisoryLock(shopId, "optionValue", valid.optionGroupId, async (repo) => {
      const existingValues = await repo.listOptionValues(shopId, {
        optionGroupId: valid.optionGroupId,
        includeArchived: false,
      });
      const duplicate = existingValues.some(
        (v) => v.label.trim().toLowerCase() === valid.label.trim().toLowerCase(),
      );
      if (duplicate) {
        throw new ValidationError(
          "NAME_NOT_UNIQUE",
          "An option value with this label already exists in this group",
        );
      }

      const created = await repo.createOptionValue(shopId, {
        optionGroupId: valid.optionGroupId,
        label: valid.label,
        priceDeltaMinor: delta,
        currency: valid.currency ?? "USD",
        tokenKey: valid.tokenKey,
        tokenValue: valid.tokenValue,
        overrideCode: valid.overrideCode,
        swatch: valid.swatch,
        shopifyVariantId: valid.shopifyVariantId,
        position: valid.position,
      });

      return mapOptionValueToDto(created);
    });
  }

  async updateOptionValue(
    shopId: string,
    id: string,
    input: OptionValueUpdateInput,
  ): Promise<CatalogOptionValueDto> {
    const valid = validateInput(optionValueUpdateSchema, input);

    const existing = await this.repository.getOptionValue(shopId, id);
    if (!existing) {
      throw new NotFoundError("OptionValue not found");
    }

    const targetGroupId = valid.optionGroupId ?? existing.optionGroupId;
    if (valid.optionGroupId && valid.optionGroupId !== existing.optionGroupId) {
      const group = await this.repository.getOptionGroup(shopId, valid.optionGroupId);
      if (!group) {
        throw new NotFoundError("OptionGroup not found");
      }
    }

    const delta = valid.priceDeltaMinor;
    if (delta !== undefined && delta < 0) {
      throw new ValidationError("NEGATIVE_PRICE");
    }

    // Check token vs override on merged state
    const tokenKey = valid.tokenKey !== undefined ? valid.tokenKey : existing.tokenKey;
    const tokenValue = valid.tokenValue !== undefined ? valid.tokenValue : existing.tokenValue;
    const overrideCode = valid.overrideCode !== undefined ? valid.overrideCode : existing.overrideCode;
    const hasToken = Boolean(tokenKey || tokenValue);
    const hasOverride = Boolean(overrideCode);
    if (hasToken && hasOverride) {
      throw new ValidationError("ONE_CODE_SOURCE");
    }

    const updateData = {
      optionGroupId: valid.optionGroupId,
      label: valid.label,
      priceDeltaMinor: delta,
      currency: valid.currency,
      tokenKey: valid.tokenKey,
      tokenValue: valid.tokenValue,
      overrideCode: valid.overrideCode,
      swatch: valid.swatch,
      shopifyVariantId: valid.shopifyVariantId,
      position: valid.position,
    };

    if (valid.label !== undefined || (valid.optionGroupId && valid.optionGroupId !== existing.optionGroupId)) {
      const targetLabel = valid.label ?? existing.label;
      return this.withAdvisoryLock(shopId, "optionValue", targetGroupId, async (repo) => {
        const existingValues = await repo.listOptionValues(shopId, {
          optionGroupId: targetGroupId,
          includeArchived: false,
        });
        const duplicate = existingValues.some(
          (v) => v.id !== id && v.label.trim().toLowerCase() === targetLabel.trim().toLowerCase(),
        );
        if (duplicate) {
          throw new ValidationError(
            "NAME_NOT_UNIQUE",
            "An option value with this label already exists in this group",
          );
        }

        const updated = await repo.updateOptionValue(shopId, id, updateData);
        return mapOptionValueToDto(updated);
      });
    }

    const updated = await this.repository.updateOptionValue(shopId, id, updateData);
    return mapOptionValueToDto(updated);
  }

  async deleteOptionValue(shopId: string, id: string): Promise<CatalogOptionValueDto> {
    const existing = await this.repository.getOptionValue(shopId, id);
    if (!existing) {
      throw new NotFoundError("OptionValue not found");
    }
    const deleted = await this.repository.deleteOptionValue(shopId, id);
    return mapOptionValueToDto(deleted);
  }

  async archiveOptionValue(shopId: string, id: string): Promise<CatalogOptionValueDto> {
    return this.deleteOptionValue(shopId, id);
  }

  async reorderOptionValues(
    shopId: string,
    ids: string[],
    optionGroupId?: string,
  ): Promise<void> {
    validateInput(reorderSchema, { ids });
    await this.repository.reorderOptionValues(shopId, ids, optionGroupId);
  }

  // -------------------------------------------------------------------------
  // Add-Ons
  // -------------------------------------------------------------------------

  async listAddOns(
    shopId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<CatalogAddOnDto[]> {
    const addOns = await this.repository.listAddOns(shopId, options);
    return addOns.map(mapAddOnToDto);
  }

  async getAddOn(shopId: string, id: string): Promise<CatalogAddOnDto> {
    const addOn = await this.repository.getAddOn(shopId, id);
    if (!addOn) {
      throw new NotFoundError("AddOn not found");
    }
    return mapAddOnToDto(addOn);
  }

  async createAddOn(shopId: string, input: AddOnInput): Promise<CatalogAddOnDto> {
    const valid = validateInput(addOnInputSchema, input);

    const priceMinor = valid.priceMinor;
    if (priceMinor === undefined) {
      throw new ValidationError("REQUIRED", "Price is required");
    }
    if (priceMinor < 0) {
      throw new ValidationError("NEGATIVE_PRICE");
    }

    return this.withAdvisoryLock(shopId, "addOn", undefined, async (repo) => {
      const existing = await repo.listAddOns(shopId, { includeArchived: false });
      const duplicate = existing.some(
        (a) => a.name.trim().toLowerCase() === valid.name.trim().toLowerCase(),
      );
      if (duplicate) {
        throw new ValidationError("NAME_NOT_UNIQUE", "An add-on with this name already exists");
      }

      const created = await repo.createAddOn(shopId, {
        name: valid.name,
        priceMinor,
        currency: valid.currency ?? "USD",
        shopifyProductId: valid.shopifyProductId,
        shopifyVariantId: valid.shopifyVariantId,
        position: valid.position,
      });

      return mapAddOnToDto(created);
    });
  }

  async updateAddOn(
    shopId: string,
    id: string,
    input: AddOnUpdateInput,
  ): Promise<CatalogAddOnDto> {
    const valid = validateInput(addOnUpdateSchema, input);

    const existing = await this.repository.getAddOn(shopId, id);
    if (!existing) {
      throw new NotFoundError("AddOn not found");
    }

    const priceMinor = valid.priceMinor;
    if (priceMinor !== undefined && priceMinor < 0) {
      throw new ValidationError("NEGATIVE_PRICE");
    }

    const updateData = {
      name: valid.name,
      priceMinor,
      currency: valid.currency,
      shopifyProductId: valid.shopifyProductId,
      shopifyVariantId: valid.shopifyVariantId,
      position: valid.position,
    };

    if (valid.name !== undefined) {
      return this.withAdvisoryLock(shopId, "addOn", undefined, async (repo) => {
        const allAddOns = await repo.listAddOns(shopId, { includeArchived: false });
        const duplicate = allAddOns.some(
          (a) => a.id !== id && a.name.trim().toLowerCase() === valid.name!.trim().toLowerCase(),
        );
        if (duplicate) {
          throw new ValidationError("NAME_NOT_UNIQUE", "An add-on with this name already exists");
        }

        const updated = await repo.updateAddOn(shopId, id, updateData);
        return mapAddOnToDto(updated);
      });
    }

    const updated = await this.repository.updateAddOn(shopId, id, updateData);
    return mapAddOnToDto(updated);
  }

  async deleteAddOn(shopId: string, id: string): Promise<CatalogAddOnDto> {
    const existing = await this.repository.getAddOn(shopId, id);
    if (!existing) {
      throw new NotFoundError("AddOn not found");
    }
    const deleted = await this.repository.deleteAddOn(shopId, id);
    return mapAddOnToDto(deleted);
  }

  async archiveAddOn(shopId: string, id: string): Promise<CatalogAddOnDto> {
    return this.deleteAddOn(shopId, id);
  }

  async reorderAddOns(shopId: string, ids: string[]): Promise<void> {
    validateInput(reorderSchema, { ids });
    await this.repository.reorderAddOns(shopId, ids);
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
  ): Promise<CatalogLensDto | CatalogOptionValueDto | CatalogAddOnDto> {
    const updated = await this.repository.markSynced(
      shopId,
      entity,
      id,
      variantId,
      productId,
    );

    if (entity === "lens") {
      return mapLensToDto(updated as PrismaLens);
    }
    if (entity === "optionValue") {
      return mapOptionValueToDto(updated as PrismaOptionValue);
    }
    if (entity === "addOn") {
      return mapAddOnToDto(updated as PrismaAddOn);
    }
    throw new NotFoundError(`Unknown entity type: ${String(entity)}`);
  }

  // -------------------------------------------------------------------------
  // Storefront Catalog
  // -------------------------------------------------------------------------

  async getStorefrontCatalog(shopId: string): Promise<CatalogResponse> {
    const data = await this.repository.getStorefrontCatalogData(shopId);

    const lensGroups: StorefrontLensGroup[] = data.lensGroups.map((group) => {
      // Exclude archived lenses and lenses without shopifyVariantId
      const lenses: StorefrontLens[] = group.lenses
        .filter((lens) => lens.archivedAt === null && lens.shopifyVariantId !== null)
        .map((lens) => ({
          id: lens.id,
          groupId: lens.groupId,
          name: lens.name,
          description: lens.description || undefined,
          price: {
            amountMinor: lens.priceMinor,
            currency: lens.currency,
          },
          limits: {
            sphMin: lens.sphMin,
            sphMax: lens.sphMax,
            cylMin: lens.cylMin,
            cylMax: lens.cylMax,
            ...(lens.addMin !== null && lens.addMin !== undefined ? { addMin: lens.addMin } : {}),
            ...(lens.addMax !== null && lens.addMax !== undefined ? { addMax: lens.addMax } : {}),
            rxTypes: lens.rxTypes as RxType[],
          },
          labCodeTemplate: lens.labCodeTemplate,
          shopifyVariantId: lens.shopifyVariantId!,
          position: lens.position,
        }));

      return {
        id: group.id,
        name: group.name,
        description: group.description || undefined,
        position: group.position,
        lenses,
      };
    });

    const optionGroups: StorefrontOptionGroup[] = data.optionGroups.map((group) => {
      // Exclude archived option values, and exclude priced option values with no variant id
      const values: StorefrontOptionValue[] = group.values
        .filter((val) => {
          if (val.archivedAt !== null) return false;
          if (val.priceDeltaMinor > 0 && !val.shopifyVariantId) return false;
          return true;
        })
        .map((val) => ({
          id: val.id,
          optionGroupId: val.optionGroupId,
          label: val.label,
          priceDelta: {
            amountMinor: val.priceDeltaMinor,
            currency: val.currency,
          },
          tokenKey: val.tokenKey ?? undefined,
          tokenValue: val.tokenValue ?? undefined,
          overrideCode: val.overrideCode ?? undefined,
          swatch: val.swatch ?? undefined,
          shopifyVariantId: val.shopifyVariantId ?? undefined,
          position: val.position,
        }));

      return {
        id: group.id,
        kind: group.kind as OptionGroupKind,
        name: group.name,
        position: group.position,
        values,
      };
    });

    // Exclude archived add-ons and add-ons without shopifyVariantId
    const addOns: StorefrontAddOn[] = data.addOns
      .filter((a) => a.archivedAt === null && a.shopifyVariantId !== null)
      .map((a) => ({
        id: a.id,
        name: a.name,
        price: {
          amountMinor: a.priceMinor,
          currency: a.currency,
        },
        shopifyVariantId: a.shopifyVariantId!,
        position: a.position,
      }));

    const settings: CatalogSettings = data.settings
      ? {
          manualRxEnabled: data.settings.manualRxEnabled,
          rxUploadEnabled: data.settings.rxUploadEnabled,
          storeRxInOrder: data.settings.storeRxInOrder,
        }
      : {
          manualRxEnabled: true,
          rxUploadEnabled: true,
          storeRxInOrder: false,
        };

    const responseDto: CatalogResponse = {
      lensGroups,
      optionGroups,
      addOns,
      settings,
    };

    return catalogResponseSchema.parse(responseDto);
  }
}

export function createCatalogService(
  deps: { repository?: CatalogRepository; prisma?: PrismaClient } = {},
): CatalogService {
  return new CatalogService(deps);
}

// ---------------------------------------------------------------------------
// Standalone Service Functions
// ---------------------------------------------------------------------------

export async function getStorefrontCatalog(
  shopId: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogResponse> {
  return createCatalogService(deps).getStorefrontCatalog(shopId);
}

export async function markSynced(
  shopId: string,
  entity: CatalogEntity,
  id: string,
  variantId: string,
  productId?: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensDto | CatalogOptionValueDto | CatalogAddOnDto> {
  return createCatalogService(deps).markSynced(shopId, entity, id, variantId, productId);
}

export async function listLensGroups(
  shopId: string,
  options?: { includeArchived?: boolean },
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensGroupDto[]> {
  return createCatalogService(deps).listLensGroups(shopId, options);
}

export async function getLensGroup(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensGroupDto> {
  return createCatalogService(deps).getLensGroup(shopId, id);
}

export async function createLensGroup(
  shopId: string,
  input: LensGroupInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensGroupDto> {
  return createCatalogService(deps).createLensGroup(shopId, input);
}

export async function updateLensGroup(
  shopId: string,
  id: string,
  input: LensGroupUpdateInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensGroupDto> {
  return createCatalogService(deps).updateLensGroup(shopId, id, input);
}

export async function deleteLensGroup(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensGroupDto> {
  return createCatalogService(deps).deleteLensGroup(shopId, id);
}

export async function archiveLensGroup(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensGroupDto> {
  return createCatalogService(deps).archiveLensGroup(shopId, id);
}

export async function reorderLensGroups(
  shopId: string,
  ids: string[],
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<void> {
  return createCatalogService(deps).reorderLensGroups(shopId, ids);
}

export async function listLenses(
  shopId: string,
  options?: { groupId?: string; includeArchived?: boolean },
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensDto[]> {
  return createCatalogService(deps).listLenses(shopId, options);
}

export async function getLens(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensDto> {
  return createCatalogService(deps).getLens(shopId, id);
}

export async function createLens(
  shopId: string,
  input: LensInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensDto> {
  return createCatalogService(deps).createLens(shopId, input);
}

export async function updateLens(
  shopId: string,
  id: string,
  input: LensUpdateInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensDto> {
  return createCatalogService(deps).updateLens(shopId, id, input);
}

export async function deleteLens(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensDto> {
  return createCatalogService(deps).deleteLens(shopId, id);
}

export async function archiveLens(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogLensDto> {
  return createCatalogService(deps).archiveLens(shopId, id);
}

export async function reorderLenses(
  shopId: string,
  ids: string[],
  groupId?: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<void> {
  return createCatalogService(deps).reorderLenses(shopId, ids, groupId);
}

export async function listOptionGroups(
  shopId: string,
  options?: { includeArchived?: boolean },
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionGroupDto[]> {
  return createCatalogService(deps).listOptionGroups(shopId, options);
}

export async function getOptionGroup(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionGroupDto> {
  return createCatalogService(deps).getOptionGroup(shopId, id);
}

export async function createOptionGroup(
  shopId: string,
  input: OptionGroupInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionGroupDto> {
  return createCatalogService(deps).createOptionGroup(shopId, input);
}

export async function updateOptionGroup(
  shopId: string,
  id: string,
  input: OptionGroupUpdateInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionGroupDto> {
  return createCatalogService(deps).updateOptionGroup(shopId, id, input);
}

export async function deleteOptionGroup(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionGroupDto> {
  return createCatalogService(deps).deleteOptionGroup(shopId, id);
}

export async function archiveOptionGroup(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionGroupDto> {
  return createCatalogService(deps).archiveOptionGroup(shopId, id);
}

export async function reorderOptionGroups(
  shopId: string,
  ids: string[],
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<void> {
  return createCatalogService(deps).reorderOptionGroups(shopId, ids);
}

export async function listOptionValues(
  shopId: string,
  options?: { optionGroupId?: string; includeArchived?: boolean },
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionValueDto[]> {
  return createCatalogService(deps).listOptionValues(shopId, options);
}

export async function getOptionValue(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionValueDto> {
  return createCatalogService(deps).getOptionValue(shopId, id);
}

export async function createOptionValue(
  shopId: string,
  input: OptionValueInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionValueDto> {
  return createCatalogService(deps).createOptionValue(shopId, input);
}

export async function updateOptionValue(
  shopId: string,
  id: string,
  input: OptionValueUpdateInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionValueDto> {
  return createCatalogService(deps).updateOptionValue(shopId, id, input);
}

export async function deleteOptionValue(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionValueDto> {
  return createCatalogService(deps).deleteOptionValue(shopId, id);
}

export async function archiveOptionValue(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogOptionValueDto> {
  return createCatalogService(deps).archiveOptionValue(shopId, id);
}

export async function reorderOptionValues(
  shopId: string,
  ids: string[],
  optionGroupId?: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<void> {
  return createCatalogService(deps).reorderOptionValues(shopId, ids, optionGroupId);
}

export async function listAddOns(
  shopId: string,
  options?: { includeArchived?: boolean },
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogAddOnDto[]> {
  return createCatalogService(deps).listAddOns(shopId, options);
}

export async function getAddOn(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogAddOnDto> {
  return createCatalogService(deps).getAddOn(shopId, id);
}

export async function createAddOn(
  shopId: string,
  input: AddOnInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogAddOnDto> {
  return createCatalogService(deps).createAddOn(shopId, input);
}

export async function updateAddOn(
  shopId: string,
  id: string,
  input: AddOnUpdateInput,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogAddOnDto> {
  return createCatalogService(deps).updateAddOn(shopId, id, input);
}

export async function deleteAddOn(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogAddOnDto> {
  return createCatalogService(deps).deleteAddOn(shopId, id);
}

export async function archiveAddOn(
  shopId: string,
  id: string,
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<CatalogAddOnDto> {
  return createCatalogService(deps).archiveAddOn(shopId, id);
}

export async function reorderAddOns(
  shopId: string,
  ids: string[],
  deps?: { repository?: CatalogRepository; prisma?: PrismaClient },
): Promise<void> {
  return createCatalogService(deps).reorderAddOns(shopId, ids);
}
