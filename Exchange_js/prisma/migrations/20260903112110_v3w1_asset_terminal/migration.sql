/*
  Warnings:

  - You are about to drop the column `approvalCaseId` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `depositEnabled` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `maxDepositAmount` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `maxWithdrawAmount` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `minDepositAmount` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `minWithdrawAmount` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `preSuspendDepositEnabled` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `preSuspendWithdrawalEnabled` on the `assets` table. All the data in the column will be lost.
  - You are about to drop the column `withdrawalEnabled` on the `assets` table. All the data in the column will be lost.
  - Made the column `assetNo` on table `assets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `network` on table `assets` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "description" TEXT,
    "contractAddress" TEXT,
    "isNative" BOOLEAN NOT NULL DEFAULT true,
    "standard" TEXT,
    "minConfirmations" INTEGER NOT NULL DEFAULT 0,
    "custodianAssetKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tbLedgerId" INTEGER,
    "approvalCaseNo" TEXT,
    "suspendedAt" DATETIME,
    "suspendReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_assets" ("approvalCaseNo", "assetNo", "code", "contractAddress", "createdAt", "currency", "decimals", "description", "id", "network", "status", "suspendReason", "suspendedAt", "tbLedgerId", "type", "updatedAt") SELECT "approvalCaseNo", "assetNo", "code", "contractAddress", "createdAt", "currency", "decimals", "description", "id", "network", "status", "suspendReason", "suspendedAt", "tbLedgerId", "type", "updatedAt" FROM "assets";
DROP TABLE "assets";
ALTER TABLE "new_assets" RENAME TO "assets";
CREATE UNIQUE INDEX "assets_assetNo_key" ON "assets"("assetNo");
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");
CREATE UNIQUE INDEX "assets_tbLedgerId_key" ON "assets"("tbLedgerId");
CREATE UNIQUE INDEX "assets_type_currency_network_key" ON "assets"("type", "currency", "network");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
