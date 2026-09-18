-- Align DEPOSIT accounting events with current deposit status machine
-- and remove rejected accounting events per product decision.

UPDATE "acct_events"
SET
  "triggerType" = 'STATUS_TRANSITION',
  "triggerKey" = 'status',
  "fromStatus" = NULL,
  "toStatus" = 'COMPLIANCE_PENDING',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "eventCode" IN ('EVT_DEPOSIT_CONFIRMED__CRYPTO', 'EVT_DEPOSIT_CONFIRMED__FIAT');

UPDATE "acct_events"
SET
  "triggerType" = 'STATUS_TRANSITION',
  "triggerKey" = 'status',
  "fromStatus" = NULL,
  "toStatus" = 'SUCCESS',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "eventCode" IN ('EVT_DEPOSIT_SUCCESS__CRYPTO', 'EVT_DEPOSIT_SUCCESS__FIAT');

DELETE FROM "acct_events"
WHERE "eventCode" IN ('EVT_DEPOSIT_REJECTED__CRYPTO', 'EVT_DEPOSIT_REJECTED__FIAT');
