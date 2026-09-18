PRAGMA foreign_keys=OFF;

ALTER TABLE "compliance_alert_events" RENAME TO "_compliance_alert_events_old_repair";

CREATE TABLE "compliance_alert_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "alertId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorNo" TEXT,
  "actorRole" TEXT,
  "note" TEXT,
  "payload" TEXT,
  "sourcePlatform" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_alert_events_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "compliance_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "compliance_alert_events" (
  "id","alertId","eventType","eventAt","actorType","actorId","actorNo","actorRole","note","payload","sourcePlatform","createdAt"
)
SELECT
  "id","alertId","eventType","eventAt","actorType","actorId","actorNo","actorRole","note","payload","sourcePlatform","createdAt"
FROM "_compliance_alert_events_old_repair";

DROP TABLE "_compliance_alert_events_old_repair";

CREATE INDEX "compliance_alert_events_alertId_eventAt_idx" ON "compliance_alert_events"("alertId", "eventAt");

ALTER TABLE "compliance_incident_events" RENAME TO "_compliance_incident_events_old_repair";
ALTER TABLE "compliance_incident_alerts" RENAME TO "_compliance_incident_alerts_old_repair";
ALTER TABLE "compliance_incidents" RENAME TO "_compliance_incidents_old_repair";

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
FROM "_compliance_incidents_old_repair";

DROP TABLE "_compliance_incidents_old_repair";

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

CREATE TABLE "compliance_incident_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "incidentId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorNo" TEXT,
  "actorRole" TEXT,
  "note" TEXT,
  "payload" TEXT,
  "sourcePlatform" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_incident_events_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "compliance_incidents" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "compliance_incident_events" (
  "id","incidentId","eventType","eventAt","actorType","actorId","actorNo","actorRole","note","payload","sourcePlatform","createdAt"
)
SELECT
  "id","incidentId","eventType","eventAt","actorType","actorId","actorNo","actorRole","note","payload","sourcePlatform","createdAt"
FROM "_compliance_incident_events_old_repair";

DROP TABLE "_compliance_incident_events_old_repair";

CREATE INDEX "compliance_incident_events_incidentId_eventAt_idx" ON "compliance_incident_events"("incidentId", "eventAt");

CREATE TABLE "compliance_incident_alerts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "incidentId" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "alertNo" TEXT NOT NULL,
  "relationType" TEXT NOT NULL,
  "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linkedByType" TEXT NOT NULL,
  "linkedById" TEXT NOT NULL,
  "linkedByNo" TEXT,
  "linkedByRole" TEXT,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_incident_alerts_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "compliance_incidents" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "compliance_incident_alerts_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "compliance_alerts" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "compliance_incident_alerts" (
  "id","incidentId","alertId","alertNo","relationType","linkedAt","linkedByType","linkedById","linkedByNo","linkedByRole","note","createdAt"
)
SELECT
  "id","incidentId","alertId","alertNo","relationType","linkedAt","linkedByType","linkedById","linkedByNo","linkedByRole","note","createdAt"
FROM "_compliance_incident_alerts_old_repair";

DROP TABLE "_compliance_incident_alerts_old_repair";

CREATE UNIQUE INDEX "compliance_incident_alerts_alertId_key" ON "compliance_incident_alerts"("alertId");
CREATE UNIQUE INDEX "compliance_incident_alerts_incidentId_alertId_key" ON "compliance_incident_alerts"("incidentId", "alertId");
CREATE INDEX "compliance_incident_alerts_incidentId_relationType_linkedAt_idx" ON "compliance_incident_alerts"("incidentId", "relationType", "linkedAt");
CREATE INDEX "compliance_incident_alerts_alertId_idx" ON "compliance_incident_alerts"("alertId");

PRAGMA foreign_keys=ON;
