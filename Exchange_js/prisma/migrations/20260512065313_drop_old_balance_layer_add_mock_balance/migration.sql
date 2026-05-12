/*
  Warnings:

  - You are about to drop the `journal_lines` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `wallet_balance_entries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `wallet_balance_snapshots` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "journal_lines_journalId_lineNo_key";

-- DropIndex
DROP INDEX "journal_lines_walletId_assetId_idx";

-- DropIndex
DROP INDEX "journal_lines_walletId_idx";

-- DropIndex
DROP INDEX "journal_lines_journalLineTemplateId_idx";

-- DropIndex
DROP INDEX "journal_lines_accountCode_ownerType_ownerId_idx";

-- DropIndex
DROP INDEX "journal_lines_ownerType_ownerId_idx";

-- DropIndex
DROP INDEX "journal_lines_assetId_idx";

-- DropIndex
DROP INDEX "journal_lines_accountCode_idx";

-- DropIndex
DROP INDEX "journal_lines_journalId_idx";

-- DropIndex
DROP INDEX "wallet_balance_entries_createdAt_idx";

-- DropIndex
DROP INDEX "wallet_balance_entries_walletId_assetId_idx";

-- DropIndex
DROP INDEX "wallet_balance_entries_journalLineId_key";

-- DropIndex
DROP INDEX "wallet_balance_snapshots_assetId_idx";

-- DropIndex
DROP INDEX "wallet_balance_snapshots_walletId_idx";

-- DropIndex
DROP INDEX "wallet_balance_snapshots_walletId_assetId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "journal_lines";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "wallet_balance_entries";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "wallet_balance_snapshots";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_wallets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerNo" TEXT,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "walletRole" TEXT NOT NULL DEFAULT 'GENERAL',
    "assetId" TEXT NOT NULL,
    "address" TEXT,
    "memo" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "bankCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mockBalance" DECIMAL NOT NULL DEFAULT 0,
    "regulatoryEnablementStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "regulatoryEnabledAt" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "accountName" TEXT,
    "beneficiaryName" TEXT,
    "counterpartyVasp" TEXT,
    "iban" TEXT,
    CONSTRAINT "wallets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_wallets" ("accountName", "address", "assetId", "bankAccount", "bankCode", "bankName", "beneficiaryName", "counterpartyVasp", "created_at", "direction", "iban", "id", "memo", "ownerId", "ownerNo", "ownerType", "regulatoryEnabledAt", "regulatoryEnablementStatus", "status", "type", "updated_at", "walletNo", "walletRole") SELECT "accountName", "address", "assetId", "bankAccount", "bankCode", "bankName", "beneficiaryName", "counterpartyVasp", "created_at", "direction", "iban", "id", "memo", "ownerId", "ownerNo", "ownerType", "regulatoryEnabledAt", "regulatoryEnablementStatus", "status", "type", "updated_at", "walletNo", "walletRole" FROM "wallets";
DROP TABLE "wallets";
ALTER TABLE "new_wallets" RENAME TO "wallets";
CREATE UNIQUE INDEX "wallets_walletNo_key" ON "wallets"("walletNo");
CREATE INDEX "wallets_ownerType_ownerId_idx" ON "wallets"("ownerType", "ownerId");
CREATE INDEX "wallets_assetId_idx" ON "wallets"("assetId");
CREATE INDEX "wallets_status_idx" ON "wallets"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
