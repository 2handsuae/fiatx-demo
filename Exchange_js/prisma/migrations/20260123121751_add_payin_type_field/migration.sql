-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_payins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depositId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'crypto',
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
INSERT INTO "new_payins" ("amount", "assetId", "confirmations", "confirmedAt", "counterpartyVasp", "createdAt", "depositId", "fromAddress", "fromIban", "id", "kytCheckedAt", "kytRiskScore", "kytScreeningId", "kytStatus", "providerTxnId", "receivedAt", "referenceNo", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "travelRuleCheckedAt", "travelRuleRequired", "travelRuleStatus", "travelRuleTransferId", "txHash", "updatedAt") SELECT "amount", "assetId", "confirmations", "confirmedAt", "counterpartyVasp", "createdAt", "depositId", "fromAddress", "fromIban", "id", "kytCheckedAt", "kytRiskScore", "kytScreeningId", "kytStatus", "providerTxnId", "receivedAt", "referenceNo", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "travelRuleCheckedAt", "travelRuleRequired", "travelRuleStatus", "travelRuleTransferId", "txHash", "updatedAt" FROM "payins";
DROP TABLE "payins";
ALTER TABLE "new_payins" RENAME TO "payins";
CREATE INDEX "payins_depositId_idx" ON "payins"("depositId");
CREATE INDEX "payins_status_idx" ON "payins"("status");
CREATE INDEX "payins_assetId_idx" ON "payins"("assetId");
CREATE INDEX "payins_receivedAt_idx" ON "payins"("receivedAt");
CREATE INDEX "payins_providerTxnId_idx" ON "payins"("providerTxnId");
CREATE INDEX "payins_txHash_idx" ON "payins"("txHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill type based on asset type
UPDATE "payins"
SET "type" = (
    SELECT CASE 
        WHEN "assets"."type" = 'CRYPTO' THEN 'crypto'
        WHEN "assets"."type" = 'FIAT' THEN 'fiat'
        ELSE 'crypto' -- Default fallback
    END
    FROM "assets"
    WHERE "assets"."id" = "payins"."assetId"
);

