-- CreateTable
CREATE TABLE "reconciliation_adjustments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adjustmentNo" TEXT NOT NULL DEFAULT 'TEMP',
    "caseNo" TEXT NOT NULL,
    "lineItemId" TEXT,
    "walletRef" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "relatedOrderNo" TEXT,
    "assetCode" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "reasonInternal" TEXT NOT NULL,
    "reasonCustomer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalCaseId" TEXT,
    "approvalNo" TEXT,
    "ownerNo" TEXT,
    "ownerId" TEXT,
    "traceId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "postedAt" DATETIME,
    "tbTransferId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_adjustments_adjustmentNo_key" ON "reconciliation_adjustments"("adjustmentNo");

-- CreateIndex
CREATE INDEX "reconciliation_adjustments_caseNo_idx" ON "reconciliation_adjustments"("caseNo");

-- CreateIndex
CREATE INDEX "reconciliation_adjustments_status_idx" ON "reconciliation_adjustments"("status");

-- CreateIndex
CREATE INDEX "reconciliation_adjustments_lineItemId_idx" ON "reconciliation_adjustments"("lineItemId");
