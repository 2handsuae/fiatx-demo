-- AlterTable
ALTER TABLE "fee_accruals" ADD COLUMN "originTraceId" TEXT;

-- AlterTable
ALTER TABLE "outstandings" ADD COLUMN "originTraceId" TEXT;
