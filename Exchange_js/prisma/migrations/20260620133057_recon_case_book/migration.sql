-- Redesign reconciliation: per-book cases.
-- A currency can now hold a CLIENT case AND a FIRM case for the same business date.
-- Legacy I1–I5 cases keep book=NULL (still unique under the composite key).

-- AddColumn
ALTER TABLE "reconciliation_cases" ADD COLUMN "book" TEXT;

-- Replace the (businessDate, assetId) unique with (businessDate, assetId, book).
DROP INDEX "reconciliation_cases_businessDate_assetId_key";
CREATE UNIQUE INDEX "reconciliation_cases_businessDate_assetId_book_key" ON "reconciliation_cases"("businessDate", "assetId", "book");
