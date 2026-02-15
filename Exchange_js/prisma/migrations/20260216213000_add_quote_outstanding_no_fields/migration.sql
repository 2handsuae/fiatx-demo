ALTER TABLE "swap_quotes" ADD COLUMN "quoteNo" TEXT;
ALTER TABLE "swap_quotes" ADD COLUMN "ownerNo" TEXT;

ALTER TABLE "swap_transactions" ADD COLUMN "quoteNo" TEXT;

ALTER TABLE "outstandings" ADD COLUMN "outstandingNo" TEXT;
ALTER TABLE "outstandings" ADD COLUMN "ownerNo" TEXT;

-- Deterministic backfill for existing records
UPDATE "swap_quotes"
SET "quoteNo" = 'QUO_' || substr(replace("id", '-', ''), 1, 16)
WHERE "quoteNo" IS NULL;

UPDATE "outstandings"
SET "outstandingNo" = 'OTS_' || substr(replace("id", '-', ''), 1, 16)
WHERE "outstandingNo" IS NULL;

-- Backfill ownerNo from customer master for CUSTOMER scope
UPDATE "swap_quotes"
SET "ownerNo" = (
  SELECT "customerNo"
  FROM "customer_main" cm
  WHERE cm."id" = "swap_quotes"."ownerId"
)
WHERE "ownerType" = 'CUSTOMER' AND ("ownerNo" IS NULL OR "ownerNo" = '');

UPDATE "outstandings"
SET "ownerNo" = (
  SELECT "customerNo"
  FROM "customer_main" cm
  WHERE cm."id" = "outstandings"."ownerId"
)
WHERE "ownerType" = 'CUSTOMER' AND ("ownerNo" IS NULL OR "ownerNo" = '');

-- Backfill swap quoteNo snapshot from linked quote
UPDATE "swap_transactions"
SET "quoteNo" = (
  SELECT sq."quoteNo"
  FROM "swap_quotes" sq
  WHERE sq."id" = "swap_transactions"."quote_id"
)
WHERE "quote_id" IS NOT NULL AND "quoteNo" IS NULL;

CREATE UNIQUE INDEX "swap_quotes_quoteNo_key" ON "swap_quotes"("quoteNo");
CREATE INDEX "swap_quotes_ownerNo_idx" ON "swap_quotes"("ownerNo");
CREATE INDEX "swap_transactions_quoteNo_idx" ON "swap_transactions"("quoteNo");

CREATE UNIQUE INDEX "outstandings_outstandingNo_key" ON "outstandings"("outstandingNo");
CREATE INDEX "outstandings_ownerNo_idx" ON "outstandings"("ownerNo");
