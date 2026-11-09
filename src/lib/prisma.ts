import path from "node:path";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPgliteAdapter } from "prisma-pglite";
import { PrismaClient } from "@/generated/prisma/client";
import { env, isLocalDatabase } from "./config";

type PrismaGlobal = typeof globalThis & {
  __deliveryAuditPrisma?: PrismaClient;
  __deliveryAuditPrismaPromise?: Promise<PrismaClient>;
};

const globalForPrisma = globalThis as PrismaGlobal;

async function createPrismaClient() {
  if (!isLocalDatabase) {
    const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
    return new PrismaClient({ adapter });
  }

  const adapter = await createPgliteAdapter({
    prismaConfigPath: path.join(process.cwd(), "prisma.config.ts"),
    dbParentDirPath: path.join(process.cwd(), ".data", "pglite"),
    dbDirName: env.NODE_ENV === "test" ? "test" : "dev",
  });
  const client = new PrismaClient({ adapter });
  // PGlite reuses a local directory without running Prisma migrate deploy.
  // Apply this release's additive columns without resetting existing data.
  await client.$executeRaw`ALTER TABLE "Ingredient" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT ''`;
  await client.$executeRaw`ALTER TABLE "Ingredient" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1`;
  await client.$executeRaw`ALTER TABLE "DocumentItem" ADD COLUMN IF NOT EXISTS "roundingAdjustment" JSONB`;
  await client.$executeRaw`CREATE TABLE IF NOT EXISTS "CustomRole" (
    "id" TEXT PRIMARY KEY, "name" TEXT UNIQUE NOT NULL, "description" TEXT NOT NULL DEFAULT '',
    "permissions" JSONB NOT NULL DEFAULT '[]', "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
  )`;
  await client.$executeRaw`ALTER TABLE "ProjectMembership" ADD COLUMN IF NOT EXISTS "customRoleId" TEXT REFERENCES "CustomRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE`;
  await client.$executeRawUnsafe(readFileSync(path.join(process.cwd(), "prisma/migrations/0005_project_daily_revenue/migration.sql"), "utf8").replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '));
  await client.$executeRawUnsafe(readFileSync(path.join(process.cwd(), "prisma/migrations/0006_revenue_review/migration.sql"), "utf8"));
  await client.$executeRaw`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3)`;
  for (const statement of readFileSync(path.join(process.cwd(), "prisma/migrations/0008_upload_batches/migration.sql"), "utf8").split(";").filter(sql=>sql.trim())) {
    await client.$executeRawUnsafe(statement);
  }
  return client;
}

export function getDb(): Promise<PrismaClient> {
  if (globalForPrisma.__deliveryAuditPrisma) {
    return Promise.resolve(globalForPrisma.__deliveryAuditPrisma);
  }
  if (!globalForPrisma.__deliveryAuditPrismaPromise) {
    globalForPrisma.__deliveryAuditPrismaPromise = createPrismaClient().then(
      (client) => {
        globalForPrisma.__deliveryAuditPrisma = client;
        return client;
      },
    );
  }
  return globalForPrisma.__deliveryAuditPrismaPromise;
}

export type Db = PrismaClient;
