-- CreateTable
CREATE TABLE "journal_line_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "drCr" TEXT NOT NULL,
    "amountSource" TEXT NOT NULL,
    "assetSource" TEXT NOT NULL,
    "bucketRuleJson" TEXT NOT NULL DEFAULT '{}',
    "conditionExpr" TEXT,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_line_templates_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "journal_header_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "journal_line_templates_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "chart_of_accounts" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_line_templates_templateId_lineNo_key" ON "journal_line_templates"("templateId", "lineNo");
