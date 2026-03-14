ALTER TABLE "audit_log_events" ADD COLUMN "traceId" TEXT;
ALTER TABLE "audit_log_events" ADD COLUMN "workflowType" TEXT;
ALTER TABLE "audit_log_events" ADD COLUMN "workflowId" TEXT;
ALTER TABLE "audit_log_events" ADD COLUMN "workflowNo" TEXT;

CREATE INDEX "audit_log_events_traceId_occurredAt_idx"
ON "audit_log_events"("traceId", "occurredAt");

CREATE INDEX "audit_log_events_workflowType_occurredAt_idx"
ON "audit_log_events"("workflowType", "occurredAt");

CREATE INDEX "audit_log_events_workflowType_workflowNo_occurredAt_idx"
ON "audit_log_events"("workflowType", "workflowNo", "occurredAt");

CREATE TABLE "approval_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvalNo" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityRef" TEXT NOT NULL,
    "makerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "executionStatus" TEXT NOT NULL DEFAULT 'NOT_EXECUTED',
    "riskLevel" TEXT NOT NULL DEFAULT 'HIGH',
    "checkerRoles" TEXT NOT NULL,
    "selectedCheckerRole" TEXT NOT NULL,
    "allowCancel" BOOLEAN NOT NULL DEFAULT true,
    "allowRetry" BOOLEAN NOT NULL DEFAULT true,
    "docRef" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    "timeoutAt" DATETIME,
    "decidedAt" DATETIME,
    "executedAt" DATETIME,
    "decisionByUserId" TEXT,
    "decisionByRole" TEXT,
    "decisionReason" TEXT,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "deleteRequestId" TEXT,
    "deleteReason" TEXT
);

CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvalCaseId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "checkerRoleCandidates" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedByRole" TEXT,
    "reason" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "approval_steps_approvalCaseId_fkey"
      FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "approval_action_policies" (
    "actionType" TEXT NOT NULL PRIMARY KEY,
    "riskLevel" TEXT NOT NULL DEFAULT 'HIGH',
    "checkerRoles" TEXT NOT NULL,
    "timeoutHours" INTEGER NOT NULL DEFAULT 24,
    "allowCancel" BOOLEAN NOT NULL DEFAULT true,
    "allowRetry" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "approval_sod_rules" (
    "ruleCode" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "approval_cases_approvalNo_key"
ON "approval_cases"("approvalNo");

CREATE INDEX "approval_cases_actionType_entityRef_status_idx"
ON "approval_cases"("actionType", "entityRef", "status");

CREATE INDEX "approval_cases_status_timeoutAt_idx"
ON "approval_cases"("status", "timeoutAt");

CREATE INDEX "approval_cases_traceId_createdAt_idx"
ON "approval_cases"("traceId", "createdAt");

CREATE INDEX "approval_cases_deletedAt_idx"
ON "approval_cases"("deletedAt");

CREATE UNIQUE INDEX "approval_cases_pending_action_entity_key"
ON "approval_cases"("actionType", "entityRef")
WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "approval_steps_approvalCaseId_stepNo_key"
ON "approval_steps"("approvalCaseId", "stepNo");

CREATE INDEX "approval_steps_approvalCaseId_stepNo_idx"
ON "approval_steps"("approvalCaseId", "stepNo");

CREATE TABLE "change_tickets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketNo" TEXT NOT NULL DEFAULT 'TEMP',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "changeType" TEXT,
    "scopeSummary" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'HIGH',
    "testEvidenceRef" TEXT,
    "rollbackPlanRef" TEXT,
    "latestApprovalId" TEXT,
    "latestApprovalStatus" TEXT,
    "traceId" TEXT NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "emergencyReason" TEXT,
    "postApprovalDueAt" DATETIME,
    "postApprovalCompletedAt" DATETIME,
    "createdByUserId" TEXT NOT NULL,
    "submittedByUserId" TEXT,
    "closedByUserId" TEXT,
    "submittedAt" DATETIME,
    "deployedAt" DATETIME,
    "closedAt" DATETIME,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "deleteRequestId" TEXT,
    "deleteReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "change_tickets_latestApprovalId_fkey"
      FOREIGN KEY ("latestApprovalId") REFERENCES "approval_cases" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "change_tickets_ticketNo_key"
ON "change_tickets"("ticketNo");

CREATE UNIQUE INDEX "change_tickets_latestApprovalId_key"
ON "change_tickets"("latestApprovalId");

CREATE INDEX "change_tickets_status_createdAt_idx"
ON "change_tickets"("status", "createdAt");

CREATE INDEX "change_tickets_ticketNo_createdAt_idx"
ON "change_tickets"("ticketNo", "createdAt");

CREATE INDEX "change_tickets_traceId_createdAt_idx"
ON "change_tickets"("traceId", "createdAt");

CREATE INDEX "change_tickets_latestApprovalStatus_createdAt_idx"
ON "change_tickets"("latestApprovalStatus", "createdAt");

CREATE INDEX "change_tickets_deletedAt_idx"
ON "change_tickets"("deletedAt");

CREATE TABLE "change_ticket_gate_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "targetEnv" TEXT NOT NULL,
    "releaseVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "failureReason" TEXT,
    "operatorUserId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "activeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "change_ticket_gate_runs_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "change_tickets" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "change_ticket_gate_runs_activeKey_key"
ON "change_ticket_gate_runs"("activeKey");

CREATE INDEX "change_ticket_gate_runs_ticketId_createdAt_idx"
ON "change_ticket_gate_runs"("ticketId", "createdAt");

CREATE INDEX "change_ticket_gate_runs_status_createdAt_idx"
ON "change_ticket_gate_runs"("status", "createdAt");

CREATE INDEX "change_ticket_gate_runs_traceId_createdAt_idx"
ON "change_ticket_gate_runs"("traceId", "createdAt");

CREATE INDEX "change_ticket_gate_runs_ticketId_targetEnv_releaseVersion_createdAt_idx"
ON "change_ticket_gate_runs"("ticketId", "targetEnv", "releaseVersion", "createdAt");

CREATE TABLE "delete_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL DEFAULT 'TEMP',
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "latestApprovalId" TEXT,
    "latestApprovalStatus" TEXT,
    "makerUserId" TEXT NOT NULL,
    "submittedByUserId" TEXT,
    "executedByUserId" TEXT,
    "deleteReason" TEXT NOT NULL,
    "docRef" TEXT,
    "targetSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    "executedAt" DATETIME,
    CONSTRAINT "delete_requests_latestApprovalId_fkey"
      FOREIGN KEY ("latestApprovalId") REFERENCES "approval_cases" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "delete_requests_requestNo_key"
ON "delete_requests"("requestNo");

CREATE UNIQUE INDEX "delete_requests_latestApprovalId_key"
ON "delete_requests"("latestApprovalId");

CREATE INDEX "delete_requests_status_createdAt_idx"
ON "delete_requests"("status", "createdAt");

CREATE INDEX "delete_requests_requestNo_createdAt_idx"
ON "delete_requests"("requestNo", "createdAt");

CREATE INDEX "delete_requests_targetType_targetId_status_idx"
ON "delete_requests"("targetType", "targetId", "status");

CREATE INDEX "delete_requests_targetType_targetNo_status_idx"
ON "delete_requests"("targetType", "targetNo", "status");

CREATE INDEX "delete_requests_traceId_createdAt_idx"
ON "delete_requests"("traceId", "createdAt");

CREATE INDEX "delete_requests_latestApprovalStatus_createdAt_idx"
ON "delete_requests"("latestApprovalStatus", "createdAt");

ALTER TABLE "audit_evidence_packages" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'READY';
ALTER TABLE "audit_evidence_packages" ADD COLUMN "exportMode" TEXT NOT NULL DEFAULT 'SELECTION';
ALTER TABLE "audit_evidence_packages" ADD COLUMN "fileName" TEXT;
ALTER TABLE "audit_evidence_packages" ADD COLUMN "selectedEventIdsSnapshot" TEXT;
ALTER TABLE "audit_evidence_packages" ADD COLUMN "packageBody" TEXT;
ALTER TABLE "audit_evidence_packages" ADD COLUMN "approvalCaseId" TEXT REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_evidence_packages" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "audit_evidence_packages" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "audit_evidence_packages" ADD COLUMN "deleteRequestId" TEXT;
ALTER TABLE "audit_evidence_packages" ADD COLUMN "deleteReason" TEXT;

CREATE INDEX "audit_evidence_packages_status_createdAt_idx"
ON "audit_evidence_packages"("status", "createdAt");

CREATE INDEX "audit_evidence_packages_exportMode_createdAt_idx"
ON "audit_evidence_packages"("exportMode", "createdAt");

CREATE UNIQUE INDEX "audit_evidence_packages_approvalCaseId_key"
ON "audit_evidence_packages"("approvalCaseId");

CREATE INDEX "audit_evidence_packages_approvalCaseId_idx"
ON "audit_evidence_packages"("approvalCaseId");

CREATE INDEX "audit_evidence_packages_deletedAt_idx"
ON "audit_evidence_packages"("deletedAt");

CREATE TABLE "sla_timers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timerNo" TEXT NOT NULL DEFAULT 'TEMP',
    "workflowType" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowNo" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectNo" TEXT NOT NULL,
    "timerType" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "dueAt" DATETIME NOT NULL,
    "graceSeconds" INTEGER NOT NULL DEFAULT 120,
    "traceId" TEXT NOT NULL,
    "contextJson" TEXT NOT NULL DEFAULT '{}',
    "closedAt" DATETIME,
    "expiredAt" DATETIME,
    "activeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "sla_timers_timerNo_key"
ON "sla_timers"("timerNo");

CREATE UNIQUE INDEX "sla_timers_activeKey_key"
ON "sla_timers"("activeKey");

CREATE INDEX "sla_timers_timerNo_createdAt_idx"
ON "sla_timers"("timerNo", "createdAt");

CREATE INDEX "sla_timers_timerType_status_dueAt_idx"
ON "sla_timers"("timerType", "status", "dueAt");

CREATE INDEX "sla_timers_workflowType_workflowNo_createdAt_idx"
ON "sla_timers"("workflowType", "workflowNo", "createdAt");

CREATE INDEX "sla_timers_subjectType_subjectNo_createdAt_idx"
ON "sla_timers"("subjectType", "subjectNo", "createdAt");

CREATE INDEX "sla_timers_ownerUserId_status_createdAt_idx"
ON "sla_timers"("ownerUserId", "status", "createdAt");

CREATE INDEX "sla_timers_traceId_createdAt_idx"
ON "sla_timers"("traceId", "createdAt");

CREATE TABLE "sla_notifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "timerId" TEXT NOT NULL,
  "notificationType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "scheduledAt" DATETIME NOT NULL,
  "triggeredAt" DATETIME,
  "reasonCode" TEXT,
  "message" TEXT,
  "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "sla_notifications_timerId_fkey"
    FOREIGN KEY ("timerId") REFERENCES "sla_timers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "sla_notifications_timerId_createdAt_idx"
ON "sla_notifications"("timerId", "createdAt");

CREATE INDEX "sla_notifications_notificationType_status_scheduledAt_idx"
ON "sla_notifications"("notificationType", "status", "scheduledAt");

CREATE INDEX "sla_notifications_status_scheduledAt_idx"
ON "sla_notifications"("status", "scheduledAt");

INSERT INTO "approval_action_policies"(
  "actionType",
  "riskLevel",
  "checkerRoles",
  "timeoutHours",
  "allowCancel",
  "allowRetry"
) VALUES
  ('SENSITIVE_EXPORT_APPROVAL', 'HIGH', 'DPO,MLRO', 24, true, true),
  ('CHANGE_TICKET_APPROVAL', 'HIGH', 'CISO,TECH_ADMIN', 24, true, true),
  ('DELETE_REQUEST_APPROVAL', 'HIGH', 'DPO,TECH_ADMIN', 24, true, true);

INSERT INTO "approval_sod_rules"(
  "ruleCode",
  "enabled",
  "description"
) VALUES
  ('DENY_SAME_USER_MAKER_CHECKER', true, 'Same user cannot be both maker and checker unless SUPER_ADMIN bypass applies');
