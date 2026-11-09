CREATE TABLE "CustomRole" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "permissions" JSONB NOT NULL DEFAULT '[]',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomRole_name_key" ON "CustomRole"("name");
ALTER TABLE "ProjectMembership" ADD COLUMN "customRoleId" TEXT;
CREATE INDEX "ProjectMembership_customRoleId_idx" ON "ProjectMembership"("customRoleId");
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_customRoleId_fkey"
  FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
