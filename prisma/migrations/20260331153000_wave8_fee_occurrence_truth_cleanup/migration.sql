DROP INDEX IF EXISTS "fee_occurrences_feeType_occurrenceType_idx";

ALTER TABLE "fee_occurrences" DROP COLUMN "occurrenceType";
ALTER TABLE "fee_occurrences" DROP COLUMN "periodStart";
ALTER TABLE "fee_occurrences" DROP COLUMN "periodEnd";

CREATE INDEX "fee_occurrences_feeType_idx" ON "fee_occurrences"("feeType");
