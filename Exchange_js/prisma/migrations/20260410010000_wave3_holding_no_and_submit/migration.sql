-- AlterTable: add holdingNo to customer_material_holdings
ALTER TABLE "customer_material_holdings" ADD COLUMN "holdingNo" TEXT NOT NULL DEFAULT 'TEMP';

-- Backfill existing holdings with unique values
UPDATE "customer_material_holdings"
SET "holdingNo" = 'CMH' || substr(strftime('%Y', datetime("createdAt"/1000, 'unixepoch')), 3, 2)
  || substr('00' || (cast(strftime('%m', datetime("createdAt"/1000, 'unixepoch')) as integer)), -2, 2)
  || substr('00' || (cast(strftime('%d', datetime("createdAt"/1000, 'unixepoch')) as integer)), -2, 2)
  || substr('0000' || rowid, -4, 4)
WHERE "holdingNo" = 'TEMP';

-- CreateIndex: unique constraint on holdingNo
CREATE UNIQUE INDEX "customer_material_holdings_holdingNo_key" ON "customer_material_holdings"("holdingNo");

-- AlterTable: add customerSubmittedAt to material_refresh_cycles
ALTER TABLE "material_refresh_cycles" ADD COLUMN "customerSubmittedAt" DATETIME;
