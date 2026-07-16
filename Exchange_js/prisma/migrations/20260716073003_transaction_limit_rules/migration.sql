-- AlterTable
ALTER TABLE "swap_transactions" ADD COLUMN "grossAedValue" DECIMAL;

-- CreateTable
CREATE TABLE "transaction_limit_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleNo" TEXT NOT NULL,
    "gateType" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "assetId" TEXT,
    "tradingTier" TEXT,
    "period" TEXT,
    "minAmount" DECIMAL,
    "maxAmount" DECIMAL,
    "defaultLimit" DECIMAL,
    "cap" DECIMAL,
    "threshold" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approvalCaseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_limit_rules_ruleNo_key" ON "transaction_limit_rules"("ruleNo");

-- CreateIndex
CREATE INDEX "transaction_limit_rules_gateType_status_idx" ON "transaction_limit_rules"("gateType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_limit_rules_gateType_operationType_assetId_tradingTier_period_key" ON "transaction_limit_rules"("gateType", "operationType", "assetId", "tradingTier", "period");
