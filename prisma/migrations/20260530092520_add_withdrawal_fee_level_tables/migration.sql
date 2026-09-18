-- AlterTable
ALTER TABLE "withdraw_pricing_quotes" ADD COLUMN "feeLevelCode" TEXT;
ALTER TABLE "withdraw_pricing_quotes" ADD COLUMN "feeLevelId" TEXT;

-- CreateTable
CREATE TABLE "withdrawal_fee_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "levelCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tiersJson" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdrawal_fee_levels_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "withdrawal_fee_level_change_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL DEFAULT 'TEMP',
    "levelId" TEXT NOT NULL,
    "levelCode" TEXT NOT NULL,
    "currentTiersJson" TEXT NOT NULL,
    "currentConfigHash" TEXT NOT NULL,
    "proposedTiersJson" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedByUserId" TEXT NOT NULL,
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "executedAt" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdrawal_fee_level_change_requests_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "withdrawal_fee_levels" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "withdrawal_fee_level_bindings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "boundByUserId" TEXT NOT NULL,
    "boundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withdrawal_fee_level_bindings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "withdrawal_fee_level_bindings_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "withdrawal_fee_levels" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_fee_levels_levelCode_key" ON "withdrawal_fee_levels"("levelCode");

-- CreateIndex
CREATE INDEX "withdrawal_fee_levels_assetId_status_enabled_idx" ON "withdrawal_fee_levels"("assetId", "status", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_fee_level_change_requests_requestNo_key" ON "withdrawal_fee_level_change_requests"("requestNo");

-- CreateIndex
CREATE INDEX "withdrawal_fee_level_change_requests_levelId_status_idx" ON "withdrawal_fee_level_change_requests"("levelId", "status");

-- CreateIndex
CREATE INDEX "withdrawal_fee_level_bindings_customerId_idx" ON "withdrawal_fee_level_bindings"("customerId");

-- CreateIndex
CREATE INDEX "withdrawal_fee_level_bindings_levelId_idx" ON "withdrawal_fee_level_bindings"("levelId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_fee_level_bindings_customerId_levelId_key" ON "withdrawal_fee_level_bindings"("customerId", "levelId");
