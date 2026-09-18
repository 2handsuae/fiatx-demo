-- AlterTable
ALTER TABLE "deposit_transactions" ADD COLUMN "actionSubmittedAt" DATETIME;
ALTER TABLE "deposit_transactions" ADD COLUMN "sumsubActionId" TEXT;
ALTER TABLE "deposit_transactions" ADD COLUMN "sumsubExternalActionId" TEXT;
