-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_swap_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "swapNo" TEXT,
    "quote_id" TEXT,
    "quoteNo" TEXT,
    "quoteSnapshotRef" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "status" TEXT NOT NULL,
    "currentStage" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "slaDeadline" DATETIME,
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "fromAssetId" TEXT NOT NULL,
    "fromAssetCode" TEXT,
    "fromAmount" DECIMAL NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "toAssetCode" TEXT,
    "toAmount" DECIMAL NOT NULL,
    "netToAmount" DECIMAL,
    "feeAmount" DECIMAL,
    "feeCurrency" TEXT,
    "feeBreakdown" TEXT,
    "exchangeRate" DECIMAL NOT NULL,
    "riskDecisionRef" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "statusHistory" TEXT,
    "sumsub_txn_id_out" TEXT,
    "sumsub_txn_id_in" TEXT,
    "compliance_verdict" TEXT,
    "compliance_action" TEXT,
    "compliance_rule_names" TEXT,
    "sumsub_detail_json" TEXT,
    "reject_reason" TEXT,
    "sumsub_score" INTEGER,
    "sumsub_scored_at" DATETIME,
    "sumsub_txn_type" TEXT,
    "spreadAmount" DECIMAL,
    "grossAedValue" DECIMAL,
    "tbFromTransferId" TEXT,
    "tbToTransferId" TEXT,
    "tbFeeTransferId" TEXT,
    "tbSpreadTransferId" TEXT,
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "swap_transactions_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_transactions_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_transactions_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "swap_quotes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "swap_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_swap_transactions" ("completedAt", "compliance_action", "compliance_rule_names", "compliance_verdict", "createdAt", "currentStage", "exchangeRate", "failureCode", "failureReason", "feeAmount", "feeBreakdown", "feeCurrency", "fromAmount", "fromAssetCode", "fromAssetId", "grossAedValue", "id", "needsReview", "netToAmount", "ownerId", "ownerNo", "ownerType", "quoteNo", "quoteSnapshotRef", "quote_id", "reject_reason", "riskDecisionRef", "spreadAmount", "status", "statusHistory", "sumsub_detail_json", "sumsub_score", "sumsub_scored_at", "sumsub_txn_id_in", "sumsub_txn_id_out", "sumsub_txn_type", "swapNo", "tbFeeTransferId", "tbFromTransferId", "tbSpreadTransferId", "tbToTransferId", "toAmount", "toAssetCode", "toAssetId", "traceId", "updatedAt") SELECT "completedAt", "compliance_action", "compliance_rule_names", "compliance_verdict", "createdAt", "currentStage", "exchangeRate", "failureCode", "failureReason", "feeAmount", "feeBreakdown", "feeCurrency", "fromAmount", "fromAssetCode", "fromAssetId", "grossAedValue", "id", "needsReview", "netToAmount", "ownerId", "ownerNo", "ownerType", "quoteNo", "quoteSnapshotRef", "quote_id", "reject_reason", "riskDecisionRef", "spreadAmount", "status", "statusHistory", "sumsub_detail_json", "sumsub_score", "sumsub_scored_at", "sumsub_txn_id_in", "sumsub_txn_id_out", "sumsub_txn_type", "swapNo", "tbFeeTransferId", "tbFromTransferId", "tbSpreadTransferId", "tbToTransferId", "toAmount", "toAssetCode", "toAssetId", "traceId", "updatedAt" FROM "swap_transactions";
DROP TABLE "swap_transactions";
ALTER TABLE "new_swap_transactions" RENAME TO "swap_transactions";
CREATE UNIQUE INDEX "swap_transactions_swapNo_key" ON "swap_transactions"("swapNo");
CREATE UNIQUE INDEX "swap_transactions_quote_id_key" ON "swap_transactions"("quote_id");
CREATE INDEX "swap_transactions_swapNo_idx" ON "swap_transactions"("swapNo");
CREATE INDEX "swap_transactions_ownerType_ownerId_idx" ON "swap_transactions"("ownerType", "ownerId");
CREATE INDEX "swap_transactions_ownerNo_idx" ON "swap_transactions"("ownerNo");
CREATE INDEX "swap_transactions_fromAssetCode_idx" ON "swap_transactions"("fromAssetCode");
CREATE INDEX "swap_transactions_toAssetCode_idx" ON "swap_transactions"("toAssetCode");
CREATE INDEX "swap_transactions_status_idx" ON "swap_transactions"("status");
CREATE INDEX "swap_transactions_createdAt_idx" ON "swap_transactions"("createdAt");
CREATE INDEX "swap_transactions_sumsub_txn_id_out_idx" ON "swap_transactions"("sumsub_txn_id_out");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
