-- RedefineTables
-- Withdraw domain migrates to the deposit-style single-txn Sumsub columns
-- (see 20260730212024_deposit_single_sumsub_txn for the precedent). Drops the
-- old two-phase preKyt*/kyt*/travelRule*/complianceStatus columns and adds
-- sumsubTxnId/sumsubTxnType/sumsubVerdict/sumsubScore/sumsubScoredAt/
-- sumsubTxnDetailJson/counterpartyIsVasp/manualReason/slaDeadline/slaBreached/
-- needsReview/feeSettleAttempts.
--
-- Data migration: old `status` values that predate the Task 1 state-machine
-- rewrite (10 states/20 edges) are remapped onto their new names so historical
-- rows keep a valid status. sumsubTxnId (and every other new sumsub* column)
-- has no source column — every row lands NULL, which SQLite fills
-- automatically for columns omitted from the INSERT target list below.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_withdraw_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawNo" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "netAmount" DECIMAL NOT NULL,
    "toWalletId" TEXT,
    "toWalletNo" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "fromWalletId" TEXT,
    "fromWalletNo" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "providerTxnId" TEXT,
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "sumsubTxnId" TEXT,
    "sumsubTxnType" TEXT,
    "sumsubVerdict" TEXT,
    "sumsubScore" INTEGER,
    "sumsubScoredAt" DATETIME,
    "sumsubTxnDetailJson" TEXT,
    "counterpartyIsVasp" BOOLEAN,
    "manualReason" TEXT,
    "slaDeadline" DATETIME,
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "feeSettleAttempts" INTEGER NOT NULL DEFAULT 0,
    "traceId" TEXT,
    "grossAedValue" DECIMAL,
    "aedRate" DECIMAL,
    "rateFetchedAt" DATETIME,
    "rateFetchFailed" BOOLEAN NOT NULL DEFAULT false,
    "approvalCaseId" TEXT,
    "approvalNo" TEXT,
    "tbPendingNetId" TEXT,
    "tbPendingFeeId" TEXT,
    "parentType" TEXT,
    "parentId" TEXT,
    "pricingQuoteId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "completedAt" DATETIME,
    "statusHistory" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdraw_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "withdraw_transactions_pricingQuoteId_fkey" FOREIGN KEY ("pricingQuoteId") REFERENCES "withdraw_pricing_quotes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "withdraw_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_withdraw_transactions" ("aedRate", "amount", "approvalCaseId", "approvalNo", "approvedAt", "assetId", "completedAt", "confirmations", "createdAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "fromWalletNo", "grossAedValue", "id", "netAmount", "ownerId", "ownerNo", "ownerType", "parentId", "parentType", "pricingQuoteId", "providerTxnId", "rateFetchFailed", "rateFetchedAt", "referenceNo", "status", "statusHistory", "tbPendingFeeId", "tbPendingNetId", "toAddress", "toIban", "toWalletId", "toWalletNo", "traceId", "txHash", "updatedAt", "withdrawNo")
SELECT "aedRate", "amount", "approvalCaseId", "approvalNo", "approvedAt", "assetId", "completedAt", "confirmations", "createdAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "fromWalletNo", "grossAedValue", "id", "netAmount", "ownerId", "ownerNo", "ownerType", "parentId", "parentType", "pricingQuoteId", "providerTxnId", "rateFetchFailed", "rateFetchedAt", "referenceNo",
    CASE "status"
        WHEN 'PENDING_COMPLIANCE' THEN 'COMPLIANCE_PENDING'
        WHEN 'UNDER_REVIEW' THEN 'MANUAL_CHECKING'
        WHEN 'HELD' THEN 'FROZEN'
        ELSE "status"
    END AS "status",
    "statusHistory", "tbPendingFeeId", "tbPendingNetId", "toAddress", "toIban", "toWalletId", "toWalletNo", "traceId", "txHash", "updatedAt", "withdrawNo"
FROM "withdraw_transactions";
DROP TABLE "withdraw_transactions";
ALTER TABLE "new_withdraw_transactions" RENAME TO "withdraw_transactions";
CREATE UNIQUE INDEX "withdraw_transactions_withdrawNo_key" ON "withdraw_transactions"("withdrawNo");
CREATE UNIQUE INDEX "withdraw_transactions_sumsubTxnId_key" ON "withdraw_transactions"("sumsubTxnId");
CREATE UNIQUE INDEX "withdraw_transactions_pricingQuoteId_key" ON "withdraw_transactions"("pricingQuoteId");
CREATE INDEX "withdraw_transactions_withdrawNo_idx" ON "withdraw_transactions"("withdrawNo");
CREATE INDEX "withdraw_transactions_ownerId_idx" ON "withdraw_transactions"("ownerId");
CREATE INDEX "withdraw_transactions_status_idx" ON "withdraw_transactions"("status");
CREATE INDEX "withdraw_transactions_assetId_idx" ON "withdraw_transactions"("assetId");
CREATE INDEX "withdraw_transactions_toWalletId_idx" ON "withdraw_transactions"("toWalletId");
CREATE INDEX "withdraw_transactions_pricingQuoteId_idx" ON "withdraw_transactions"("pricingQuoteId");
CREATE INDEX "withdraw_transactions_providerTxnId_idx" ON "withdraw_transactions"("providerTxnId");
CREATE INDEX "withdraw_transactions_txHash_idx" ON "withdraw_transactions"("txHash");
CREATE INDEX "withdraw_transactions_parentId_idx" ON "withdraw_transactions"("parentId");
CREATE INDEX "withdraw_transactions_createdAt_idx" ON "withdraw_transactions"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
