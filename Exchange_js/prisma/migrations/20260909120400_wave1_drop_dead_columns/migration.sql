/*
  Warnings:

  - You are about to drop the column `aggregatedAt` on the `deposit_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `aggregatedTransferId` on the `deposit_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `sumsubExternalActionId` on the `deposit_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `travelRuleCheckedAt` on the `deposit_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `travelRuleTransferId` on the `deposit_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `lastScannedAt` on the `inbound_transfer_signals` table. All the data in the column will be lost.
  - You are about to drop the column `supplementRequestedByUserId` on the `inbound_transfer_signals` table. All the data in the column will be lost.
  - You are about to drop the column `updatedByUserId` on the `swap_fee_levels` table. All the data in the column will be lost.
  - You are about to drop the column `failureCode` on the `swap_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `riskDecisionRef` on the `swap_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `updatedByUserId` on the `withdrawal_fee_levels` table. All the data in the column will be lost.

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
    "counterpartyVasp" TEXT,
    "correlationId" TEXT,
    "traceId" TEXT,
    "statusHistory" TEXT,
    "limitHoldReason" TEXT,
    "effectiveDate" TEXT,
    "clawbackExternalLineId" TEXT,
    "clawbackReconCaseNo" TEXT,
    "clawbackDispositionNo" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "l1Snapshot" TEXT,
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
    CONSTRAINT "deposit_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_deposit_transactions" ("amount", "assetId", "clawbackDispositionNo", "clawbackExternalLineId", "clawbackReconCaseNo", "completedAt", "correlationId", "counterpartyIsVasp", "counterpartyVasp", "createdAt", "depositNo", "effectiveDate", "expiresAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "id", "l1Snapshot", "limitHoldReason", "manualReason", "needsReview", "netAmount", "ownerId", "ownerType", "referenceNo", "slaBreached", "slaDeadline", "status", "statusHistory", "sumsubActionId", "sumsubScore", "sumsubScoredAt", "sumsubTxnDetailJson", "sumsubTxnId", "sumsubTxnType", "sumsubVerdict", "toAddress", "toIban", "toWalletId", "traceId", "txHash", "updatedAt") SELECT "amount", "assetId", "clawbackDispositionNo", "clawbackExternalLineId", "clawbackReconCaseNo", "completedAt", "correlationId", "counterpartyIsVasp", "counterpartyVasp", "createdAt", "depositNo", "effectiveDate", "expiresAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "id", "l1Snapshot", "limitHoldReason", "manualReason", "needsReview", "netAmount", "ownerId", "ownerType", "referenceNo", "slaBreached", "slaDeadline", "status", "statusHistory", "sumsubActionId", "sumsubScore", "sumsubScoredAt", "sumsubTxnDetailJson", "sumsubTxnId", "sumsubTxnType", "sumsubVerdict", "toAddress", "toIban", "toWalletId", "traceId", "txHash", "updatedAt" FROM "deposit_transactions";
DROP TABLE "deposit_transactions";
ALTER TABLE "new_deposit_transactions" RENAME TO "deposit_transactions";
CREATE UNIQUE INDEX "deposit_transactions_depositNo_key" ON "deposit_transactions"("depositNo");
CREATE UNIQUE INDEX "deposit_transactions_clawbackExternalLineId_key" ON "deposit_transactions"("clawbackExternalLineId");
CREATE INDEX "deposit_transactions_depositNo_idx" ON "deposit_transactions"("depositNo");
CREATE INDEX "deposit_transactions_ownerType_ownerId_idx" ON "deposit_transactions"("ownerType", "ownerId");
CREATE INDEX "deposit_transactions_status_idx" ON "deposit_transactions"("status");
CREATE INDEX "deposit_transactions_createdAt_idx" ON "deposit_transactions"("createdAt");
CREATE INDEX "deposit_transactions_toWalletId_status_idx" ON "deposit_transactions"("toWalletId", "status");
CREATE TABLE "new_inbound_transfer_signals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalNo" TEXT NOT NULL DEFAULT 'TEMP',
    "ownerId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "txHash" TEXT,
    "referenceNo" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "simulationRiskLevel" TEXT,
    "simulationRiskReason" TEXT,
    "counterpartyIsVasp" BOOLEAN,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SCAN',
    "dedupeKey" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanResult" TEXT,
    "supplementOfExternalLineId" TEXT,
    "supplementReconCaseNo" TEXT,
    "supplementDispositionNo" TEXT,
    "supplementEffectiveDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "inbound_transfer_signals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbound_transfer_signals_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbound_transfer_signals_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_inbound_transfer_signals" ("amount", "assetId", "channelType", "counterpartyIsVasp", "createdAt", "dedupeKey", "fromAddress", "fromIban", "id", "ownerId", "referenceNo", "scanResult", "signalNo", "simulationRiskLevel", "simulationRiskReason", "status", "submittedAt", "supplementDispositionNo", "supplementEffectiveDate", "supplementOfExternalLineId", "supplementReconCaseNo", "txHash", "updatedAt", "walletId") SELECT "amount", "assetId", "channelType", "counterpartyIsVasp", "createdAt", "dedupeKey", "fromAddress", "fromIban", "id", "ownerId", "referenceNo", "scanResult", "signalNo", "simulationRiskLevel", "simulationRiskReason", "status", "submittedAt", "supplementDispositionNo", "supplementEffectiveDate", "supplementOfExternalLineId", "supplementReconCaseNo", "txHash", "updatedAt", "walletId" FROM "inbound_transfer_signals";
DROP TABLE "inbound_transfer_signals";
ALTER TABLE "new_inbound_transfer_signals" RENAME TO "inbound_transfer_signals";
CREATE UNIQUE INDEX "inbound_transfer_signals_signalNo_key" ON "inbound_transfer_signals"("signalNo");
CREATE UNIQUE INDEX "inbound_transfer_signals_dedupeKey_key" ON "inbound_transfer_signals"("dedupeKey");
CREATE UNIQUE INDEX "inbound_transfer_signals_supplementOfExternalLineId_key" ON "inbound_transfer_signals"("supplementOfExternalLineId");
CREATE INDEX "inbound_transfer_signals_ownerId_walletId_status_idx" ON "inbound_transfer_signals"("ownerId", "walletId", "status");
CREATE INDEX "inbound_transfer_signals_walletId_submittedAt_idx" ON "inbound_transfer_signals"("walletId", "submittedAt");
CREATE INDEX "inbound_transfer_signals_txHash_idx" ON "inbound_transfer_signals"("txHash");
CREATE INDEX "inbound_transfer_signals_referenceNo_idx" ON "inbound_transfer_signals"("referenceNo");
CREATE TABLE "new_swap_fee_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "levelCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "tiersJson" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "requiredTagsJson" TEXT NOT NULL DEFAULT '[]',
    "validFrom" DATETIME,
    "validTo" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "swap_fee_levels_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_fee_levels_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_swap_fee_levels" ("approvalCaseId", "approvalCaseNo", "configHash", "createdAt", "createdByUserId", "fromAssetId", "id", "isDefault", "levelCode", "name", "requiredTagsJson", "status", "tiersJson", "toAssetId", "updatedAt", "validFrom", "validTo") SELECT "approvalCaseId", "approvalCaseNo", "configHash", "createdAt", "createdByUserId", "fromAssetId", "id", "isDefault", "levelCode", "name", "requiredTagsJson", "status", "tiersJson", "toAssetId", "updatedAt", "validFrom", "validTo" FROM "swap_fee_levels";
DROP TABLE "swap_fee_levels";
ALTER TABLE "new_swap_fee_levels" RENAME TO "swap_fee_levels";
CREATE UNIQUE INDEX "swap_fee_levels_levelCode_key" ON "swap_fee_levels"("levelCode");
CREATE INDEX "swap_fee_levels_fromAssetId_toAssetId_status_idx" ON "swap_fee_levels"("fromAssetId", "toAssetId", "status");
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
    "correlationId" TEXT,
    "l1Snapshot" TEXT,
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
INSERT INTO "new_swap_transactions" ("completedAt", "compliance_action", "compliance_rule_names", "compliance_verdict", "correlationId", "createdAt", "currentStage", "exchangeRate", "failureReason", "feeAmount", "feeBreakdown", "feeCurrency", "fromAmount", "fromAssetCode", "fromAssetId", "grossAedValue", "id", "l1Snapshot", "needsReview", "netToAmount", "ownerId", "ownerNo", "ownerType", "quoteNo", "quoteSnapshotRef", "quote_id", "reject_reason", "slaBreached", "slaDeadline", "spreadAmount", "status", "statusHistory", "sumsub_detail_json", "sumsub_score", "sumsub_scored_at", "sumsub_txn_id_in", "sumsub_txn_id_out", "sumsub_txn_type", "swapNo", "tbFeeTransferId", "tbFromTransferId", "tbSpreadTransferId", "tbToTransferId", "toAmount", "toAssetCode", "toAssetId", "traceId", "updatedAt") SELECT "completedAt", "compliance_action", "compliance_rule_names", "compliance_verdict", "correlationId", "createdAt", "currentStage", "exchangeRate", "failureReason", "feeAmount", "feeBreakdown", "feeCurrency", "fromAmount", "fromAssetCode", "fromAssetId", "grossAedValue", "id", "l1Snapshot", "needsReview", "netToAmount", "ownerId", "ownerNo", "ownerType", "quoteNo", "quoteSnapshotRef", "quote_id", "reject_reason", "slaBreached", "slaDeadline", "spreadAmount", "status", "statusHistory", "sumsub_detail_json", "sumsub_score", "sumsub_scored_at", "sumsub_txn_id_in", "sumsub_txn_id_out", "sumsub_txn_type", "swapNo", "tbFeeTransferId", "tbFromTransferId", "tbSpreadTransferId", "tbToTransferId", "toAmount", "toAssetCode", "toAssetId", "traceId", "updatedAt" FROM "swap_transactions";
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
CREATE TABLE "new_withdrawal_fee_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "levelCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "tiersJson" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "requiredTagsJson" TEXT NOT NULL DEFAULT '[]',
    "validFrom" DATETIME,
    "validTo" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdrawal_fee_levels_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_withdrawal_fee_levels" ("approvalCaseId", "approvalCaseNo", "assetId", "configHash", "createdAt", "createdByUserId", "id", "isDefault", "levelCode", "name", "requiredTagsJson", "status", "tiersJson", "updatedAt", "validFrom", "validTo") SELECT "approvalCaseId", "approvalCaseNo", "assetId", "configHash", "createdAt", "createdByUserId", "id", "isDefault", "levelCode", "name", "requiredTagsJson", "status", "tiersJson", "updatedAt", "validFrom", "validTo" FROM "withdrawal_fee_levels";
DROP TABLE "withdrawal_fee_levels";
ALTER TABLE "new_withdrawal_fee_levels" RENAME TO "withdrawal_fee_levels";
CREATE UNIQUE INDEX "withdrawal_fee_levels_levelCode_key" ON "withdrawal_fee_levels"("levelCode");
CREATE INDEX "withdrawal_fee_levels_assetId_status_idx" ON "withdrawal_fee_levels"("assetId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
