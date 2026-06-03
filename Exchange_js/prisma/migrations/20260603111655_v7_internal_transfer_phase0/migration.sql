-- DropIndex
DROP INDEX "fee_occurrences_traceId_idx";

-- DropIndex
DROP INDEX "fee_occurrences_reimbursementImpact_poolRole_idx";

-- DropIndex
DROP INDEX "fee_occurrences_relatedEntityType_relatedEntityId_idx";

-- DropIndex
DROP INDEX "fee_occurrences_sourceEntityType_sourceEntityId_idx";

-- DropIndex
DROP INDEX "fee_occurrences_assetId_createdAt_idx";

-- DropIndex
DROP INDEX "fee_occurrences_status_idx";

-- DropIndex
DROP INDEX "fee_occurrences_idempotencyKey_key";

-- DropIndex
DROP INDEX "fee_occurrences_feeNo_key";

-- AlterTable
ALTER TABLE "internal_transactions" ADD COLUMN "accountingClass" TEXT;
ALTER TABLE "internal_transactions" ADD COLUMN "medium" TEXT;
ALTER TABLE "internal_transactions" ADD COLUMN "pathLabel" TEXT;
ALTER TABLE "internal_transactions" ADD COLUMN "traceId" TEXT;
ALTER TABLE "internal_transactions" ADD COLUMN "triggerSource" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "fee_occurrences";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_outstanding_settlements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementNo" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'SWAP',
    "rangeStartAt" DATETIME,
    "cutoffAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "requestId" TEXT,
    "makerUserId" TEXT,
    "note" TEXT,
    "settlementType" TEXT NOT NULL DEFAULT 'EOD',
    "totalOutstandingCount" INTEGER NOT NULL DEFAULT 0,
    "closedOutstandingCount" INTEGER NOT NULL DEFAULT 0,
    "totalAssetCount" INTEGER NOT NULL DEFAULT 0,
    "closedAssetCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);
INSERT INTO "new_outstanding_settlements" ("closedAssetCount", "closedOutstandingCount", "completedAt", "createdAt", "cutoffAt", "id", "makerUserId", "note", "rangeStartAt", "requestId", "settlementNo", "sourceType", "status", "totalAssetCount", "totalOutstandingCount", "updatedAt") SELECT "closedAssetCount", "closedOutstandingCount", "completedAt", "createdAt", "cutoffAt", "id", "makerUserId", "note", "rangeStartAt", "requestId", "settlementNo", "sourceType", "status", "totalAssetCount", "totalOutstandingCount", "updatedAt" FROM "outstanding_settlements";
DROP TABLE "outstanding_settlements";
ALTER TABLE "new_outstanding_settlements" RENAME TO "outstanding_settlements";
CREATE UNIQUE INDEX "outstanding_settlements_settlementNo_key" ON "outstanding_settlements"("settlementNo");
CREATE UNIQUE INDEX "outstanding_settlements_requestId_key" ON "outstanding_settlements"("requestId");
CREATE INDEX "outstanding_settlements_status_idx" ON "outstanding_settlements"("status");
CREATE INDEX "outstanding_settlements_sourceType_idx" ON "outstanding_settlements"("sourceType");
CREATE INDEX "outstanding_settlements_createdAt_idx" ON "outstanding_settlements"("createdAt");
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
    "lockedByPoolSettlementBatchId" TEXT,
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
    CONSTRAINT "reimbursement_obligations_settlementInternalTransactionId_fkey" FOREIGN KEY ("settlementInternalTransactionId") REFERENCES "internal_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "reimbursement_obligations_lockedByPoolSettlementBatchId_fkey" FOREIGN KEY ("lockedByPoolSettlementBatchId") REFERENCES "pool_settlement_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_reimbursement_obligations" ("amount", "assetId", "cancelledAt", "createdAt", "id", "lockedByPoolSettlementBatchId", "metadata", "obligationNo", "poolRole", "reason", "reimbursedAt", "settlementInternalTransactionId", "settlementReferenceNo", "sourceAccountRef", "sourceWalletId", "status", "traceId", "updatedAt") SELECT "amount", "assetId", "cancelledAt", "createdAt", "id", "lockedByPoolSettlementBatchId", "metadata", "obligationNo", "poolRole", "reason", "reimbursedAt", "settlementInternalTransactionId", "settlementReferenceNo", "sourceAccountRef", "sourceWalletId", "status", "traceId", "updatedAt" FROM "reimbursement_obligations";
DROP TABLE "reimbursement_obligations";
ALTER TABLE "new_reimbursement_obligations" RENAME TO "reimbursement_obligations";
CREATE UNIQUE INDEX "reimbursement_obligations_obligationNo_key" ON "reimbursement_obligations"("obligationNo");
CREATE UNIQUE INDEX "reimbursement_obligations_approvalCaseId_key" ON "reimbursement_obligations"("approvalCaseId");
CREATE INDEX "reimbursement_obligations_status_idx" ON "reimbursement_obligations"("status");
CREATE INDEX "reimbursement_obligations_assetId_createdAt_idx" ON "reimbursement_obligations"("assetId", "createdAt");
CREATE INDEX "reimbursement_obligations_poolRole_status_idx" ON "reimbursement_obligations"("poolRole", "status");
CREATE INDEX "reimbursement_obligations_lockedByPoolSettlementBatchId_idx" ON "reimbursement_obligations"("lockedByPoolSettlementBatchId");
CREATE INDEX "reimbursement_obligations_traceId_idx" ON "reimbursement_obligations"("traceId");
CREATE INDEX "reimbursement_obligations_settlementInternalTransactionId_idx" ON "reimbursement_obligations"("settlementInternalTransactionId");
CREATE INDEX "reimbursement_obligations_reasonCategory_status_idx" ON "reimbursement_obligations"("reasonCategory", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "internal_transactions_pathLabel_idx" ON "internal_transactions"("pathLabel");

-- CreateIndex
CREATE INDEX "internal_transactions_traceId_idx" ON "internal_transactions"("traceId");

