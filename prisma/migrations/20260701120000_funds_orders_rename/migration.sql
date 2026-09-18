-- rename internal_funds → funds_orders.
--
-- Why a table rebuild (not `ALTER TABLE ... RENAME` + `DROP COLUMN`):
--   1. `DROP COLUMN "internalTransactionId"` is rejected by SQLite because that column participates
--      in the self-FK internal_funds_internalTransactionId_fkey ("column in foreign key definition").
--   2. `ALTER TABLE RENAME`'s child-FK cascade depends on PRAGMA legacy_alter_table, which is not
--      reliably togglable inside the migration runner's transaction — so we do NOT rely on it.
-- Instead we rebuild every affected table with explicit DDL (deterministic regardless of pragma state):
--   funds_orders itself (drop internalTransactionId + its FK, add depositTransactionId, rename
--   internalFundNo → fundsOrderNo, legSeq NOT NULL DEFAULT 1), plus the three child tables whose FKs
--   pointed at internal_funds (internal_fund_audit_logs / outstandings / fee_accruals) so they point
--   at funds_orders.

PRAGMA foreign_keys=OFF;

-- ── funds_orders (was internal_funds) ──
ALTER TABLE "internal_funds" RENAME TO "_funds_orders_old";

CREATE TABLE "funds_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundsOrderNo" TEXT NOT NULL,
    "depositTransactionId" TEXT,
    "swapTransactionId" TEXT,
    "withdrawTransactionId" TEXT,
    "legSeq" INTEGER NOT NULL DEFAULT 1,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
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
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "providerTxnId" TEXT,
    "nonce" TEXT,
    "blockNo" TEXT,
    "gasUsed" TEXT,
    "effectiveGasPrice" TEXT,
    "sentAt" DATETIME,
    "confirmedAt" DATETIME,
    "completedAt" DATETIME,
    "statusHistory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "funds_orders_depositTransactionId_fkey" FOREIGN KEY ("depositTransactionId") REFERENCES "deposit_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_swapTransactionId_fkey" FOREIGN KEY ("swapTransactionId") REFERENCES "swap_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_withdrawTransactionId_fkey" FOREIGN KEY ("withdrawTransactionId") REFERENCES "withdraw_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "funds_orders" (
    "id", "fundsOrderNo", "depositTransactionId", "swapTransactionId", "withdrawTransactionId",
    "legSeq", "attempt", "status", "assetId", "amount", "feeAmount", "netAmount",
    "fromWalletId", "fromAddress", "fromIban", "toWalletId", "toAddress", "toIban",
    "txHash", "confirmations", "referenceNo", "providerTxnId", "nonce", "blockNo",
    "gasUsed", "effectiveGasPrice", "sentAt", "confirmedAt", "completedAt",
    "statusHistory", "createdAt", "updatedAt"
)
SELECT
    "id", "internalFundNo", NULL, "swapTransactionId", "withdrawTransactionId",
    COALESCE("legSeq", 1), "attempt", "status", "assetId", "amount", "feeAmount", "netAmount",
    "fromWalletId", "fromAddress", "fromIban", "toWalletId", "toAddress", "toIban",
    "txHash", "confirmations", "referenceNo", "providerTxnId", "nonce", "blockNo",
    "gasUsed", "effectiveGasPrice", "sentAt", "confirmedAt", "completedAt",
    "statusHistory", "createdAt", "updatedAt"
FROM "_funds_orders_old";

DROP TABLE "_funds_orders_old";

CREATE UNIQUE INDEX "funds_orders_fundsOrderNo_key" ON "funds_orders"("fundsOrderNo");
CREATE UNIQUE INDEX "funds_orders_swapTransactionId_legSeq_attempt_key" ON "funds_orders"("swapTransactionId", "legSeq", "attempt");
CREATE INDEX "funds_orders_depositTransactionId_idx" ON "funds_orders"("depositTransactionId");
CREATE INDEX "funds_orders_swapTransactionId_legSeq_idx" ON "funds_orders"("swapTransactionId", "legSeq");
CREATE INDEX "funds_orders_withdrawTransactionId_idx" ON "funds_orders"("withdrawTransactionId");
CREATE INDEX "funds_orders_status_idx" ON "funds_orders"("status");
CREATE INDEX "funds_orders_txHash_idx" ON "funds_orders"("txHash");
CREATE INDEX "funds_orders_createdAt_idx" ON "funds_orders"("createdAt");

-- ── internal_fund_audit_logs: repoint FK → funds_orders ──
ALTER TABLE "internal_fund_audit_logs" RENAME TO "_internal_fund_audit_logs_old";
CREATE TABLE "internal_fund_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "internalFundId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "internal_fund_audit_logs_internalFundId_fkey" FOREIGN KEY ("internalFundId") REFERENCES "funds_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "internal_fund_audit_logs" ("id","internalFundId","operatorId","oldStatus","newStatus","reason","createdAt")
SELECT "id","internalFundId","operatorId","oldStatus","newStatus","reason","createdAt" FROM "_internal_fund_audit_logs_old";
DROP TABLE "_internal_fund_audit_logs_old";
CREATE INDEX "internal_fund_audit_logs_internalFundId_idx" ON "internal_fund_audit_logs"("internalFundId");

