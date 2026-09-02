-- AlterTable
ALTER TABLE "reconciliation_adjustments" ADD COLUMN "toOwnerNo" TEXT;
ALTER TABLE "reconciliation_adjustments" ADD COLUMN "toWalletRef" TEXT;

-- CreateTable
CREATE TABLE "reconciliation_dispositions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dispositionNo" TEXT NOT NULL DEFAULT 'TEMP',
    "caseNo" TEXT NOT NULL,
    "walletRef" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "explainedFlowId" TEXT,
    "explainedExternalLineId" TEXT,
    "matchType" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "causeCode" TEXT NOT NULL,
    "outlet" TEXT NOT NULL,
    "deferredTarget" TEXT,
    "findingNote" TEXT NOT NULL,
    "adjustmentNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_dispositions_dispositionNo_key" ON "reconciliation_dispositions"("dispositionNo");

-- CreateIndex
CREATE INDEX "reconciliation_dispositions_caseNo_idx" ON "reconciliation_dispositions"("caseNo");

-- CreateIndex
CREATE INDEX "reconciliation_dispositions_walletRef_businessDate_idx" ON "reconciliation_dispositions"("walletRef", "businessDate");
