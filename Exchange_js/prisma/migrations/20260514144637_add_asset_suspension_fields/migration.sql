-- AlterTable
ALTER TABLE "assets" ADD COLUMN "preSuspendDepositEnabled" BOOLEAN;
ALTER TABLE "assets" ADD COLUMN "preSuspendWithdrawalEnabled" BOOLEAN;
ALTER TABLE "assets" ADD COLUMN "suspendReason" TEXT;
ALTER TABLE "assets" ADD COLUMN "suspendedAt" DATETIME;
