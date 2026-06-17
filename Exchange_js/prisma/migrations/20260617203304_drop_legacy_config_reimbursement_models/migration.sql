-- DropIndex
DROP INDEX "business_config_release_items_subjectType_businessKey_idx";

-- DropIndex
DROP INDEX "business_config_release_items_revisionId_idx";

-- DropIndex
DROP INDEX "business_config_release_items_releaseId_sortOrder_idx";

-- DropIndex
DROP INDEX "business_config_release_items_releaseId_businessKey_key";

-- DropIndex
DROP INDEX "business_config_releases_subjectType_createdAt_idx";

-- DropIndex
DROP INDEX "business_config_releases_subjectType_status_createdAt_idx";

-- DropIndex
DROP INDEX "business_config_releases_releaseNo_key";

-- DropIndex
DROP INDEX "business_config_revisions_subjectType_contentHash_idx";

-- DropIndex
DROP INDEX "business_config_revisions_subjectType_businessKey_createdAt_idx";

-- DropIndex
DROP INDEX "business_config_revisions_subjectType_businessKey_revisionNo_key";

-- DropIndex
DROP INDEX "pricing_policies_business_idx";

-- DropIndex
DROP INDEX "pricing_policies_policyCode_key";

-- DropIndex
DROP INDEX "reimbursement_obligations_reasonCategory_status_idx";

-- DropIndex
DROP INDEX "reimbursement_obligations_settlementInternalTransactionId_idx";

-- DropIndex
DROP INDEX "reimbursement_obligations_traceId_idx";

-- DropIndex
DROP INDEX "reimbursement_obligations_poolRole_status_idx";

-- DropIndex
DROP INDEX "reimbursement_obligations_assetId_createdAt_idx";

-- DropIndex
DROP INDEX "reimbursement_obligations_status_idx";

-- DropIndex
DROP INDEX "reimbursement_obligations_approvalCaseId_key";

-- DropIndex
DROP INDEX "reimbursement_obligations_obligationNo_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "business_config_release_items";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "business_config_releases";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "business_config_revisions";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "pricing_policies";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "reimbursement_obligations";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_regulatory_gate_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateNo" TEXT NOT NULL DEFAULT 'TEMP',
    "gateType" TEXT NOT NULL,
    "authority" TEXT NOT NULL DEFAULT 'VARA',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectNo" TEXT NOT NULL,
    "scopeSummary" TEXT,
    "shareholdingRegistryVersionId" TEXT,
    "appointmentRecordId" TEXT,
    "walletId" TEXT,
    "linkedApprovalId" TEXT,
    "internalApprovalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "filingStatus" TEXT NOT NULL DEFAULT 'REQUIRED',
    "receiptStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "effectivenessStatus" TEXT NOT NULL DEFAULT 'BLOCKED',
    "gateResult" TEXT NOT NULL DEFAULT 'BLOCKED',
    "filingRefNo" TEXT,
    "filingSubmittedAt" DATETIME,
    "latestFeedback" TEXT,
    "latestFeedbackAt" DATETIME,
    "receiptType" TEXT,
    "receiptRefNo" TEXT,
    "receiptBoundAt" DATETIME,
    "proposedEffectiveAt" DATETIME,
    "effectiveAt" DATETIME,
    "revokedAt" DATETIME,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "activeKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "regulatory_gate_items_shareholdingRegistryVersionId_fkey" FOREIGN KEY ("shareholdingRegistryVersionId") REFERENCES "shareholding_registry_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_appointmentRecordId_fkey" FOREIGN KEY ("appointmentRecordId") REFERENCES "appointment_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_linkedApprovalId_fkey" FOREIGN KEY ("linkedApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_regulatory_gate_items" ("activeKey", "appointmentRecordId", "authority", "createdAt", "createdByUserId", "effectiveAt", "effectivenessStatus", "filingRefNo", "filingStatus", "filingSubmittedAt", "gateNo", "gateResult", "gateType", "id", "internalApprovalStatus", "latestFeedback", "latestFeedbackAt", "linkedApprovalId", "metadataJson", "proposedEffectiveAt", "receiptBoundAt", "receiptRefNo", "receiptStatus", "receiptType", "revokedAt", "scopeSummary", "shareholdingRegistryVersionId", "subjectId", "subjectNo", "subjectType", "traceId", "updatedAt", "updatedByUserId", "walletId") SELECT "activeKey", "appointmentRecordId", "authority", "createdAt", "createdByUserId", "effectiveAt", "effectivenessStatus", "filingRefNo", "filingStatus", "filingSubmittedAt", "gateNo", "gateResult", "gateType", "id", "internalApprovalStatus", "latestFeedback", "latestFeedbackAt", "linkedApprovalId", "metadataJson", "proposedEffectiveAt", "receiptBoundAt", "receiptRefNo", "receiptStatus", "receiptType", "revokedAt", "scopeSummary", "shareholdingRegistryVersionId", "subjectId", "subjectNo", "subjectType", "traceId", "updatedAt", "updatedByUserId", "walletId" FROM "regulatory_gate_items";
