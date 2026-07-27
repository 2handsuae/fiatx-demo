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
    "kytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kytScreeningId" TEXT,
    "kytRiskScore" INTEGER,
    "kytCheckedAt" DATETIME,
    "travelRuleRequired" BOOLEAN NOT NULL DEFAULT false,
    "travelRuleStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "travelRuleTransferId" TEXT,
    "counterpartyVasp" TEXT,
    "travelRuleCheckedAt" DATETIME,
    "traceId" TEXT,
    "statusHistory" TEXT,
    "aggregatedAt" DATETIME,
    "aggregatedTransferId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "sumsubFinanceTxnId" TEXT,
    "sumsubTravelRuleTxnId" TEXT,
    "manualReason" TEXT,
    "slaDeadline" DATETIME,
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "deposit_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_deposit_transactions" ("aggregatedAt", "aggregatedTransferId", "amount", "assetId", "completedAt", "counterpartyVasp", "createdAt", "depositNo", "expiresAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "id", "kytCheckedAt", "kytRiskScore", "kytScreeningId", "kytStatus", "netAmount", "ownerId", "ownerType", "referenceNo", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "traceId", "travelRuleCheckedAt", "travelRuleRequired", "travelRuleStatus", "travelRuleTransferId", "txHash", "updatedAt") SELECT "aggregatedAt", "aggregatedTransferId", "amount", "assetId", "completedAt", "counterpartyVasp", "createdAt", "depositNo", "expiresAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "id", "kytCheckedAt", "kytRiskScore", "kytScreeningId", "kytStatus", "netAmount", "ownerId", "ownerType", "referenceNo", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "traceId", "travelRuleCheckedAt", "travelRuleRequired", "travelRuleStatus", "travelRuleTransferId", "txHash", "updatedAt" FROM "deposit_transactions";
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
