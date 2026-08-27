/*
  Warnings:

  - You are about to drop the `client_risk_assessments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `corporate_profiles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tier_upgrade_cases` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ubo_profiles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `investorTierSource` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `onboardingTraceId` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `sumsubVerificationLevel` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `verificationProvider` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `triggeredByAssessmentId` on the `material_refresh_cycles` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "client_risk_assessments_status_triggeredAt_idx";

-- DropIndex
DROP INDEX "client_risk_assessments_sumsubAmlCheckInspectionId_idx";

-- DropIndex
DROP INDEX "client_risk_assessments_customerId_triggeredAt_idx";

-- DropIndex
DROP INDEX "client_risk_assessments_customerId_status_idx";

-- DropIndex
DROP INDEX "client_risk_assessments_traceId_key";

-- DropIndex
DROP INDEX "client_risk_assessments_assessmentNo_key";

-- DropIndex
DROP INDEX "corporate_profiles_customerId_key";

-- DropIndex
DROP INDEX "tier_upgrade_cases_customerId_status_idx";

-- DropIndex
DROP INDEX "tier_upgrade_cases_traceId_key";

-- DropIndex
DROP INDEX "tier_upgrade_cases_phase2ApprovalCaseId_key";

-- DropIndex
DROP INDEX "tier_upgrade_cases_sourceCraId_key";

-- DropIndex
DROP INDEX "tier_upgrade_cases_caseNo_key";

-- DropIndex
DROP INDEX "ubo_profiles_customerId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "client_risk_assessments";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "corporate_profiles";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "tier_upgrade_cases";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ubo_profiles";
PRAGMA foreign_keys=on;

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
    "onboardingApprovedAt" DATETIME,
    "hard_line_dispositioned_at" DATETIME,
    "investorTier" TEXT NOT NULL DEFAULT 'STANDARD',
    "investorTierUpdatedAt" DATETIME,
    "tradingTier" TEXT NOT NULL DEFAULT 'BASIC',
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
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
INSERT INTO "new_customer_main" ("cddDocumentExpiresAt", "companyName", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "hard_line_dispositioned_at", "id", "investorTier", "investorTierUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "lifecycle", "locale", "lockedUntil", "nextReviewAt", "onboardingApprovedAt", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "riskLevel", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "termsAcceptedAt", "timezone", "tradingTier", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationSubstatus") SELECT "cddDocumentExpiresAt", "companyName", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "hard_line_dispositioned_at", "id", "investorTier", "investorTierUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "lifecycle", "locale", "lockedUntil", "nextReviewAt", "onboardingApprovedAt", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "riskLevel", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "termsAcceptedAt", "timezone", "tradingTier", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationSubstatus" FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");
CREATE UNIQUE INDEX "customer_main_latestRiskApprovalId_key" ON "customer_main"("latestRiskApprovalId");
CREATE INDEX "customer_main_riskRating_idx" ON "customer_main"("riskRating");
CREATE TABLE "new_material_refresh_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CUSTOMER_EVIDENCE',
    "stage" TEXT NOT NULL DEFAULT 'NUDGE_ONLY',
    "triggerType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageNudgeAt" DATETIME,
    "stageUrgentAt" DATETIME,
    "stageBlockingAt" DATETIME,
    "clearedAt" DATETIME,
    "rejectedAt" DATETIME,
    "customerSubmittedAt" DATETIME,
    "graceExpiresAt" DATETIME,
    "resolutionReason" TEXT,
    "materialRequestNo" TEXT,
    "traceId" TEXT NOT NULL,
    CONSTRAINT "material_refresh_cycles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "material_refresh_cycles_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "customer_material_holdings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_material_refresh_cycles" ("clearedAt", "createdAt", "customerId", "customerSubmittedAt", "cycleNo", "graceExpiresAt", "holdingId", "id", "materialRequestNo", "materialType", "rejectedAt", "resolutionReason", "stage", "stageBlockingAt", "stageNudgeAt", "stageUrgentAt", "status", "traceId", "triggerType") SELECT "clearedAt", "createdAt", "customerId", "customerSubmittedAt", "cycleNo", "graceExpiresAt", "holdingId", "id", "materialRequestNo", "materialType", "rejectedAt", "resolutionReason", "stage", "stageBlockingAt", "stageNudgeAt", "stageUrgentAt", "status", "traceId", "triggerType" FROM "material_refresh_cycles";
DROP TABLE "material_refresh_cycles";
ALTER TABLE "new_material_refresh_cycles" RENAME TO "material_refresh_cycles";
CREATE UNIQUE INDEX "material_refresh_cycles_cycleNo_key" ON "material_refresh_cycles"("cycleNo");
CREATE UNIQUE INDEX "material_refresh_cycles_traceId_key" ON "material_refresh_cycles"("traceId");
CREATE INDEX "material_refresh_cycles_customerId_status_idx" ON "material_refresh_cycles"("customerId", "status");
CREATE INDEX "material_refresh_cycles_status_graceExpiresAt_idx" ON "material_refresh_cycles"("status", "graceExpiresAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
