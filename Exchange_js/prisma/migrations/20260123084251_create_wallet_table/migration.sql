-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "lockedBalance" DECIMAL NOT NULL DEFAULT 0,
    "address" TEXT,
    "memo" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "bankCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "wallets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "wallets_ownerType_ownerId_idx" ON "wallets"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "wallets_assetId_idx" ON "wallets"("assetId");

-- CreateIndex
CREATE INDEX "wallets_status_idx" ON "wallets"("status");
