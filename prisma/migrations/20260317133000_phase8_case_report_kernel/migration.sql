CREATE TABLE "compliance_incident_reports" (
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
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_incident_reports_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "compliance_incidents" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "compliance_incident_reports_incidentId_version_key"
ON "compliance_incident_reports"("incidentId", "version");

CREATE INDEX "compliance_incident_reports_incidentId_isCurrent_idx"
ON "compliance_incident_reports"("incidentId", "isCurrent");

CREATE INDEX "compliance_incident_reports_incidentId_status_updatedAt_idx"
ON "compliance_incident_reports"("incidentId", "status", "updatedAt");
