import { PrismaClient } from "@prisma/client";
import { getConfig } from "../config.server";

declare global {
  var __prismaClient: PrismaClient | undefined;
}

export function getPrisma(): PrismaClient {
  const config = getConfig();

  if (config.isProduction) {
    if (!global.__prismaClient) {
      global.__prismaClient = new PrismaClient({
        datasources: {
          db: {
            url: config.database.databaseUrl,
          },
        },
      });
    }
    return global.__prismaClient;
  }

  if (!global.__prismaClient) {
    global.__prismaClient = new PrismaClient({
      datasources: {
        db: {
          url: config.database.databaseUrl,
        },
      },
    });
  }
  return global.__prismaClient;
}
