-- Wallet balance projection base tables
ALTER TABLE "journal_lines" ADD COLUMN "walletId" TEXT;

CREATE INDEX "journal_lines_walletId_idx" ON "journal_lines"("walletId");
CREATE INDEX "journal_lines_walletId_assetId_idx" ON "journal_lines"("walletId", "assetId");

CREATE TABLE "wallet_balance_snapshots" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "walletId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "availableBalance" DECIMAL NOT NULL DEFAULT 0,
  "restrictedBalance" DECIMAL NOT NULL DEFAULT 0,
  "inTransitBalance" DECIMAL NOT NULL DEFAULT 0,
  "totalBalance" DECIMAL NOT NULL DEFAULT 0,
  "lastJournalLineId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "wallet_balance_snapshots_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wallet_balance_snapshots_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "wallet_balance_snapshots_walletId_assetId_key"
  ON "wallet_balance_snapshots"("walletId", "assetId");
CREATE INDEX "wallet_balance_snapshots_walletId_idx"
  ON "wallet_balance_snapshots"("walletId");
CREATE INDEX "wallet_balance_snapshots_assetId_idx"
  ON "wallet_balance_snapshots"("assetId");

CREATE TABLE "wallet_balance_entries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "journalLineId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "accountCode" TEXT NOT NULL,
  "drCr" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "deltaAvailable" DECIMAL NOT NULL DEFAULT 0,
  "deltaRestricted" DECIMAL NOT NULL DEFAULT 0,
  "deltaInTransit" DECIMAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_balance_entries_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "journal_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wallet_balance_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "wallet_balance_entries_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "wallet_balance_entries_journalLineId_key"
  ON "wallet_balance_entries"("journalLineId");
CREATE INDEX "wallet_balance_entries_walletId_assetId_idx"
  ON "wallet_balance_entries"("walletId", "assetId");
CREATE INDEX "wallet_balance_entries_createdAt_idx"
  ON "wallet_balance_entries"("createdAt");

CREATE TABLE "asset_valuation_rates" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assetId" TEXT NOT NULL,
  "quoteAssetCode" TEXT NOT NULL,
  "price" DECIMAL NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "asset_valuation_rates_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "asset_valuation_rates_assetId_quoteAssetCode_key"
  ON "asset_valuation_rates"("assetId", "quoteAssetCode");
CREATE INDEX "asset_valuation_rates_status_idx"
  ON "asset_valuation_rates"("status");

-- Hard-cut rename for existing CRYPTO system walletNo naming
UPDATE "wallets"
SET
  "walletNo" = REPLACE("walletNo", 'SYS_MASTER_', 'SYS_CUST_CRYPTO_MASTER_'),
  "ownerType" = 'CUSTOMER',
  "ownerId" = NULL,
  "ownerNo" = COALESCE("ownerNo", 'CUSTOMER_POOL')
WHERE "walletNo" LIKE 'SYS_MASTER_%';

UPDATE "wallets"
SET
  "walletNo" = REPLACE("walletNo", 'SYS_PAYOUT_', 'SYS_CUST_CRYPTO_PAYOUT_'),
  "ownerType" = 'CUSTOMER',
  "ownerId" = NULL,
  "ownerNo" = 'CUSTOMER_POOL'
WHERE "walletNo" LIKE 'SYS_PAYOUT_%';

UPDATE "wallets"
SET
  "walletNo" = REPLACE("walletNo", 'SYS_LIQ_', 'SYS_PLATFORM_CRYPTO_LIQ_'),
  "ownerType" = 'PLATFORM',
  "ownerId" = NULL,
  "ownerNo" = 'PLATFORM'
WHERE "walletNo" LIKE 'SYS_LIQ_%';
