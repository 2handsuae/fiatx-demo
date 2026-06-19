-- AddColumn: statementNo business key for ReconciliationExternalStatement.
-- Format: STMT-{businessDate-no-dashes}-{source}-{currency}
ALTER TABLE "reconciliation_external_statements" ADD COLUMN "statementNo" TEXT DEFAULT 'TEMP';

-- Backfill existing rows BEFORE adding the unique index so two rows never both hold 'TEMP'.
UPDATE "reconciliation_external_statements"
SET "statementNo" = 'STMT-' || REPLACE("businessDate", '-', '') || '-' || "source" || '-' || "currency";

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_external_statements_statementNo_key" ON "reconciliation_external_statements"("statementNo");
