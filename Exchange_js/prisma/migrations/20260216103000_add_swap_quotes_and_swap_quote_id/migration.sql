CREATE TABLE "swap_quotes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "quoteType" TEXT NOT NULL DEFAULT 'FIRM',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
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
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "swap_quotes_fromAssetId_fkey"
    FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "swap_quotes_toAssetId_fkey"
    FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "swap_quotes_ownerType_ownerId_idx"
ON "swap_quotes"("ownerType", "ownerId");

CREATE INDEX "swap_quotes_status_expiresAt_idx"
ON "swap_quotes"("status", "expiresAt");

CREATE INDEX "swap_quotes_createdAt_idx"
ON "swap_quotes"("createdAt");

ALTER TABLE "swap_transactions"
ADD COLUMN "quote_id" TEXT REFERENCES "swap_quotes" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "swap_transactions_quote_id_key"
ON "swap_transactions"("quote_id");
