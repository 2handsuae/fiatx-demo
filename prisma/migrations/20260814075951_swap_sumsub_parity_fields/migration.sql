-- AlterTable
ALTER TABLE "swap_transactions" ADD COLUMN "sumsub_score" INTEGER;
ALTER TABLE "swap_transactions" ADD COLUMN "sumsub_scored_at" DATETIME;
ALTER TABLE "swap_transactions" ADD COLUMN "sumsub_txn_type" TEXT;
