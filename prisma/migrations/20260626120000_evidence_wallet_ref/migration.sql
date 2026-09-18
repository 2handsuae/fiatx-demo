-- AlterTable: add per-physical-wallet + external-boundary tracking columns to tb_transfer_evidence
-- Phase B reconciliation needs these to drill down per wallet and match against external statements.
ALTER TABLE "tb_transfer_evidence" ADD COLUMN "debitWalletRef" TEXT;
ALTER TABLE "tb_transfer_evidence" ADD COLUMN "creditWalletRef" TEXT;
ALTER TABLE "tb_transfer_evidence" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "tb_transfer_evidence" ADD COLUMN "isExternalCrossing" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tb_transfer_evidence_debitWalletRef_idx" ON "tb_transfer_evidence"("debitWalletRef");
CREATE INDEX "tb_transfer_evidence_creditWalletRef_idx" ON "tb_transfer_evidence"("creditWalletRef");
CREATE INDEX "tb_transfer_evidence_externalRef_idx" ON "tb_transfer_evidence"("externalRef");
