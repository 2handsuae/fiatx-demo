-- AlterTable
ALTER TABLE "customer_main" ADD COLUMN "restrictionCaseId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "restrictionReason" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "restrictionSetAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "restrictionReleasedAt" DATETIME;
