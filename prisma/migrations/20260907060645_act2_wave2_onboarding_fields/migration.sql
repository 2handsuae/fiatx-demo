-- AlterTable
ALTER TABLE "customer_main" ADD COLUMN "dateOfBirth" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "idDocNumber" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "idDocType" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "nationality" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "onboardingFinalRejectedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "onboardingSubmittedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "residentialAddress" TEXT;
