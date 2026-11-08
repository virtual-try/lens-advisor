import type { Prisma, PrismaClient, Session } from "@prisma/client";

export type SessionDb = PrismaClient | Prisma.TransactionClient;

export interface UpdateSessionScopeInput {
  sessionId: string;
  scope: string;
  shop?: string;
}

/**
 * Updates the scope of a session by ID, optionally scoped to a shop domain (INV-1).
 */
export async function updateSessionScopeInDb(
  db: SessionDb,
  input: UpdateSessionScopeInput,
): Promise<{ count: number }> {
  const { sessionId, scope, shop } = input;
  const result = await db.session.updateMany({
    where: {
      id: sessionId,
      ...(shop ? { shop } : {}),
    },
    data: {
      scope,
    },
  });
  return result;
}

/**
 * Finds a session by ID, optionally scoped to a shop domain.
 */
export async function findSessionById(
  db: SessionDb,
  sessionId: string,
  shop?: string,
): Promise<Session | null> {
  return db.session.findFirst({
    where: {
      id: sessionId,
      ...(shop ? { shop } : {}),
    },
  });
}
