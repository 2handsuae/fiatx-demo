UPDATE "compliance_incident_external_filings" AS f
SET "metadata" = json_set(
  COALESCE(f."metadata", '{}'),
  '$.compatibilityOnly',
  json('true'),
  '$.compatibilityReason',
  'LEGACY_HEURISTIC_BACKFILL'
)
WHERE json_extract(COALESCE(f."metadata", '{}'), '$.source') = 'LEGACY_PHASE12_BACKFILL'
  AND NOT (
    EXISTS (
      SELECT 1
      FROM "compliance_incidents" i
      WHERE i."id" = f."incidentId"
        AND (
          UPPER(COALESCE(i."reportStatus", '')) = 'REPORTED'
          OR i."reportedAt" IS NOT NULL
        )
    )
    OR EXISTS (
      SELECT 1
      FROM "compliance_incident_external_filing_events" e
      WHERE e."filingId" = f."id"
        AND UPPER(COALESCE(e."eventType", '')) IN ('SUBMITTED', 'ACKNOWLEDGED', 'CLOSED')
    )
  );
