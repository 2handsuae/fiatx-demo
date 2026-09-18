-- AlterTable
ALTER TABLE "withdrawal_addresses" ADD COLUMN "iban" TEXT;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "swiftBic" TEXT;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "bankName" TEXT;
