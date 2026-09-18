-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetNo" TEXT,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "network" TEXT,
    "decimals" INTEGER NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tbLedgerId" INTEGER,
    "contractAddress" TEXT,
    "minDepositAmount" REAL,
    "maxDepositAmount" REAL,
    "minWithdrawAmount" REAL,
    "maxWithdrawAmount" REAL,
    "depositEnabled" BOOLEAN NOT NULL DEFAULT true,
    "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_assets" ("assetNo", "code", "createdAt", "decimals", "description", "id", "network", "status", "tbLedgerId", "type", "updatedAt") SELECT "assetNo", "code", "createdAt", "decimals", "description", "id", "network", "status", "tbLedgerId", "type", "updatedAt" FROM "assets";
DROP TABLE "assets";
ALTER TABLE "new_assets" RENAME TO "assets";
CREATE UNIQUE INDEX "assets_assetNo_key" ON "assets"("assetNo");
CREATE UNIQUE INDEX "assets_tbLedgerId_key" ON "assets"("tbLedgerId");
CREATE UNIQUE INDEX "assets_type_code_network_key" ON "assets"("type", "code", "network");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
