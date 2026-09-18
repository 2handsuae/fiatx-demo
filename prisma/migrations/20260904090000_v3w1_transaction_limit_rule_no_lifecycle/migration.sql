/*
  Warnings:

  - You are about to drop the column `approvalCaseId` on the `transaction_limit_rules` table. All the data in the column will be lost.
  - You are about to drop the column `cap` on the `transaction_limit_rules` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `transaction_limit_rules` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_transaction_limit_rules" (
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
    "threshold" DECIMAL,
    "approvalCaseNo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_transaction_limit_rules" ("approvalCaseNo", "assetId", "createdAt", "defaultLimit", "gateType", "id", "maxAmount", "minAmount", "operationType", "period", "ruleNo", "threshold", "tradingTier", "updatedAt") SELECT "approvalCaseNo", "assetId", "createdAt", "defaultLimit", "gateType", "id", "maxAmount", "minAmount", "operationType", "period", "ruleNo", "threshold", "tradingTier", "updatedAt" FROM "transaction_limit_rules";
DROP TABLE "transaction_limit_rules";
ALTER TABLE "new_transaction_limit_rules" RENAME TO "transaction_limit_rules";
CREATE UNIQUE INDEX "transaction_limit_rules_ruleNo_key" ON "transaction_limit_rules"("ruleNo");
CREATE INDEX "transaction_limit_rules_gateType_idx" ON "transaction_limit_rules"("gateType");
CREATE UNIQUE INDEX "transaction_limit_rules_gateType_operationType_assetId_tradingTier_period_key" ON "transaction_limit_rules"("gateType", "operationType", "assetId", "tradingTier", "period");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
