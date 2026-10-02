-- CreateTable
CREATE TABLE "trade_confirmations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "confirmationNo" TEXT NOT NULL,
    "swapNo" TEXT NOT NULL,
    "quoteNo" TEXT,
    "ownerCustomerNo" TEXT NOT NULL,
    "fromAmount" DECIMAL NOT NULL,
    "fromAssetCode" TEXT NOT NULL,
    "toAmount" DECIMAL NOT NULL,
    "netToAmount" DECIMAL,
    "feeAmount" DECIMAL,
    "feeCurrency" TEXT,
    "feeLines" TEXT NOT NULL DEFAULT '[]',
    "exchangeRate" DECIMAL NOT NULL,
    "marketRate" DECIMAL,
    "rateSource" TEXT,
    "fetchedAt" DATETIME,
    "spreadPercent" DECIMAL,
    "spreadAmount" DECIMAL,
    "tradedAt" DATETIME NOT NULL,
    "settledAt" DATETIME,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_confirmations_confirmationNo_key" ON "trade_confirmations"("confirmationNo");

-- CreateIndex
CREATE UNIQUE INDEX "trade_confirmations_swapNo_key" ON "trade_confirmations"("swapNo");

-- CreateIndex
CREATE INDEX "trade_confirmations_ownerCustomerNo_idx" ON "trade_confirmations"("ownerCustomerNo");
