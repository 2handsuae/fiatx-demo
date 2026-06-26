-- CreateTable: account_flows is the Phase B reconciliation projection — 2 rows per TB transfer
-- (debit→OUT, credit→IN). Per-wallet drill-down does a single indexed query instead of
-- OR-filtering tb_transfer_evidence and computing direction at read time.
CREATE TABLE "account_flows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tbTransferId" TEXT NOT NULL,
    "tbAccountId" TEXT NOT NULL,
    "walletRef" TEXT,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "isExternalCrossing" BOOLEAN NOT NULL DEFAULT false,
    "externalRef" TEXT,
    "eventCode" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceNo" TEXT NOT NULL,
    "transferType" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL
);

-- Idempotency: (tbTransferId, tbAccountId) uniquely identifies a flow row
CREATE UNIQUE INDEX "account_flows_tbTransferId_tbAccountId_key" ON "account_flows"("tbTransferId", "tbAccountId");

-- Per-wallet ordered drill-down: SELECT … WHERE tbAccountId = ? ORDER BY createdAt
CREATE INDEX "account_flows_tbAccountId_createdAt_idx" ON "account_flows"("tbAccountId", "createdAt");
CREATE INDEX "account_flows_walletRef_idx" ON "account_flows"("walletRef");
CREATE INDEX "account_flows_externalRef_idx" ON "account_flows"("externalRef");
CREATE INDEX "account_flows_tbTransferId_idx" ON "account_flows"("tbTransferId");
