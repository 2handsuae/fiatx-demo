-- CreateTable
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
    CONSTRAINT "compliance_incidents_primaryAlertId_fkey"
      FOREIGN KEY ("primaryAlertId") REFERENCES "compliance_alerts" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE UNIQUE INDEX "compliance_incidents_incidentNo_key" ON "compliance_incidents"("incidentNo");
CREATE UNIQUE INDEX "compliance_incidents_primaryAlertId_key" ON "compliance_incidents"("primaryAlertId");
CREATE INDEX "compliance_incidents_status_lastActionAt_idx" ON "compliance_incidents"("status", "lastActionAt");
CREATE INDEX "compliance_incidents_severity_status_dueAt_idx" ON "compliance_incidents"("severity", "status", "dueAt");
CREATE INDEX "compliance_incidents_customerNo_lastActionAt_idx" ON "compliance_incidents"("customerNo", "lastActionAt");
CREATE INDEX "compliance_incidents_primaryAlertId_idx" ON "compliance_incidents"("primaryAlertId");
CREATE INDEX "compliance_incidents_lastAlertAt_idx" ON "compliance_incidents"("lastAlertAt");

CREATE UNIQUE INDEX "compliance_incident_alerts_alertId_key" ON "compliance_incident_alerts"("alertId");
CREATE UNIQUE INDEX "compliance_incident_alerts_incidentId_alertId_key" ON "compliance_incident_alerts"("incidentId", "alertId");
CREATE INDEX "compliance_incident_alerts_incidentId_relationType_linkedAt_idx" ON "compliance_incident_alerts"("incidentId", "relationType", "linkedAt");
CREATE INDEX "compliance_incident_alerts_alertId_idx" ON "compliance_incident_alerts"("alertId");

CREATE INDEX "compliance_incident_events_incidentId_eventAt_idx" ON "compliance_incident_events"("incidentId", "eventAt");
