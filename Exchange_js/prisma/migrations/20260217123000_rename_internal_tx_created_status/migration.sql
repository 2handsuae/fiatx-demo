-- Rename internal transaction initial status from CREATED to INTERNAL_FUNDS_PENDING.
UPDATE "internal_transactions"
SET "status" = 'INTERNAL_FUNDS_PENDING'
WHERE "status" = 'CREATED';

UPDATE "internal_transaction_audit_logs"
SET "oldStatus" = 'INTERNAL_FUNDS_PENDING'
WHERE "oldStatus" = 'CREATED';

UPDATE "internal_transaction_audit_logs"
SET "newStatus" = 'INTERNAL_FUNDS_PENDING'
WHERE "newStatus" = 'CREATED';

-- Keep runtime event matching consistent for already-seeded environments.
UPDATE "acct_events"
SET "toStatus" = 'INTERNAL_FUNDS_PENDING'
WHERE "eventCode" = 'EVT_INTERNAL_TX_CREATED'
  AND "entityType" = 'INTERNAL_TX';
