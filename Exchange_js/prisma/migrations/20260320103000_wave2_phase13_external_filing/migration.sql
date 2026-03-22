ALTER TABLE "compliance_incidents" ADD COLUMN "proposedFilingRequired" BOOLEAN;
ALTER TABLE "compliance_incidents" ADD COLUMN "proposedFilingType" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "proposedFilingAuthority" TEXT;

ALTER TABLE "compliance_incident_reports" ADD COLUMN "filingRequired" BOOLEAN;
ALTER TABLE "compliance_incident_reports" ADD COLUMN "filingType" TEXT;
ALTER TABLE "compliance_incident_reports" ADD COLUMN "filingAuthority" TEXT;

CREATE TABLE "compliance_incident_external_filings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "filingNo" TEXT NOT NULL,
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
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_incident_external_filings_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "compliance_incidents" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "compliance_incident_external_filings_filingNo_key"
  ON "compliance_incident_external_filings"("filingNo");
CREATE UNIQUE INDEX "compliance_incident_external_filings_incidentId_key"
  ON "compliance_incident_external_filings"("incidentId");
CREATE INDEX "compliance_incident_external_filings_status_updatedAt_idx"
  ON "compliance_incident_external_filings"("status", "updatedAt");
CREATE INDEX "compliance_incident_external_filings_filingAuthority_status_updatedAt_idx"
  ON "compliance_incident_external_filings"("filingAuthority", "status", "updatedAt");

CREATE TABLE "compliance_incident_external_filing_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "filingId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorNo" TEXT,
  "actorRole" TEXT,
  "note" TEXT,
  "statusFrom" TEXT,
  "statusTo" TEXT,
  "externalRefNo" TEXT,
  "feedback" TEXT,
  "sourcePlatform" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_incident_external_filing_events_filingId_fkey"
    FOREIGN KEY ("filingId") REFERENCES "compliance_incident_external_filings" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "compliance_incident_external_filing_events_filingId_eventAt_idx"
  ON "compliance_incident_external_filing_events"("filingId", "eventAt");

UPDATE "compliance_incident_reports"
SET "finalDispositionCode" = CASE UPPER(TRIM(COALESCE("finalDispositionCode", '')))
  WHEN 'APPROVE_STAGE' THEN 'CLEAR'
  WHEN 'CLEAR' THEN 'CLEAR'
  WHEN 'FALSE_POSITIVE' THEN 'FALSE_POSITIVE'
  WHEN 'REJECT_STAGE' THEN 'RISK_CONFIRMED'
  WHEN 'REQUIRE_EDD' THEN 'RISK_CONFIRMED'
  WHEN 'RESTRICT' THEN 'RISK_CONFIRMED'
  WHEN 'REPORT' THEN 'RISK_CONFIRMED'
  ELSE "finalDispositionCode"
END;

UPDATE "compliance_incident_reports"
SET "filingRequired" = 1
WHERE UPPER(TRIM(COALESCE("finalDispositionCode", ''))) = 'RISK_CONFIRMED'
  AND UPPER(TRIM(COALESCE("recommendedActions", ''))) LIKE '%REPORT%';

UPDATE "compliance_incidents"
SET "proposedFinalDispositionCode" = CASE UPPER(TRIM(COALESCE("proposedFinalDispositionCode", '')))
  WHEN 'APPROVE_STAGE' THEN 'CLEAR'
  WHEN 'CLEAR' THEN 'CLEAR'
  WHEN 'FALSE_POSITIVE' THEN 'FALSE_POSITIVE'
  WHEN 'REJECT_STAGE' THEN 'RISK_CONFIRMED'
  WHEN 'REQUIRE_EDD' THEN 'RISK_CONFIRMED'
  WHEN 'RESTRICT' THEN 'RISK_CONFIRMED'
  WHEN 'REPORT' THEN 'RISK_CONFIRMED'
  ELSE "proposedFinalDispositionCode"
END,
    "currentDispositionCode" = CASE UPPER(TRIM(COALESCE("currentDispositionCode", '')))
  WHEN 'APPROVE_STAGE' THEN 'CLEAR'
  WHEN 'CLEAR' THEN 'CLEAR'
  WHEN 'FALSE_POSITIVE' THEN 'FALSE_POSITIVE'
  WHEN 'REJECT_STAGE' THEN 'RISK_CONFIRMED'
  WHEN 'REQUIRE_EDD' THEN 'RISK_CONFIRMED'
  WHEN 'RESTRICT' THEN 'RISK_CONFIRMED'
  WHEN 'REPORT' THEN 'RISK_CONFIRMED'
  ELSE "currentDispositionCode"
