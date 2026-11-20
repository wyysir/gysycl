CREATE TABLE IF NOT EXISTS "MaterialIdentity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "baseUnit" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "MaterialIdentity_normalizedName_key" ON "MaterialIdentity"("normalizedName");
CREATE TABLE IF NOT EXISTS "ProductSpecification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "materialId" TEXT NOT NULL REFERENCES "MaterialIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL DEFAULT '',
  "normalizedName" TEXT NOT NULL DEFAULT '',
  "spec" TEXT NOT NULL DEFAULT '',
  "normalizedSpec" TEXT NOT NULL DEFAULT '',
  "baseUnit" TEXT NOT NULL,
  "baseQuantity" DECIMAL(20,8),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "ProductSpecification" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProductSpecification" ADD COLUMN IF NOT EXISTS "normalizedName" TEXT NOT NULL DEFAULT '';
DROP INDEX IF EXISTS "ProductSpecification_materialId_normalizedSpec_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ProductSpecification_materialId_normalizedName_normalizedSpec_key" ON "ProductSpecification"("materialId", "normalizedName", "normalizedSpec");
ALTER TABLE "Ingredient" ADD COLUMN IF NOT EXISTS "productSpecificationId" TEXT REFERENCES "ProductSpecification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ingredient" ADD COLUMN IF NOT EXISTS "quantityPerProductUnit" DECIMAL(20,8);
CREATE INDEX IF NOT EXISTS "Ingredient_productSpecificationId_idx" ON "Ingredient"("productSpecificationId");
ALTER TABLE "DocumentItem" ADD COLUMN IF NOT EXISTS "measurementSnapshot" JSONB;