-- ── outstandings: repoint closedByInternalFundId FK → funds_orders ──
ALTER TABLE "outstandings" RENAME TO "_outstandings_old";
CREATE TABLE "outstandings" (
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
    "settledByTransferId" TEXT,
    "lockedAt" DATETIME,
    "closedAt" DATETIME,
    "closedByInternalFundId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "originTraceId" TEXT,
    CONSTRAINT "outstandings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "outstandings_swapTransactionId_fkey" FOREIGN KEY ("swapTransactionId") REFERENCES "swap_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "outstandings_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "settlement_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "outstandings_settledByTransferId_fkey" FOREIGN KEY ("settledByTransferId") REFERENCES "internal_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "outstandings_closedByInternalFundId_fkey" FOREIGN KEY ("closedByInternalFundId") REFERENCES "funds_orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "outstandings" ("id","outstandingNo","sourceType","sourceId","sourceNo","ownerType","ownerId","ownerNo","direction","assetId","assetCode","amount","status","swapTransactionId","settlementBatchId","settledByTransferId","lockedAt","closedAt","closedByInternalFundId","createdAt","updatedAt","originTraceId")
SELECT "id","outstandingNo","sourceType","sourceId","sourceNo","ownerType","ownerId","ownerNo","direction","assetId","assetCode","amount","status","swapTransactionId","settlementBatchId","settledByTransferId","lockedAt","closedAt","closedByInternalFundId","createdAt","updatedAt","originTraceId" FROM "_outstandings_old";
DROP TABLE "_outstandings_old";
CREATE UNIQUE INDEX "outstandings_outstandingNo_key" ON "outstandings"("outstandingNo");
CREATE INDEX "outstandings_status_idx" ON "outstandings"("status");
CREATE INDEX "outstandings_ownerType_ownerId_idx" ON "outstandings"("ownerType", "ownerId");
CREATE INDEX "outstandings_sourceType_sourceId_idx" ON "outstandings"("sourceType", "sourceId");
CREATE INDEX "outstandings_createdAt_idx" ON "outstandings"("createdAt");
CREATE INDEX "outstandings_assetId_idx" ON "outstandings"("assetId");
CREATE INDEX "outstandings_swapTransactionId_idx" ON "outstandings"("swapTransactionId");
CREATE INDEX "outstandings_settlementBatchId_idx" ON "outstandings"("settlementBatchId");
CREATE INDEX "outstandings_settledByTransferId_idx" ON "outstandings"("settledByTransferId");
CREATE INDEX "outstandings_closedByInternalFundId_idx" ON "outstandings"("closedByInternalFundId");
CREATE UNIQUE INDEX "outstandings_sourceType_sourceId_direction_key" ON "outstandings"("sourceType", "sourceId", "direction");

-- ── fee_accruals: repoint closedByInternalFundId FK → funds_orders ──
ALTER TABLE "fee_accruals" RENAME TO "_fee_accruals_old";
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
    "originTraceId" TEXT,
    CONSTRAINT "fee_accruals_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_accruals_settlementBatchId_fkey" FOREIGN KEY ("settlementBatchId") REFERENCES "settlement_batches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fee_accruals_settledByTransferId_fkey" FOREIGN KEY ("settledByTransferId") REFERENCES "internal_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "fee_accruals_closedByInternalFundId_fkey" FOREIGN KEY ("closedByInternalFundId") REFERENCES "funds_orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "fee_accruals" ("id","feeAccrualNo","sourceType","sourceId","sourceNo","ownerType","ownerId","ownerNo","feeKind","category","assetId","assetCode","amount","status","settlementBatchId","settledByTransferId","lockedAt","closedAt","closedByInternalFundId","createdAt","updatedAt","originTraceId")
SELECT "id","feeAccrualNo","sourceType","sourceId","sourceNo","ownerType","ownerId","ownerNo","feeKind","category","assetId","assetCode","amount","status","settlementBatchId","settledByTransferId","lockedAt","closedAt","closedByInternalFundId","createdAt","updatedAt","originTraceId" FROM "_fee_accruals_old";
DROP TABLE "_fee_accruals_old";
CREATE UNIQUE INDEX "fee_accruals_feeAccrualNo_key" ON "fee_accruals"("feeAccrualNo");
CREATE INDEX "fee_accruals_status_idx" ON "fee_accruals"("status");
CREATE INDEX "fee_accruals_sourceType_sourceId_idx" ON "fee_accruals"("sourceType", "sourceId");
CREATE INDEX "fee_accruals_assetId_idx" ON "fee_accruals"("assetId");
CREATE INDEX "fee_accruals_settlementBatchId_idx" ON "fee_accruals"("settlementBatchId");
CREATE INDEX "fee_accruals_settledByTransferId_idx" ON "fee_accruals"("settledByTransferId");
CREATE UNIQUE INDEX "fee_accruals_sourceType_sourceId_feeKind_key" ON "fee_accruals"("sourceType", "sourceId", "feeKind");

PRAGMA foreign_keys=ON;
