-- CreateTable
CREATE TABLE "liquidity_configurations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lpId" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "rateSourceType" TEXT NOT NULL,
    "feePercent" DECIMAL NOT NULL DEFAULT 0,
    "feeFixedAmount" DECIMAL NOT NULL DEFAULT 0,
    "feeAssetId" TEXT,
    "minFromAmount" DECIMAL,
    "maxFromAmount" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "liquidity_configurations_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "liquidity_provider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "liquidity_configurations_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "liquidity_configurations_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "liquidity_configurations_feeAssetId_fkey" FOREIGN KEY ("feeAssetId") REFERENCES "assets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "liquidity_configurations_lpId_idx" ON "liquidity_configurations"("lpId");

-- CreateIndex
CREATE INDEX "liquidity_configurations_fromAssetId_toAssetId_idx" ON "liquidity_configurations"("fromAssetId", "toAssetId");

-- CreateIndex
CREATE INDEX "liquidity_configurations_status_idx" ON "liquidity_configurations"("status");
