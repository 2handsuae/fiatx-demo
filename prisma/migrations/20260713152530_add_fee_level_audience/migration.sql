-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_swap_fee_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "levelCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
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
INSERT INTO "new_swap_fee_levels" ("approvalCaseId", "approvalCaseNo", "configHash", "createdAt", "createdByUserId", "enabled", "fromAssetId", "id", "isDefault", "levelCode", "name", "status", "tiersJson", "toAssetId", "updatedAt", "updatedByUserId") SELECT "approvalCaseId", "approvalCaseNo", "configHash", "createdAt", "createdByUserId", "enabled", "fromAssetId", "id", "isDefault", "levelCode", "name", "status", "tiersJson", "toAssetId", "updatedAt", "updatedByUserId" FROM "swap_fee_levels";
DROP TABLE "swap_fee_levels";
ALTER TABLE "new_swap_fee_levels" RENAME TO "swap_fee_levels";
CREATE UNIQUE INDEX "swap_fee_levels_levelCode_key" ON "swap_fee_levels"("levelCode");
CREATE INDEX "swap_fee_levels_fromAssetId_toAssetId_status_enabled_idx" ON "swap_fee_levels"("fromAssetId", "toAssetId", "status", "enabled");
CREATE TABLE "new_withdrawal_fee_levels" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "levelCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
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
INSERT INTO "new_withdrawal_fee_levels" ("approvalCaseId", "approvalCaseNo", "assetId", "configHash", "createdAt", "createdByUserId", "enabled", "id", "isDefault", "levelCode", "name", "status", "tiersJson", "updatedAt", "updatedByUserId") SELECT "approvalCaseId", "approvalCaseNo", "assetId", "configHash", "createdAt", "createdByUserId", "enabled", "id", "isDefault", "levelCode", "name", "status", "tiersJson", "updatedAt", "updatedByUserId" FROM "withdrawal_fee_levels";
DROP TABLE "withdrawal_fee_levels";
ALTER TABLE "new_withdrawal_fee_levels" RENAME TO "withdrawal_fee_levels";
CREATE UNIQUE INDEX "withdrawal_fee_levels_levelCode_key" ON "withdrawal_fee_levels"("levelCode");
CREATE INDEX "withdrawal_fee_levels_assetId_status_enabled_idx" ON "withdrawal_fee_levels"("assetId", "status", "enabled");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
