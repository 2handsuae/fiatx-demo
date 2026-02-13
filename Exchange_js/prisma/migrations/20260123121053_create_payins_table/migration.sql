-- CreateTable
CREATE TABLE "payins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depositId" TEXT,
    "status" TEXT NOT NULL,
    "toWalletId" TEXT,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "toAddress" TEXT,
    "toIban" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "providerTxnId" TEXT,
    "kytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kytScreeningId" TEXT,
    "kytRiskScore" INTEGER,
    "kytCheckedAt" DATETIME,
    "travelRuleRequired" BOOLEAN NOT NULL DEFAULT false,
    "travelRuleStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "travelRuleTransferId" TEXT,
    "counterpartyVasp" TEXT,
    "travelRuleCheckedAt" DATETIME,
    "receivedAt" DATETIME,
    "confirmedAt" DATETIME,
    "statusHistory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "payins_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payins_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "payins_depositId_idx" ON "payins"("depositId");

-- CreateIndex
CREATE INDEX "payins_status_idx" ON "payins"("status");

-- CreateIndex
CREATE INDEX "payins_assetId_idx" ON "payins"("assetId");

-- CreateIndex
CREATE INDEX "payins_receivedAt_idx" ON "payins"("receivedAt");

-- CreateIndex
CREATE INDEX "payins_providerTxnId_idx" ON "payins"("providerTxnId");

-- CreateIndex
CREATE INDEX "payins_txHash_idx" ON "payins"("txHash");
