CREATE TABLE "outstandings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceNo" TEXT,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "assetCode" TEXT,
  "amount" DECIMAL NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "swapTransactionId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "outstandings_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "outstandings_swapTransactionId_fkey"
    FOREIGN KEY ("swapTransactionId") REFERENCES "swap_transactions" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "outstandings_sourceType_sourceId_direction_key"
ON "outstandings"("sourceType", "sourceId", "direction");

CREATE INDEX "outstandings_status_idx"
ON "outstandings"("status");

CREATE INDEX "outstandings_ownerType_ownerId_idx"
ON "outstandings"("ownerType", "ownerId");

CREATE INDEX "outstandings_sourceType_sourceId_idx"
ON "outstandings"("sourceType", "sourceId");

CREATE INDEX "outstandings_createdAt_idx"
ON "outstandings"("createdAt");

CREATE INDEX "outstandings_assetId_idx"
ON "outstandings"("assetId");

CREATE INDEX "outstandings_swapTransactionId_idx"
ON "outstandings"("swapTransactionId");
