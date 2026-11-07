-- AlterTable
ALTER TABLE "reconciliation_dispositions" ADD COLUMN "transferNo" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_internal_transfers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferNo" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "fromWalletId" TEXT NOT NULL,
    "viaWalletId" TEXT,
    "toWalletId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" TEXT NOT NULL,
    "sourceCaseNo" TEXT NOT NULL,
    "sourceExternalLineId" TEXT,
    "explainedFlowId" TEXT,
    "explainedExternalLineId" TEXT,
    "recognizedTbTransferId" TEXT,
    "recognizedAt" DATETIME,
    "effectiveDate" DATETIME NOT NULL,
    "lossSource" TEXT,
    "sourceIncidentNo" TEXT,
    "approvalNo" TEXT,
    "failureReasonCode" TEXT,
    "failureNote" TEXT,
    "executedAt" DATETIME,
    "settledAt" DATETIME,
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "internal_transfers_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_internal_transfers" ("amount", "approvalNo", "assetId", "createdAt", "createdByUserId", "customerId", "customerNo", "executedAt", "failureNote", "failureReasonCode", "fromWalletId", "id", "purpose", "reason", "settledAt", "sourceCaseNo", "sourceExternalLineId", "status", "toWalletId", "traceId", "transferNo", "updatedAt", "viaWalletId") SELECT "amount", "approvalNo", "assetId", "createdAt", "createdByUserId", "customerId", "customerNo", "executedAt", "failureNote", "failureReasonCode", "fromWalletId", "id", "purpose", "reason", "settledAt", "sourceCaseNo", "sourceExternalLineId", "status", "toWalletId", "traceId", "transferNo", "updatedAt", "viaWalletId" FROM "internal_transfers";
DROP TABLE "internal_transfers";
ALTER TABLE "new_internal_transfers" RENAME TO "internal_transfers";
CREATE UNIQUE INDEX "internal_transfers_transferNo_key" ON "internal_transfers"("transferNo");
CREATE INDEX "internal_transfers_status_idx" ON "internal_transfers"("status");
CREATE INDEX "internal_transfers_sourceCaseNo_idx" ON "internal_transfers"("sourceCaseNo");
CREATE INDEX "internal_transfers_sourceExternalLineId_idx" ON "internal_transfers"("sourceExternalLineId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

