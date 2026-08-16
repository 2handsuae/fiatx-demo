/*
  Warnings:

  - You are about to drop the column `adminStatus` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceFreezeAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceFreezeCaseId` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceFreezeReason` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceFreezeReleasedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `complianceStatus` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `onboardingStatus` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `restrictions` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `suspendedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `suspendedReason` on the `customer_main` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "customer_restrictions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "restrictionNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "releasePolicy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "caseRef" TEXT,
    "releaseOrderRef" TEXT,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedBy" TEXT NOT NULL,
    "releasedAt" DATETIME,
    "releasedBy" TEXT,
    "releaseApprovalNo" TEXT,
    "releaseMode" TEXT,
    "traceId" TEXT NOT NULL,
    CONSTRAINT "customer_restrictions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    "lifecycle" TEXT NOT NULL DEFAULT 'PROSPECT',
    "onboardingTraceId" TEXT,
    "onboardingApprovedAt" DATETIME,
    "pending_action_external_id" TEXT,
    "pending_action_reason" TEXT,
    "pending_action_submitted_at" DATETIME,
    "hard_line_dispositioned_at" DATETIME,
    "investorTier" TEXT NOT NULL DEFAULT 'STANDARD',
    "investorTierSource" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "investorTierUpdatedAt" DATETIME,
    "tradingTier" TEXT NOT NULL DEFAULT 'BASIC',
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "sumsubVerificationLevel" INTEGER NOT NULL DEFAULT 1,
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
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_main_latestRiskApprovalId_fkey" FOREIGN KEY ("latestRiskApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_customer_main" ("cddDocumentExpiresAt", "companyName", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "hard_line_dispositioned_at", "id", "investorTier", "investorTierSource", "investorTierUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingApprovedAt", "onboardingTraceId", "passwordHash", "passwordUpdatedAt", "pending_action_external_id", "pending_action_reason", "pending_action_submitted_at", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "riskLevel", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "sumsubVerificationLevel", "termsAcceptedAt", "timezone", "tradingTier", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus") SELECT "cddDocumentExpiresAt", "companyName", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "hard_line_dispositioned_at", "id", "investorTier", "investorTierSource", "investorTierUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingApprovedAt", "onboardingTraceId", "passwordHash", "passwordUpdatedAt", "pending_action_external_id", "pending_action_reason", "pending_action_submitted_at", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "riskLevel", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "sumsubVerificationLevel", "termsAcceptedAt", "timezone", "tradingTier", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus" FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");
CREATE UNIQUE INDEX "customer_main_latestRiskApprovalId_key" ON "customer_main"("latestRiskApprovalId");
CREATE INDEX "customer_main_riskRating_idx" ON "customer_main"("riskRating");
CREATE INDEX "customer_main_pending_action_external_id_idx" ON "customer_main"("pending_action_external_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "customer_restrictions_customerId_status_idx" ON "customer_restrictions"("customerId", "status");

-- CreateIndex
CREATE INDEX "customer_restrictions_cause_status_idx" ON "customer_restrictions"("cause", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_restrictions_restrictionNo_scope_key" ON "customer_restrictions"("restrictionNo", "scope");
