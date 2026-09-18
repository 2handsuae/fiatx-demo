ALTER TABLE "customer_main" ADD COLUMN "verificationProvider" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "verificationSubstatus" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "verificationCustomerActionRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_main" ADD COLUMN "verificationCanContinue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_main" ADD COLUMN "verificationLatestEventType" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "verificationLatestEventAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "sumsubApplicantId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "sumsubCurrentLevelName" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "sumsubLatestReviewId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "sumsubLatestAttemptId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "sumsubExperiencedLevel2" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");

UPDATE "customer_main"
SET "onboardingStatus" = 'PENDING_VERIFICATION'
WHERE "onboardingStatus" IN ('PENDING_CDD_INPUT', 'CDD_UNDER_REVIEW', 'PENDING_EDD_INPUT', 'EDD_UNDER_REVIEW');
