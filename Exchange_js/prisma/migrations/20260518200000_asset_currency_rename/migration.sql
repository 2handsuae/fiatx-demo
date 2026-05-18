-- Step 1: Add currency column
ALTER TABLE "assets" ADD COLUMN "currency" TEXT;

-- Step 2: Copy current code values to currency
UPDATE "assets" SET "currency" = "code";

-- Step 3: Rewrite code as compound: currency-network or just currency
UPDATE "assets" SET "code" = CASE
  WHEN "network" IS NOT NULL AND "network" != '' THEN "currency" || '-' || "network"
  ELSE "currency"
END;

-- Step 4: Create unique index on code
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");

-- Step 5: Drop old composite unique index and create new one
DROP INDEX IF EXISTS "assets_type_code_network_key";
CREATE UNIQUE INDEX "assets_type_currency_network_key" ON "assets"("type", "currency", "network");
