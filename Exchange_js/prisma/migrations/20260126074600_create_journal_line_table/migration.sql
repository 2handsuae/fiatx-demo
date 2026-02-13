-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "drCr" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "baseAmount" DECIMAL,
    "fxRate" DECIMAL,
    "bucketJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_lines_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "chart_of_accounts" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "journal_lines_journalId_idx" ON "journal_lines"("journalId");

-- CreateIndex
CREATE INDEX "journal_lines_accountCode_idx" ON "journal_lines"("accountCode");

-- CreateIndex
CREATE INDEX "journal_lines_assetId_idx" ON "journal_lines"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journalId_lineNo_key" ON "journal_lines"("journalId", "lineNo");
