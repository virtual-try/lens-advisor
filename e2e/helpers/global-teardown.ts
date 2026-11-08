import { teardownSharedTestDb } from "./shared-db";

export default async function globalTeardown(): Promise<void> {
  await teardownSharedTestDb();
}
