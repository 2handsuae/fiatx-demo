-- CreateTable
CREATE TABLE "transaction_limit_policies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "policyNo" TEXT NOT NULL,
    "tradingTier" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "limitAmount" DECIMAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "approvalCaseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
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
    "latestDecisionRecordId" TEXT,
    "activePeriodicReviewCycleId" TEXT,
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_main_latestRiskApprovalId_fkey" FOREIGN KEY ("latestRiskApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "customer_main_activePeriodicReviewCycleId_fkey" FOREIGN KEY ("activePeriodicReviewCycleId") REFERENCES "periodic_review_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_customer_main" ("activePeriodicReviewCycleId", "adminStatus", "cddDocumentExpiresAt", "companyName", "complianceFreezeAt", "complianceFreezeCaseId", "complianceFreezeReason", "complianceFreezeReleasedAt", "complianceStatus", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "investorTier", "investorTierSource", "investorTierUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestDecisionRecordId", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingStatus", "onboardingTraceId", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "restrictions", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "suspendedAt", "suspendedReason", "termsAcceptedAt", "timezone", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus") SELECT "activePeriodicReviewCycleId", "adminStatus", "cddDocumentExpiresAt", "companyName", "complianceFreezeAt", "complianceFreezeCaseId", "complianceFreezeReason", "complianceFreezeReleasedAt", "complianceStatus", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "investorTier", "investorTierSource", "investorTierUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestDecisionRecordId", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingStatus", "onboardingTraceId", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "restrictions", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "suspendedAt", "suspendedReason", "termsAcceptedAt", "timezone", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus" FROM "customer_main";
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

-- CreateIndex
CREATE UNIQUE INDEX "transaction_limit_policies_policyNo_key" ON "transaction_limit_policies"("policyNo");

-- CreateIndex
CREATE INDEX "transaction_limit_policies_status_idx" ON "transaction_limit_policies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_limit_policies_tradingTier_operationType_period_key" ON "transaction_limit_policies"("tradingTier", "operationType", "period");
