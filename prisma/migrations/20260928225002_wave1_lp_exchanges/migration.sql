-- CreateTable
CREATE TABLE "lp_exchanges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "exchangeNo" TEXT NOT NULL,
    "lpId" TEXT NOT NULL,
    "lpNo" TEXT NOT NULL,
    "sellAssetId" TEXT NOT NULL,
    "sellAmount" DECIMAL NOT NULL,
    "buyAssetId" TEXT NOT NULL,
    "buyAmount" DECIMAL NOT NULL,
    "prudentialPurpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "sellFromWalletId" TEXT NOT NULL,
    "buyViaWalletId" TEXT NOT NULL,
    "buyToWalletId" TEXT NOT NULL,
    "approvalNo" TEXT,
    "failureReasonCode" TEXT,
    "failureNote" TEXT,
    "executedAt" DATETIME,
    "deliveredAt" DATETIME,
    "settledAt" DATETIME,
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "lp_exchanges_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "liquidity_providers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lp_exchanges_sellAssetId_fkey" FOREIGN KEY ("sellAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lp_exchanges_buyAssetId_fkey" FOREIGN KEY ("buyAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_funds_orders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fundsOrderNo" TEXT NOT NULL,
    "depositTransactionId" TEXT,
    "swapTransactionId" TEXT,
    "withdrawTransactionId" TEXT,
    "internalTransferId" TEXT,
    "lpExchangeId" TEXT,
    "legSeq" INTEGER NOT NULL DEFAULT 1,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "netAmount" DECIMAL NOT NULL,
    "fromWalletId" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "toWalletId" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "providerTxnId" TEXT,
    "nonce" TEXT,
    "blockNo" TEXT,
    "gasUsed" TEXT,
    "effectiveGasPrice" TEXT,
    "sentAt" DATETIME,
    "confirmedAt" DATETIME,
    "completedAt" DATETIME,
    "statusHistory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "funds_orders_depositTransactionId_fkey" FOREIGN KEY ("depositTransactionId") REFERENCES "deposit_transactions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_swapTransactionId_fkey" FOREIGN KEY ("swapTransactionId") REFERENCES "swap_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_withdrawTransactionId_fkey" FOREIGN KEY ("withdrawTransactionId") REFERENCES "withdraw_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_internalTransferId_fkey" FOREIGN KEY ("internalTransferId") REFERENCES "internal_transfers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_lpExchangeId_fkey" FOREIGN KEY ("lpExchangeId") REFERENCES "lp_exchanges" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "funds_orders_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_funds_orders" ("amount", "assetId", "attempt", "blockNo", "completedAt", "confirmations", "confirmedAt", "createdAt", "depositTransactionId", "effectiveGasPrice", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "fundsOrderNo", "gasUsed", "id", "internalTransferId", "legSeq", "netAmount", "nonce", "providerTxnId", "referenceNo", "sentAt", "status", "statusHistory", "swapTransactionId", "toAddress", "toIban", "toWalletId", "txHash", "updatedAt", "withdrawTransactionId") SELECT "amount", "assetId", "attempt", "blockNo", "completedAt", "confirmations", "confirmedAt", "createdAt", "depositTransactionId", "effectiveGasPrice", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "fundsOrderNo", "gasUsed", "id", "internalTransferId", "legSeq", "netAmount", "nonce", "providerTxnId", "referenceNo", "sentAt", "status", "statusHistory", "swapTransactionId", "toAddress", "toIban", "toWalletId", "txHash", "updatedAt", "withdrawTransactionId" FROM "funds_orders";
DROP TABLE "funds_orders";
ALTER TABLE "new_funds_orders" RENAME TO "funds_orders";
CREATE UNIQUE INDEX "funds_orders_fundsOrderNo_key" ON "funds_orders"("fundsOrderNo");
CREATE INDEX "funds_orders_depositTransactionId_idx" ON "funds_orders"("depositTransactionId");
CREATE INDEX "funds_orders_swapTransactionId_legSeq_idx" ON "funds_orders"("swapTransactionId", "legSeq");
CREATE INDEX "funds_orders_withdrawTransactionId_idx" ON "funds_orders"("withdrawTransactionId");
CREATE INDEX "funds_orders_internalTransferId_idx" ON "funds_orders"("internalTransferId");
CREATE INDEX "funds_orders_lpExchangeId_idx" ON "funds_orders"("lpExchangeId");
CREATE INDEX "funds_orders_status_idx" ON "funds_orders"("status");
CREATE INDEX "funds_orders_txHash_idx" ON "funds_orders"("txHash");
CREATE INDEX "funds_orders_createdAt_idx" ON "funds_orders"("createdAt");
CREATE UNIQUE INDEX "funds_orders_swapTransactionId_legSeq_attempt_key" ON "funds_orders"("swapTransactionId", "legSeq", "attempt");
CREATE UNIQUE INDEX "funds_orders_internalTransferId_legSeq_attempt_key" ON "funds_orders"("internalTransferId", "legSeq", "attempt");
CREATE UNIQUE INDEX "funds_orders_lpExchangeId_legSeq_attempt_key" ON "funds_orders"("lpExchangeId", "legSeq", "attempt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "lp_exchanges_exchangeNo_key" ON "lp_exchanges"("exchangeNo");

-- CreateIndex
CREATE INDEX "lp_exchanges_status_idx" ON "lp_exchanges"("status");

-- CreateIndex
CREATE INDEX "lp_exchanges_lpNo_idx" ON "lp_exchanges"("lpNo");

