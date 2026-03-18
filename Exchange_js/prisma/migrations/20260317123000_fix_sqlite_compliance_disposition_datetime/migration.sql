PRAGMA foreign_keys=OFF;

ALTER TABLE "compliance_incidents" RENAME TO "_compliance_incidents_old";

CREATE TABLE "compliance_incidents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "incidentNo" TEXT NOT NULL DEFAULT 'TEMP',
  "status" TEXT NOT NULL DEFAULT 'NEW',
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
  "lastActionById" TEXT,
  "lastActionByNo" TEXT,
  "lastActionByRole" TEXT,
  "lastActionAt" DATETIME,
  "metadata" TEXT,
  "retainedUntil" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "decision" TEXT,
  "linkedCaseIds" TEXT,
  "decisionRecordIds" TEXT,
  "caseType" TEXT NOT NULL DEFAULT 'GENERIC',
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
  "stage" TEXT,
  "ruleCode" TEXT,
  CONSTRAINT "compliance_incidents_primaryAlertId_fkey"
    FOREIGN KEY ("primaryAlertId") REFERENCES "compliance_alerts" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "compliance_incidents" (
  "id","incidentNo","status","severity","title","summary","primaryAlertId","primaryAlertNo","customerId",
  "customerNo","entityType","entityId","entityNo","sourceModule","sourceType","ownerUserId","ownerUserNo",
  "assignedAt","alertCount","firstAlertAt","lastAlertAt","dueAt","resolvedAt","closedAt","closeReason",
  "rootCauseCategory","resolutionSummary","containmentSummary","closureChecklist","lastActionById","lastActionByNo",
  "lastActionByRole","lastActionAt","metadata","retainedUntil","createdAt","updatedAt","decision","linkedCaseIds",
  "decisionRecordIds","caseType","freezeStatus","frozenAt","freezeReason","reportStatus","reportRefNo","reportedAt",
  "reportReason","reportedByUserId","reportedByUserNo","overdueMarkedAt","currentDispositionCode",
  "currentDispositionReason","currentDispositionAt","currentDispositionById","currentDispositionByNo",
  "currentDispositionByRole","currentDispositionRecordId","finalDispositionCode","finalDispositionReason",
  "finalDispositionAt","finalDispositionRecordId","stage","ruleCode"
)
SELECT
  "id","incidentNo","status","severity","title","summary","primaryAlertId","primaryAlertNo","customerId",
  "customerNo","entityType","entityId","entityNo","sourceModule","sourceType","ownerUserId","ownerUserNo",
  "assignedAt","alertCount","firstAlertAt","lastAlertAt","dueAt","resolvedAt","closedAt","closeReason",
  "rootCauseCategory","resolutionSummary","containmentSummary","closureChecklist","lastActionById","lastActionByNo",
  "lastActionByRole","lastActionAt","metadata","retainedUntil","createdAt","updatedAt","decision","linkedCaseIds",
  "decisionRecordIds","caseType","freezeStatus","frozenAt","freezeReason","reportStatus","reportRefNo","reportedAt",
  "reportReason","reportedByUserId","reportedByUserNo","overdueMarkedAt","currentDispositionCode",
  "currentDispositionReason","currentDispositionAt","currentDispositionById","currentDispositionByNo",
  "currentDispositionByRole","currentDispositionRecordId","finalDispositionCode","finalDispositionReason",
  "finalDispositionAt","finalDispositionRecordId","stage","ruleCode"
FROM "_compliance_incidents_old";

DROP TABLE "_compliance_incidents_old";

CREATE UNIQUE INDEX "compliance_incidents_incidentNo_key" ON "compliance_incidents"("incidentNo");
CREATE UNIQUE INDEX "compliance_incidents_primaryAlertId_key" ON "compliance_incidents"("primaryAlertId");
CREATE INDEX "compliance_incidents_status_lastActionAt_idx" ON "compliance_incidents"("status", "lastActionAt");
CREATE INDEX "compliance_incidents_severity_status_dueAt_idx" ON "compliance_incidents"("severity", "status", "dueAt");
CREATE INDEX "compliance_incidents_customerNo_lastActionAt_idx" ON "compliance_incidents"("customerNo", "lastActionAt");
CREATE INDEX "compliance_incidents_primaryAlertId_idx" ON "compliance_incidents"("primaryAlertId");
CREATE INDEX "compliance_incidents_lastAlertAt_idx" ON "compliance_incidents"("lastAlertAt");
CREATE INDEX "compliance_incidents_caseType_status_dueAt_idx" ON "compliance_incidents"("caseType", "status", "dueAt");
CREATE UNIQUE INDEX "compliance_incidents_reportRefNo_key" ON "compliance_incidents"("reportRefNo");
CREATE INDEX "compliance_incidents_status_dueAt_overdueMarkedAt_idx" ON "compliance_incidents"("status", "dueAt", "overdueMarkedAt");
CREATE INDEX "compliance_incidents_reportStatus_reportedAt_idx" ON "compliance_incidents"("reportStatus", "reportedAt");
CREATE INDEX "compliance_incidents_sourceType_stage_lastActionAt_idx" ON "compliance_incidents"("sourceType", "stage", "lastActionAt");
CREATE INDEX "compliance_incidents_ruleCode_lastActionAt_idx" ON "compliance_incidents"("ruleCode", "lastActionAt");

ALTER TABLE "compliance_incident_disposition_records" RENAME TO "_compliance_incident_disposition_records_old";

CREATE TABLE "compliance_incident_disposition_records" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "incidentId" TEXT NOT NULL,
  "dispositionCode" TEXT NOT NULL,
  "reason" TEXT,
  "isFinal" BOOLEAN NOT NULL DEFAULT false,
  "supersedesRecordId" TEXT,
  "decisionRecordId" TEXT,
  "source" TEXT,
  "sourceRefId" TEXT,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorNo" TEXT,
  "actorRole" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_incident_disposition_records_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "compliance_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "compliance_incident_disposition_records" (
  "id","incidentId","dispositionCode","reason","isFinal","supersedesRecordId","decisionRecordId","source",
  "sourceRefId","actorType","actorId","actorNo","actorRole","createdAt"
)
SELECT
  "id","incidentId","dispositionCode","reason","isFinal","supersedesRecordId","decisionRecordId","source",
  "sourceRefId","actorType","actorId","actorNo","actorRole","createdAt"
FROM "_compliance_incident_disposition_records_old";

DROP TABLE "_compliance_incident_disposition_records_old";

CREATE INDEX "compliance_incident_disposition_records_incidentId_createdAt_idx"
  ON "compliance_incident_disposition_records"("incidentId", "createdAt");
CREATE INDEX "compliance_incident_disposition_records_dispositionCode_createdAt_idx"
  ON "compliance_incident_disposition_records"("dispositionCode", "createdAt");

PRAGMA foreign_keys=ON;
