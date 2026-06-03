-- V7 Phase 3: delete Wave-8 settlement engines (OutstandingSettlement* / PoolSettlementBatch*),
-- add SettlementBatch + SettlementBatchItem tables for EOD settlement.

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "outstanding_settlement_items";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "outstanding_settlements";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "pool_settlement_batch_item_sources";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "pool_settlement_batch_items";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "pool_settlement_batches";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "settlement_batches" (
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
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "settlement_batch_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementBatchId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT,
    "inAmount" DECIMAL NOT NULL DEFAULT 0,
    "outAmount" DECIMAL NOT NULL DEFAULT 0,
    "netAmount" DECIMAL NOT NULL DEFAULT 0,
    "direction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "internalTransactionId" TEXT,
    "outstandingCount" INTEGER NOT NULL DEFAULT 0,
    "settledOutstandingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    CONSTRAINT "settlement_batch_items_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "settlement_batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "settlement_batch_items_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "settlement_batch_items_internalTransactionId_fkey" FOREIGN KEY ("internalTransactionId") REFERENCES "internal_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_internal_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "internalTxNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "purpose" TEXT,
    "initiationMode" TEXT,
    "status" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
    "approvalCaseId" TEXT,
    "makerUserId" TEXT,
    "checkerUserId" TEXT,
    "checkedAt" DATETIME,
    "reviewReason" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "netAmount" DECIMAL NOT NULL,
    "fromWalletId" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "toWalletId" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "referenceNo" TEXT,
    "pathLabel" TEXT,
    "accountingClass" TEXT,
    "medium" TEXT,
    "triggerSource" TEXT,
    "traceId" TEXT,
    "statusHistory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "internal_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "internal_transactions_approvalCaseId_fkey" FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "internal_transactions_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "internal_transactions_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_internal_transactions" ("accountingClass", "amount", "approvalCaseId", "approvalStatus", "assetId", "checkedAt", "checkerUserId", "completedAt", "createdAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "id", "initiationMode", "internalTxNo", "makerUserId", "medium", "netAmount", "ownerId", "ownerNo", "ownerType", "pathLabel", "purpose", "referenceNo", "reviewReason", "sourceId", "sourceNo", "sourceType", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "traceId", "triggerSource", "type", "updatedAt") SELECT "accountingClass", "amount", "approvalCaseId", "approvalStatus", "assetId", "checkedAt", "checkerUserId", "completedAt", "createdAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "id", "initiationMode", "internalTxNo", "makerUserId", "medium", "netAmount", "ownerId", "ownerNo", "ownerType", "pathLabel", "purpose", "referenceNo", "reviewReason", "sourceId", "sourceNo", "sourceType", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "traceId", "triggerSource", "type", "updatedAt" FROM "internal_transactions";
DROP TABLE "internal_transactions";
ALTER TABLE "new_internal_transactions" RENAME TO "internal_transactions";
CREATE UNIQUE INDEX "internal_transactions_internalTxNo_key" ON "internal_transactions"("internalTxNo");
CREATE UNIQUE INDEX "internal_transactions_approvalCaseId_key" ON "internal_transactions"("approvalCaseId");
CREATE INDEX "internal_transactions_status_idx" ON "internal_transactions"("status");
CREATE INDEX "internal_transactions_approvalStatus_idx" ON "internal_transactions"("approvalStatus");
CREATE INDEX "internal_transactions_approvalCaseId_idx" ON "internal_transactions"("approvalCaseId");
CREATE INDEX "internal_transactions_createdAt_idx" ON "internal_transactions"("createdAt");
CREATE INDEX "internal_transactions_assetId_idx" ON "internal_transactions"("assetId");
CREATE INDEX "internal_transactions_pathLabel_idx" ON "internal_transactions"("pathLabel");
CREATE INDEX "internal_transactions_traceId_idx" ON "internal_transactions"("traceId");
CREATE UNIQUE INDEX "internal_transactions_sourceType_sourceId_type_key" ON "internal_transactions"("sourceType", "sourceId", "type");
CREATE TABLE "new_outstandings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "outstandingNo" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "direction" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT,
    "amount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "swapTransactionId" TEXT,
    "settlementBatchId" TEXT,
    "settlementBatchItemId" TEXT,
    "lockedAt" DATETIME,
    "closedAt" DATETIME,
    "closedByInternalFundId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "outstandings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outstandings_swapTransactionId_fkey" FOREIGN KEY ("swapTransactionId") REFERENCES "swap_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "outstandings_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "settlement_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "outstandings_settlementBatchItemId_fkey" FOREIGN KEY ("settlementBatchItemId") REFERENCES "settlement_batch_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "outstandings_closedByInternalFundId_fkey" FOREIGN KEY ("closedByInternalFundId") REFERENCES "internal_funds" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_outstandings" ("amount", "assetCode", "assetId", "closedAt", "closedByInternalFundId", "createdAt", "direction", "id", "lockedAt", "outstandingNo", "ownerId", "ownerNo", "ownerType", "sourceId", "sourceNo", "sourceType", "status", "swapTransactionId", "updatedAt") SELECT "amount", "assetCode", "assetId", "closedAt", "closedByInternalFundId", "createdAt", "direction", "id", "lockedAt", "outstandingNo", "ownerId", "ownerNo", "ownerType", "sourceId", "sourceNo", "sourceType", "status", "swapTransactionId", "updatedAt" FROM "outstandings";
