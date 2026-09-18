-- AlterTable
ALTER TABLE "internal_transactions"
ADD COLUMN "purpose" TEXT;

ALTER TABLE "internal_transactions"
ADD COLUMN "initiationMode" TEXT;
