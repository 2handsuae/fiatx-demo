-- Normalize legacy ACKED status to ASSIGNED for simplified state machine
UPDATE "compliance_alerts"
SET "status" = 'ASSIGNED',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'ACKED';

-- Escalated is terminal/closed in V2; backfill close fields for legacy rows
UPDATE "compliance_alerts"
SET "closedAt" = COALESCE("closedAt", "updatedAt", CURRENT_TIMESTAMP),
    "closeReason" = COALESCE(NULLIF("closeReason", ''), 'Escalated terminal migration'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'ESCALATED'
  AND "closedAt" IS NULL;
