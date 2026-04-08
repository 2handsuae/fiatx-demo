-- Drop customer_main.activeJourneyId via SQLite table-recreate.
-- The column was a free-floating trace identifier overloaded for three
-- different jobs (audit trace, CDD/EDD response grouping, workflow handle).
-- Those jobs now use customer.id (for sequence grouping) and
-- customer.onboardingTraceId (for audit traces).
PRAGMA foreign_keys = OFF;

-- Drop triggers that reference customer_main so they don't block the
-- table drop/rename below (SQLite validates trigger bodies at compile time).
DROP TRIGGER IF EXISTS "wallets_owner_semantics_insert";
DROP TRIGGER IF EXISTS "wallets_owner_semantics_update";

CREATE TABLE "customer_main_new" AS
SELECT
    "id",
    "customerNo",
    "email",
    "phone",
    "emailVerifiedAt",
    "phoneVerifiedAt",
    "firstName",
    "lastName",
    "companyName",
    "passwordHash",
    "passwordUpdatedAt",
    "riskScore",
    "riskLevel",
    "riskUpdatedAt",
    "failedLoginCount",
    "lockedUntil",
    "lastLoginAt",
    "lastLoginIp",
    "locale",
    "timezone",
    "termsAcceptedAt",
    "customerType",
    "amlRiskTier",
    "eddRequired",
    "cddDocumentExpiresAt",
    "nextReviewAt",
    "investorClassification",
    "investorClassificationSource",
    "investorClassificationUpdatedAt",
    "createdAt",
    "updatedAt",
    "latestDecisionRecordId",
    "complianceHoldStatus",
    "complianceHoldCaseId",
    "complianceHoldReason",
    "complianceHoldSetAt",
    "complianceHoldReleasedAt",
    "onboardingStatus",
    "operatingStatus",
    "restrictionStatus",
    "restrictionCaseId",
    "restrictionReason",
    "restrictionSetAt",
    "restrictionReleasedAt",
    "latestFinalApprovalId",
    "latestFinalApprovalStatus",
    "activePeriodicReviewCycleId",
    "periodicReviewOverdueAt",
    "periodicReviewOverdueReason",
    "verificationProvider",
    "verificationSubstatus",
    "verificationCustomerActionRequired",
    "verificationCanContinue",
    "verificationLatestEventType",
    "verificationLatestEventAt",
    "sumsubApplicantId",
    "sumsubCurrentLevelName",
    "sumsubLatestReviewId",
    "sumsubLatestAttemptId",
    "sumsubExperiencedLevel2",
    "onboardingTraceId"
FROM "customer_main";

DROP TABLE "customer_main";
ALTER TABLE "customer_main_new" RENAME TO "customer_main";

-- Recreate every index that existed on the original table.
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE INDEX "customer_main_complianceHoldStatus_idx" ON "customer_main"("complianceHoldStatus");
CREATE UNIQUE INDEX "customer_main_latestFinalApprovalId_key" ON "customer_main"("latestFinalApprovalId");
CREATE INDEX "customer_main_latestFinalApprovalStatus_idx" ON "customer_main"("latestFinalApprovalStatus");
CREATE UNIQUE INDEX "customer_main_activePeriodicReviewCycleId_key" ON "customer_main"("activePeriodicReviewCycleId");
CREATE INDEX "customer_main_activePeriodicReviewCycleId_idx" ON "customer_main"("activePeriodicReviewCycleId");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");

-- Recreate the wallet owner semantics triggers that were dropped above.
CREATE TRIGGER "wallets_owner_semantics_insert"
BEFORE INSERT ON "wallets"
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW."ownerType" NOT IN ('PLATFORM', 'CUSTOMER', 'LIQUIDITY_PROVIDER')
      THEN RAISE(ABORT, 'Invalid wallets.ownerType')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'PLATFORM' AND NEW."ownerId" IS NOT NULL
      THEN RAISE(ABORT, 'PLATFORM wallet must not set ownerId')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'LIQUIDITY_PROVIDER' AND NEW."ownerId" IS NULL
      THEN RAISE(ABORT, 'LIQUIDITY_PROVIDER wallet must set ownerId')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'CUSTOMER'
      AND NEW."ownerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "customer_main" c WHERE c."id" = NEW."ownerId"
      )
      THEN RAISE(ABORT, 'CUSTOMER wallet ownerId does not exist')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'LIQUIDITY_PROVIDER'
      AND NEW."ownerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "liquidity_provider" lp WHERE lp."id" = NEW."ownerId"
      )
      THEN RAISE(ABORT, 'LIQUIDITY_PROVIDER wallet ownerId does not exist')
  END;
END;

CREATE TRIGGER "wallets_owner_semantics_update"
BEFORE UPDATE ON "wallets"
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW."ownerType" NOT IN ('PLATFORM', 'CUSTOMER', 'LIQUIDITY_PROVIDER')
      THEN RAISE(ABORT, 'Invalid wallets.ownerType')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'PLATFORM' AND NEW."ownerId" IS NOT NULL
      THEN RAISE(ABORT, 'PLATFORM wallet must not set ownerId')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'LIQUIDITY_PROVIDER' AND NEW."ownerId" IS NULL
      THEN RAISE(ABORT, 'LIQUIDITY_PROVIDER wallet must set ownerId')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'CUSTOMER'
      AND NEW."ownerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "customer_main" c WHERE c."id" = NEW."ownerId"
      )
      THEN RAISE(ABORT, 'CUSTOMER wallet ownerId does not exist')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'LIQUIDITY_PROVIDER'
      AND NEW."ownerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "liquidity_provider" lp WHERE lp."id" = NEW."ownerId"
      )
      THEN RAISE(ABORT, 'LIQUIDITY_PROVIDER wallet ownerId does not exist')
  END;
END;

PRAGMA foreign_keys = ON;
