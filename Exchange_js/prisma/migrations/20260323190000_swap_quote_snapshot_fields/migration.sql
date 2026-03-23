ALTER TABLE "swap_quotes"
ADD COLUMN "totalsJson" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "swap_quotes"
ADD COLUMN "policyRef" TEXT NOT NULL DEFAULT '{}';

UPDATE "swap_quotes"
SET
  "totalsJson" = CASE
    WHEN "feeBreakdown" IS NOT NULL
      AND json_valid("feeBreakdown")
      AND json_type("feeBreakdown", '$[0].totals') IS NOT NULL
    THEN COALESCE(json_extract("feeBreakdown", '$[0].totals'), '{}')
    ELSE '{}'
  END,
  "policyRef" = CASE
    WHEN "feeBreakdown" IS NOT NULL
      AND json_valid("feeBreakdown")
      AND json_type("feeBreakdown", '$[0].policyRef') IS NOT NULL
    THEN COALESCE(json_extract("feeBreakdown", '$[0].policyRef'), '{}')
    ELSE '{}'
  END;
