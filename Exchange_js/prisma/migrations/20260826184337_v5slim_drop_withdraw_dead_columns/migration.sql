/*
  Warnings:

  - You are about to drop the column `actionSubmittedAt` on the `withdraw_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `confirmations` on the `withdraw_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `parentId` on the `withdraw_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `parentType` on the `withdraw_transactions` table. All the data in the column will be lost.

*/
-- RedefineTables
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
    "l1Snapshot" TEXT,
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
INSERT INTO "new_withdraw_transactions" ("aedRate", "amount", "approvalCaseId", "approvalNo", "approvedAt", "assetId", "completedAt", "counterpartyIsVasp", "createdAt", "feeAmount", "feeSettleAttempts", "fromAddress", "fromIban", "fromWalletId", "fromWalletNo", "grossAedValue", "id", "l1Snapshot", "manualReason", "needsReview", "netAmount", "ownerId", "ownerNo", "ownerType", "pricingQuoteId", "providerTxnId", "rateFetchFailed", "rateFetchedAt", "referenceNo", "slaBreached", "slaDeadline", "status", "statusHistory", "sumsubScore", "sumsubScoredAt", "sumsubTxnDetailJson", "sumsubTxnId", "sumsubTxnType", "sumsubVerdict", "tbPendingFeeId", "tbPendingNetId", "toAddress", "toIban", "toWalletId", "toWalletNo", "traceId", "txHash", "updatedAt", "withdrawNo") SELECT "aedRate", "amount", "approvalCaseId", "approvalNo", "approvedAt", "assetId", "completedAt", "counterpartyIsVasp", "createdAt", "feeAmount", "feeSettleAttempts", "fromAddress", "fromIban", "fromWalletId", "fromWalletNo", "grossAedValue", "id", "l1Snapshot", "manualReason", "needsReview", "netAmount", "ownerId", "ownerNo", "ownerType", "pricingQuoteId", "providerTxnId", "rateFetchFailed", "rateFetchedAt", "referenceNo", "slaBreached", "slaDeadline", "status", "statusHistory", "sumsubScore", "sumsubScoredAt", "sumsubTxnDetailJson", "sumsubTxnId", "sumsubTxnType", "sumsubVerdict", "tbPendingFeeId", "tbPendingNetId", "toAddress", "toIban", "toWalletId", "toWalletNo", "traceId", "txHash", "updatedAt", "withdrawNo" FROM "withdraw_transactions";
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
CREATE INDEX "withdraw_transactions_createdAt_idx" ON "withdraw_transactions"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
