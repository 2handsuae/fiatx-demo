-- CreateTable
CREATE TABLE "journal_header_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateCode" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "baseAssetId" TEXT NOT NULL,
    "description" TEXT,
    "effectiveFrom" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "journal_header_templates_eventCode_fkey" FOREIGN KEY ("eventCode") REFERENCES "acct_events" ("eventCode") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_header_templates_baseAssetId_fkey" FOREIGN KEY ("baseAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_header_templates_templateCode_key" ON "journal_header_templates"("templateCode");
