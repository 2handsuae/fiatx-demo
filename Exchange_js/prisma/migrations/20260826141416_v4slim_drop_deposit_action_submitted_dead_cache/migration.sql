/*
  Warnings:

  - You are about to drop the column `actionSubmittedAt` on the `deposit_transactions` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_deposit_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depositNo" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "netAmount" DECIMAL NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "fromWalletId" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "txHash" TEXT,
    "referenceNo" TEXT,
    "expiresAt" DATETIME,
    "travelRuleTransferId" TEXT,
    "counterpartyVasp" TEXT,
    "travelRuleCheckedAt" DATETIME,
    "traceId" TEXT,
    "statusHistory" TEXT,
    "limitHoldReason" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "l1Snapshot" TEXT,
    "aggregatedAt" DATETIME,
    "aggregatedTransferId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
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
    "sumsubActionId" TEXT,
    "sumsubExternalActionId" TEXT,
    CONSTRAINT "deposit_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_deposit_transactions" ("aggregatedAt", "aggregatedTransferId", "amount", "assetId", "completedAt", "counterpartyIsVasp", "counterpartyVasp", "createdAt", "depositNo", "expiresAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "id", "l1Snapshot", "limitHoldReason", "manualReason", "needsReview", "netAmount", "ownerId", "ownerType", "referenceNo", "slaBreached", "slaDeadline", "status", "statusHistory", "sumsubActionId", "sumsubExternalActionId", "sumsubScore", "sumsubScoredAt", "sumsubTxnDetailJson", "sumsubTxnId", "sumsubTxnType", "sumsubVerdict", "toAddress", "toIban", "toWalletId", "traceId", "travelRuleCheckedAt", "travelRuleTransferId", "txHash", "updatedAt") SELECT "aggregatedAt", "aggregatedTransferId", "amount", "assetId", "completedAt", "counterpartyIsVasp", "counterpartyVasp", "createdAt", "depositNo", "expiresAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "id", "l1Snapshot", "limitHoldReason", "manualReason", "needsReview", "netAmount", "ownerId", "ownerType", "referenceNo", "slaBreached", "slaDeadline", "status", "statusHistory", "sumsubActionId", "sumsubExternalActionId", "sumsubScore", "sumsubScoredAt", "sumsubTxnDetailJson", "sumsubTxnId", "sumsubTxnType", "sumsubVerdict", "toAddress", "toIban", "toWalletId", "traceId", "travelRuleCheckedAt", "travelRuleTransferId", "txHash", "updatedAt" FROM "deposit_transactions";
DROP TABLE "deposit_transactions";
ALTER TABLE "new_deposit_transactions" RENAME TO "deposit_transactions";
CREATE UNIQUE INDEX "deposit_transactions_depositNo_key" ON "deposit_transactions"("depositNo");
CREATE INDEX "deposit_transactions_depositNo_idx" ON "deposit_transactions"("depositNo");
CREATE INDEX "deposit_transactions_ownerType_ownerId_idx" ON "deposit_transactions"("ownerType", "ownerId");
CREATE INDEX "deposit_transactions_status_idx" ON "deposit_transactions"("status");
CREATE INDEX "deposit_transactions_createdAt_idx" ON "deposit_transactions"("createdAt");
CREATE INDEX "deposit_transactions_toWalletId_status_aggregatedAt_idx" ON "deposit_transactions"("toWalletId", "status", "aggregatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
