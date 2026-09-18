/*
  Warnings:

  - You are about to drop the `compliance_alert_disposition_records` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_alert_events` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_alerts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_case_evidence_packages` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_incident_alerts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_incident_disposition_records` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_incident_events` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_incident_external_filing_events` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_incident_external_filings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_incident_reports` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `compliance_incidents` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `phase1ApprovalCaseId` on the `client_risk_assessments` table. All the data in the column will be lost.
  - You are about to drop the column `phase2ApprovalCaseId` on the `client_risk_assessments` table. All the data in the column will be lost.
  - You are about to drop the column `primaryAlertId` on the `periodic_review_cycles` table. All the data in the column will be lost.
  - You are about to drop the column `primaryIncidentId` on the `periodic_review_cycles` table. All the data in the column will be lost.
  - You are about to drop the column `linkedAlertId` on the `reconciliation_breaks` table. All the data in the column will be lost.
  - You are about to drop the column `linkedCaseId` on the `reconciliation_breaks` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "compliance_alert_disposition_records_dispositionCode_createdAt_idx";

-- DropIndex
DROP INDEX "compliance_alert_disposition_records_alertId_createdAt_idx";

-- DropIndex
DROP INDEX "compliance_alert_events_alertId_eventAt_idx";

-- DropIndex
DROP INDEX "compliance_alerts_status_dueAt_overdueMarkedAt_idx";

-- DropIndex
DROP INDEX "compliance_alerts_customerNo_lastOccurredAt_idx";

-- DropIndex
DROP INDEX "compliance_alerts_sourceType_sourceId_stage_lastOccurredAt_idx";

-- DropIndex
DROP INDEX "compliance_alerts_sourceType_sourceId_lastOccurredAt_idx";

-- DropIndex
DROP INDEX "compliance_alerts_ruleCode_lastOccurredAt_idx";

-- DropIndex
DROP INDEX "compliance_alerts_severity_status_dueAt_idx";

-- DropIndex
DROP INDEX "compliance_alerts_status_lastOccurredAt_idx";

-- DropIndex
DROP INDEX "compliance_alerts_dedupeKey_key";

-- DropIndex
DROP INDEX "compliance_alerts_alertNo_key";

-- DropIndex
DROP INDEX "compliance_case_evidence_packages_approvalCaseId_idx";

-- DropIndex
DROP INDEX "compliance_case_evidence_packages_approvalCaseNo_idx";

-- DropIndex
DROP INDEX "compliance_case_evidence_packages_deletedAt_idx";

-- DropIndex
DROP INDEX "compliance_case_evidence_packages_status_createdAt_idx";

-- DropIndex
DROP INDEX "compliance_case_evidence_packages_exportedByType_exportedById_idx";

-- DropIndex
DROP INDEX "compliance_case_evidence_packages_createdAt_idx";

-- DropIndex
DROP INDEX "compliance_case_evidence_packages_approvalCaseId_key";

-- DropIndex
DROP INDEX "compliance_case_evidence_packages_packageNo_key";

-- DropIndex
DROP INDEX "compliance_incident_alerts_alertId_idx";

-- DropIndex
DROP INDEX "compliance_incident_alerts_incidentId_relationType_linkedAt_idx";

-- DropIndex
DROP INDEX "compliance_incident_alerts_incidentId_alertId_key";

-- DropIndex
DROP INDEX "compliance_incident_alerts_alertId_key";

-- DropIndex
DROP INDEX "compliance_incident_disposition_records_dispositionCode_createdAt_idx";

-- DropIndex
DROP INDEX "compliance_incident_disposition_records_incidentId_createdAt_idx";

-- DropIndex
DROP INDEX "compliance_incident_events_incidentId_eventAt_idx";

-- DropIndex
DROP INDEX "compliance_incident_external_filing_events_filingId_eventAt_idx";

-- DropIndex
DROP INDEX "compliance_incident_external_filings_filingAuthority_status_updatedAt_idx";

-- DropIndex
DROP INDEX "compliance_incident_external_filings_status_updatedAt_idx";

-- DropIndex
DROP INDEX "compliance_incident_external_filings_incidentId_key";

-- DropIndex
DROP INDEX "compliance_incident_external_filings_filingNo_key";

-- DropIndex
DROP INDEX "compliance_incident_reports_incidentId_version_key";

-- DropIndex
DROP INDEX "compliance_incident_reports_incidentId_status_updatedAt_idx";

-- DropIndex
DROP INDEX "compliance_incident_reports_incidentId_isCurrent_idx";

-- DropIndex
DROP INDEX "compliance_incidents_lastAlertAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_primaryAlertId_idx";

-- DropIndex
DROP INDEX "compliance_incidents_customerNo_lastActionAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_reportStatus_reportedAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_status_dueAt_overdueMarkedAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_ruleCode_lastActionAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_sourceType_stage_lastActionAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_caseType_status_dueAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_severity_status_dueAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_status_lastActionAt_idx";

-- DropIndex
DROP INDEX "compliance_incidents_reportRefNo_key";

-- DropIndex
DROP INDEX "compliance_incidents_primaryAlertId_key";

-- DropIndex
DROP INDEX "compliance_incidents_incidentNo_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_alert_disposition_records";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_alert_events";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_alerts";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_case_evidence_packages";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_incident_alerts";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_incident_disposition_records";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_incident_events";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_incident_external_filing_events";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_incident_external_filings";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_incident_reports";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "compliance_incidents";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "tier_upgrade_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceCraId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_LEVEL2',
    "phase2ApprovalCaseId" TEXT,
    "completedAt" DATETIME,
    "rejectedAt" DATETIME,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tier_upgrade_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tier_upgrade_cases_sourceCraId_fkey" FOREIGN KEY ("sourceCraId") REFERENCES "client_risk_assessments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tier_upgrade_cases_phase2ApprovalCaseId_fkey" FOREIGN KEY ("phase2ApprovalCaseId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_client_risk_assessments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sumsubAmlCheckRequestedAt" DATETIME,
    "sumsubAmlCheckInspectionId" TEXT,
    "sumsubAmlReviewAnswer" TEXT,
    "sumsubAmlLabels" TEXT,
    "sumsubAmlRejectType" TEXT,
    "sumsubSnapshotAt" DATETIME,
    "sumsubRiskScore" INTEGER,
    "sumsubTags" TEXT,
    "policyVersion" TEXT NOT NULL,
    "resultingRiskTier" TEXT,
    "previousRiskTier" TEXT,
    "scoreSuggestedTier" TEXT,
    "recommendedAction" TEXT,
    "reasoning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SUMSUB_RESULT',
    "signoffMethod" TEXT,
    "approvalCaseId" TEXT,
    "signedBy" TEXT,
    "signedAt" DATETIME,
    "signedUnderPolicyVersion" TEXT,
    "sumsubInternalCaseRef" TEXT,
    "sumsubCaseFinalDecision" TEXT,
    "sumsubCaseDecidedAt" DATETIME,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_risk_assessments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_risk_assessments_approvalCaseId_fkey" FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_client_risk_assessments" ("approvalCaseId", "assessmentNo", "createdAt", "customerId", "id", "policyVersion", "previousRiskTier", "reasoning", "recommendedAction", "resultingRiskTier", "scoreSuggestedTier", "signedAt", "signedBy", "signedUnderPolicyVersion", "signoffMethod", "status", "sumsubAmlCheckInspectionId", "sumsubAmlCheckRequestedAt", "sumsubAmlLabels", "sumsubAmlRejectType", "sumsubAmlReviewAnswer", "sumsubCaseDecidedAt", "sumsubCaseFinalDecision", "sumsubInternalCaseRef", "sumsubRiskScore", "sumsubSnapshotAt", "sumsubTags", "traceId", "triggerType", "triggeredAt") SELECT "approvalCaseId", "assessmentNo", "createdAt", "customerId", "id", "policyVersion", "previousRiskTier", "reasoning", "recommendedAction", "resultingRiskTier", "scoreSuggestedTier", "signedAt", "signedBy", "signedUnderPolicyVersion", "signoffMethod", "status", "sumsubAmlCheckInspectionId", "sumsubAmlCheckRequestedAt", "sumsubAmlLabels", "sumsubAmlRejectType", "sumsubAmlReviewAnswer", "sumsubCaseDecidedAt", "sumsubCaseFinalDecision", "sumsubInternalCaseRef", "sumsubRiskScore", "sumsubSnapshotAt", "sumsubTags", "traceId", "triggerType", "triggeredAt" FROM "client_risk_assessments";
DROP TABLE "client_risk_assessments";
ALTER TABLE "new_client_risk_assessments" RENAME TO "client_risk_assessments";
CREATE UNIQUE INDEX "client_risk_assessments_assessmentNo_key" ON "client_risk_assessments"("assessmentNo");
CREATE UNIQUE INDEX "client_risk_assessments_traceId_key" ON "client_risk_assessments"("traceId");
CREATE INDEX "client_risk_assessments_customerId_status_idx" ON "client_risk_assessments"("customerId", "status");
CREATE INDEX "client_risk_assessments_customerId_triggeredAt_idx" ON "client_risk_assessments"("customerId", "triggeredAt");
CREATE INDEX "client_risk_assessments_sumsubAmlCheckInspectionId_idx" ON "client_risk_assessments"("sumsubAmlCheckInspectionId");
CREATE INDEX "client_risk_assessments_status_triggeredAt_idx" ON "client_risk_assessments"("status", "triggeredAt");
-- Drop wallet owner triggers before customer_main redefine to avoid trigger firing on INSERT...SELECT
DROP TRIGGER IF EXISTS "wallets_owner_semantics_insert";
DROP TRIGGER IF EXISTS "wallets_owner_semantics_update";
CREATE TABLE "new_customer_main" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerNo" TEXT NOT NULL DEFAULT 'TEMP',
    "email" TEXT,
    "phone" TEXT,
    "emailVerifiedAt" DATETIME,
    "phoneVerifiedAt" DATETIME,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "passwordHash" TEXT,
    "passwordUpdatedAt" DATETIME,
    "riskScore" INTEGER,
    "riskLevel" TEXT,
    "riskUpdatedAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLoginIp" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "termsAcceptedAt" DATETIME,
    "customerType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "onboardingStatus" TEXT NOT NULL DEFAULT 'NONE',
    "verificationProvider" TEXT,
    "verificationSubstatus" TEXT,
    "verificationCustomerActionRequired" BOOLEAN NOT NULL DEFAULT false,
    "verificationCanContinue" BOOLEAN NOT NULL DEFAULT false,
    "verificationLatestEventType" TEXT,
    "verificationLatestEventAt" DATETIME,
    "sumsubApplicantId" TEXT,
    "sumsubCurrentLevelName" TEXT,
    "sumsubLatestReviewId" TEXT,
    "sumsubLatestAttemptId" TEXT,
    "sumsubExperiencedLevel2" BOOLEAN NOT NULL DEFAULT false,
    "onboardingTraceId" TEXT,
    "operatingStatus" TEXT NOT NULL DEFAULT 'INACTIVE',
    "restrictionStatus" TEXT NOT NULL DEFAULT 'CLEAR',
    "restrictionCaseId" TEXT,
    "restrictionReason" TEXT,
    "restrictionSetAt" DATETIME,
    "restrictionReleasedAt" DATETIME,
    "amlRiskTier" TEXT NOT NULL DEFAULT 'LOW',
    "eddRequired" BOOLEAN NOT NULL DEFAULT false,
    "complianceHoldStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "complianceHoldCaseId" TEXT,
    "complianceHoldReason" TEXT,
    "complianceHoldSetAt" DATETIME,
    "complianceHoldReleasedAt" DATETIME,
    "cddDocumentExpiresAt" DATETIME,
    "latestRiskApprovalId" TEXT,
    "latestRiskApprovalStatus" TEXT,
    "riskTier" TEXT NOT NULL DEFAULT 'LOW',
    "riskTierUpdatedAt" DATETIME,
    "pepStatus" TEXT NOT NULL DEFAULT 'NONE',
    "pepConfirmedAt" DATETIME,
    "latestRiskAssessmentId" TEXT,
    "nextReviewAt" DATETIME,
    "activePeriodicReviewCycleId" TEXT,
    "periodicReviewOverdueAt" DATETIME,
    "periodicReviewOverdueReason" TEXT,
    "latestDecisionRecordId" TEXT,
    "investorClassification" TEXT NOT NULL DEFAULT 'RETAIL',
    "investorClassificationSource" TEXT NOT NULL DEFAULT 'CDD',
    "investorClassificationUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_main_latestRiskApprovalId_fkey" FOREIGN KEY ("latestRiskApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "customer_main_activePeriodicReviewCycleId_fkey" FOREIGN KEY ("activePeriodicReviewCycleId") REFERENCES "periodic_review_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_customer_main" ("activePeriodicReviewCycleId", "amlRiskTier", "cddDocumentExpiresAt", "companyName", "complianceHoldCaseId", "complianceHoldReason", "complianceHoldReleasedAt", "complianceHoldSetAt", "complianceHoldStatus", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "investorClassification", "investorClassificationSource", "investorClassificationUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestDecisionRecordId", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingStatus", "onboardingTraceId", "operatingStatus", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "periodicReviewOverdueAt", "periodicReviewOverdueReason", "phone", "phoneVerifiedAt", "restrictionCaseId", "restrictionReason", "restrictionReleasedAt", "restrictionSetAt", "restrictionStatus", "riskLevel", "riskScore", "riskTier", "riskTierUpdatedAt", "riskUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "termsAcceptedAt", "timezone", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus") SELECT "activePeriodicReviewCycleId", "amlRiskTier", "cddDocumentExpiresAt", "companyName", "complianceHoldCaseId", "complianceHoldReason", "complianceHoldReleasedAt", "complianceHoldSetAt", "complianceHoldStatus", "createdAt", "customerNo", "customerType", "eddRequired", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "investorClassification", "investorClassificationSource", "investorClassificationUpdatedAt", "lastLoginAt", "lastLoginIp", "lastName", "latestDecisionRecordId", "latestRiskApprovalId", "latestRiskApprovalStatus", "latestRiskAssessmentId", "locale", "lockedUntil", "nextReviewAt", "onboardingStatus", "onboardingTraceId", "operatingStatus", "passwordHash", "passwordUpdatedAt", "pepConfirmedAt", "pepStatus", "periodicReviewOverdueAt", "periodicReviewOverdueReason", "phone", "phoneVerifiedAt", "restrictionCaseId", "restrictionReason", "restrictionReleasedAt", "restrictionSetAt", "restrictionStatus", "riskLevel", "riskScore", "riskTier", "riskTierUpdatedAt", "riskUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "sumsubExperiencedLevel2", "sumsubLatestAttemptId", "sumsubLatestReviewId", "termsAcceptedAt", "timezone", "updatedAt", "verificationCanContinue", "verificationCustomerActionRequired", "verificationLatestEventAt", "verificationLatestEventType", "verificationProvider", "verificationSubstatus" FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");
CREATE UNIQUE INDEX "customer_main_latestRiskApprovalId_key" ON "customer_main"("latestRiskApprovalId");
CREATE UNIQUE INDEX "customer_main_activePeriodicReviewCycleId_key" ON "customer_main"("activePeriodicReviewCycleId");
CREATE INDEX "customer_main_complianceHoldStatus_idx" ON "customer_main"("complianceHoldStatus");
CREATE INDEX "customer_main_latestRiskApprovalStatus_idx" ON "customer_main"("latestRiskApprovalStatus");
CREATE INDEX "customer_main_activePeriodicReviewCycleId_idx" ON "customer_main"("activePeriodicReviewCycleId");
-- Recreate wallet owner triggers after customer_main redefine
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
CREATE TABLE "new_periodic_review_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CDD_INPUT',
    "dueAt" DATETIME NOT NULL,
    "triggeredAt" DATETIME,
    "clearedAt" DATETIME,
    "rejectedAt" DATETIME,
    "currentCddResponseId" TEXT,
    "currentEddResponseId" TEXT,
    "latestDecisionRecordId" TEXT,
    "resolutionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "periodic_review_cycles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_periodic_review_cycles" ("clearedAt", "createdAt", "currentCddResponseId", "currentEddResponseId", "customerId", "cycleNo", "dueAt", "id", "latestDecisionRecordId", "rejectedAt", "resolutionReason", "status", "triggeredAt", "updatedAt") SELECT "clearedAt", "createdAt", "currentCddResponseId", "currentEddResponseId", "customerId", "cycleNo", "dueAt", "id", "latestDecisionRecordId", "rejectedAt", "resolutionReason", "status", "triggeredAt", "updatedAt" FROM "periodic_review_cycles";
DROP TABLE "periodic_review_cycles";
ALTER TABLE "new_periodic_review_cycles" RENAME TO "periodic_review_cycles";
CREATE UNIQUE INDEX "periodic_review_cycles_cycleNo_key" ON "periodic_review_cycles"("cycleNo");
CREATE INDEX "periodic_review_cycles_customerId_status_idx" ON "periodic_review_cycles"("customerId", "status");
CREATE INDEX "periodic_review_cycles_status_dueAt_idx" ON "periodic_review_cycles"("status", "dueAt");
CREATE TABLE "new_reconciliation_breaks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "breakNo" TEXT NOT NULL DEFAULT 'TEMP',
    "runId" TEXT,
    "businessDate" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'WITHDRAW',
    "sourceId" TEXT NOT NULL,
    "sourceNo" TEXT,
    "withdrawId" TEXT,
    "withdrawNo" TEXT,
    "payoutId" TEXT,
    "payoutNo" TEXT,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT,
    "breakType" TEXT,
    "liabilityAmount" DECIMAL NOT NULL DEFAULT 0,
    "poolAmount" DECIMAL NOT NULL DEFAULT 0,
    "externalAmount" DECIMAL,
    "expectedNetDelta" DECIMAL NOT NULL DEFAULT 0,
    "observedNetDelta" DECIMAL NOT NULL DEFAULT 0,
    "deltaAmount" DECIMAL NOT NULL DEFAULT 0,
    "reasonCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detailsJson" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "reopenedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reconciliation_breaks_runId_fkey" FOREIGN KEY ("runId") REFERENCES "safeguarding_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_reconciliation_breaks" ("assetCode", "assetId", "breakNo", "breakType", "businessDate", "createdAt", "deltaAmount", "detailsJson", "detectedAt", "expectedNetDelta", "externalAmount", "id", "liabilityAmount", "observedNetDelta", "payoutId", "payoutNo", "poolAmount", "reasonCode", "reopenedAt", "resolvedAt", "runId", "sourceId", "sourceNo", "sourceType", "status", "updatedAt", "withdrawId", "withdrawNo") SELECT "assetCode", "assetId", "breakNo", "breakType", "businessDate", "createdAt", "deltaAmount", "detailsJson", "detectedAt", "expectedNetDelta", "externalAmount", "id", "liabilityAmount", "observedNetDelta", "payoutId", "payoutNo", "poolAmount", "reasonCode", "reopenedAt", "resolvedAt", "runId", "sourceId", "sourceNo", "sourceType", "status", "updatedAt", "withdrawId", "withdrawNo" FROM "reconciliation_breaks";
DROP TABLE "reconciliation_breaks";
ALTER TABLE "new_reconciliation_breaks" RENAME TO "reconciliation_breaks";
CREATE UNIQUE INDEX "reconciliation_breaks_breakNo_key" ON "reconciliation_breaks"("breakNo");
CREATE INDEX "reconciliation_breaks_businessDate_status_idx" ON "reconciliation_breaks"("businessDate", "status");
CREATE INDEX "reconciliation_breaks_runId_idx" ON "reconciliation_breaks"("runId");
CREATE INDEX "reconciliation_breaks_sourceType_sourceId_idx" ON "reconciliation_breaks"("sourceType", "sourceId");
CREATE INDEX "reconciliation_breaks_withdrawId_idx" ON "reconciliation_breaks"("withdrawId");
CREATE INDEX "reconciliation_breaks_payoutId_idx" ON "reconciliation_breaks"("payoutId");
CREATE UNIQUE INDEX "reconciliation_breaks_businessDate_sourceType_sourceId_key" ON "reconciliation_breaks"("businessDate", "sourceType", "sourceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "tier_upgrade_cases_caseNo_key" ON "tier_upgrade_cases"("caseNo");

-- CreateIndex
CREATE UNIQUE INDEX "tier_upgrade_cases_sourceCraId_key" ON "tier_upgrade_cases"("sourceCraId");

-- CreateIndex
CREATE UNIQUE INDEX "tier_upgrade_cases_phase2ApprovalCaseId_key" ON "tier_upgrade_cases"("phase2ApprovalCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "tier_upgrade_cases_traceId_key" ON "tier_upgrade_cases"("traceId");

-- CreateIndex
CREATE INDEX "tier_upgrade_cases_customerId_status_idx" ON "tier_upgrade_cases"("customerId", "status");
