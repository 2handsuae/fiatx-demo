-- AlterTable
ALTER TABLE "withdrawal_addresses" ADD COLUMN "deactivatedAt" DATETIME;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "deactivatedBy" TEXT;
