-- CreateTable
CREATE TABLE "fee_occurrences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "feeNo" TEXT NOT NULL,
    "feeType" TEXT NOT NULL,
    "occurrenceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "payer" TEXT NOT NULL DEFAULT 'PLATFORM',
    "chargedToCustomer" BOOLEAN NOT NULL DEFAULT false,
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "sourceEntityNo" TEXT,
    "sourceWalletId" TEXT,
    "sourceAccountRef" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "relatedEntityNo" TEXT,
    "reimbursementImpact" TEXT NOT NULL DEFAULT 'NONE',
    "poolRole" TEXT,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "evidenceRef" TEXT,
    "traceId" TEXT,
    "idempotencyKey" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cancelledAt" DATETIME,
    CONSTRAINT "fee_occurrences_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fee_occurrences_sourceWalletId_fkey" FOREIGN KEY ("sourceWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reimbursement_obligations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "obligationNo" TEXT NOT NULL,
    "feeOccurrenceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "poolRole" TEXT,
    "sourceWalletId" TEXT,
    "sourceAccountRef" TEXT,
    "settlementInternalTransactionId" TEXT,
    "settlementReferenceNo" TEXT,
    "reason" TEXT,
    "traceId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reimbursedAt" DATETIME,
    "cancelledAt" DATETIME,
    CONSTRAINT "reimbursement_obligations_feeOccurrenceId_fkey" FOREIGN KEY ("feeOccurrenceId") REFERENCES "fee_occurrences" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reimbursement_obligations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reimbursement_obligations_sourceWalletId_fkey" FOREIGN KEY ("sourceWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "reimbursement_obligations_settlementInternalTransactionId_fkey" FOREIGN KEY ("settlementInternalTransactionId") REFERENCES "internal_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "fee_occurrences_feeNo_key" ON "fee_occurrences"("feeNo");
CREATE UNIQUE INDEX "fee_occurrences_idempotencyKey_key" ON "fee_occurrences"("idempotencyKey");
CREATE INDEX "fee_occurrences_status_idx" ON "fee_occurrences"("status");
CREATE INDEX "fee_occurrences_feeType_occurrenceType_idx" ON "fee_occurrences"("feeType", "occurrenceType");
CREATE INDEX "fee_occurrences_assetId_createdAt_idx" ON "fee_occurrences"("assetId", "createdAt");
CREATE INDEX "fee_occurrences_sourceEntityType_sourceEntityId_idx" ON "fee_occurrences"("sourceEntityType", "sourceEntityId");
CREATE INDEX "fee_occurrences_relatedEntityType_relatedEntityId_idx" ON "fee_occurrences"("relatedEntityType", "relatedEntityId");
CREATE INDEX "fee_occurrences_reimbursementImpact_poolRole_idx" ON "fee_occurrences"("reimbursementImpact", "poolRole");
CREATE INDEX "fee_occurrences_traceId_idx" ON "fee_occurrences"("traceId");

-- CreateIndex
CREATE UNIQUE INDEX "reimbursement_obligations_obligationNo_key" ON "reimbursement_obligations"("obligationNo");
CREATE UNIQUE INDEX "reimbursement_obligations_feeOccurrenceId_key" ON "reimbursement_obligations"("feeOccurrenceId");
CREATE INDEX "reimbursement_obligations_status_idx" ON "reimbursement_obligations"("status");
CREATE INDEX "reimbursement_obligations_assetId_createdAt_idx" ON "reimbursement_obligations"("assetId", "createdAt");
CREATE INDEX "reimbursement_obligations_poolRole_status_idx" ON "reimbursement_obligations"("poolRole", "status");
CREATE INDEX "reimbursement_obligations_traceId_idx" ON "reimbursement_obligations"("traceId");
CREATE INDEX "reimbursement_obligations_settlementInternalTransactionId_idx" ON "reimbursement_obligations"("settlementInternalTransactionId");
