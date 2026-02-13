-- CreateTable
CREATE TABLE "acct_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventCode" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "ownerScope" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "postingMode" TEXT NOT NULL,
    "clearingMode" TEXT NOT NULL,
    "postingReversalOfEventCode" TEXT,
    "clearingReversalOfEventCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "acct_events_postingReversalOfEventCode_fkey" FOREIGN KEY ("postingReversalOfEventCode") REFERENCES "acct_events" ("eventCode") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "acct_events_clearingReversalOfEventCode_fkey" FOREIGN KEY ("clearingReversalOfEventCode") REFERENCES "acct_events" ("eventCode") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "acct_events_eventCode_key" ON "acct_events"("eventCode");
