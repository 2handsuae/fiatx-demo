/*
  Warnings:

  - You are about to drop the column `amlRiskTier` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceHoldCaseId` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceHoldReason` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceHoldReleasedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceHoldSetAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceHoldStatus` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `investorClassification` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `investorClassificationSource` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `investorClassificationUpdatedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `operatingStatus` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `periodicReviewOverdueAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `periodicReviewOverdueReason` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `restrictionCaseId` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `restrictionReason` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `restrictionReleasedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `restrictionSetAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `restrictionStatus` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `riskLevel` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `riskScore` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `riskTier` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `riskTierUpdatedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `riskUpdatedAt` on the `customer_main` table. All the data in the column will be lost.

*/
-- Drop triggers that reference customer_main before redefining
DROP TRIGGER IF EXISTS "wallets_owner_semantics_insert";
DROP TRIGGER IF EXISTS "wallets_owner_semantics_update";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customer_main" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "email" TEXT,
    "phone" TEXT,
    "emailVerifiedAt" DATETIME,
    "phoneVerifiedAt" DATETIME,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "passwordHash" TEXT,
    "passwordUpdatedAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLoginIp" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "termsAcceptedAt" DATETIME,
    "onboardingStatus" TEXT NOT NULL DEFAULT 'NONE',
    "onboardingTraceId" TEXT,
    "adminStatus" TEXT NOT NULL DEFAULT 'INACTIVE',
    "suspendedReason" TEXT,
    "suspendedAt" DATETIME,
    "complianceStatus" TEXT NOT NULL DEFAULT 'CLEAR',
    "complianceFreezeReason" TEXT,
    "complianceFreezeCaseId" TEXT,
    "complianceFreezeAt" DATETIME,
    "complianceFreezeReleasedAt" DATETIME,
    "restrictions" TEXT NOT NULL DEFAULT '[]',
    "investorTier" TEXT NOT NULL DEFAULT 'STANDARD',
    "investorTierSource" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "investorTierUpdatedAt" DATETIME,
    "riskRating" TEXT NOT NULL DEFAULT 'LOW',
    "riskRatingUpdatedAt" DATETIME,
    "eddRequired" BOOLEAN NOT NULL DEFAULT false,
    "pepStatus" TEXT NOT NULL DEFAULT 'NONE',
    "pepConfirmedAt" DATETIME,
    "cddDocumentExpiresAt" DATETIME,
    "sumsubApplicantId" TEXT,
    "sumsubCurrentLevelName" TEXT,
    "sumsubLatestReviewId" TEXT,
    "sumsubLatestAttemptId" TEXT,
    "sumsubExperiencedLevel2" BOOLEAN NOT NULL DEFAULT false,
    "verificationProvider" TEXT,
    "verificationSubstatus" TEXT,
    "verificationCustomerActionRequired" BOOLEAN NOT NULL DEFAULT false,
    "verificationCanContinue" BOOLEAN NOT NULL DEFAULT false,
    "verificationLatestEventType" TEXT,
    "verificationLatestEventAt" DATETIME,
    "latestRiskApprovalId" TEXT,
    "latestRiskApprovalStatus" TEXT,
    "latestRiskAssessmentId" TEXT,
    "latestDecisionRecordId" TEXT,
    "activePeriodicReviewCycleId" TEXT,
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_main_latestRiskApprovalId_fkey" FOREIGN KEY ("latestRiskApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "customer_main_activePeriodicReviewCycleId_fkey" FOREIGN KEY ("activePeriodicReviewCycleId") REFERENCES "periodic_review_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_customer_main" ("activePeriodicReviewCycleId", "cddDocumentExpiresAt", "companyName", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "lastLoginAt", "lastLoginIp", "lastName", "latestDecisionRecordId", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingStatus", "onboardingTraceId", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "termsAcceptedAt", "timezone", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus") SELECT "activePeriodicReviewCycleId", "cddDocumentExpiresAt", "companyName", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "lastLoginAt", "lastLoginIp", "lastName", "latestDecisionRecordId", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingStatus", "onboardingTraceId", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "termsAcceptedAt", "timezone", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus" FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");
CREATE UNIQUE INDEX "customer_main_latestRiskApprovalId_key" ON "customer_main"("latestRiskApprovalId");
CREATE UNIQUE INDEX "customer_main_activePeriodicReviewCycleId_key" ON "customer_main"("activePeriodicReviewCycleId");
CREATE INDEX "customer_main_adminStatus_idx" ON "customer_main"("adminStatus");
CREATE INDEX "customer_main_complianceStatus_idx" ON "customer_main"("complianceStatus");
CREATE INDEX "customer_main_riskRating_idx" ON "customer_main"("riskRating");
CREATE INDEX "customer_main_activePeriodicReviewCycleId_idx" ON "customer_main"("activePeriodicReviewCycleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Recreate triggers referencing customer_main
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
