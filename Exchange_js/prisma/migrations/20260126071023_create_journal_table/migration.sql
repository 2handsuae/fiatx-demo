-- CreateTable
CREATE TABLE "journals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "postingStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "postedAt" DATETIME,
    "baseAssetId" TEXT NOT NULL,
    "reversalOfJournalId" TEXT,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "journals_baseAssetId_fkey" FOREIGN KEY ("baseAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "journals_sourceType_sourceId_idx" ON "journals"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journals_eventCode_idx" ON "journals"("eventCode");

-- CreateIndex
CREATE INDEX "journals_postingStatus_idx" ON "journals"("postingStatus");

-- CreateIndex
CREATE INDEX "journals_baseAssetId_idx" ON "journals"("baseAssetId");

-- CreateIndex
CREATE INDEX "journals_createdAt_idx" ON "journals"("createdAt");
