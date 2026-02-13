ALTER TABLE "customer_main" ADD COLUMN "companyName" TEXT;

UPDATE "customer_main"
SET "companyName" = COALESCE(NULLIF("firstName", ''), "companyName")
WHERE "customerType" = 'CORPORATE'
  AND ("companyName" IS NULL OR "companyName" = '');
