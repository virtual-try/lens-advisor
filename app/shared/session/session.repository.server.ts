import type { Prisma, PrismaClient } from "@prisma/client";

export type SessionDb = PrismaClient | Prisma.TransactionClient;

export interface UpdateSessionScopeInput {
  sessionId: string;
  scope: string;
  shop: string;
}

/**
 * Updates the scope of a session by ID scoped strictly to a shop domain (INV-1).
 */
export async function updateSessionScopeInDb(
  db: SessionDb,
  input: UpdateSessionScopeInput,
): Promise<{ count: number }> {
  const { sessionId, scope, shop } = input;
  if (!shop || typeof shop !== "string" || !shop.trim()) {
    throw new Error("shop is required to update session scope (INV-1)");
  }
  const result = await db.session.updateMany({
    where: {
      id: sessionId,
      shop,
    },
    data: {
      scope,
    },
  });
  return result;
}
