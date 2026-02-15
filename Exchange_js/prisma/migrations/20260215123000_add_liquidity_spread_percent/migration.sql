ALTER TABLE "liquidity_configurations"
ADD COLUMN "spreadPercent" DECIMAL NOT NULL DEFAULT 0;

UPDATE "liquidity_configurations"
SET "spreadPercent" = "feePercent"
WHERE "spreadPercent" = 0;

UPDATE "liquidity_configurations"
SET "rateSourceType" = 'API'
WHERE "rateSourceType" = 'MANUAL';
