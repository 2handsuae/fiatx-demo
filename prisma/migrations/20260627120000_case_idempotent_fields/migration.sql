-- AlterTable: T1 reconciliation case idempotency tracking.
-- Pure additive ALTER TABLE ADD COLUMN + CREATE INDEX. Existing data unaffected — all 5
-- columns are nullable; legacy V8_FORMULA cases leave them NULL, T2's wallet-level upsert
-- engine (keyed on walletRef+businessDate) will populate them on new runs.
--
-- firstSeenRunId / lastUpdatedRunId: pin the run that first opened the case and the most recent
--   run that re-observed it (idempotent rerun = bump lastUpdatedRunId, do not create a new row).
-- resolvedAt / resolutionReason:    close the loop when the break clears (AUTO_HEALED) or an
--   operator resolves / waives it (MANUAL_RESOLVED | WAIVED).
-- severity:                          HIGH | MEDIUM | LOW for cockpit triage.
-- (walletRef, businessDate, status) composite index: drives the T2 idempotent lookup +
--   the T4 cockpit account-status table (one row per wallet per day, filtered by status).

ALTER TABLE "reconciliation_cases" ADD COLUMN "firstSeenRunId" TEXT;
ALTER TABLE "reconciliation_cases" ADD COLUMN "lastUpdatedRunId" TEXT;
ALTER TABLE "reconciliation_cases" ADD COLUMN "resolvedAt" DATETIME;
ALTER TABLE "reconciliation_cases" ADD COLUMN "resolutionReason" TEXT;
ALTER TABLE "reconciliation_cases" ADD COLUMN "severity" TEXT;
CREATE INDEX "reconciliation_cases_walletRef_businessDate_status_idx" ON "reconciliation_cases"("walletRef", "businessDate", "status");
