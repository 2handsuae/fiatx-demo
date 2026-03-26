CREATE TABLE "inbound_transfer_signals" (
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
  "status" TEXT NOT NULL DEFAULT 'PENDING_SCAN',
  "dedupeKey" TEXT NOT NULL,
  "linkedPayinId" TEXT,
  "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastScannedAt" DATETIME,
  "scanResult" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "inbound_transfer_signals_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inbound_transfer_signals_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "wallets" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inbound_transfer_signals_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inbound_transfer_signals_linkedPayinId_fkey"
    FOREIGN KEY ("linkedPayinId") REFERENCES "payins" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inbound_transfer_signals_signalNo_key"
ON "inbound_transfer_signals"("signalNo");

CREATE UNIQUE INDEX "inbound_transfer_signals_dedupeKey_key"
ON "inbound_transfer_signals"("dedupeKey");

CREATE INDEX "inbound_transfer_signals_ownerId_walletId_status_idx"
ON "inbound_transfer_signals"("ownerId", "walletId", "status");

CREATE INDEX "inbound_transfer_signals_walletId_submittedAt_idx"
ON "inbound_transfer_signals"("walletId", "submittedAt");

CREATE INDEX "inbound_transfer_signals_linkedPayinId_idx"
ON "inbound_transfer_signals"("linkedPayinId");

CREATE INDEX "inbound_transfer_signals_txHash_idx"
ON "inbound_transfer_signals"("txHash");

CREATE INDEX "inbound_transfer_signals_referenceNo_idx"
ON "inbound_transfer_signals"("referenceNo");
