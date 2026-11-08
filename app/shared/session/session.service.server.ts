import type { PrismaClient, Session } from "@prisma/client";

import { getPrisma } from "../container/prisma.server";
import {
  findSessionById,
  updateSessionScopeInDb,
} from "./session.repository.server";

export interface SessionServiceDeps {
  prisma?: PrismaClient;
}

export interface UpdateSessionScopeOptions {
  shop?: string;
  deps?: SessionServiceDeps;
}

export interface SessionService {
  updateSessionScope(
    sessionId: string,
    scopes: string[] | string,
    options?: UpdateSessionScopeOptions | string,
  ): Promise<{ count: number }>;
  getSession(
    sessionId: string,
    shop?: string,
  ): Promise<Session | null>;
}

export function createSessionService(deps: SessionServiceDeps = {}): SessionService {
  const getClient = () => deps.prisma ?? getPrisma();

  return {
    async updateSessionScope(
      sessionId: string,
      scopes: string[] | string,
      options?: UpdateSessionScopeOptions | string,
    ): Promise<{ count: number }> {
      const shop = typeof options === "string" ? options : options?.shop;
      const scopeStr = Array.isArray(scopes) ? scopes.join(",") : scopes;
      return updateSessionScopeInDb(getClient(), {
        sessionId,
        scope: scopeStr,
        shop,
      });
    },

    async getSession(
      sessionId: string,
      shop?: string,
    ): Promise<Session | null> {
      return findSessionById(getClient(), sessionId, shop);
    },
  };
}

export async function updateSessionScope(
  sessionId: string,
  scopes: string[] | string,
  options?: UpdateSessionScopeOptions | string,
): Promise<{ count: number }> {
  const deps = typeof options === "object" ? options?.deps : undefined;
  return createSessionService(deps).updateSessionScope(sessionId, scopes, options);
}

export async function getSession(
  sessionId: string,
  shop?: string,
  deps?: SessionServiceDeps,
): Promise<Session | null> {
  return createSessionService(deps).getSession(sessionId, shop);
}
