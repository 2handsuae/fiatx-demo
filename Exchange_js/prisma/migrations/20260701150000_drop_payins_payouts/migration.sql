-- C5a: drop payins/payouts tables + models (funds_orders 三合一 final decoupling).
--
-- The payin/payout principal now lives in funds_orders (C1-C4). These two tables are
-- orphan residue whose only remaining coupling was compile-time typed relations on
-- DepositTransaction / WithdrawTransaction / InboundTransferSignal (all removed in C5a code).
--
-- Why table rebuilds (not plain `ALTER TABLE ... DROP COLUMN`):
--   * deposit_transactions.payinId  → participates in FK deposit_transactions_payinId_fkey
--     (→ payins). SQLite rejects DROP COLUMN on a column in a FK definition → rebuild.
--   * inbound_transfer_signals.linkedPayinId → participates in FK
--     inbound_transfer_signals_linkedPayinId_fkey (→ payins) → rebuild.
--   * withdraw_transactions.payoutId/payoutNo/payoutRequestedAt → NO FK, but payoutId
--     backs a UNIQUE index + a plain index. Drop those two indexes first, then DROP COLUMN.
--
-- Rebuild pattern = create-<name>_new → copy → drop-old → RENAME _new → canonical.
-- This is chosen over `RENAME old→_old; CREATE new` deliberately: renaming the *referenced*
-- table (deposit_transactions) triggers SQLite's child-FK rewrite (funds_orders.
-- depositTransactionId_fkey would be repointed at the temp name and then dangle after the
-- temp is dropped). Dropping the old canonical table (FK off) and renaming the freshly-built
-- `_new` INTO the canonical name leaves child FKs that reference the canonical name intact.

PRAGMA foreign_keys=OFF;

-- ── deposit_transactions: drop payinId column + its FK (→ payins) + unique index ──
CREATE TABLE "deposit_transactions_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depositNo" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "netAmount" DECIMAL NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "fromWalletId" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "txHash" TEXT,
    "referenceNo" TEXT,
    "expiresAt" DATETIME,
    "kytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kytScreeningId" TEXT,
    "kytRiskScore" INTEGER,
    "kytCheckedAt" DATETIME,
    "travelRuleRequired" BOOLEAN NOT NULL DEFAULT false,
    "travelRuleStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "travelRuleTransferId" TEXT,
    "counterpartyVasp" TEXT,
    "travelRuleCheckedAt" DATETIME,
    "statusHistory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "traceId" TEXT,
    "aggregatedAt" DATETIME,
    "aggregatedTransferId" TEXT,
    CONSTRAINT "deposit_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "deposit_transactions_new" ("id","depositNo","ownerType","ownerId","status","assetId","toWalletId","amount","netAmount","feeAmount","fromWalletId","fromAddress","fromIban","toAddress","toIban","txHash","referenceNo","expiresAt","kytStatus","kytScreeningId","kytRiskScore","kytCheckedAt","travelRuleRequired","travelRuleStatus","travelRuleTransferId","counterpartyVasp","travelRuleCheckedAt","statusHistory","createdAt","updatedAt","completedAt","traceId","aggregatedAt","aggregatedTransferId")
SELECT "id","depositNo","ownerType","ownerId","status","assetId","toWalletId","amount","netAmount","feeAmount","fromWalletId","fromAddress","fromIban","toAddress","toIban","txHash","referenceNo","expiresAt","kytStatus","kytScreeningId","kytRiskScore","kytCheckedAt","travelRuleRequired","travelRuleStatus","travelRuleTransferId","counterpartyVasp","travelRuleCheckedAt","statusHistory","createdAt","updatedAt","completedAt","traceId","aggregatedAt","aggregatedTransferId" FROM "deposit_transactions";
DROP TABLE "deposit_transactions";
ALTER TABLE "deposit_transactions_new" RENAME TO "deposit_transactions";

CREATE UNIQUE INDEX "deposit_transactions_depositNo_key" ON "deposit_transactions"("depositNo");
CREATE INDEX "deposit_transactions_depositNo_idx" ON "deposit_transactions"("depositNo");
CREATE INDEX "deposit_transactions_ownerType_ownerId_idx" ON "deposit_transactions"("ownerType", "ownerId");
CREATE INDEX "deposit_transactions_status_idx" ON "deposit_transactions"("status");
CREATE INDEX "deposit_transactions_createdAt_idx" ON "deposit_transactions"("createdAt");
CREATE INDEX "deposit_transactions_toWalletId_status_aggregatedAt_idx" ON "deposit_transactions"("toWalletId", "status", "aggregatedAt");

-- ── inbound_transfer_signals: drop linkedPayinId column + its FK (→ payins) + index ──
CREATE TABLE "inbound_transfer_signals_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalNo" TEXT NOT NULL DEFAULT 'TEMP',
    "ownerId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "txHash" TEXT,
    "referenceNo" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "simulationRiskLevel" TEXT,
    "simulationRiskReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SCAN',
    "dedupeKey" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScannedAt" DATETIME,
    "scanResult" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "inbound_transfer_signals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbound_transfer_signals_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbound_transfer_signals_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "inbound_transfer_signals_new" ("id","signalNo","ownerId","walletId","assetId","channelType","amount","txHash","referenceNo","fromAddress","fromIban","simulationRiskLevel","simulationRiskReason","status","dedupeKey","submittedAt","lastScannedAt","scanResult","createdAt","updatedAt")
SELECT "id","signalNo","ownerId","walletId","assetId","channelType","amount","txHash","referenceNo","fromAddress","fromIban","simulationRiskLevel","simulationRiskReason","status","dedupeKey","submittedAt","lastScannedAt","scanResult","createdAt","updatedAt" FROM "inbound_transfer_signals";
DROP TABLE "inbound_transfer_signals";
ALTER TABLE "inbound_transfer_signals_new" RENAME TO "inbound_transfer_signals";

CREATE UNIQUE INDEX "inbound_transfer_signals_signalNo_key" ON "inbound_transfer_signals"("signalNo");
CREATE UNIQUE INDEX "inbound_transfer_signals_dedupeKey_key" ON "inbound_transfer_signals"("dedupeKey");
CREATE INDEX "inbound_transfer_signals_ownerId_walletId_status_idx" ON "inbound_transfer_signals"("ownerId", "walletId", "status");
CREATE INDEX "inbound_transfer_signals_walletId_submittedAt_idx" ON "inbound_transfer_signals"("walletId", "submittedAt");
CREATE INDEX "inbound_transfer_signals_txHash_idx" ON "inbound_transfer_signals"("txHash");
CREATE INDEX "inbound_transfer_signals_referenceNo_idx" ON "inbound_transfer_signals"("referenceNo");

-- ── withdraw_transactions: no FK on payout* columns → drop backing indexes, then columns ──
DROP INDEX "withdraw_transactions_payoutId_key";
DROP INDEX "withdraw_transactions_payoutId_idx";
ALTER TABLE "withdraw_transactions" DROP COLUMN "payoutId";
ALTER TABLE "withdraw_transactions" DROP COLUMN "payoutNo";
ALTER TABLE "withdraw_transactions" DROP COLUMN "payoutRequestedAt";

-- ── drop the now-orphaned tables ──
DROP TABLE "payins";
DROP TABLE "payouts";

PRAGMA foreign_keys=ON;
