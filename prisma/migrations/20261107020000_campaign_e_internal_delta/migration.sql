-- AlterTable
ALTER TABLE "reconciliation_cases" ADD COLUMN "internalDeltaAmount" DECIMAL;

-- AlterTable
ALTER TABLE "reconciliation_run_wallets" ADD COLUMN "internalDeltaAmount" DECIMAL;
