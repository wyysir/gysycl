import type { Db } from "./prisma";
import { getDb } from "./prisma";
import { seedDatabase } from "@/server/seed";
import { assertProductionConfig, env } from "./config";

type BootstrapGlobal = typeof globalThis & {
  __deliveryAuditReadyDb?: Promise<Db>;
};

const globalForBootstrap = globalThis as BootstrapGlobal;

export function getReadyDb(): Promise<Db> {
  if (!globalForBootstrap.__deliveryAuditReadyDb) {
    globalForBootstrap.__deliveryAuditReadyDb = (async () => {
      assertProductionConfig();
      const db = await getDb();
      if (env.DEMO_MODE) {
        await seedDatabase(db);
      }
      return db;
    })();
  }
  return globalForBootstrap.__deliveryAuditReadyDb;
}
