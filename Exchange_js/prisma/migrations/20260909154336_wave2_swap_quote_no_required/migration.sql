/*
  Warnings:

  - Made the column `quoteNo` on table `swap_quotes` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_swap_quotes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteNo" TEXT NOT NULL,
    "quoteType" TEXT NOT NULL DEFAULT 'FIRM',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "fromAssetId" TEXT NOT NULL,
    "fromAssetCode" TEXT NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "toAssetCode" TEXT NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'SELL_BASE',
    "amountType" TEXT NOT NULL DEFAULT 'EXACT_IN',
    "amountIn" DECIMAL NOT NULL,
    "currencyIn" TEXT NOT NULL,
    "amountOut" DECIMAL NOT NULL,
    "currencyOut" TEXT NOT NULL,
    "rateDisplay" DECIMAL NOT NULL,
    "rateAllIn" DECIMAL NOT NULL,
    "marketRate" DECIMAL NOT NULL,
    "spreadPercent" DECIMAL NOT NULL DEFAULT 0,
    "spreadBps" INTEGER NOT NULL DEFAULT 0,
    "rateSource" TEXT NOT NULL DEFAULT 'BINANCE',
    "fetchedAt" DATETIME NOT NULL,
    "feeTotal" DECIMAL NOT NULL DEFAULT 0,
    "feeCurrency" TEXT NOT NULL,
    "feeBreakdown" TEXT,
    "totalsJson" TEXT NOT NULL DEFAULT '{}',
    "policyRef" TEXT NOT NULL DEFAULT '{}',
    "feeLevelId" TEXT,
    "feeLevelCode" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "cancelledAt" DATETIME,
    "traceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "swap_quotes_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_quotes_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_swap_quotes" ("amountIn", "amountOut", "amountType", "cancelledAt", "createdAt", "currencyIn", "currencyOut", "expiresAt", "feeBreakdown", "feeCurrency", "feeLevelCode", "feeLevelId", "feeTotal", "fetchedAt", "fromAssetCode", "fromAssetId", "id", "marketRate", "ownerId", "ownerNo", "ownerType", "policyRef", "quoteNo", "quoteType", "rateAllIn", "rateDisplay", "rateSource", "side", "spreadBps", "spreadPercent", "status", "toAssetCode", "toAssetId", "totalsJson", "traceId", "updatedAt", "usedAt") SELECT "amountIn", "amountOut", "amountType", "cancelledAt", "createdAt", "currencyIn", "currencyOut", "expiresAt", "feeBreakdown", "feeCurrency", "feeLevelCode", "feeLevelId", "feeTotal", "fetchedAt", "fromAssetCode", "fromAssetId", "id", "marketRate", "ownerId", "ownerNo", "ownerType", "policyRef", "quoteNo", "quoteType", "rateAllIn", "rateDisplay", "rateSource", "side", "spreadBps", "spreadPercent", "status", "toAssetCode", "toAssetId", "totalsJson", "traceId", "updatedAt", "usedAt" FROM "swap_quotes";
DROP TABLE "swap_quotes";
ALTER TABLE "new_swap_quotes" RENAME TO "swap_quotes";
CREATE UNIQUE INDEX "swap_quotes_quoteNo_key" ON "swap_quotes"("quoteNo");
CREATE INDEX "swap_quotes_ownerType_ownerId_idx" ON "swap_quotes"("ownerType", "ownerId");
CREATE INDEX "swap_quotes_status_expiresAt_idx" ON "swap_quotes"("status", "expiresAt");
CREATE INDEX "swap_quotes_createdAt_idx" ON "swap_quotes"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
