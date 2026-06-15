-- CreateTable
CREATE TABLE "fee_accruals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feeAccrualNo" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "feeKind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT,
    "amount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCRUED',
    "settlementBatchId" TEXT,
    "settledByTransferId" TEXT,
    "lockedAt" DATETIME,
    "closedAt" DATETIME,
    "closedByInternalFundId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "fee_accruals_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_accruals_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "settlement_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fee_accruals_settledByTransferId_fkey" FOREIGN KEY ("settledByTransferId") REFERENCES "internal_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fee_accruals_closedByInternalFundId_fkey" FOREIGN KEY ("closedByInternalFundId") REFERENCES "internal_funds" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_settlement_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchNo" TEXT NOT NULL,
    "settlementType" TEXT NOT NULL DEFAULT 'EOD',
    "cutoffAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "requestId" TEXT,
    "totalAssetCount" INTEGER NOT NULL DEFAULT 0,
    "settledAssetCount" INTEGER NOT NULL DEFAULT 0,
    "totalOutstandingCount" INTEGER NOT NULL DEFAULT 0,
    "settledOutstandingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "category" TEXT NOT NULL DEFAULT 'PRINCIPAL',
    "totalFeeAccrualCount" INTEGER NOT NULL DEFAULT 0,
    "settledFeeAccrualCount" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_settlement_batches" ("batchNo", "completedAt", "createdAt", "cutoffAt", "id", "requestId", "settledAssetCount", "settledOutstandingCount", "settlementType", "status", "totalAssetCount", "totalOutstandingCount", "updatedAt") SELECT "batchNo", "completedAt", "createdAt", "cutoffAt", "id", "requestId", "settledAssetCount", "settledOutstandingCount", "settlementType", "status", "totalAssetCount", "totalOutstandingCount", "updatedAt" FROM "settlement_batches";
DROP TABLE "settlement_batches";
ALTER TABLE "new_settlement_batches" RENAME TO "settlement_batches";
CREATE UNIQUE INDEX "settlement_batches_batchNo_key" ON "settlement_batches"("batchNo");
CREATE UNIQUE INDEX "settlement_batches_requestId_key" ON "settlement_batches"("requestId");
CREATE INDEX "settlement_batches_status_idx" ON "settlement_batches"("status");
CREATE INDEX "settlement_batches_settlementType_idx" ON "settlement_batches"("settlementType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "fee_accruals_feeAccrualNo_key" ON "fee_accruals"("feeAccrualNo");

-- CreateIndex
CREATE INDEX "fee_accruals_status_idx" ON "fee_accruals"("status");

-- CreateIndex
CREATE INDEX "fee_accruals_sourceType_sourceId_idx" ON "fee_accruals"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "fee_accruals_assetId_idx" ON "fee_accruals"("assetId");

-- CreateIndex
CREATE INDEX "fee_accruals_settlementBatchId_idx" ON "fee_accruals"("settlementBatchId");

-- CreateIndex
CREATE INDEX "fee_accruals_settledByTransferId_idx" ON "fee_accruals"("settledByTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_accruals_sourceType_sourceId_feeKind_key" ON "fee_accruals"("sourceType", "sourceId", "feeKind");
