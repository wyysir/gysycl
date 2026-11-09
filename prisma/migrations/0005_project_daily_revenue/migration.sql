CREATE TABLE "ProjectDailyRevenue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "date" DATE NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" >= 0),
  "notes" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectDailyRevenue_projectId_date_key" UNIQUE ("projectId", "date")
);
