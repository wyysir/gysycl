-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accessGrants" JSONB,
ADD COLUMN IF NOT EXISTS "authorizationVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SupplierAdjustment" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "date" DATE NOT NULL,
    "sourceDocumentId" TEXT,
    "sourceItemId" TEXT,
    "ingredientId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "spec" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "equivalentQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "sourceUnit" TEXT NOT NULL DEFAULT '',
    "unitPrice" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "conversionSnapshot" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierStatement" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "gross" DECIMAL(14,2) NOT NULL,
    "returns" DECIMAL(14,2) NOT NULL,
    "deductions" DECIMAL(14,2) NOT NULL,
    "payable" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierStatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "documentId" TEXT,
    "adjustmentId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sourceDate" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "SupplierStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "recognized" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceAllocation" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SupplierInvoiceAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "adjustmentId" TEXT,
    "invoiceId" TEXT,
    "objectKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "recognized" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierAdjustment_requestKey_key" ON "SupplierAdjustment"("requestKey");

-- CreateIndex
CREATE INDEX "SupplierAdjustment_projectId_supplierId_date_idx" ON "SupplierAdjustment"("projectId", "supplierId", "date");

-- CreateIndex
CREATE INDEX "SupplierAdjustment_sourceItemId_status_idx" ON "SupplierAdjustment"("sourceItemId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierStatement_requestKey_key" ON "SupplierStatement"("requestKey");

-- CreateIndex
CREATE INDEX "SupplierStatement_projectId_supplierId_from_to_idx" ON "SupplierStatement"("projectId", "supplierId", "from", "to");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierStatementLine_documentId_key" ON "SupplierStatementLine"("documentId");

-- CreateIndex
CREATE INDEX "SupplierStatementLine_adjustmentId_idx" ON "SupplierStatementLine"("adjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierStatementLine_statementId_adjustmentId_key" ON "SupplierStatementLine"("statementId", "adjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_requestKey_key" ON "SupplierInvoice"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_number_key" ON "SupplierInvoice"("number");

-- CreateIndex
CREATE INDEX "SupplierInvoice_projectId_supplierId_idx" ON "SupplierInvoice"("projectId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceAllocation_statementId_idx" ON "SupplierInvoiceAllocation"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoiceAllocation_invoiceId_statementId_key" ON "SupplierInvoiceAllocation"("invoiceId", "statementId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_requestKey_key" ON "SupplierPayment"("requestKey");

-- CreateIndex
CREATE INDEX "SupplierPayment_projectId_supplierId_createdAt_idx" ON "SupplierPayment"("projectId", "supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_statementId_idx" ON "SupplierPaymentAllocation"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentAllocation_paymentId_statementId_key" ON "SupplierPaymentAllocation"("paymentId", "statementId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierFile_objectKey_key" ON "SupplierFile"("objectKey");

-- CreateIndex
CREATE INDEX "SupplierFile_projectId_supplierId_kind_idx" ON "SupplierFile"("projectId", "supplierId", "kind");

-- AddForeignKey
ALTER TABLE "SupplierAdjustment" ADD CONSTRAINT "SupplierAdjustment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAdjustment" ADD CONSTRAINT "SupplierAdjustment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAdjustment" ADD CONSTRAINT "SupplierAdjustment_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAdjustment" ADD CONSTRAINT "SupplierAdjustment_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "DocumentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAdjustment" ADD CONSTRAINT "SupplierAdjustment_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierAdjustment" ADD CONSTRAINT "SupplierAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStatement" ADD CONSTRAINT "SupplierStatement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStatement" ADD CONSTRAINT "SupplierStatement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStatement" ADD CONSTRAINT "SupplierStatement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStatementLine" ADD CONSTRAINT "SupplierStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "SupplierStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStatementLine" ADD CONSTRAINT "SupplierStatementLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStatementLine" ADD CONSTRAINT "SupplierStatementLine_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "SupplierAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceAllocation" ADD CONSTRAINT "SupplierInvoiceAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceAllocation" ADD CONSTRAINT "SupplierInvoiceAllocation_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "SupplierStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "SupplierStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFile" ADD CONSTRAINT "SupplierFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFile" ADD CONSTRAINT "SupplierFile_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFile" ADD CONSTRAINT "SupplierFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFile" ADD CONSTRAINT "SupplierFile_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "SupplierAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierFile" ADD CONSTRAINT "SupplierFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
