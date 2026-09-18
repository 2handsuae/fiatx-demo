-- AlterTable
ALTER TABLE "swap_transactions" ADD COLUMN "compliance_action" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "compliance_rule_names" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "compliance_verdict" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "reject_reason" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "sumsub_detail_json" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "sumsub_txn_id_in" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "sumsub_txn_id_out" TEXT;

-- CreateIndex
CREATE INDEX "swap_transactions_sumsub_txn_id_out_idx" ON "swap_transactions"("sumsub_txn_id_out");