DROP TABLE "outstandings";
ALTER TABLE "new_outstandings" RENAME TO "outstandings";
CREATE UNIQUE INDEX "outstandings_outstandingNo_key" ON "outstandings"("outstandingNo");
CREATE INDEX "outstandings_status_idx" ON "outstandings"("status");
CREATE INDEX "outstandings_ownerType_ownerId_idx" ON "outstandings"("ownerType", "ownerId");
CREATE INDEX "outstandings_sourceType_sourceId_idx" ON "outstandings"("sourceType", "sourceId");
CREATE INDEX "outstandings_createdAt_idx" ON "outstandings"("createdAt");
CREATE INDEX "outstandings_assetId_idx" ON "outstandings"("assetId");
CREATE INDEX "outstandings_swapTransactionId_idx" ON "outstandings"("swapTransactionId");
CREATE INDEX "outstandings_settlementBatchId_idx" ON "outstandings"("settlementBatchId");
CREATE INDEX "outstandings_settlementBatchItemId_idx" ON "outstandings"("settlementBatchItemId");
CREATE INDEX "outstandings_closedByInternalFundId_idx" ON "outstandings"("closedByInternalFundId");
CREATE UNIQUE INDEX "outstandings_sourceType_sourceId_direction_key" ON "outstandings"("sourceType", "sourceId", "direction");
CREATE TABLE "new_reimbursement_obligations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "obligationNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "approvalCaseId" TEXT,
    "reasonCategory" TEXT,
    "owedToType" TEXT,
    "owedToId" TEXT,
    "owedToNo" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sourceNo" TEXT,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "poolRole" TEXT,
    "sourceWalletId" TEXT,
    "sourceAccountRef" TEXT,
    "settlementInternalTransactionId" TEXT,
    "settlementReferenceNo" TEXT,
    "reason" TEXT,
    "traceId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reimbursedAt" DATETIME,
    "cancelledAt" DATETIME,
    CONSTRAINT "reimbursement_obligations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reimbursement_obligations_sourceWalletId_fkey" FOREIGN KEY ("sourceWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "reimbursement_obligations_settlementInternalTransactionId_fkey" FOREIGN KEY ("settlementInternalTransactionId") REFERENCES "internal_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_reimbursement_obligations" ("amount", "approvalCaseId", "assetId", "cancelledAt", "createdAt", "id", "metadata", "obligationNo", "owedToId", "owedToNo", "owedToType", "poolRole", "reason", "reasonCategory", "reimbursedAt", "settlementInternalTransactionId", "settlementReferenceNo", "sourceAccountRef", "sourceId", "sourceNo", "sourceType", "sourceWalletId", "status", "traceId", "updatedAt") SELECT "amount", "approvalCaseId", "assetId", "cancelledAt", "createdAt", "id", "metadata", "obligationNo", "owedToId", "owedToNo", "owedToType", "poolRole", "reason", "reasonCategory", "reimbursedAt", "settlementInternalTransactionId", "settlementReferenceNo", "sourceAccountRef", "sourceId", "sourceNo", "sourceType", "sourceWalletId", "status", "traceId", "updatedAt" FROM "reimbursement_obligations";
DROP TABLE "reimbursement_obligations";
ALTER TABLE "new_reimbursement_obligations" RENAME TO "reimbursement_obligations";
CREATE UNIQUE INDEX "reimbursement_obligations_obligationNo_key" ON "reimbursement_obligations"("obligationNo");
CREATE UNIQUE INDEX "reimbursement_obligations_approvalCaseId_key" ON "reimbursement_obligations"("approvalCaseId");
CREATE INDEX "reimbursement_obligations_status_idx" ON "reimbursement_obligations"("status");
CREATE INDEX "reimbursement_obligations_assetId_createdAt_idx" ON "reimbursement_obligations"("assetId", "createdAt");
CREATE INDEX "reimbursement_obligations_poolRole_status_idx" ON "reimbursement_obligations"("poolRole", "status");
CREATE INDEX "reimbursement_obligations_traceId_idx" ON "reimbursement_obligations"("traceId");
CREATE INDEX "reimbursement_obligations_settlementInternalTransactionId_idx" ON "reimbursement_obligations"("settlementInternalTransactionId");
CREATE INDEX "reimbursement_obligations_reasonCategory_status_idx" ON "reimbursement_obligations"("reasonCategory", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "settlement_batches_batchNo_key" ON "settlement_batches"("batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_batches_requestId_key" ON "settlement_batches"("requestId");

-- CreateIndex
CREATE INDEX "settlement_batches_status_idx" ON "settlement_batches"("status");

-- CreateIndex
CREATE INDEX "settlement_batches_settlementType_idx" ON "settlement_batches"("settlementType");

-- CreateIndex
CREATE INDEX "settlement_batch_items_settlementBatchId_idx" ON "settlement_batch_items"("settlementBatchId");

-- CreateIndex
CREATE INDEX "settlement_batch_items_assetId_idx" ON "settlement_batch_items"("assetId");

-- CreateIndex
CREATE INDEX "settlement_batch_items_status_idx" ON "settlement_batch_items"("status");

-- CreateIndex
CREATE INDEX "settlement_batch_items_internalTransactionId_idx" ON "settlement_batch_items"("internalTransactionId");

