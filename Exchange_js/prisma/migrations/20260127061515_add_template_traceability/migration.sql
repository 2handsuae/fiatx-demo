-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_journal_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "drCr" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "baseAmount" DECIMAL,
    "fxRate" DECIMAL,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "dimensions" TEXT NOT NULL DEFAULT '{}',
    "description" TEXT,
    "referenceId" TEXT,
    "journalLineTemplateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_lines_journalLineTemplateId_fkey" FOREIGN KEY ("journalLineTemplateId") REFERENCES "journal_line_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "chart_of_accounts" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_journal_lines" ("accountCode", "amount", "assetId", "baseAmount", "createdAt", "description", "dimensions", "drCr", "fxRate", "id", "journalId", "lineNo", "ownerId", "ownerType", "referenceId") SELECT "accountCode", "amount", "assetId", "baseAmount", "createdAt", "description", "dimensions", "drCr", "fxRate", "id", "journalId", "lineNo", "ownerId", "ownerType", "referenceId" FROM "journal_lines";
DROP TABLE "journal_lines";
ALTER TABLE "new_journal_lines" RENAME TO "journal_lines";
CREATE INDEX "journal_lines_journalId_idx" ON "journal_lines"("journalId");
CREATE INDEX "journal_lines_accountCode_idx" ON "journal_lines"("accountCode");
CREATE INDEX "journal_lines_assetId_idx" ON "journal_lines"("assetId");
CREATE INDEX "journal_lines_ownerType_ownerId_idx" ON "journal_lines"("ownerType", "ownerId");
CREATE INDEX "journal_lines_accountCode_ownerType_ownerId_idx" ON "journal_lines"("accountCode", "ownerType", "ownerId");
CREATE INDEX "journal_lines_journalLineTemplateId_idx" ON "journal_lines"("journalLineTemplateId");
CREATE UNIQUE INDEX "journal_lines_journalId_lineNo_key" ON "journal_lines"("journalId", "lineNo");
CREATE TABLE "new_journals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "postingStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "postedAt" DATETIME,
    "baseAssetId" TEXT NOT NULL,
    "reversalOfJournalId" TEXT,
    "description" TEXT,
    "totalAmount" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "journalHeaderTemplateId" TEXT,
    CONSTRAINT "journals_baseAssetId_fkey" FOREIGN KEY ("baseAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journals_journalHeaderTemplateId_fkey" FOREIGN KEY ("journalHeaderTemplateId") REFERENCES "journal_header_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_journals" ("baseAssetId", "createdAt", "description", "eventCode", "id", "postedAt", "postingStatus", "reversalOfJournalId", "sourceId", "sourceType", "totalAmount", "updatedAt") SELECT "baseAssetId", "createdAt", "description", "eventCode", "id", "postedAt", "postingStatus", "reversalOfJournalId", "sourceId", "sourceType", "totalAmount", "updatedAt" FROM "journals";
DROP TABLE "journals";
ALTER TABLE "new_journals" RENAME TO "journals";
CREATE INDEX "journals_sourceType_sourceId_idx" ON "journals"("sourceType", "sourceId");
CREATE INDEX "journals_eventCode_idx" ON "journals"("eventCode");
CREATE INDEX "journals_postingStatus_idx" ON "journals"("postingStatus");
CREATE INDEX "journals_baseAssetId_idx" ON "journals"("baseAssetId");
CREATE INDEX "journals_createdAt_idx" ON "journals"("createdAt");
CREATE INDEX "journals_journalHeaderTemplateId_idx" ON "journals"("journalHeaderTemplateId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
