-- CreateTable
CREATE TABLE "deposit_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depositNo" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "txHash" TEXT,
    "referenceNo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "deposit_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "deposit_transactions_depositNo_key" ON "deposit_transactions"("depositNo");

-- CreateIndex
CREATE INDEX "deposit_transactions_depositNo_idx" ON "deposit_transactions"("depositNo");

-- CreateIndex
CREATE INDEX "deposit_transactions_ownerType_ownerId_idx" ON "deposit_transactions"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "deposit_transactions_status_idx" ON "deposit_transactions"("status");

-- CreateIndex
CREATE INDEX "deposit_transactions_createdAt_idx" ON "deposit_transactions"("createdAt");
