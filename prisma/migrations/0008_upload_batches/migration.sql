CREATE TABLE IF NOT EXISTS "UploadBatch" (
  "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL UNIQUE,
  "projectId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "docDate" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "UploadBatch_createdById_createdAt_idx" ON "UploadBatch"("createdById", "createdAt");
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "batchId" TEXT REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "batchPosition" INTEGER;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "checkedVersion" INTEGER;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "checkedById" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "checkedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Document_batchId_batchPosition_key" ON "Document"("batchId", "batchPosition");
CREATE TABLE IF NOT EXISTS "BatchPhoto" (
  "id" TEXT PRIMARY KEY, "batchId" TEXT NOT NULL REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "position" INTEGER NOT NULL CHECK ("position" BETWEEN 1 AND 10),
  "fileName" TEXT NOT NULL, "mime" TEXT NOT NULL DEFAULT '', "objectKey" TEXT NOT NULL DEFAULT '',
  "documentId" TEXT UNIQUE REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "completedAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 1,
  UNIQUE ("batchId", "position")
);
