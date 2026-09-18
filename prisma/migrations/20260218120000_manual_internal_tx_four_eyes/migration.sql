-- Add wallet role tags for filterable manual internal transfer creation.
ALTER TABLE "wallets"
ADD COLUMN "walletRole" TEXT NOT NULL DEFAULT 'GENERAL';

-- Backfill system wallet roles by walletNo convention.
UPDATE "wallets"
SET "walletRole" = 'MASTER'
WHERE "walletNo" LIKE 'SYS_CUST_CRYPTO_MASTER_%';

UPDATE "wallets"
SET "walletRole" = 'PAYOUT'
WHERE "walletNo" LIKE 'SYS_CUST_CRYPTO_PAYOUT_%';

UPDATE "wallets"
SET "walletRole" = 'LIQ'
WHERE "walletNo" LIKE 'SYS_PLATFORM_CRYPTO_LIQ_%';

UPDATE "wallets"
SET "walletRole" = 'CUST_BANK'
WHERE "walletNo" LIKE 'SYS_CUST_BANK_%';

UPDATE "wallets"
SET "walletRole" = 'LIQ_BANK'
WHERE "walletNo" LIKE 'SYS_LIQ_BANK_%';

UPDATE "wallets"
SET "walletRole" = 'DEPOSIT'
WHERE "walletRole" = 'GENERAL'
  AND "ownerType" = 'CUSTOMER'
  AND "direction" = 'INBOUND'
  AND "type" = 'CRYPTO_ADDRESS';

-- Add manual internal transaction review fields.
ALTER TABLE "internal_transactions"
ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED';

ALTER TABLE "internal_transactions"
ADD COLUMN "makerUserId" TEXT;

ALTER TABLE "internal_transactions"
ADD COLUMN "checkerUserId" TEXT;

ALTER TABLE "internal_transactions"
ADD COLUMN "checkedAt" DATETIME;

ALTER TABLE "internal_transactions"
ADD COLUMN "reviewReason" TEXT;

CREATE INDEX "internal_transactions_approvalStatus_idx"
ON "internal_transactions"("approvalStatus");
