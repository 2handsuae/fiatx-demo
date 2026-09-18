-- AlterTable
ALTER TABLE "deposit_transactions" ADD COLUMN "aggregatedAt" DATETIME;
ALTER TABLE "deposit_transactions" ADD COLUMN "aggregatedTransferId" TEXT;

-- CreateIndex
CREATE INDEX "deposit_transactions_toWalletId_status_aggregatedAt_idx" ON "deposit_transactions"("toWalletId", "status", "aggregatedAt");
