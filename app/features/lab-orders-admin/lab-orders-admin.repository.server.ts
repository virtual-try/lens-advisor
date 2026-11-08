import type {
  LabOrder,
  LabOrderStatus,
  OptionGroup,
  OptionValue,
  Prisma,
  PrismaClient,
  RxSource,
  RxType,
} from "@prisma/client";
import { getPrisma } from "../../shared/container/prisma.server";

export type LabOrdersAdminDb = PrismaClient | Prisma.TransactionClient;

export interface ListLabOrdersOptions {
  cursor?: string;
  limit?: number;
  status?: LabOrderStatus;
}

export interface LabOrderListItem extends LabOrder {
  lens: {
    id: string;
    name: string;
  } | null;
}

export interface ListLabOrdersResult {
  items: LabOrderListItem[];
  hasNext: boolean;
  nextCursor: string | null;
}

export interface OptionValueWithGroup extends OptionValue {
  optionGroup: Pick<OptionGroup, "name" | "kind">;
}

export interface PrescriptionSummary {
  id: string;
  rxType: RxType;
  source: RxSource;
  uploadKeys: string[];
  createdAt: Date;
}

export interface LabOrderDetail extends LabOrder {
  lens: {
    id: string;
    name: string;
    description: string | null;
  } | null;
  prescription: PrescriptionSummary | null;
  optionValues: OptionValueWithGroup[];
  addOns: {
    id: string;
    name: string;
    priceMinor: number;
    currency: string;
  }[];
}

/**
 * Lists lab orders for a given shop, newest first, 50 per page by default with cursor-based pagination.
 * Scoped strictly to shopId (INV-1).
 */
export async function listLabOrders(
  shopId: string,
  options: ListLabOrdersOptions = {},
  db?: LabOrdersAdminDb,
): Promise<ListLabOrdersResult> {
  const client = db ?? getPrisma();
  const limit = options.limit ?? 50;

  // Validate cursor belongs to this shop (INV-1, R1-F7)
  if (options.cursor) {
    const cursorRecord = await client.labOrder.findFirst({
      where: { id: options.cursor, shopId },
      select: { id: true },
    });
    if (!cursorRecord) {
      return {
        items: [],
        hasNext: false,
        nextCursor: null,
      };
    }
  }

  const where: Prisma.LabOrderWhereInput = {
    shopId,
    ...(options.status ? { status: options.status } : {}),
  };

  const rows = await client.labOrder.findMany({
    where,
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      lens: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const nextCursor = hasNext && items.length > 0 ? items[items.length - 1].id : null;

  return {
    items,
    hasNext,
    nextCursor,
  };
}

/**
 * Loads a single lab order detail scoped strictly to shopId (INV-1).
 * Never loads prescription cipher (INV-2).
 * Returns null if not found or belongs to another shop.
 */
export async function getLabOrderDetail(
  shopId: string,
  labOrderId: string,
  db?: LabOrdersAdminDb,
): Promise<LabOrderDetail | null> {
  const client = db ?? getPrisma();

  const order = await client.labOrder.findFirst({
    where: {
      id: labOrderId,
      shopId,
    },
    include: {
      lens: {
        select: {
          id: true,
          name: true,
          description: true,
        },
      },
      prescription: {
        select: {
          id: true,
          rxType: true,
          source: true,
          uploadKeys: true,
          createdAt: true,
        },
      },
    },
  });

  if (!order) {
    return null;
  }

  const optionValues =
    order.optionValueIds.length > 0
      ? await client.optionValue.findMany({
          where: {
            shopId,
            id: { in: order.optionValueIds },
          },
          include: {
            optionGroup: {
              select: {
                name: true,
                kind: true,
              },
            },
          },
        })
      : [];

  const addOns =
    order.addOnIds.length > 0
      ? await client.addOn.findMany({
          where: {
            shopId,
            id: { in: order.addOnIds },
          },
          select: {
            id: true,
            name: true,
            priceMinor: true,
            currency: true,
          },
        })
      : [];

  return {
    ...order,
    optionValues,
    addOns,
  };
}
