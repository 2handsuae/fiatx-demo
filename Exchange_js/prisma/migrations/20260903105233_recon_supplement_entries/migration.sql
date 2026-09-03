-- AlterTable
ALTER TABLE "deposit_transactions" ADD COLUMN "clawbackDispositionNo" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "clawbackExternalLineId" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "clawbackReconCaseNo" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "effectiveDate" TEXT;

-- AlterTable
ALTER TABLE "inbound_transfer_signals" ADD COLUMN "supplementDispositionNo" TEXT;
ALTER TABLE "inbound_transfer_signals" ADD COLUMN "supplementEffectiveDate" TEXT;
ALTER TABLE "inbound_transfer_signals" ADD COLUMN "supplementOfExternalLineId" TEXT;
ALTER TABLE "inbound_transfer_signals" ADD COLUMN "supplementReconCaseNo" TEXT;
ALTER TABLE "inbound_transfer_signals" ADD COLUMN "supplementRequestedByUserId" TEXT;

-- AlterTable
ALTER TABLE "reconciliation_dispositions" ADD COLUMN "supplementNo" TEXT;

-- AlterTable
ALTER TABLE "withdraw_transactions" ADD COLUMN "returnDispositionNo" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "returnExternalLineId" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "returnReconCaseNo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "deposit_transactions_clawbackExternalLineId_key" ON "deposit_transactions"("clawbackExternalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_transfer_signals_supplementOfExternalLineId_key" ON "inbound_transfer_signals"("supplementOfExternalLineId");

-- CreateIndex
CREATE UNIQUE INDEX "withdraw_transactions_returnExternalLineId_key" ON "withdraw_transactions"("returnExternalLineId");
