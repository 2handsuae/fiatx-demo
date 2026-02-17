-- Allow CUSTOMER pool wallets with nullable ownerId.
-- Keep PLATFORM ownerId null and LIQUIDITY_PROVIDER ownerId required.

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
    WHEN NEW."ownerType" = 'LIQUIDITY_PROVIDER' AND NEW."ownerId" IS NULL
      THEN RAISE(ABORT, 'LIQUIDITY_PROVIDER wallet must set ownerId')
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
    WHEN NEW."ownerType" = 'LIQUIDITY_PROVIDER' AND NEW."ownerId" IS NULL
      THEN RAISE(ABORT, 'LIQUIDITY_PROVIDER wallet must set ownerId')
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
