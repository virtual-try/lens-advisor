import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../container/prisma.server";
import { updateSessionScopeInDb } from "./session.repository.server";

export interface SessionServiceDeps {
  prisma?: PrismaClient;
}

export interface UpdateSessionScopeOptions {
  shop: string;
  deps?: SessionServiceDeps;
}

export interface SessionService {
  updateSessionScope(
    sessionId: string,
    scopes: string[] | string,
    options: UpdateSessionScopeOptions | string,
  ): Promise<{ count: number }>;
}

export function createSessionService(deps: SessionServiceDeps = {}): SessionService {
  const getClient = () => deps.prisma ?? getPrisma();

  return {
    async updateSessionScope(
      sessionId: string,
      scopes: string[] | string,
      options: UpdateSessionScopeOptions | string,
    ): Promise<{ count: number }> {
      const shop = typeof options === "string" ? options : options?.shop;
      if (!shop || typeof shop !== "string" || !shop.trim()) {
        throw new Error("shop is required to update session scope (INV-1)");
      }
      const scopeStr = Array.isArray(scopes) ? scopes.join(",") : scopes;
      return updateSessionScopeInDb(getClient(), {
        sessionId,
        scope: scopeStr,
        shop,
      });
    },
  };
}

export async function updateSessionScope(
  sessionId: string,
  scopes: string[] | string,
  options: UpdateSessionScopeOptions | string,
): Promise<{ count: number }> {
  const deps = typeof options === "object" ? options?.deps : undefined;
  return createSessionService(deps).updateSessionScope(sessionId, scopes, options);
}
