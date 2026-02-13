-- CreateTable
CREATE TABLE "swap_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "swapNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "fromAmount" DECIMAL NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "toAmount" DECIMAL NOT NULL,
    "exchangeRate" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "swap_transactions_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_transactions_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "swap_transactions_swapNo_key" ON "swap_transactions"("swapNo");

-- CreateIndex
CREATE INDEX "swap_transactions_swapNo_idx" ON "swap_transactions"("swapNo");

-- CreateIndex
CREATE INDEX "swap_transactions_ownerType_ownerId_idx" ON "swap_transactions"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "swap_transactions_status_idx" ON "swap_transactions"("status");

-- CreateIndex
CREATE INDEX "swap_transactions_createdAt_idx" ON "swap_transactions"("createdAt");
