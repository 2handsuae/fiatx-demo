ALTER TABLE "compliance_alerts" ADD COLUMN "stage" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "currentDispositionCode" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "currentDispositionReason" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "currentDispositionAt" DATETIME;
ALTER TABLE "compliance_alerts" ADD COLUMN "currentDispositionById" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "currentDispositionByNo" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "currentDispositionByRole" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "currentDispositionRecordId" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "finalDispositionCode" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "finalDispositionReason" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "finalDispositionAt" DATETIME;
ALTER TABLE "compliance_alerts" ADD COLUMN "finalDispositionRecordId" TEXT;

ALTER TABLE "compliance_incidents" ADD COLUMN "currentDispositionCode" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "currentDispositionReason" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "currentDispositionAt" DATETIME;
ALTER TABLE "compliance_incidents" ADD COLUMN "currentDispositionById" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "currentDispositionByNo" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "currentDispositionByRole" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "currentDispositionRecordId" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "finalDispositionCode" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "finalDispositionReason" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "finalDispositionAt" DATETIME;
ALTER TABLE "compliance_incidents" ADD COLUMN "finalDispositionRecordId" TEXT;

CREATE TABLE "compliance_alert_disposition_records" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "alertId" TEXT NOT NULL,
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
  CONSTRAINT "compliance_alert_disposition_records_alertId_fkey"
    FOREIGN KEY ("alertId") REFERENCES "compliance_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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

CREATE INDEX "compliance_alerts_sourceType_sourceId_stage_lastOccurredAt_idx"
  ON "compliance_alerts"("sourceType", "sourceId", "stage", "lastOccurredAt");

CREATE INDEX "compliance_alert_disposition_records_alertId_createdAt_idx"
  ON "compliance_alert_disposition_records"("alertId", "createdAt");

CREATE INDEX "compliance_alert_disposition_records_dispositionCode_createdAt_idx"
  ON "compliance_alert_disposition_records"("dispositionCode", "createdAt");

CREATE INDEX "compliance_incident_disposition_records_incidentId_createdAt_idx"
  ON "compliance_incident_disposition_records"("incidentId", "createdAt");

CREATE INDEX "compliance_incident_disposition_records_dispositionCode_createdAt_idx"
  ON "compliance_incident_disposition_records"("dispositionCode", "createdAt");

UPDATE "compliance_alerts"
SET "stage" = 'ONBOARDING'
WHERE "stage" IS NULL
  AND "sourceType" = 'ONBOARDING_JOURNEY';

UPDATE "compliance_alerts"
SET
  "currentDispositionCode" = CASE
    WHEN UPPER(COALESCE("decision", '')) = 'APPROVE' THEN 'APPROVE_STAGE'
    WHEN UPPER(COALESCE("decision", '')) = 'REJECT' THEN 'REJECT_STAGE'
    WHEN UPPER(COALESCE("decision", '')) = 'REQUIRE_EDD' THEN 'REQUIRE_EDD'
    ELSE "currentDispositionCode"
  END,
  "currentDispositionAt" = COALESCE("currentDispositionAt", "lastActionAt", "updatedAt"),
  "currentDispositionById" = COALESCE("currentDispositionById", "lastActionById"),
  "currentDispositionByNo" = COALESCE("currentDispositionByNo", "lastActionByNo"),
  "currentDispositionByRole" = COALESCE("currentDispositionByRole", "lastActionByRole")
WHERE UPPER(COALESCE("decision", '')) IN ('APPROVE', 'REJECT', 'REQUIRE_EDD');

UPDATE "compliance_alerts"
SET
  "finalDispositionCode" = CASE
    WHEN UPPER(COALESCE("decision", '')) = 'APPROVE' THEN 'APPROVE_STAGE'
    WHEN UPPER(COALESCE("decision", '')) = 'REJECT' THEN 'REJECT_STAGE'
    WHEN UPPER(COALESCE("decision", '')) = 'REQUIRE_EDD' THEN 'REQUIRE_EDD'
    ELSE "finalDispositionCode"
  END,
  "finalDispositionReason" = COALESCE("finalDispositionReason", "closeReason"),
  "finalDispositionAt" = COALESCE("finalDispositionAt", "closedAt", "lastActionAt", "updatedAt")
WHERE "status" = 'CLOSED'
  AND UPPER(COALESCE("decision", '')) IN ('APPROVE', 'REJECT', 'REQUIRE_EDD');

UPDATE "compliance_incidents"
SET
  "currentDispositionCode" = CASE
    WHEN UPPER(COALESCE("decision", '')) = 'APPROVE' THEN 'APPROVE_STAGE'
    WHEN UPPER(COALESCE("decision", '')) = 'REJECT' THEN 'REJECT_STAGE'
    WHEN UPPER(COALESCE("decision", '')) = 'REQUIRE_EDD' THEN 'REQUIRE_EDD'
    ELSE "currentDispositionCode"
  END,
  "currentDispositionAt" = COALESCE("currentDispositionAt", "lastActionAt", "updatedAt"),
  "currentDispositionById" = COALESCE("currentDispositionById", "lastActionById"),
  "currentDispositionByNo" = COALESCE("currentDispositionByNo", "lastActionByNo"),
  "currentDispositionByRole" = COALESCE("currentDispositionByRole", "lastActionByRole")
WHERE UPPER(COALESCE("decision", '')) IN ('APPROVE', 'REJECT', 'REQUIRE_EDD');

UPDATE "compliance_incidents"
SET
  "finalDispositionCode" = CASE
    WHEN UPPER(COALESCE("decision", '')) = 'APPROVE' THEN 'APPROVE_STAGE'
    WHEN UPPER(COALESCE("decision", '')) = 'REJECT' THEN 'REJECT_STAGE'
    WHEN UPPER(COALESCE("decision", '')) = 'REQUIRE_EDD' THEN 'REQUIRE_EDD'
    ELSE "finalDispositionCode"
  END,
  "finalDispositionReason" = COALESCE("finalDispositionReason", "closeReason"),
  "finalDispositionAt" = COALESCE("finalDispositionAt", "closedAt", "lastActionAt", "updatedAt")
WHERE "status" = 'CLOSED'
  AND UPPER(COALESCE("decision", '')) IN ('APPROVE', 'REJECT', 'REQUIRE_EDD');
