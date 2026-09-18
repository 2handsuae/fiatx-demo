-- DropIndex
DROP INDEX "cdd_response_reports_customerId_cddResponseId_idx";

-- DropIndex
DROP INDEX "cdd_response_reports_provider_providerSessionId_idx";

-- DropIndex
DROP INDEX "cdd_responses_subjectKind_subjectRefId_idx";

-- DropIndex
DROP INDEX "cdd_responses_periodicReviewCycleId_idx";

-- DropIndex
DROP INDEX "cdd_responses_workflow_status_idx";

-- DropIndex
DROP INDEX "cdd_responses_customerId_journeyId_idx";

-- DropIndex
DROP INDEX "cdd_responses_customerId_status_idx";

-- DropIndex
DROP INDEX "cdd_responses_caseNo_key";

-- DropIndex
DROP INDEX "compliance_sessions_status_expiresAt_idx";

-- DropIndex
DROP INDEX "compliance_sessions_customerId_caseType_caseId_idx";

-- DropIndex
DROP INDEX "compliance_sessions_providerSessionId_key";

-- DropIndex
DROP INDEX "edd_response_reports_customerId_eddResponseId_idx";

-- DropIndex
DROP INDEX "edd_response_reports_provider_providerSessionId_idx";

-- DropIndex
DROP INDEX "edd_responses_subjectKind_subjectRefId_idx";

-- DropIndex
DROP INDEX "edd_responses_periodicReviewCycleId_idx";

-- DropIndex
DROP INDEX "edd_responses_workflow_status_idx";

-- DropIndex
DROP INDEX "edd_responses_customerId_journeyId_idx";

-- DropIndex
DROP INDEX "edd_responses_cddResponseId_idx";

-- DropIndex
DROP INDEX "edd_responses_customerId_status_idx";

-- DropIndex
DROP INDEX "edd_responses_caseNo_key";

-- DropIndex
DROP INDEX "kyt_case_reports_receivedAt_idx";

-- DropIndex
DROP INDEX "kyt_case_reports_provider_providerCaseId_idx";

-- DropIndex
DROP INDEX "kyt_case_reports_sourceType_sourceId_screeningStage_idx";

-- DropIndex
DROP INDEX "kyt_case_reports_kytCaseId_idx";

-- DropIndex
DROP INDEX "kyt_cases_provider_providerCaseId_idx";

-- DropIndex
DROP INDEX "kyt_cases_status_idx";

-- DropIndex
DROP INDEX "kyt_cases_sourceType_sourceId_idx";

-- DropIndex
DROP INDEX "kyt_cases_sourceType_sourceId_screeningStage_key";

-- DropIndex
DROP INDEX "kyt_cases_caseNo_key";

-- DropIndex
DROP INDEX "periodic_review_cycles_status_dueAt_idx";

-- DropIndex
DROP INDEX "periodic_review_cycles_customerId_status_idx";

-- DropIndex
DROP INDEX "periodic_review_cycles_cycleNo_key";

-- DropIndex
DROP INDEX "travel_rule_case_reports_receivedAt_idx";

-- DropIndex
DROP INDEX "travel_rule_case_reports_provider_providerTransferId_idx";

-- DropIndex
DROP INDEX "travel_rule_case_reports_sourceType_sourceId_idx";

-- DropIndex
DROP INDEX "travel_rule_case_reports_travelRuleCaseId_idx";

-- DropIndex
DROP INDEX "travel_rule_cases_provider_providerTransferId_idx";

-- DropIndex
DROP INDEX "travel_rule_cases_status_idx";

-- DropIndex
DROP INDEX "travel_rule_cases_sourceType_sourceId_idx";

-- DropIndex
DROP INDEX "travel_rule_cases_sourceType_sourceId_key";

-- DropIndex
DROP INDEX "travel_rule_cases_caseNo_key";

-- DropIndex
DROP INDEX "workflow_decision_records_customerId_createdAt_idx";

-- DropIndex
DROP INDEX "workflow_decision_records_contextType_subjectId_createdAt_idx";

-- DropIndex
DROP INDEX "workflow_decision_records_status_createdAt_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "cdd_response_reports";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "cdd_responses";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_sessions";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "edd_response_reports";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "edd_responses";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "kyt_case_reports";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "kyt_cases";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "periodic_review_cycles";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "travel_rule_case_reports";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "travel_rule_cases";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "workflow_decision_records";
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
    "nextReviewAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_main_latestRiskApprovalId_fkey" FOREIGN KEY ("latestRiskApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_customer_main" ("adminStatus", "cddDocumentExpiresAt", "companyName", "complianceFreezeAt", "complianceFreezeCaseId", "complianceFreezeReason", "complianceFreezeReleasedAt", "complianceStatus", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "investorTier", "investorTierSource", "investorTierUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingStatus", "onboardingTraceId", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "restrictions", "riskLevel", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "sumsubVerificationLevel", "suspendedAt", "suspendedReason", "termsAcceptedAt", "timezone", "tradingTier", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus") SELECT "adminStatus", "cddDocumentExpiresAt", "companyName", "complianceFreezeAt", "complianceFreezeCaseId", "complianceFreezeReason", "complianceFreezeReleasedAt", "complianceStatus", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "investorTier", "investorTierSource", "investorTierUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingStatus", "onboardingTraceId", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "phone", "phoneVerifiedAt", "restrictions", "riskLevel", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "sumsubVerificationLevel", "suspendedAt", "suspendedReason", "termsAcceptedAt", "timezone", "tradingTier", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus" FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");
CREATE UNIQUE INDEX "customer_main_latestRiskApprovalId_key" ON "customer_main"("latestRiskApprovalId");
CREATE INDEX "customer_main_adminStatus_idx" ON "customer_main"("adminStatus");
CREATE INDEX "customer_main_complianceStatus_idx" ON "customer_main"("complianceStatus");
CREATE INDEX "customer_main_riskRating_idx" ON "customer_main"("riskRating");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

