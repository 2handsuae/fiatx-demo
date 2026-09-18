-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_withdraw_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawNo" TEXT NOT NULL,
    "payoutId" TEXT,
    "payoutNo" TEXT,
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
    "preKytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "preKytId" TEXT,
    "preKytRiskScore" INTEGER,
    "preKytCheckedAt" DATETIME,
    "kytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kytScreeningId" TEXT,
    "kytRiskScore" INTEGER,
    "kytCheckedAt" DATETIME,
    "travelRuleRequired" BOOLEAN NOT NULL DEFAULT false,
    "counterpartyVasp" TEXT,
    "travelRuleStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "travelRuleTransferId" TEXT,
    "travelRuleCheckedAt" DATETIME,
    "complianceStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "complianceReviewedAt" DATETIME,
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
    "payoutRequestedAt" DATETIME,
    "completedAt" DATETIME,
    "statusHistory" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdraw_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "withdraw_transactions_pricingQuoteId_fkey" FOREIGN KEY ("pricingQuoteId") REFERENCES "withdraw_pricing_quotes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "withdraw_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_withdraw_transactions" ("amount", "approvedAt", "assetId", "completedAt", "complianceReviewedAt", "complianceStatus", "confirmations", "counterpartyVasp", "createdAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "fromWalletNo", "id", "kytCheckedAt", "kytRiskScore", "kytScreeningId", "kytStatus", "netAmount", "ownerId", "ownerNo", "ownerType", "parentId", "parentType", "payoutId", "payoutNo", "payoutRequestedAt", "preKytCheckedAt", "preKytId", "preKytRiskScore", "preKytStatus", "pricingQuoteId", "providerTxnId", "referenceNo", "status", "statusHistory", "tbPendingFeeId", "tbPendingNetId", "toAddress", "toIban", "toWalletId", "toWalletNo", "traceId", "travelRuleCheckedAt", "travelRuleRequired", "travelRuleStatus", "travelRuleTransferId", "txHash", "updatedAt", "withdrawNo") SELECT "amount", "approvedAt", "assetId", "completedAt", "complianceReviewedAt", "complianceStatus", "confirmations", "counterpartyVasp", "createdAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "fromWalletNo", "id", "kytCheckedAt", "kytRiskScore", "kytScreeningId", "kytStatus", "netAmount", "ownerId", "ownerNo", "ownerType", "parentId", "parentType", "payoutId", "payoutNo", "payoutRequestedAt", "preKytCheckedAt", "preKytId", "preKytRiskScore", "preKytStatus", "pricingQuoteId", "providerTxnId", "referenceNo", "status", "statusHistory", "tbPendingFeeId", "tbPendingNetId", "toAddress", "toIban", "toWalletId", "toWalletNo", "traceId", "travelRuleCheckedAt", "travelRuleRequired", "travelRuleStatus", "travelRuleTransferId", "txHash", "updatedAt", "withdrawNo" FROM "withdraw_transactions";
DROP TABLE "withdraw_transactions";
ALTER TABLE "new_withdraw_transactions" RENAME TO "withdraw_transactions";
CREATE UNIQUE INDEX "withdraw_transactions_withdrawNo_key" ON "withdraw_transactions"("withdrawNo");
CREATE UNIQUE INDEX "withdraw_transactions_payoutId_key" ON "withdraw_transactions"("payoutId");
CREATE UNIQUE INDEX "withdraw_transactions_pricingQuoteId_key" ON "withdraw_transactions"("pricingQuoteId");
CREATE INDEX "withdraw_transactions_withdrawNo_idx" ON "withdraw_transactions"("withdrawNo");
CREATE INDEX "withdraw_transactions_payoutId_idx" ON "withdraw_transactions"("payoutId");
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
