-- AlterTable
ALTER TABLE "reconciliation_cases" ADD COLUMN "slaBreached" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reconciliation_runs" ADD COLUMN "cutoffAt" DATETIME;
