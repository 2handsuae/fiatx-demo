-- Wave 6 swap workflow fields
ALTER TABLE "swap_transactions" ADD COLUMN "quoteSnapshotRef" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "netToAmount" DECIMAL;
ALTER TABLE "swap_transactions" ADD COLUMN "feeAmount" DECIMAL;
ALTER TABLE "swap_transactions" ADD COLUMN "feeCurrency" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "feeBreakdown" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "riskDecisionRef" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "alertId" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "caseId" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "failureCode" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "failureReason" TEXT;
