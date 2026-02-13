/*
  Warnings:

  - You are about to drop the column `bucketRuleJson` on the `journal_line_templates` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_journal_line_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "drCr" TEXT NOT NULL,
    "amountSource" TEXT NOT NULL,
    "assetSource" TEXT NOT NULL,
    "ownerTypeSource" TEXT,
    "ownerIdSource" TEXT,
    "fxRateSource" TEXT,
    "referenceSource" TEXT,
    "dimensionsRule" TEXT NOT NULL DEFAULT '{}',
    "conditionExpr" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_line_templates_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "journal_header_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "journal_line_templates_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "chart_of_accounts" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_journal_line_templates" ("accountCode", "amountSource", "assetSource", "conditionExpr", "createdAt", "description", "drCr", "fxRateSource", "id", "lineNo", "ownerIdSource", "ownerTypeSource", "referenceSource", "templateId") SELECT "accountCode", "amountSource", "assetSource", "conditionExpr", "createdAt", "description", "drCr", "fxRateSource", "id", "lineNo", "ownerIdSource", "ownerTypeSource", "referenceSource", "templateId" FROM "journal_line_templates";
DROP TABLE "journal_line_templates";
ALTER TABLE "new_journal_line_templates" RENAME TO "journal_line_templates";
CREATE UNIQUE INDEX "journal_line_templates_templateId_lineNo_key" ON "journal_line_templates"("templateId", "lineNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