END,
    "finalDispositionCode" = CASE UPPER(TRIM(COALESCE("finalDispositionCode", '')))
  WHEN 'APPROVE_STAGE' THEN 'CLEAR'
  WHEN 'CLEAR' THEN 'CLEAR'
  WHEN 'FALSE_POSITIVE' THEN 'FALSE_POSITIVE'
  WHEN 'REJECT_STAGE' THEN 'RISK_CONFIRMED'
  WHEN 'REQUIRE_EDD' THEN 'RISK_CONFIRMED'
  WHEN 'RESTRICT' THEN 'RISK_CONFIRMED'
  WHEN 'REPORT' THEN 'RISK_CONFIRMED'
  ELSE "finalDispositionCode"
END;

UPDATE "compliance_incidents"
SET "proposedFilingRequired" = 1
WHERE UPPER(TRIM(COALESCE("proposedFinalDispositionCode", ''))) = 'RISK_CONFIRMED'
  AND (
    UPPER(TRIM(COALESCE("decision", ''))) = 'REPORT'
    OR UPPER(TRIM(COALESCE("reportReason", ''))) LIKE '%REPORT%'
  );

UPDATE "compliance_incident_reports"
SET "filingRequired" = 1
WHERE UPPER(TRIM(COALESCE("finalDispositionCode", ''))) = 'RISK_CONFIRMED'
  AND EXISTS (
    SELECT 1
    FROM "compliance_incidents" ci
    WHERE ci."id" = "compliance_incident_reports"."incidentId"
      AND (
        UPPER(TRIM(COALESCE(ci."reportStatus", ''))) = 'REPORTED'
        OR UPPER(TRIM(COALESCE(ci."decision", ''))) = 'REPORT'
      )
  );

INSERT INTO "compliance_incident_external_filings" (
  "id",
  "filingNo",
  "incidentId",
  "status",
  "requiredAt",
  "requiredById",
  "requiredByNo",
  "requiredByRole",
  "submittedAt",
  "submittedById",
  "submittedByNo",
  "metadata",
  "createdAt",
  "updatedAt"
)
SELECT
  lower(hex(randomblob(16))),
  COALESCE(
    NULLIF(TRIM(ci."reportRefNo"), ''),
    'FIL-' || UPPER(substr(hex(randomblob(8)), 1, 12))
  ),
  ci."id",
  CASE
    WHEN UPPER(TRIM(COALESCE(ci."reportStatus", ''))) = 'REPORTED' THEN 'SUBMITTED'
    ELSE 'REQUIRED'
  END,
  COALESCE(ci."finalDispositionAt", ci."currentDispositionAt", ci."closedAt", ci."updatedAt", ci."createdAt"),
  ci."currentDispositionById",
  ci."currentDispositionByNo",
  ci."currentDispositionByRole",
  CASE
    WHEN UPPER(TRIM(COALESCE(ci."reportStatus", ''))) = 'REPORTED' THEN ci."reportedAt"
    ELSE NULL
  END,
  CASE
    WHEN UPPER(TRIM(COALESCE(ci."reportStatus", ''))) = 'REPORTED' THEN ci."reportedByUserId"
    ELSE NULL
  END,
  CASE
    WHEN UPPER(TRIM(COALESCE(ci."reportStatus", ''))) = 'REPORTED' THEN ci."reportedByUserNo"
    ELSE NULL
  END,
  '{"source":"LEGACY_PHASE12_BACKFILL"}',
  COALESCE(ci."createdAt", CURRENT_TIMESTAMP),
  COALESCE(ci."updatedAt", CURRENT_TIMESTAMP)
FROM "compliance_incidents" ci
WHERE (
    UPPER(TRIM(COALESCE(ci."reportStatus", ''))) = 'REPORTED'
    OR UPPER(TRIM(COALESCE(ci."decision", ''))) = 'REPORT'
    OR UPPER(TRIM(COALESCE(ci."currentDispositionCode", ''))) = 'RISK_CONFIRMED'
      AND COALESCE(ci."reportRefNo", '') <> ''
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "compliance_incident_external_filings" f
    WHERE f."incidentId" = ci."id"
  );

INSERT INTO "compliance_incident_external_filing_events" (
  "id",
  "filingId",
  "eventType",
  "eventAt",
  "actorType",
  "actorId",
  "actorNo",
  "actorRole",
  "note",
  "statusFrom",
  "statusTo",
  "externalRefNo",
  "createdAt"
)
SELECT
  lower(hex(randomblob(16))),
  f."id",
  CASE
    WHEN f."status" = 'SUBMITTED' THEN 'SUBMITTED'
    ELSE 'REQUIRED'
  END,
  COALESCE(f."submittedAt", f."requiredAt", f."createdAt"),
  'SYSTEM',
  'LEGACY_BACKFILL',
  NULL,
  NULL,
  'Backfilled from Phase 12 report/reportStatus state.',
  NULL,
  f."status",
  f."externalRefNo",
  COALESCE(f."createdAt", CURRENT_TIMESTAMP)
FROM "compliance_incident_external_filings" f
WHERE json_extract(COALESCE(f."metadata", '{}'), '$.source') = 'LEGACY_PHASE12_BACKFILL';
