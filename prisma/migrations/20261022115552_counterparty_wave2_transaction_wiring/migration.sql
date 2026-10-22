/*
  Warnings:

  - You are about to drop the column `counterpartyIsVasp` on the `inbound_transfer_signals` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "deposit_transactions" ADD COLUMN "counterpartyVaspDid" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "knownSourceRef" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "sourceAttributedAt" DATETIME;
ALTER TABLE "deposit_transactions" ADD COLUMN "sourceClaimName" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "sourceClaimRelationship" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "sourceClaimType" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "sourceClaimedAt" DATETIME;

-- AlterTable
ALTER TABLE "withdraw_transactions" ADD COLUMN "beneficiaryName" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "beneficiaryType" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "counterpartyVaspDid" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "counterpartyVaspName" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "travelRuleSnapshotJson" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "withdrawalAddressNo" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_inbound_transfer_signals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalNo" TEXT NOT NULL DEFAULT 'TEMP',
    "ownerId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "txHash" TEXT,
    "referenceNo" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "simulationRiskLevel" TEXT,
    "simulationRiskReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SCAN',
    "dedupeKey" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanResult" TEXT,
    "supplementOfExternalLineId" TEXT,
    "supplementReconCaseNo" TEXT,
    "supplementDispositionNo" TEXT,
    "supplementEffectiveDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "inbound_transfer_signals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbound_transfer_signals_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbound_transfer_signals_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_inbound_transfer_signals" ("amount", "assetId", "channelType", "createdAt", "dedupeKey", "fromAddress", "fromIban", "id", "ownerId", "referenceNo", "scanResult", "signalNo", "simulationRiskLevel", "simulationRiskReason", "status", "submittedAt", "supplementDispositionNo", "supplementEffectiveDate", "supplementOfExternalLineId", "supplementReconCaseNo", "txHash", "updatedAt", "walletId") SELECT "amount", "assetId", "channelType", "createdAt", "dedupeKey", "fromAddress", "fromIban", "id", "ownerId", "referenceNo", "scanResult", "signalNo", "simulationRiskLevel", "simulationRiskReason", "status", "submittedAt", "supplementDispositionNo", "supplementEffectiveDate", "supplementOfExternalLineId", "supplementReconCaseNo", "txHash", "updatedAt", "walletId" FROM "inbound_transfer_signals";
DROP TABLE "inbound_transfer_signals";
ALTER TABLE "new_inbound_transfer_signals" RENAME TO "inbound_transfer_signals";
CREATE UNIQUE INDEX "inbound_transfer_signals_signalNo_key" ON "inbound_transfer_signals"("signalNo");
CREATE UNIQUE INDEX "inbound_transfer_signals_dedupeKey_key" ON "inbound_transfer_signals"("dedupeKey");
CREATE UNIQUE INDEX "inbound_transfer_signals_supplementOfExternalLineId_key" ON "inbound_transfer_signals"("supplementOfExternalLineId");
CREATE INDEX "inbound_transfer_signals_ownerId_walletId_status_idx" ON "inbound_transfer_signals"("ownerId", "walletId", "status");
CREATE INDEX "inbound_transfer_signals_walletId_submittedAt_idx" ON "inbound_transfer_signals"("walletId", "submittedAt");
CREATE INDEX "inbound_transfer_signals_txHash_idx" ON "inbound_transfer_signals"("txHash");
CREATE INDEX "inbound_transfer_signals_referenceNo_idx" ON "inbound_transfer_signals"("referenceNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
