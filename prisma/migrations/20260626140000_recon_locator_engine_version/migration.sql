-- AlterTable: Phase B reconciliation locator + engine-version stamp.
-- Pure additive ALTER TABLE ADD COLUMN + CREATE INDEX. Existing data unaffected:
--   - ReconciliationRun.engineVersion gets the column default 'V8_FORMULA' for every existing row
--     (historical credit-net five-formula runs), so no separate backfill is needed.
--   - ReconciliationCase / ExternalBalance / ReconciliationLineItem locator columns are nullable;
--     legacy rows leave them NULL, T7's wallet-level engine will populate new rows.

-- ReconciliationRun: stamp engine version per run (V8_FORMULA legacy, WALLET_V1 Phase B).
ALTER TABLE "reconciliation_runs" ADD COLUMN "engineVersion" TEXT NOT NULL DEFAULT 'V8_FORMULA';
CREATE INDEX "reconciliation_runs_engineVersion_idx" ON "reconciliation_runs"("engineVersion");

-- ReconciliationCase: pinpoint which physical wallet / COA bucket / owner the case belongs to.
ALTER TABLE "reconciliation_cases" ADD COLUMN "walletRef" TEXT;
ALTER TABLE "reconciliation_cases" ADD COLUMN "coaCode" TEXT;
ALTER TABLE "reconciliation_cases" ADD COLUMN "ownerNo" TEXT;
CREATE INDEX "reconciliation_cases_walletRef_idx" ON "reconciliation_cases"("walletRef");

-- ExternalBalance: pinpoint which physical wallet / COA bucket / owner the closing balance attests to.
ALTER TABLE "external_balances" ADD COLUMN "walletRef" TEXT;
ALTER TABLE "external_balances" ADD COLUMN "coaCode" TEXT;
ALTER TABLE "external_balances" ADD COLUMN "ownerNo" TEXT;
CREATE INDEX "external_balances_walletRef_idx" ON "external_balances"("walletRef");

-- ReconciliationLineItem: drill-down hooks to source (per-wallet evidence row or external statement line).
ALTER TABLE "reconciliation_line_items" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "reconciliation_line_items" ADD COLUMN "walletRef" TEXT;
CREATE INDEX "reconciliation_line_items_externalRef_idx" ON "reconciliation_line_items"("externalRef");
CREATE INDEX "reconciliation_line_items_walletRef_idx" ON "reconciliation_line_items"("walletRef");