DROP TABLE "regulatory_gate_items";
ALTER TABLE "new_regulatory_gate_items" RENAME TO "regulatory_gate_items";
CREATE UNIQUE INDEX "regulatory_gate_items_gateNo_key" ON "regulatory_gate_items"("gateNo");
CREATE UNIQUE INDEX "regulatory_gate_items_activeKey_key" ON "regulatory_gate_items"("activeKey");
CREATE INDEX "regulatory_gate_items_gateType_createdAt_idx" ON "regulatory_gate_items"("gateType", "createdAt");
CREATE INDEX "regulatory_gate_items_subjectType_subjectId_createdAt_idx" ON "regulatory_gate_items"("subjectType", "subjectId", "createdAt");
CREATE INDEX "regulatory_gate_items_subjectType_subjectNo_createdAt_idx" ON "regulatory_gate_items"("subjectType", "subjectNo", "createdAt");
CREATE INDEX "regulatory_gate_items_gateResult_createdAt_idx" ON "regulatory_gate_items"("gateResult", "createdAt");
CREATE INDEX "regulatory_gate_items_filingStatus_receiptStatus_effectivenessStatus_idx" ON "regulatory_gate_items"("filingStatus", "receiptStatus", "effectivenessStatus");
CREATE INDEX "regulatory_gate_items_traceId_createdAt_idx" ON "regulatory_gate_items"("traceId", "createdAt");
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
    "spreadAmount" DECIMAL,
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
INSERT INTO "new_swap_transactions" ("completedAt", "createdAt", "exchangeRate", "failureCode", "failureReason", "feeAmount", "feeBreakdown", "feeCurrency", "fromAmount", "fromAssetCode", "fromAssetId", "id", "netToAmount", "ownerId", "ownerNo", "ownerType", "quoteNo", "quoteSnapshotRef", "quote_id", "riskDecisionRef", "spreadAmount", "status", "statusHistory", "swapNo", "tbFeeTransferId", "tbFromTransferId", "tbSpreadTransferId", "tbToTransferId", "toAmount", "toAssetCode", "toAssetId", "traceId", "updatedAt") SELECT "completedAt", "createdAt", "exchangeRate", "failureCode", "failureReason", "feeAmount", "feeBreakdown", "feeCurrency", "fromAmount", "fromAssetCode", "fromAssetId", "id", "netToAmount", "ownerId", "ownerNo", "ownerType", "quoteNo", "quoteSnapshotRef", "quote_id", "riskDecisionRef", "spreadAmount", "status", "statusHistory", "swapNo", "tbFeeTransferId", "tbFromTransferId", "tbSpreadTransferId", "tbToTransferId", "toAmount", "toAssetCode", "toAssetId", "traceId", "updatedAt" FROM "swap_transactions";
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
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

