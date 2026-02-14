-- Remove wallets.ownerId -> customer_main FK to allow polymorphic ownerId
-- (CUSTOMER / LIQUIDITY_PROVIDER / PLATFORM) enforced by triggers below.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_wallets" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "walletNo" TEXT,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT,
  "ownerNo" TEXT,
  "type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "balance" DECIMAL NOT NULL DEFAULT 0,
  "lockedBalance" DECIMAL NOT NULL DEFAULT 0,
  "address" TEXT,
  "memo" TEXT,
  "bankName" TEXT,
  "bankAccount" TEXT,
  "bankCode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  "accountName" TEXT,
  "beneficiaryName" TEXT,
  "counterpartyVasp" TEXT,
  "iban" TEXT,
  CONSTRAINT "wallets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_wallets" (
  "id",
  "walletNo",
  "ownerType",
  "ownerId",
  "ownerNo",
  "type",
  "direction",
  "assetId",
  "balance",
  "lockedBalance",
  "address",
  "memo",
  "bankName",
  "bankAccount",
  "bankCode",
  "status",
  "created_at",
  "updated_at",
  "accountName",
  "beneficiaryName",
  "counterpartyVasp",
  "iban"
)
SELECT
  "id",
  "walletNo",
  "ownerType",
  "ownerId",
  "ownerNo",
  "type",
  "direction",
  "assetId",
  "balance",
  "lockedBalance",
  "address",
  "memo",
  "bankName",
  "bankAccount",
  "bankCode",
  "status",
  "created_at",
  "updated_at",
  "accountName",
  "beneficiaryName",
  "counterpartyVasp",
  "iban"
FROM "wallets";

DROP TABLE "wallets";
ALTER TABLE "new_wallets" RENAME TO "wallets";

CREATE UNIQUE INDEX "wallets_walletNo_key" ON "wallets"("walletNo");
CREATE INDEX "wallets_ownerType_ownerId_idx" ON "wallets"("ownerType", "ownerId");
CREATE INDEX "wallets_assetId_idx" ON "wallets"("assetId");
CREATE INDEX "wallets_status_idx" ON "wallets"("status");

PRAGMA foreign_keys=ON;

-- Precheck: fail fast if CUSTOMER INBOUND duplicate keys already exist.
-- To inspect conflict keys manually, run:
-- SELECT ownerId, assetId, type, direction, COUNT(*) FROM wallets
-- WHERE ownerType='CUSTOMER' AND direction='INBOUND'
-- GROUP BY ownerId, assetId, type, direction HAVING COUNT(*) > 1;
CREATE TEMP TABLE "__wallets_customer_inbound_dups" (
  "ownerId" TEXT,
  "assetId" TEXT,
  "type" TEXT,
  "direction" TEXT,
  "duplicateCount" INTEGER
);

CREATE TEMP TRIGGER "__wallets_customer_inbound_dups_abort"
BEFORE INSERT ON "__wallets_customer_inbound_dups"
FOR EACH ROW
BEGIN
  SELECT RAISE(
    ABORT,
    'Duplicate CUSTOMER INBOUND wallet keys detected. Run duplicate query in migration comment to inspect keys.'
  );
END;

INSERT INTO "__wallets_customer_inbound_dups" (
  "ownerId",
  "assetId",
  "type",
  "direction",
  "duplicateCount"
)
SELECT
  "ownerId",
  "assetId",
  "type",
  "direction",
  COUNT(*)
FROM "wallets"
WHERE "ownerType" = 'CUSTOMER'
  AND "direction" = 'INBOUND'
GROUP BY "ownerId", "assetId", "type", "direction"
HAVING COUNT(*) > 1;

DROP TRIGGER "__wallets_customer_inbound_dups_abort";
DROP TABLE "__wallets_customer_inbound_dups";

-- Enforce unique CUSTOMER inbound wallet per (ownerId, assetId, type, direction).
CREATE UNIQUE INDEX "wallets_customer_inbound_unique_idx"
ON "wallets" ("ownerId", "assetId", "type", "direction")
WHERE "ownerType" = 'CUSTOMER' AND "direction" = 'INBOUND';

-- Refresh semantic triggers idempotently.
DROP TRIGGER IF EXISTS "wallets_owner_semantics_insert";
DROP TRIGGER IF EXISTS "wallets_owner_semantics_update";

CREATE TRIGGER "wallets_owner_semantics_insert"
BEFORE INSERT ON "wallets"
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW."ownerType" NOT IN ('PLATFORM', 'CUSTOMER', 'LIQUIDITY_PROVIDER')
      THEN RAISE(ABORT, 'Invalid wallets.ownerType')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'PLATFORM' AND NEW."ownerId" IS NOT NULL
      THEN RAISE(ABORT, 'PLATFORM wallet must not set ownerId')
  END;

  SELECT CASE
    WHEN NEW."ownerType" <> 'PLATFORM' AND NEW."ownerId" IS NULL
      THEN RAISE(ABORT, 'Non-PLATFORM wallet must set ownerId')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'CUSTOMER'
      AND NEW."ownerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "customer_main" c WHERE c."id" = NEW."ownerId"
      )
      THEN RAISE(ABORT, 'CUSTOMER wallet ownerId does not exist')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'LIQUIDITY_PROVIDER'
      AND NEW."ownerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "liquidity_provider" lp WHERE lp."id" = NEW."ownerId"
      )
      THEN RAISE(ABORT, 'LIQUIDITY_PROVIDER wallet ownerId does not exist')
  END;
END;

CREATE TRIGGER "wallets_owner_semantics_update"
BEFORE UPDATE ON "wallets"
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW."ownerType" NOT IN ('PLATFORM', 'CUSTOMER', 'LIQUIDITY_PROVIDER')
      THEN RAISE(ABORT, 'Invalid wallets.ownerType')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'PLATFORM' AND NEW."ownerId" IS NOT NULL
      THEN RAISE(ABORT, 'PLATFORM wallet must not set ownerId')
  END;

  SELECT CASE
    WHEN NEW."ownerType" <> 'PLATFORM' AND NEW."ownerId" IS NULL
      THEN RAISE(ABORT, 'Non-PLATFORM wallet must set ownerId')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'CUSTOMER'
      AND NEW."ownerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "customer_main" c WHERE c."id" = NEW."ownerId"
      )
      THEN RAISE(ABORT, 'CUSTOMER wallet ownerId does not exist')
  END;

  SELECT CASE
    WHEN NEW."ownerType" = 'LIQUIDITY_PROVIDER'
      AND NEW."ownerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "liquidity_provider" lp WHERE lp."id" = NEW."ownerId"
      )
      THEN RAISE(ABORT, 'LIQUIDITY_PROVIDER wallet ownerId does not exist')
  END;
END;
