-- Outstanding settlement batch tables
CREATE TABLE "outstanding_settlements" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "settlementNo" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'SWAP',
  "rangeStartAt" DATETIME,
  "cutoffAt" DATETIME NOT NULL,
  "status" TEXT NOT NULL,
  "requestId" TEXT,
  "makerUserId" TEXT,
  "note" TEXT,
  "totalOutstandingCount" INTEGER NOT NULL DEFAULT 0,
  "closedOutstandingCount" INTEGER NOT NULL DEFAULT 0,
  "totalAssetCount" INTEGER NOT NULL DEFAULT 0,
  "closedAssetCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "completedAt" DATETIME
);

CREATE TABLE "outstanding_settlement_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "settlementId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "assetCode" TEXT,
  "totalInAmount" DECIMAL NOT NULL DEFAULT 0,
  "totalOutAmount" DECIMAL NOT NULL DEFAULT 0,
  "netAmount" DECIMAL NOT NULL,
  "internalType" TEXT,
  "internalTransactionId" TEXT,
  "status" TEXT NOT NULL,
  "outstandingCount" INTEGER NOT NULL DEFAULT 0,
  "closedOutstandingCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "closedAt" DATETIME,
  CONSTRAINT "outstanding_settlement_items_settlementId_fkey"
    FOREIGN KEY ("settlementId") REFERENCES "outstanding_settlements" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "outstanding_settlement_items_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outstanding_settlement_items_internalTransactionId_fkey"
    FOREIGN KEY ("internalTransactionId") REFERENCES "internal_transactions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- Extend outstandings for settlement lock/close lifecycle
ALTER TABLE "outstandings"
ADD COLUMN "settlementId" TEXT
REFERENCES "outstanding_settlements" ("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "outstandings"
ADD COLUMN "settlementItemId" TEXT
REFERENCES "outstanding_settlement_items" ("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "outstandings"
ADD COLUMN "lockedAt" DATETIME;

ALTER TABLE "outstandings"
ADD COLUMN "closedAt" DATETIME;

ALTER TABLE "outstandings"
ADD COLUMN "closedByInternalFundId" TEXT
REFERENCES "internal_funds" ("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "outstanding_settlements_settlementNo_key"
ON "outstanding_settlements"("settlementNo");

CREATE UNIQUE INDEX "outstanding_settlements_requestId_key"
ON "outstanding_settlements"("requestId");

CREATE INDEX "outstanding_settlements_status_idx"
ON "outstanding_settlements"("status");

CREATE INDEX "outstanding_settlements_sourceType_idx"
ON "outstanding_settlements"("sourceType");

CREATE INDEX "outstanding_settlements_createdAt_idx"
ON "outstanding_settlements"("createdAt");

CREATE UNIQUE INDEX "outstanding_settlement_items_settlementId_assetId_key"
ON "outstanding_settlement_items"("settlementId", "assetId");

CREATE INDEX "outstanding_settlement_items_settlementId_idx"
ON "outstanding_settlement_items"("settlementId");

CREATE INDEX "outstanding_settlement_items_assetId_idx"
ON "outstanding_settlement_items"("assetId");

CREATE INDEX "outstanding_settlement_items_internalTransactionId_idx"
ON "outstanding_settlement_items"("internalTransactionId");

CREATE INDEX "outstanding_settlement_items_status_idx"
ON "outstanding_settlement_items"("status");

CREATE INDEX "outstandings_settlementId_idx"
ON "outstandings"("settlementId");

CREATE INDEX "outstandings_settlementItemId_idx"
ON "outstandings"("settlementItemId");

CREATE INDEX "outstandings_closedByInternalFundId_idx"
ON "outstandings"("closedByInternalFundId");
