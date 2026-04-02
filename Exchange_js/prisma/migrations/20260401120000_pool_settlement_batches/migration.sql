-- CreateTable
CREATE TABLE "pool_settlement_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cutoffAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "closedAt" DATETIME,
    "approvalCaseId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "autoCreated" BOOLEAN NOT NULL DEFAULT false,
    "summaryJson" TEXT NOT NULL DEFAULT '{}',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "pool_settlement_batch_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "walletPairKey" TEXT NOT NULL,
    "walletAId" TEXT NOT NULL,
    "walletBId" TEXT NOT NULL,
    "netDirection" TEXT NOT NULL,
    "netAmount" DECIMAL NOT NULL,
    "submittedAmount" DECIMAL NOT NULL DEFAULT 0,
    "settledAmount" DECIMAL NOT NULL DEFAULT 0,
    "failedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pool_settlement_batch_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "pool_settlement_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_items_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_items_walletAId_fkey" FOREIGN KEY ("walletAId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_items_walletBId_fkey" FOREIGN KEY ("walletBId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_items_id_batchId_key" UNIQUE ("id", "batchId"),
    CONSTRAINT "pool_settlement_batch_items_batchId_assetId_walletPairKey_key" UNIQUE ("batchId", "assetId", "walletPairKey")
);

-- CreateTable
CREATE TABLE "pool_settlement_batch_item_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "batchItemId" TEXT,
    "sourceFamily" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "fromWalletId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sourceAmount" DECIMAL NOT NULL,
    "nettedAmount" DECIMAL NOT NULL DEFAULT 0,
    "settledAmount" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "closeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "pool_settlement_batch_item_sources_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "pool_settlement_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_item_sources_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "pool_settlement_batch_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_item_sources_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_item_sources_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_item_sources_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pool_settlement_batch_item_sources_batchId_sourceFamily_sourceId_key" UNIQUE ("batchId", "sourceFamily", "sourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "pool_settlement_batches_batchNo_key" ON "pool_settlement_batches"("batchNo");

-- CreateIndex
CREATE INDEX "pool_settlement_batches_status_idx" ON "pool_settlement_batches"("status");

-- CreateIndex
CREATE INDEX "pool_settlement_batches_cutoffAt_idx" ON "pool_settlement_batches"("cutoffAt");

-- CreateIndex
CREATE INDEX "pool_settlement_batches_approvalCaseId_idx" ON "pool_settlement_batches"("approvalCaseId");

-- CreateIndex
CREATE INDEX "pool_settlement_batches_autoCreated_createdAt_idx" ON "pool_settlement_batches"("autoCreated", "createdAt");

-- CreateIndex
CREATE INDEX "pool_settlement_batch_items_batchId_idx" ON "pool_settlement_batch_items"("batchId");

-- CreateIndex
CREATE INDEX "pool_settlement_batch_items_status_idx" ON "pool_settlement_batch_items"("status");

-- CreateIndex
CREATE INDEX "pool_settlement_batch_items_assetId_walletPairKey_idx" ON "pool_settlement_batch_items"("assetId", "walletPairKey");

-- CreateIndex
CREATE INDEX "pool_settlement_batch_item_sources_batchId_idx" ON "pool_settlement_batch_item_sources"("batchId");

-- CreateIndex
CREATE INDEX "pool_settlement_batch_item_sources_batchItemId_idx" ON "pool_settlement_batch_item_sources"("batchItemId");

-- CreateIndex
CREATE INDEX "pool_settlement_batch_item_sources_sourceFamily_sourceId_idx" ON "pool_settlement_batch_item_sources"("sourceFamily", "sourceId");

-- CreateIndex
CREATE INDEX "pool_settlement_batch_item_sources_assetId_fromWalletId_toWalletId_idx" ON "pool_settlement_batch_item_sources"("assetId", "fromWalletId", "toWalletId");

-- CreateTrigger
CREATE TRIGGER "pool_settlement_batch_item_sources_validate_batchItem_batch_match_insert"
BEFORE INSERT ON "pool_settlement_batch_item_sources"
FOR EACH ROW
WHEN NEW."batchItemId" IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'pool_settlement_batch_item_sources batchItemId must reference an item in the same batch')
    WHERE EXISTS (
        SELECT 1
        FROM "pool_settlement_batch_items"
        WHERE "id" = NEW."batchItemId"
          AND "batchId" <> NEW."batchId"
    );
END;

-- CreateTrigger
CREATE TRIGGER "pool_settlement_batch_item_sources_validate_batchItem_batch_match_update"
BEFORE UPDATE OF "batchId", "batchItemId" ON "pool_settlement_batch_item_sources"
FOR EACH ROW
WHEN NEW."batchItemId" IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'pool_settlement_batch_item_sources batchItemId must reference an item in the same batch')
    WHERE EXISTS (
        SELECT 1
        FROM "pool_settlement_batch_items"
        WHERE "id" = NEW."batchItemId"
          AND "batchId" <> NEW."batchId"
    );
END;

-- AlterTable
ALTER TABLE "outstandings" ADD COLUMN "lockedByPoolSettlementBatchId" TEXT REFERENCES "pool_settlement_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "reimbursement_obligations" ADD COLUMN "lockedByPoolSettlementBatchId" TEXT REFERENCES "pool_settlement_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "internal_transactions" ADD COLUMN "poolSettlementBatchItemId" TEXT REFERENCES "pool_settlement_batch_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "internal_transactions_poolSettlementBatchItemId_key" ON "internal_transactions"("poolSettlementBatchItemId");

-- CreateIndex
CREATE INDEX "outstandings_lockedByPoolSettlementBatchId_idx" ON "outstandings"("lockedByPoolSettlementBatchId");

-- CreateIndex
CREATE INDEX "reimbursement_obligations_lockedByPoolSettlementBatchId_idx" ON "reimbursement_obligations"("lockedByPoolSettlementBatchId");
