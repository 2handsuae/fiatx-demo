/*
  Warnings:

  - You are about to drop the column `closedAt` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `closedByUserId` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `deployedAt` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `emergency` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `emergencyReason` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `latestApprovalId` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `latestApprovalStatus` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `postApprovalCompletedAt` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `postApprovalDueAt` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `riskLevel` on the `change_tickets` table. All the data in the column will be lost.
  - `latestFinalApprovalId` on `customer_main` is RENAMED to `latestRiskApprovalId` (native ALTER TABLE RENAME COLUMN — no data loss).
  - `latestFinalApprovalStatus` on `customer_main` is RENAMED to `latestRiskApprovalStatus` (native ALTER TABLE RENAME COLUMN — no data loss).
  - Made the column `changeReason` on table `change_tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `changeType` on table `change_tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdByUserNo` on table `change_tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `rollbackPlanRef` on table `change_tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `scopeSummary` on table `change_tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `testEvidenceRef` on table `change_tickets` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "fee_occurrences_feeType_idx";

-- DropIndex
DROP INDEX "outstandings_ownerNo_idx";

-- DropIndex
DROP INDEX "swap_quotes_ownerNo_idx";

-- DropIndex
DROP INDEX "swap_transactions_quoteNo_idx";

-- CreateTable order: client_risk_assessments first (no deps), then customer_material_holdings, then material_refresh_cycles (forward FK from holdings.activeRefreshCycleId is checked at DML time in SQLite, not DDL)
CREATE TABLE "client_risk_assessments" (
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

-- CreateTable
CREATE TABLE "customer_material_holdings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "managementMode" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'FRESH',
    "sumsubIdDocSetType" TEXT,
    "sumsubDocId" TEXT,
    "activeRefreshCycleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_material_holdings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_material_holdings_activeRefreshCycleId_fkey" FOREIGN KEY ("activeRefreshCycleId") REFERENCES "material_refresh_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "material_refresh_cycles" (
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
    "graceExpiresAt" DATETIME,
    "resolutionReason" TEXT,
    "sumsubActionId" TEXT,
    "sumsubActionLevelName" TEXT,
    "sumsubActionCreatedAt" DATETIME,
    "triggeredByAssessmentId" TEXT,
    "traceId" TEXT NOT NULL,
    CONSTRAINT "material_refresh_cycles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "material_refresh_cycles_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "customer_material_holdings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "material_refresh_cycles_triggeredByAssessmentId_fkey" FOREIGN KEY ("triggeredByAssessmentId") REFERENCES "client_risk_assessments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_approval_action_policies" (
    "actionType" TEXT NOT NULL PRIMARY KEY,
    "riskLevel" TEXT NOT NULL DEFAULT 'HIGH',
    "checkerRoles" TEXT NOT NULL,
    "timeoutHours" INTEGER NOT NULL DEFAULT 24,
    "allowCancel" BOOLEAN NOT NULL DEFAULT true,
    "allowRetry" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_approval_action_policies" ("actionType", "allowCancel", "allowRetry", "checkerRoles", "riskLevel", "timeoutHours", "updatedAt") SELECT "actionType", "allowCancel", "allowRetry", "checkerRoles", "riskLevel", "timeoutHours", "updatedAt" FROM "approval_action_policies";
DROP TABLE "approval_action_policies";
ALTER TABLE "new_approval_action_policies" RENAME TO "approval_action_policies";
CREATE TABLE "new_approval_sod_rules" (
    "ruleCode" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_approval_sod_rules" ("createdAt", "description", "enabled", "ruleCode", "updatedAt") SELECT "createdAt", "description", "enabled", "ruleCode", "updatedAt" FROM "approval_sod_rules";
DROP TABLE "approval_sod_rules";
ALTER TABLE "new_approval_sod_rules" RENAME TO "approval_sod_rules";
CREATE TABLE "new_audit_log_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditNo" TEXT NOT NULL DEFAULT 'TEMP',
    "triggerType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityNo" TEXT,
    "traceId" TEXT,
    "workflowType" TEXT,
    "entityOwnerType" TEXT,
    "entityOwnerId" TEXT,
    "statusFrom" TEXT,
    "statusTo" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorNo" TEXT,
    "actorRole" TEXT,
    "requestId" TEXT,
    "sourceIp" TEXT,
    "sourcePlatform" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "metadata" TEXT,
    "beforeData" TEXT,
    "afterData" TEXT,
    "idempotencyKey" TEXT,
    "payloadDigest" TEXT NOT NULL,
    "maskVersion" TEXT NOT NULL DEFAULT 'v1',
    "retainedUntil" DATETIME NOT NULL,
    "entityOwnerNo" TEXT,
    "archivedAt" DATETIME,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_audit_log_events" ("action", "actorId", "actorNo", "actorRole", "actorType", "afterData", "archivedAt", "auditNo", "beforeData", "createdAt", "entityId", "entityNo", "entityOwnerId", "entityOwnerNo", "entityOwnerType", "entityType", "id", "idempotencyKey", "maskVersion", "metadata", "module", "occurredAt", "payloadDigest", "reason", "requestId", "result", "retainedUntil", "sourceIp", "sourcePlatform", "statusFrom", "statusTo", "traceId", "triggerType", "updatedAt", "workflowType") SELECT "action", "actorId", "actorNo", "actorRole", "actorType", "afterData", "archivedAt", "auditNo", "beforeData", "createdAt", "entityId", "entityNo", "entityOwnerId", "entityOwnerNo", "entityOwnerType", "entityType", "id", "idempotencyKey", "maskVersion", "metadata", "module", "occurredAt", "payloadDigest", "reason", "requestId", "result", "retainedUntil", "sourceIp", "sourcePlatform", "statusFrom", "statusTo", "traceId", "triggerType", "updatedAt", "workflowType" FROM "audit_log_events";
DROP TABLE "audit_log_events";
ALTER TABLE "new_audit_log_events" RENAME TO "audit_log_events";
CREATE UNIQUE INDEX "audit_log_events_auditNo_key" ON "audit_log_events"("auditNo");
CREATE UNIQUE INDEX "audit_log_events_idempotencyKey_key" ON "audit_log_events"("idempotencyKey");
CREATE INDEX "audit_log_events_occurredAt_idx" ON "audit_log_events"("occurredAt");
CREATE INDEX "audit_log_events_triggerType_occurredAt_idx" ON "audit_log_events"("triggerType", "occurredAt");
CREATE INDEX "audit_log_events_module_occurredAt_idx" ON "audit_log_events"("module", "occurredAt");
CREATE INDEX "audit_log_events_entityType_entityId_idx" ON "audit_log_events"("entityType", "entityId");
CREATE INDEX "audit_log_events_actorType_actorId_idx" ON "audit_log_events"("actorType", "actorId");
CREATE INDEX "audit_log_events_module_entityType_entityId_occurredAt_idx" ON "audit_log_events"("module", "entityType", "entityId", "occurredAt");
CREATE INDEX "audit_log_events_actorType_actorId_occurredAt_idx" ON "audit_log_events"("actorType", "actorId", "occurredAt");
CREATE INDEX "audit_log_events_actorNo_occurredAt_idx" ON "audit_log_events"("actorNo", "occurredAt");
CREATE INDEX "audit_log_events_entityOwnerNo_occurredAt_idx" ON "audit_log_events"("entityOwnerNo", "occurredAt");
CREATE INDEX "audit_log_events_traceId_occurredAt_idx" ON "audit_log_events"("traceId", "occurredAt");
CREATE INDEX "audit_log_events_workflowType_occurredAt_idx" ON "audit_log_events"("workflowType", "occurredAt");
CREATE INDEX "audit_log_events_result_occurredAt_idx" ON "audit_log_events"("result", "occurredAt");
CREATE INDEX "audit_log_events_retainedUntil_idx" ON "audit_log_events"("retainedUntil");
CREATE INDEX "audit_log_events_archivedAt_idx" ON "audit_log_events"("archivedAt");
CREATE TABLE "new_cdd_responses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerId" TEXT NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "subjectKind" TEXT NOT NULL DEFAULT 'INDIVIDUAL_CUSTOMER',
    "subjectRefId" TEXT NOT NULL DEFAULT '',
    "journeyId" TEXT NOT NULL DEFAULT '',
    "workflow" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "periodicReviewCycleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "reviewerId" TEXT,
    "reviewerRole" TEXT,
    "reviewerDecision" TEXT,
    "decisionReason" TEXT,
    "requiresEdd" BOOLEAN NOT NULL DEFAULT false,
    "riskScore" INTEGER,
    "riskLevel" TEXT,
    "screeningSummary" TEXT,
    "pepHit" BOOLEAN NOT NULL DEFAULT false,
    "sanctionsHit" BOOLEAN NOT NULL DEFAULT false,
    "inputData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cdd_responses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cdd_responses_periodicReviewCycleId_fkey" FOREIGN KEY ("periodicReviewCycleId") REFERENCES "periodic_review_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_cdd_responses" ("caseNo", "createdAt", "customerId", "customerType", "decisionReason", "id", "inputData", "journeyId", "pepHit", "periodicReviewCycleId", "requiresEdd", "reviewedAt", "reviewerDecision", "reviewerId", "reviewerRole", "riskLevel", "riskScore", "sanctionsHit", "screeningSummary", "status", "subjectKind", "subjectRefId", "submittedAt", "updatedAt", "workflow") SELECT "caseNo", "createdAt", "customerId", "customerType", "decisionReason", "id", "inputData", "journeyId", "pepHit", "periodicReviewCycleId", "requiresEdd", "reviewedAt", "reviewerDecision", "reviewerId", "reviewerRole", "riskLevel", "riskScore", "sanctionsHit", "screeningSummary", "status", "subjectKind", "subjectRefId", "submittedAt", "updatedAt", "workflow" FROM "cdd_responses";
DROP TABLE "cdd_responses";
ALTER TABLE "new_cdd_responses" RENAME TO "cdd_responses";
CREATE UNIQUE INDEX "cdd_responses_caseNo_key" ON "cdd_responses"("caseNo");
CREATE INDEX "cdd_responses_customerId_status_idx" ON "cdd_responses"("customerId", "status");
CREATE INDEX "cdd_responses_customerId_journeyId_idx" ON "cdd_responses"("customerId", "journeyId");
CREATE INDEX "cdd_responses_workflow_status_idx" ON "cdd_responses"("workflow", "status");
CREATE INDEX "cdd_responses_periodicReviewCycleId_idx" ON "cdd_responses"("periodicReviewCycleId");
CREATE INDEX "cdd_responses_subjectKind_subjectRefId_idx" ON "cdd_responses"("subjectKind", "subjectRefId");
CREATE TABLE "new_change_tickets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketNo" TEXT NOT NULL DEFAULT 'TEMP',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "changeType" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "bindingSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "bindingDigest" TEXT,
    "scopeSummary" TEXT NOT NULL,
    "testEvidenceRef" TEXT NOT NULL,
    "rollbackPlanRef" TEXT NOT NULL,
    "approvalCaseId" TEXT,
    "approvalNo" TEXT,
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByUserNo" TEXT NOT NULL,
    "submittedByUserId" TEXT,
    "submittedByUserNo" TEXT,
    "consumedByUserId" TEXT,
    "consumedByUserNo" TEXT,
    "submittedAt" DATETIME,
    "consumedAt" DATETIME,
    "resultNote" TEXT,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "deleteRequestId" TEXT,
    "deleteRequestNo" TEXT,
    "deleteReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "change_tickets_approvalCaseId_fkey" FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_change_tickets" ("approvalCaseId", "approvalNo", "bindingDigest", "bindingSnapshotJson", "changeReason", "changeType", "consumedAt", "consumedByUserId", "consumedByUserNo", "createdAt", "createdByUserId", "createdByUserNo", "deleteReason", "deleteRequestId", "deleteRequestNo", "deletedAt", "deletedBy", "id", "resultNote", "rollbackPlanRef", "scopeSummary", "status", "submittedAt", "submittedByUserId", "submittedByUserNo", "testEvidenceRef", "ticketNo", "traceId", "updatedAt") SELECT "approvalCaseId", "approvalNo", "bindingDigest", "bindingSnapshotJson", "changeReason", "changeType", "consumedAt", "consumedByUserId", "consumedByUserNo", "createdAt", "createdByUserId", "createdByUserNo", "deleteReason", "deleteRequestId", "deleteRequestNo", "deletedAt", "deletedBy", "id", "resultNote", "rollbackPlanRef", "scopeSummary", "status", "submittedAt", "submittedByUserId", "submittedByUserNo", "testEvidenceRef", "ticketNo", "traceId", "updatedAt" FROM "change_tickets";
DROP TABLE "change_tickets";
ALTER TABLE "new_change_tickets" RENAME TO "change_tickets";
CREATE UNIQUE INDEX "change_tickets_ticketNo_key" ON "change_tickets"("ticketNo");
CREATE UNIQUE INDEX "change_tickets_approvalCaseId_key" ON "change_tickets"("approvalCaseId");
CREATE INDEX "change_tickets_status_createdAt_idx" ON "change_tickets"("status", "createdAt");
CREATE INDEX "change_tickets_ticketNo_createdAt_idx" ON "change_tickets"("ticketNo", "createdAt");
CREATE INDEX "change_tickets_traceId_createdAt_idx" ON "change_tickets"("traceId", "createdAt");
CREATE INDEX "change_tickets_approvalNo_createdAt_idx" ON "change_tickets"("approvalNo", "createdAt");
CREATE INDEX "change_tickets_deletedAt_idx" ON "change_tickets"("deletedAt");
CREATE TABLE "new_compliance_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertNo" TEXT NOT NULL DEFAULT 'TEMP',
    "dedupeKey" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "capCode" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNo" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityNo" TEXT,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "ownerNo" TEXT,
    "customerId" TEXT,
    "customerNo" TEXT,
    "firstOccurredAt" DATETIME NOT NULL,
    "lastOccurredAt" DATETIME NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "assigneeUserId" TEXT,
    "assigneeUserNo" TEXT,
    "assignedAt" DATETIME,
    "journeyId" TEXT,
    "stage" TEXT,
    "currentDispositionCode" TEXT,
    "currentDispositionReason" TEXT,
    "currentDispositionAt" DATETIME,
    "currentDispositionById" TEXT,
    "currentDispositionByNo" TEXT,
    "currentDispositionByRole" TEXT,
    "currentDispositionRecordId" TEXT,
    "finalDispositionCode" TEXT,
    "finalDispositionReason" TEXT,
    "finalDispositionAt" DATETIME,
    "finalDispositionRecordId" TEXT,
    "decisionRecommendation" TEXT,
    "decision" TEXT,
    "linkedCaseIds" TEXT,
    "decisionRecordIds" TEXT,
    "overdueMarkedAt" DATETIME,
    "closedAt" DATETIME,
    "closeReason" TEXT,
    "lastActionById" TEXT,
    "lastActionByNo" TEXT,
    "lastActionByRole" TEXT,
    "lastActionAt" DATETIME,
    "metadata" TEXT,
    "retainedUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_compliance_alerts" ("alertNo", "assignedAt", "assigneeUserId", "assigneeUserNo", "capCode", "closeReason", "closedAt", "createdAt", "currentDispositionAt", "currentDispositionById", "currentDispositionByNo", "currentDispositionByRole", "currentDispositionCode", "currentDispositionReason", "currentDispositionRecordId", "customerId", "customerNo", "decision", "decisionRecommendation", "decisionRecordIds", "dedupeKey", "dueAt", "entityId", "entityNo", "entityType", "finalDispositionAt", "finalDispositionCode", "finalDispositionReason", "finalDispositionRecordId", "firstOccurredAt", "hitCount", "id", "journeyId", "lastActionAt", "lastActionById", "lastActionByNo", "lastActionByRole", "lastOccurredAt", "linkedCaseIds", "message", "metadata", "overdueMarkedAt", "ownerId", "ownerNo", "ownerType", "retainedUntil", "ruleCode", "severity", "sourceId", "sourceModule", "sourceNo", "sourceType", "stage", "status", "title", "updatedAt") SELECT "alertNo", "assignedAt", "assigneeUserId", "assigneeUserNo", "capCode", "closeReason", "closedAt", "createdAt", "currentDispositionAt", "currentDispositionById", "currentDispositionByNo", "currentDispositionByRole", "currentDispositionCode", "currentDispositionReason", "currentDispositionRecordId", "customerId", "customerNo", "decision", "decisionRecommendation", "decisionRecordIds", "dedupeKey", "dueAt", "entityId", "entityNo", "entityType", "finalDispositionAt", "finalDispositionCode", "finalDispositionReason", "finalDispositionRecordId", "firstOccurredAt", "hitCount", "id", "journeyId", "lastActionAt", "lastActionById", "lastActionByNo", "lastActionByRole", "lastOccurredAt", "linkedCaseIds", "message", "metadata", "overdueMarkedAt", "ownerId", "ownerNo", "ownerType", "retainedUntil", "ruleCode", "severity", "sourceId", "sourceModule", "sourceNo", "sourceType", "stage", "status", "title", "updatedAt" FROM "compliance_alerts";
DROP TABLE "compliance_alerts";
ALTER TABLE "new_compliance_alerts" RENAME TO "compliance_alerts";
CREATE UNIQUE INDEX "compliance_alerts_alertNo_key" ON "compliance_alerts"("alertNo");
CREATE UNIQUE INDEX "compliance_alerts_dedupeKey_key" ON "compliance_alerts"("dedupeKey");
CREATE INDEX "compliance_alerts_status_lastOccurredAt_idx" ON "compliance_alerts"("status", "lastOccurredAt");
CREATE INDEX "compliance_alerts_severity_status_dueAt_idx" ON "compliance_alerts"("severity", "status", "dueAt");
CREATE INDEX "compliance_alerts_ruleCode_lastOccurredAt_idx" ON "compliance_alerts"("ruleCode", "lastOccurredAt");
CREATE INDEX "compliance_alerts_sourceType_sourceId_lastOccurredAt_idx" ON "compliance_alerts"("sourceType", "sourceId", "lastOccurredAt");
CREATE INDEX "compliance_alerts_sourceType_sourceId_stage_lastOccurredAt_idx" ON "compliance_alerts"("sourceType", "sourceId", "stage", "lastOccurredAt");
CREATE INDEX "compliance_alerts_customerNo_lastOccurredAt_idx" ON "compliance_alerts"("customerNo", "lastOccurredAt");
CREATE INDEX "compliance_alerts_status_dueAt_overdueMarkedAt_idx" ON "compliance_alerts"("status", "dueAt", "overdueMarkedAt");
CREATE TABLE "new_compliance_incident_external_filings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filingNo" TEXT NOT NULL DEFAULT 'TEMP',
    "incidentId" TEXT NOT NULL,
    "filingType" TEXT,
    "filingAuthority" TEXT,
    "status" TEXT NOT NULL,
    "requiredAt" DATETIME,
    "requiredById" TEXT,
    "requiredByNo" TEXT,
    "requiredByRole" TEXT,
    "submittedAt" DATETIME,
    "submittedById" TEXT,
    "submittedByNo" TEXT,
    "submittedByRole" TEXT,
    "externalRefNo" TEXT,
    "latestFeedback" TEXT,
    "latestFeedbackAt" DATETIME,
    "latestFeedbackById" TEXT,
    "latestFeedbackByNo" TEXT,
    "latestFeedbackByRole" TEXT,
    "closedAt" DATETIME,
    "closedById" TEXT,
    "closedByNo" TEXT,
    "closedByRole" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "compliance_incident_external_filings_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "compliance_incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_compliance_incident_external_filings" ("closedAt", "closedById", "closedByNo", "closedByRole", "createdAt", "externalRefNo", "filingAuthority", "filingNo", "filingType", "id", "incidentId", "latestFeedback", "latestFeedbackAt", "latestFeedbackById", "latestFeedbackByNo", "latestFeedbackByRole", "metadata", "requiredAt", "requiredById", "requiredByNo", "requiredByRole", "status", "submittedAt", "submittedById", "submittedByNo", "submittedByRole", "updatedAt") SELECT "closedAt", "closedById", "closedByNo", "closedByRole", "createdAt", "externalRefNo", "filingAuthority", "filingNo", "filingType", "id", "incidentId", "latestFeedback", "latestFeedbackAt", "latestFeedbackById", "latestFeedbackByNo", "latestFeedbackByRole", "metadata", "requiredAt", "requiredById", "requiredByNo", "requiredByRole", "status", "submittedAt", "submittedById", "submittedByNo", "submittedByRole", "updatedAt" FROM "compliance_incident_external_filings";
DROP TABLE "compliance_incident_external_filings";
ALTER TABLE "new_compliance_incident_external_filings" RENAME TO "compliance_incident_external_filings";
CREATE UNIQUE INDEX "compliance_incident_external_filings_filingNo_key" ON "compliance_incident_external_filings"("filingNo");
CREATE UNIQUE INDEX "compliance_incident_external_filings_incidentId_key" ON "compliance_incident_external_filings"("incidentId");
CREATE INDEX "compliance_incident_external_filings_status_updatedAt_idx" ON "compliance_incident_external_filings"("status", "updatedAt");
CREATE INDEX "compliance_incident_external_filings_filingAuthority_status_updatedAt_idx" ON "compliance_incident_external_filings"("filingAuthority", "status", "updatedAt");
CREATE TABLE "new_compliance_incident_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "workflow" TEXT NOT NULL,
    "stage" TEXT,
    "ruleCode" TEXT,
    "factsSummary" TEXT,
    "investigationScope" TEXT,
    "evidenceSummary" TEXT,
    "containmentSummary" TEXT,
    "analystConclusion" TEXT,
    "recommendedActions" TEXT,
    "finalDispositionCode" TEXT,
    "finalDispositionReason" TEXT,
    "filingRequired" BOOLEAN,
    "filingType" TEXT,
    "filingAuthority" TEXT,
    "linkedAlertSnapshot" TEXT,
    "decisionRecordSnapshot" TEXT,
    "providerResponseSnapshot" TEXT,
    "createdByUserId" TEXT,
    "createdByUserNo" TEXT,
    "finalizedByUserId" TEXT,
    "finalizedByUserNo" TEXT,
    "finalizedAt" DATETIME,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "compliance_incident_reports_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "compliance_incidents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_compliance_incident_reports" ("analystConclusion", "containmentSummary", "createdAt", "createdByUserId", "createdByUserNo", "decisionRecordSnapshot", "evidenceSummary", "factsSummary", "filingAuthority", "filingRequired", "filingType", "finalDispositionCode", "finalDispositionReason", "finalizedAt", "finalizedByUserId", "finalizedByUserNo", "id", "incidentId", "investigationScope", "isCurrent", "linkedAlertSnapshot", "providerResponseSnapshot", "recommendedActions", "ruleCode", "stage", "status", "supersededAt", "updatedAt", "version", "workflow") SELECT "analystConclusion", "containmentSummary", "createdAt", "createdByUserId", "createdByUserNo", "decisionRecordSnapshot", "evidenceSummary", "factsSummary", "filingAuthority", "filingRequired", "filingType", "finalDispositionCode", "finalDispositionReason", "finalizedAt", "finalizedByUserId", "finalizedByUserNo", "id", "incidentId", "investigationScope", "isCurrent", "linkedAlertSnapshot", "providerResponseSnapshot", "recommendedActions", "ruleCode", "stage", "status", "supersededAt", "updatedAt", "version", "workflow" FROM "compliance_incident_reports";
DROP TABLE "compliance_incident_reports";
ALTER TABLE "new_compliance_incident_reports" RENAME TO "compliance_incident_reports";
CREATE INDEX "compliance_incident_reports_incidentId_isCurrent_idx" ON "compliance_incident_reports"("incidentId", "isCurrent");
CREATE INDEX "compliance_incident_reports_incidentId_status_updatedAt_idx" ON "compliance_incident_reports"("incidentId", "status", "updatedAt");
CREATE UNIQUE INDEX "compliance_incident_reports_incidentId_version_key" ON "compliance_incident_reports"("incidentId", "version");
CREATE TABLE "new_compliance_incidents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentNo" TEXT NOT NULL DEFAULT 'TEMP',
    "caseType" TEXT NOT NULL DEFAULT 'GENERIC',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "primaryAlertId" TEXT,
    "primaryAlertNo" TEXT,
    "customerId" TEXT,
    "customerNo" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityNo" TEXT,
    "sourceModule" TEXT,
    "sourceType" TEXT,
    "stage" TEXT,
    "ruleCode" TEXT,
    "ownerUserId" TEXT,
    "ownerUserNo" TEXT,
    "assignedAt" DATETIME,
    "alertCount" INTEGER NOT NULL DEFAULT 1,
    "firstAlertAt" DATETIME NOT NULL,
    "lastAlertAt" DATETIME NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "closedAt" DATETIME,
    "closeReason" TEXT,
    "rootCauseCategory" TEXT,
    "resolutionSummary" TEXT,
    "containmentSummary" TEXT,
    "closureChecklist" TEXT,
    "decision" TEXT,
    "proposedWorkflowDecision" TEXT,
    "proposedWorkflowReason" TEXT,
    "proposedFinalDispositionCode" TEXT,
    "proposedFinalDispositionReason" TEXT,
    "proposedFilingRequired" BOOLEAN,
    "proposedFilingType" TEXT,
    "proposedFilingAuthority" TEXT,
    "submittedForMlroAt" DATETIME,
    "submittedForMlroById" TEXT,
    "submittedForMlroByNo" TEXT,
    "submittedForMlroByRole" TEXT,
    "mlroReviewOutcome" TEXT,
    "mlroReviewNote" TEXT,
    "mlroReviewedAt" DATETIME,
    "mlroReviewedById" TEXT,
    "mlroReviewedByNo" TEXT,
    "mlroReviewedByRole" TEXT,
    "currentDispositionCode" TEXT,
    "currentDispositionReason" TEXT,
    "currentDispositionAt" DATETIME,
    "currentDispositionById" TEXT,
    "currentDispositionByNo" TEXT,
    "currentDispositionByRole" TEXT,
    "currentDispositionRecordId" TEXT,
    "finalDispositionCode" TEXT,
    "finalDispositionReason" TEXT,
    "finalDispositionAt" DATETIME,
    "finalDispositionRecordId" TEXT,
    "linkedCaseIds" TEXT,
    "decisionRecordIds" TEXT,
    "freezeStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "frozenAt" DATETIME,
    "freezeReason" TEXT,
    "reportStatus" TEXT NOT NULL DEFAULT 'NOT_REPORTED',
    "reportRefNo" TEXT,
    "reportedAt" DATETIME,
    "reportReason" TEXT,
    "reportedByUserId" TEXT,
    "reportedByUserNo" TEXT,
    "overdueMarkedAt" DATETIME,
    "lastActionById" TEXT,
    "lastActionByNo" TEXT,
    "lastActionByRole" TEXT,
    "lastActionAt" DATETIME,
    "metadata" TEXT,
    "retainedUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "compliance_incidents_primaryAlertId_fkey" FOREIGN KEY ("primaryAlertId") REFERENCES "compliance_alerts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_compliance_incidents" ("alertCount", "assignedAt", "caseType", "closeReason", "closedAt", "closureChecklist", "containmentSummary", "createdAt", "currentDispositionAt", "currentDispositionById", "currentDispositionByNo", "currentDispositionByRole", "currentDispositionCode", "currentDispositionReason", "currentDispositionRecordId", "customerId", "customerNo", "decision", "decisionRecordIds", "dueAt", "entityId", "entityNo", "entityType", "finalDispositionAt", "finalDispositionCode", "finalDispositionReason", "finalDispositionRecordId", "firstAlertAt", "freezeReason", "freezeStatus", "frozenAt", "id", "incidentNo", "lastActionAt", "lastActionById", "lastActionByNo", "lastActionByRole", "lastAlertAt", "linkedCaseIds", "metadata", "mlroReviewNote", "mlroReviewOutcome", "mlroReviewedAt", "mlroReviewedById", "mlroReviewedByNo", "mlroReviewedByRole", "overdueMarkedAt", "ownerUserId", "ownerUserNo", "primaryAlertId", "primaryAlertNo", "proposedFilingAuthority", "proposedFilingRequired", "proposedFilingType", "proposedFinalDispositionCode", "proposedFinalDispositionReason", "proposedWorkflowDecision", "proposedWorkflowReason", "reportReason", "reportRefNo", "reportStatus", "reportedAt", "reportedByUserId", "reportedByUserNo", "resolutionSummary", "resolvedAt", "retainedUntil", "rootCauseCategory", "ruleCode", "severity", "sourceModule", "sourceType", "stage", "status", "submittedForMlroAt", "submittedForMlroById", "submittedForMlroByNo", "submittedForMlroByRole", "summary", "title", "updatedAt") SELECT "alertCount", "assignedAt", "caseType", "closeReason", "closedAt", "closureChecklist", "containmentSummary", "createdAt", "currentDispositionAt", "currentDispositionById", "currentDispositionByNo", "currentDispositionByRole", "currentDispositionCode", "currentDispositionReason", "currentDispositionRecordId", "customerId", "customerNo", "decision", "decisionRecordIds", "dueAt", "entityId", "entityNo", "entityType", "finalDispositionAt", "finalDispositionCode", "finalDispositionReason", "finalDispositionRecordId", "firstAlertAt", "freezeReason", "freezeStatus", "frozenAt", "id", "incidentNo", "lastActionAt", "lastActionById", "lastActionByNo", "lastActionByRole", "lastAlertAt", "linkedCaseIds", "metadata", "mlroReviewNote", "mlroReviewOutcome", "mlroReviewedAt", "mlroReviewedById", "mlroReviewedByNo", "mlroReviewedByRole", "overdueMarkedAt", "ownerUserId", "ownerUserNo", "primaryAlertId", "primaryAlertNo", "proposedFilingAuthority", "proposedFilingRequired", "proposedFilingType", "proposedFinalDispositionCode", "proposedFinalDispositionReason", "proposedWorkflowDecision", "proposedWorkflowReason", "reportReason", "reportRefNo", "reportStatus", "reportedAt", "reportedByUserId", "reportedByUserNo", "resolutionSummary", "resolvedAt", "retainedUntil", "rootCauseCategory", "ruleCode", "severity", "sourceModule", "sourceType", "stage", "status", "submittedForMlroAt", "submittedForMlroById", "submittedForMlroByNo", "submittedForMlroByRole", "summary", "title", "updatedAt" FROM "compliance_incidents";
DROP TABLE "compliance_incidents";
ALTER TABLE "new_compliance_incidents" RENAME TO "compliance_incidents";
CREATE UNIQUE INDEX "compliance_incidents_incidentNo_key" ON "compliance_incidents"("incidentNo");
CREATE UNIQUE INDEX "compliance_incidents_primaryAlertId_key" ON "compliance_incidents"("primaryAlertId");
CREATE UNIQUE INDEX "compliance_incidents_reportRefNo_key" ON "compliance_incidents"("reportRefNo");
CREATE INDEX "compliance_incidents_status_lastActionAt_idx" ON "compliance_incidents"("status", "lastActionAt");
CREATE INDEX "compliance_incidents_severity_status_dueAt_idx" ON "compliance_incidents"("severity", "status", "dueAt");
CREATE INDEX "compliance_incidents_caseType_status_dueAt_idx" ON "compliance_incidents"("caseType", "status", "dueAt");
CREATE INDEX "compliance_incidents_sourceType_stage_lastActionAt_idx" ON "compliance_incidents"("sourceType", "stage", "lastActionAt");
CREATE INDEX "compliance_incidents_ruleCode_lastActionAt_idx" ON "compliance_incidents"("ruleCode", "lastActionAt");
CREATE INDEX "compliance_incidents_status_dueAt_overdueMarkedAt_idx" ON "compliance_incidents"("status", "dueAt", "overdueMarkedAt");
CREATE INDEX "compliance_incidents_reportStatus_reportedAt_idx" ON "compliance_incidents"("reportStatus", "reportedAt");
CREATE INDEX "compliance_incidents_customerNo_lastActionAt_idx" ON "compliance_incidents"("customerNo", "lastActionAt");
CREATE INDEX "compliance_incidents_primaryAlertId_idx" ON "compliance_incidents"("primaryAlertId");
CREATE INDEX "compliance_incidents_lastAlertAt_idx" ON "compliance_incidents"("lastAlertAt");
-- Native rename + add for customer_main (avoids table-recreate FK loss — see deferred-refactors.md Gotcha #1)
-- Step 1: drop the named index on latestFinalApprovalStatus before renaming the column
--         (the UNIQUE constraint on latestFinalApprovalId is a table constraint — RENAME COLUMN
--          carries it automatically; the non-unique index on status is a named user index)
DROP INDEX IF EXISTS "customer_main_latestFinalApprovalStatus_idx";
-- Step 2: rename columns (SQLite 3.25+ native support; UNIQUE constraint follows automatically)
ALTER TABLE "customer_main" RENAME COLUMN "latestFinalApprovalId" TO "latestRiskApprovalId";
ALTER TABLE "customer_main" RENAME COLUMN "latestFinalApprovalStatus" TO "latestRiskApprovalStatus";
-- Step 3: add new Wave 3 columns
ALTER TABLE "customer_main" ADD COLUMN "riskTier" TEXT NOT NULL DEFAULT 'LOW';
ALTER TABLE "customer_main" ADD COLUMN "riskTierUpdatedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "pepStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "customer_main" ADD COLUMN "pepConfirmedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "latestRiskAssessmentId" TEXT;
-- Step 4: recreate the status index with the new column name
CREATE INDEX "customer_main_latestRiskApprovalStatus_idx" ON "customer_main"("latestRiskApprovalStatus");
CREATE TABLE "new_edd_responses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerId" TEXT NOT NULL,
    "cddResponseId" TEXT,
    "subjectKind" TEXT NOT NULL DEFAULT 'INDIVIDUAL_CUSTOMER',
    "subjectRefId" TEXT NOT NULL DEFAULT '',
    "journeyId" TEXT NOT NULL DEFAULT '',
    "workflow" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "periodicReviewCycleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "submittedAt" DATETIME,
    "mlroReviewedAt" DATETIME,
    "mlroReviewerId" TEXT,
    "mlroDecision" TEXT,
    "decisionReason" TEXT,
    "sourceOfFunds" TEXT,
    "sourceOfWealth" TEXT,
    "inputData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "edd_responses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "edd_responses_cddResponseId_fkey" FOREIGN KEY ("cddResponseId") REFERENCES "cdd_responses" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "edd_responses_periodicReviewCycleId_fkey" FOREIGN KEY ("periodicReviewCycleId") REFERENCES "periodic_review_cycles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_edd_responses" ("caseNo", "cddResponseId", "createdAt", "customerId", "decisionReason", "id", "inputData", "journeyId", "mlroDecision", "mlroReviewedAt", "mlroReviewerId", "periodicReviewCycleId", "sourceOfFunds", "sourceOfWealth", "status", "subjectKind", "subjectRefId", "submittedAt", "updatedAt", "workflow") SELECT "caseNo", "cddResponseId", "createdAt", "customerId", "decisionReason", "id", "inputData", "journeyId", "mlroDecision", "mlroReviewedAt", "mlroReviewerId", "periodicReviewCycleId", "sourceOfFunds", "sourceOfWealth", "status", "subjectKind", "subjectRefId", "submittedAt", "updatedAt", "workflow" FROM "edd_responses";
DROP TABLE "edd_responses";
ALTER TABLE "new_edd_responses" RENAME TO "edd_responses";
CREATE UNIQUE INDEX "edd_responses_caseNo_key" ON "edd_responses"("caseNo");
CREATE INDEX "edd_responses_customerId_status_idx" ON "edd_responses"("customerId", "status");
CREATE INDEX "edd_responses_cddResponseId_idx" ON "edd_responses"("cddResponseId");
CREATE INDEX "edd_responses_customerId_journeyId_idx" ON "edd_responses"("customerId", "journeyId");
CREATE INDEX "edd_responses_workflow_status_idx" ON "edd_responses"("workflow", "status");
CREATE INDEX "edd_responses_periodicReviewCycleId_idx" ON "edd_responses"("periodicReviewCycleId");
CREATE INDEX "edd_responses_subjectKind_subjectRefId_idx" ON "edd_responses"("subjectKind", "subjectRefId");
CREATE TABLE "new_journal_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "drCr" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "baseAmount" DECIMAL,
    "fxRate" DECIMAL,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "walletId" TEXT,
    "dimensions" TEXT NOT NULL DEFAULT '{}',
    "description" TEXT,
    "referenceId" TEXT,
    "journalLineTemplateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_lines_journalLineTemplateId_fkey" FOREIGN KEY ("journalLineTemplateId") REFERENCES "journal_line_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "chart_of_accounts" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_journal_lines" ("accountCode", "amount", "assetId", "baseAmount", "createdAt", "description", "dimensions", "drCr", "fxRate", "id", "journalId", "journalLineTemplateId", "lineNo", "ownerId", "ownerType", "referenceId", "walletId") SELECT "accountCode", "amount", "assetId", "baseAmount", "createdAt", "description", "dimensions", "drCr", "fxRate", "id", "journalId", "journalLineTemplateId", "lineNo", "ownerId", "ownerType", "referenceId", "walletId" FROM "journal_lines";
DROP TABLE "journal_lines";
ALTER TABLE "new_journal_lines" RENAME TO "journal_lines";
CREATE INDEX "journal_lines_journalId_idx" ON "journal_lines"("journalId");
CREATE INDEX "journal_lines_accountCode_idx" ON "journal_lines"("accountCode");
CREATE INDEX "journal_lines_assetId_idx" ON "journal_lines"("assetId");
CREATE INDEX "journal_lines_ownerType_ownerId_idx" ON "journal_lines"("ownerType", "ownerId");
CREATE INDEX "journal_lines_accountCode_ownerType_ownerId_idx" ON "journal_lines"("accountCode", "ownerType", "ownerId");
CREATE INDEX "journal_lines_journalLineTemplateId_idx" ON "journal_lines"("journalLineTemplateId");
CREATE INDEX "journal_lines_walletId_idx" ON "journal_lines"("walletId");
CREATE INDEX "journal_lines_walletId_assetId_idx" ON "journal_lines"("walletId", "assetId");
CREATE UNIQUE INDEX "journal_lines_journalId_lineNo_key" ON "journal_lines"("journalId", "lineNo");
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
    "primaryAlertId" TEXT,
    "primaryIncidentId" TEXT,
    "latestDecisionRecordId" TEXT,
    "resolutionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "periodic_review_cycles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_periodic_review_cycles" ("clearedAt", "createdAt", "currentCddResponseId", "currentEddResponseId", "customerId", "cycleNo", "dueAt", "id", "latestDecisionRecordId", "primaryAlertId", "primaryIncidentId", "rejectedAt", "resolutionReason", "status", "triggeredAt", "updatedAt") SELECT "clearedAt", "createdAt", "currentCddResponseId", "currentEddResponseId", "customerId", "cycleNo", "dueAt", "id", "latestDecisionRecordId", "primaryAlertId", "primaryIncidentId", "rejectedAt", "resolutionReason", "status", "triggeredAt", "updatedAt" FROM "periodic_review_cycles";
DROP TABLE "periodic_review_cycles";
ALTER TABLE "new_periodic_review_cycles" RENAME TO "periodic_review_cycles";
CREATE UNIQUE INDEX "periodic_review_cycles_cycleNo_key" ON "periodic_review_cycles"("cycleNo");
CREATE INDEX "periodic_review_cycles_customerId_status_idx" ON "periodic_review_cycles"("customerId", "status");
CREATE INDEX "periodic_review_cycles_status_dueAt_idx" ON "periodic_review_cycles"("status", "dueAt");
CREATE INDEX "periodic_review_cycles_primaryAlertId_idx" ON "periodic_review_cycles"("primaryAlertId");
CREATE INDEX "periodic_review_cycles_primaryIncidentId_idx" ON "periodic_review_cycles"("primaryIncidentId");
CREATE TABLE "new_sumsub_webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventNo" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "rawPayload" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" DATETIME,
    "lastErrorMessage" TEXT,
    "processedAt" DATETIME,
    "dispatchedTo" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "simulatedByUserId" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_sumsub_webhook_events" ("applicantId", "context", "created_at", "dispatchedTo", "eventNo", "eventType", "externalUserId", "id", "isSimulated", "lastErrorMessage", "lastRetryAt", "processedAt", "rawPayload", "receivedAt", "retryCount", "simulatedByUserId", "status", "updated_at") SELECT "applicantId", "context", "created_at", "dispatchedTo", "eventNo", "eventType", "externalUserId", "id", "isSimulated", "lastErrorMessage", "lastRetryAt", "processedAt", "rawPayload", "receivedAt", "retryCount", "simulatedByUserId", "status", "updated_at" FROM "sumsub_webhook_events";
DROP TABLE "sumsub_webhook_events";
ALTER TABLE "new_sumsub_webhook_events" RENAME TO "sumsub_webhook_events";
CREATE UNIQUE INDEX "sumsub_webhook_events_eventNo_key" ON "sumsub_webhook_events"("eventNo");
CREATE INDEX "sumsub_webhook_events_status_created_at_idx" ON "sumsub_webhook_events"("status", "created_at");
CREATE INDEX "sumsub_webhook_events_applicantId_idx" ON "sumsub_webhook_events"("applicantId");
CREATE INDEX "sumsub_webhook_events_externalUserId_idx" ON "sumsub_webhook_events"("externalUserId");
CREATE INDEX "sumsub_webhook_events_eventType_status_idx" ON "sumsub_webhook_events"("eventType", "status");
CREATE TABLE "new_withdraw_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawNo" TEXT NOT NULL,
    "payoutId" TEXT,
    "payoutNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "netAmount" DECIMAL NOT NULL,
    "toWalletId" TEXT,
    "toWalletNo" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "fromWalletId" TEXT,
    "fromWalletNo" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "providerTxnId" TEXT,
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "preKytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "preKytId" TEXT,
    "preKytRiskScore" INTEGER,
    "preKytCheckedAt" DATETIME,
    "kytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kytScreeningId" TEXT,
    "kytRiskScore" INTEGER,
    "kytCheckedAt" DATETIME,
    "travelRuleRequired" BOOLEAN NOT NULL DEFAULT false,
    "counterpartyVasp" TEXT,
    "travelRuleStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "travelRuleTransferId" TEXT,
    "travelRuleCheckedAt" DATETIME,
    "complianceStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "complianceReviewedAt" DATETIME,
    "parentType" TEXT,
    "parentId" TEXT,
    "pricingQuoteId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "payoutRequestedAt" DATETIME,
    "completedAt" DATETIME,
    "statusHistory" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdraw_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "withdraw_transactions_pricingQuoteId_fkey" FOREIGN KEY ("pricingQuoteId") REFERENCES "withdraw_pricing_quotes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "withdraw_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_withdraw_transactions" ("amount", "approvedAt", "assetId", "completedAt", "complianceReviewedAt", "complianceStatus", "confirmations", "counterpartyVasp", "createdAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "fromWalletNo", "id", "kytCheckedAt", "kytRiskScore", "kytScreeningId", "kytStatus", "netAmount", "ownerId", "ownerNo", "ownerType", "parentId", "parentType", "payoutId", "payoutNo", "payoutRequestedAt", "preKytCheckedAt", "preKytId", "preKytRiskScore", "preKytStatus", "pricingQuoteId", "providerTxnId", "referenceNo", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "toWalletNo", "travelRuleCheckedAt", "travelRuleRequired", "travelRuleStatus", "travelRuleTransferId", "txHash", "updatedAt", "withdrawNo") SELECT "amount", "approvedAt", "assetId", "completedAt", "complianceReviewedAt", "complianceStatus", "confirmations", "counterpartyVasp", "createdAt", "feeAmount", "fromAddress", "fromIban", "fromWalletId", "fromWalletNo", "id", "kytCheckedAt", "kytRiskScore", "kytScreeningId", "kytStatus", "netAmount", "ownerId", "ownerNo", "ownerType", "parentId", "parentType", "payoutId", "payoutNo", "payoutRequestedAt", "preKytCheckedAt", "preKytId", "preKytRiskScore", "preKytStatus", "pricingQuoteId", "providerTxnId", "referenceNo", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "toWalletNo", "travelRuleCheckedAt", "travelRuleRequired", "travelRuleStatus", "travelRuleTransferId", "txHash", "updatedAt", "withdrawNo" FROM "withdraw_transactions";
DROP TABLE "withdraw_transactions";
ALTER TABLE "new_withdraw_transactions" RENAME TO "withdraw_transactions";
CREATE UNIQUE INDEX "withdraw_transactions_withdrawNo_key" ON "withdraw_transactions"("withdrawNo");
CREATE UNIQUE INDEX "withdraw_transactions_payoutId_key" ON "withdraw_transactions"("payoutId");
CREATE UNIQUE INDEX "withdraw_transactions_pricingQuoteId_key" ON "withdraw_transactions"("pricingQuoteId");
CREATE INDEX "withdraw_transactions_withdrawNo_idx" ON "withdraw_transactions"("withdrawNo");
CREATE INDEX "withdraw_transactions_payoutId_idx" ON "withdraw_transactions"("payoutId");
CREATE INDEX "withdraw_transactions_ownerId_idx" ON "withdraw_transactions"("ownerId");
CREATE INDEX "withdraw_transactions_status_idx" ON "withdraw_transactions"("status");
CREATE INDEX "withdraw_transactions_assetId_idx" ON "withdraw_transactions"("assetId");
CREATE INDEX "withdraw_transactions_toWalletId_idx" ON "withdraw_transactions"("toWalletId");
CREATE INDEX "withdraw_transactions_pricingQuoteId_idx" ON "withdraw_transactions"("pricingQuoteId");
CREATE INDEX "withdraw_transactions_providerTxnId_idx" ON "withdraw_transactions"("providerTxnId");
CREATE INDEX "withdraw_transactions_txHash_idx" ON "withdraw_transactions"("txHash");
CREATE INDEX "withdraw_transactions_parentId_idx" ON "withdraw_transactions"("parentId");
CREATE INDEX "withdraw_transactions_createdAt_idx" ON "withdraw_transactions"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "customer_material_holdings_activeRefreshCycleId_key" ON "customer_material_holdings"("activeRefreshCycleId");

-- CreateIndex
CREATE INDEX "customer_material_holdings_expiresAt_status_idx" ON "customer_material_holdings"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "customer_material_holdings_customerId_idx" ON "customer_material_holdings"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_material_holdings_customerId_materialType_key" ON "customer_material_holdings"("customerId", "materialType");

-- CreateIndex
CREATE UNIQUE INDEX "material_refresh_cycles_cycleNo_key" ON "material_refresh_cycles"("cycleNo");

-- CreateIndex
CREATE UNIQUE INDEX "material_refresh_cycles_traceId_key" ON "material_refresh_cycles"("traceId");

-- CreateIndex
CREATE INDEX "material_refresh_cycles_customerId_status_idx" ON "material_refresh_cycles"("customerId", "status");

-- CreateIndex
CREATE INDEX "material_refresh_cycles_status_graceExpiresAt_idx" ON "material_refresh_cycles"("status", "graceExpiresAt");

-- CreateIndex
CREATE INDEX "material_refresh_cycles_sumsubActionId_idx" ON "material_refresh_cycles"("sumsubActionId");

-- CreateIndex
CREATE UNIQUE INDEX "client_risk_assessments_assessmentNo_key" ON "client_risk_assessments"("assessmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "client_risk_assessments_traceId_key" ON "client_risk_assessments"("traceId");

-- CreateIndex
CREATE INDEX "client_risk_assessments_customerId_status_idx" ON "client_risk_assessments"("customerId", "status");

-- CreateIndex
CREATE INDEX "client_risk_assessments_customerId_triggeredAt_idx" ON "client_risk_assessments"("customerId", "triggeredAt");

-- CreateIndex
CREATE INDEX "client_risk_assessments_sumsubAmlCheckInspectionId_idx" ON "client_risk_assessments"("sumsubAmlCheckInspectionId");

-- CreateIndex
CREATE INDEX "client_risk_assessments_status_triggeredAt_idx" ON "client_risk_assessments"("status", "triggeredAt");

-- CreateIndex
CREATE INDEX "compliance_case_evidence_packages_approvalCaseId_idx" ON "compliance_case_evidence_packages"("approvalCaseId");

-- RedefineIndex
DROP INDEX "cdd_case_reports_provider_providerSessionId_idx";
CREATE INDEX "cdd_response_reports_provider_providerSessionId_idx" ON "cdd_response_reports"("provider", "providerSessionId");

-- RedefineIndex
DROP INDEX "cdd_case_reports_customerId_cddCaseId_idx";
CREATE INDEX "cdd_response_reports_customerId_cddResponseId_idx" ON "cdd_response_reports"("customerId", "cddResponseId");

-- RedefineIndex
DROP INDEX "edd_case_reports_provider_providerSessionId_idx";
CREATE INDEX "edd_response_reports_provider_providerSessionId_idx" ON "edd_response_reports"("provider", "providerSessionId");

-- RedefineIndex
DROP INDEX "edd_case_reports_customerId_eddCaseId_idx";
CREATE INDEX "edd_response_reports_customerId_eddResponseId_idx" ON "edd_response_reports"("customerId", "eddResponseId");

-- RedefineIndex (sqlite_autoindex names only exist in live DB, skip DROP for shadow replay safety)
-- pool_settlement_batch_item_sources unique index: already named correctly in fresh replay
CREATE UNIQUE INDEX IF NOT EXISTS "pool_settlement_batch_item_sources_batchId_sourceFamily_sourceId_key" ON "pool_settlement_batch_item_sources"("batchId", "sourceFamily", "sourceId");

-- pool_settlement_batch_items unique indexes: already named correctly in fresh replay
CREATE UNIQUE INDEX IF NOT EXISTS "pool_settlement_batch_items_batchId_assetId_walletPairKey_key" ON "pool_settlement_batch_items"("batchId", "assetId", "walletPairKey");

CREATE UNIQUE INDEX IF NOT EXISTS "pool_settlement_batch_items_id_batchId_key" ON "pool_settlement_batch_items"("id", "batchId");

-- RedefineIndex
DROP INDEX "onboarding_decision_records_status_createdAt_idx";
CREATE INDEX "workflow_decision_records_status_createdAt_idx" ON "workflow_decision_records"("status", "createdAt");

-- RedefineIndex
DROP INDEX "onboarding_decision_records_contextType_subjectId_createdAt_idx";
CREATE INDEX "workflow_decision_records_contextType_subjectId_createdAt_idx" ON "workflow_decision_records"("contextType", "subjectId", "createdAt");

-- RedefineIndex
DROP INDEX "onboarding_decision_records_customerId_createdAt_idx";
CREATE INDEX "workflow_decision_records_customerId_createdAt_idx" ON "workflow_decision_records"("customerId", "createdAt");
