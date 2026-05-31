-- AlterTable
ALTER TABLE "swap_transactions" ADD COLUMN "tbFeeTransferId" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "tbFromTransferId" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "tbToTransferId" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "traceId" TEXT;
