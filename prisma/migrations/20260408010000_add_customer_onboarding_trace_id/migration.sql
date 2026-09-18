-- Add single-purpose UUID column holding the onboarding sequence trace ID.
-- Populated at POST /onboarding/verification/start; inherited by every sumsub
-- webhook audit row.
ALTER TABLE "customer_main" ADD COLUMN "onboardingTraceId" TEXT;
