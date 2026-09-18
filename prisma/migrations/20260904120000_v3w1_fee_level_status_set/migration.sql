/*
  Warnings:

  - You are about to drop the column `enabled` on the `withdrawal_fee_levels` table. All the data in the column will be lost.
  - You are about to drop the column `failureReason` on the `withdrawal_fee_level_change_requests` table. All the data in the column will be lost.
  - You are about to drop the column `enabled` on the `swap_fee_levels` table. All the data in the column will be lost.
  - You are about to drop the column `failureReason` on the `swap_fee_level_change_requests` table. All the data in the column will be lost.
  - Made the column `requestNo` on table `withdrawal_fee_level_change_requests` required without a default. This step will fail if there are existing NULL values in that column.
  - Made the column `requestNo` on table `swap_fee_level_change_requests` required without a default. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdrawal_fee_levels_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_withdrawal_fee_levels" ("id", "levelCode", "name", "assetId", "isDefault", "tiersJson", "configHash", "requiredTagsJson", "validFrom", "validTo", "status", "approvalCaseId", "approvalCaseNo", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt") SELECT "id", "levelCode", "name", "assetId", "isDefault", "tiersJson", "configHash", "requiredTagsJson", "validFrom", "validTo", "status", "approvalCaseId", "approvalCaseNo", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt" FROM "withdrawal_fee_levels";
DROP TABLE "withdrawal_fee_levels";
ALTER TABLE "new_withdrawal_fee_levels" RENAME TO "withdrawal_fee_levels";
CREATE UNIQUE INDEX "withdrawal_fee_levels_levelCode_key" ON "withdrawal_fee_levels"("levelCode");
CREATE INDEX "withdrawal_fee_levels_assetId_status_idx" ON "withdrawal_fee_levels"("assetId", "status");
CREATE TABLE "new_withdrawal_fee_level_change_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdrawal_fee_level_change_requests_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "withdrawal_fee_levels" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_withdrawal_fee_level_change_requests" ("id", "requestNo", "levelId", "levelCode", "currentTiersJson", "currentConfigHash", "proposedTiersJson", "changeReason", "status", "requestedByUserId", "approvalCaseId", "approvalCaseNo", "executedAt", "createdAt", "updatedAt") SELECT "id", "requestNo", "levelId", "levelCode", "currentTiersJson", "currentConfigHash", "proposedTiersJson", "changeReason", "status", "requestedByUserId", "approvalCaseId", "approvalCaseNo", "executedAt", "createdAt", "updatedAt" FROM "withdrawal_fee_level_change_requests";
DROP TABLE "withdrawal_fee_level_change_requests";
ALTER TABLE "new_withdrawal_fee_level_change_requests" RENAME TO "withdrawal_fee_level_change_requests";
CREATE UNIQUE INDEX "withdrawal_fee_level_change_requests_requestNo_key" ON "withdrawal_fee_level_change_requests"("requestNo");
CREATE INDEX "withdrawal_fee_level_change_requests_levelId_status_idx" ON "withdrawal_fee_level_change_requests"("levelId", "status");
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
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "swap_fee_levels_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_fee_levels_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_swap_fee_levels" ("id", "levelCode", "name", "fromAssetId", "toAssetId", "isDefault", "tiersJson", "configHash", "requiredTagsJson", "validFrom", "validTo", "status", "approvalCaseId", "approvalCaseNo", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt") SELECT "id", "levelCode", "name", "fromAssetId", "toAssetId", "isDefault", "tiersJson", "configHash", "requiredTagsJson", "validFrom", "validTo", "status", "approvalCaseId", "approvalCaseNo", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt" FROM "swap_fee_levels";
DROP TABLE "swap_fee_levels";
ALTER TABLE "new_swap_fee_levels" RENAME TO "swap_fee_levels";
CREATE UNIQUE INDEX "swap_fee_levels_levelCode_key" ON "swap_fee_levels"("levelCode");
CREATE INDEX "swap_fee_levels_fromAssetId_toAssetId_status_idx" ON "swap_fee_levels"("fromAssetId", "toAssetId", "status");
CREATE TABLE "new_swap_fee_level_change_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "swap_fee_level_change_requests_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "swap_fee_levels" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_swap_fee_level_change_requests" ("id", "requestNo", "levelId", "levelCode", "currentTiersJson", "currentConfigHash", "proposedTiersJson", "changeReason", "status", "requestedByUserId", "approvalCaseId", "approvalCaseNo", "executedAt", "createdAt", "updatedAt") SELECT "id", "requestNo", "levelId", "levelCode", "currentTiersJson", "currentConfigHash", "proposedTiersJson", "changeReason", "status", "requestedByUserId", "approvalCaseId", "approvalCaseNo", "executedAt", "createdAt", "updatedAt" FROM "swap_fee_level_change_requests";
DROP TABLE "swap_fee_level_change_requests";
ALTER TABLE "new_swap_fee_level_change_requests" RENAME TO "swap_fee_level_change_requests";
CREATE UNIQUE INDEX "swap_fee_level_change_requests_requestNo_key" ON "swap_fee_level_change_requests"("requestNo");
CREATE INDEX "swap_fee_level_change_requests_levelId_status_idx" ON "swap_fee_level_change_requests"("levelId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
