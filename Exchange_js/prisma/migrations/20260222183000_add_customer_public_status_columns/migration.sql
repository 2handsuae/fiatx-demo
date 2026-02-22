-- Align customer_main with current Prisma schema for onboarding v2.
ALTER TABLE "customer_main" ADD COLUMN "publicStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "customer_main" ADD COLUMN "activeJourneyId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "activeCaseType" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "activeCaseId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "latestDecisionRecordId" TEXT;
