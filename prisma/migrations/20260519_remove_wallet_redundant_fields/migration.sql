-- DropColumns: Remove 10 redundant fields from wallets table
-- Data cleanup: FIAT vaultId already cleaned before this migration

-- SQLite doesn't support DROP COLUMN in older versions, but modern SQLite (3.35+) does.
-- Prisma's SQLite driver uses modern SQLite.

-- RedefineTables
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_wallets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerNo" TEXT,
    "type" TEXT NOT NULL,
    "walletRole" TEXT NOT NULL DEFAULT 'GENERAL',
    "assetId" TEXT NOT NULL,
    "address" TEXT,
    "bankName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mockBalance" DECIMAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "accountName" TEXT,
    "iban" TEXT,
    "vaultId" TEXT,
    CONSTRAINT "wallets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_wallets" ("id", "walletNo", "ownerType", "ownerId", "ownerNo", "type", "walletRole", "assetId", "address", "bankName", "status", "mockBalance", "created_at", "updated_at", "accountName", "iban", "vaultId")
SELECT "id", "walletNo", "ownerType", "ownerId", "ownerNo", "type", "walletRole", "assetId", "address", "bankName", "status", "mockBalance", "created_at", "updated_at", "accountName", "iban", "vaultId"
FROM "wallets";

DROP TABLE "wallets";
ALTER TABLE "new_wallets" RENAME TO "wallets";

CREATE UNIQUE INDEX "wallets_walletNo_key" ON "wallets"("walletNo");
CREATE INDEX "wallets_ownerType_ownerId_idx" ON "wallets"("ownerType", "ownerId");
CREATE INDEX "wallets_assetId_idx" ON "wallets"("assetId");
CREATE INDEX "wallets_status_idx" ON "wallets"("status");

PRAGMA foreign_keys=ON;
