-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_internal_funds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "internalFundNo" TEXT NOT NULL,
    "internalTransactionId" TEXT,
    "swapTransactionId" TEXT,
    "legSeq" INTEGER,
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
    CONSTRAINT "internal_funds_internalTransactionId_fkey" FOREIGN KEY ("internalTransactionId") REFERENCES "internal_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_funds_swapTransactionId_fkey" FOREIGN KEY ("swapTransactionId") REFERENCES "swap_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "internal_funds_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "internal_funds_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "internal_funds_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_internal_funds" ("amount", "assetId", "blockNo", "completedAt", "confirmations", "confirmedAt", "createdAt", "effectiveGasPrice", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "gasUsed", "id", "internalFundNo", "internalTransactionId", "netAmount", "nonce", "providerTxnId", "referenceNo", "sentAt", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "txHash", "updatedAt") SELECT "amount", "assetId", "blockNo", "completedAt", "confirmations", "confirmedAt", "createdAt", "effectiveGasPrice", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "gasUsed", "id", "internalFundNo", "internalTransactionId", "netAmount", "nonce", "providerTxnId", "referenceNo", "sentAt", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "txHash", "updatedAt" FROM "internal_funds";
DROP TABLE "internal_funds";
ALTER TABLE "new_internal_funds" RENAME TO "internal_funds";
CREATE UNIQUE INDEX "internal_funds_internalFundNo_key" ON "internal_funds"("internalFundNo");
CREATE INDEX "internal_funds_internalTransactionId_idx" ON "internal_funds"("internalTransactionId");
CREATE INDEX "internal_funds_swapTransactionId_idx" ON "internal_funds"("swapTransactionId");
CREATE INDEX "internal_funds_status_idx" ON "internal_funds"("status");
CREATE INDEX "internal_funds_txHash_idx" ON "internal_funds"("txHash");
CREATE INDEX "internal_funds_createdAt_idx" ON "internal_funds"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
