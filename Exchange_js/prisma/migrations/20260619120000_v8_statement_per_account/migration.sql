-- V8: statement-per-physical-account. The external statement unique key moves from
-- (source, businessDate, currency) to (source, businessDate, accountRef): one statement per
-- physical external account (segregated). currency stays a normal column.
-- Existing rows have distinct accountRef (C_CMA-AED-0001 vs vault-usdt-0001) so no collision;
-- the demo regenerates statements regardless.

-- DropIndex (old currency-scoped unique key)
DROP INDEX "reconciliation_external_statements_source_businessDate_currency_key";

-- CreateIndex (new account-scoped unique key)
CREATE UNIQUE INDEX "reconciliation_external_statements_source_businessDate_accountRef_key" ON "reconciliation_external_statements"("source", "businessDate", "accountRef");
