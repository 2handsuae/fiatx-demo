-- Retire the superseded external-statement blob table (#3).
-- Raw statements now live per-line in external_statement_lines.raw + statementId
-- (see external_balances / external_statement_lines, migration recon_redesign_external_tables).
-- The dedicated CRUD page and its dead file adapters are removed in the same change.

-- DropTable
DROP TABLE "reconciliation_external_statements";
