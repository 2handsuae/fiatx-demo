CREATE TABLE "pricing_policies" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyCode" TEXT NOT NULL,
  "policyName" TEXT NOT NULL,
  "business" TEXT NOT NULL,
  "channelOnline" BOOLEAN NOT NULL DEFAULT true,
  "channelStoreSoon" BOOLEAN NOT NULL DEFAULT true,
  "configJson" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "updatedByUserNo" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "pricing_policies_policyCode_key" ON "pricing_policies"("policyCode");
CREATE INDEX "pricing_policies_business_idx" ON "pricing_policies"("business");

CREATE TABLE "withdraw_pricing_quotes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "quoteNo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "ownerNo" TEXT,
  "assetId" TEXT NOT NULL,
  "assetCode" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "segment" TEXT NOT NULL,
  "riskTier" TEXT NOT NULL,
  "matchedAssetId" TEXT NOT NULL,
  "matchedTierId" TEXT NOT NULL,
  "matchedTierName" TEXT NOT NULL,
  "feeBreakdown" TEXT NOT NULL,
  "totalsJson" TEXT NOT NULL,
  "policyRef" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "withdraw_pricing_quotes_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "withdraw_pricing_quotes_quoteNo_key" ON "withdraw_pricing_quotes"("quoteNo");
CREATE INDEX "withdraw_pricing_quotes_status_expiresAt_idx" ON "withdraw_pricing_quotes"("status", "expiresAt");
CREATE INDEX "withdraw_pricing_quotes_ownerType_ownerId_idx" ON "withdraw_pricing_quotes"("ownerType", "ownerId");
CREATE INDEX "withdraw_pricing_quotes_assetId_createdAt_idx" ON "withdraw_pricing_quotes"("assetId", "createdAt");

ALTER TABLE "withdraw_transactions" ADD COLUMN "pricingQuoteId" TEXT;
CREATE UNIQUE INDEX "withdraw_transactions_pricingQuoteId_key" ON "withdraw_transactions"("pricingQuoteId");
CREATE INDEX "withdraw_transactions_pricingQuoteId_idx" ON "withdraw_transactions"("pricingQuoteId");

DROP TABLE "customer_swap_rate_configurations";
