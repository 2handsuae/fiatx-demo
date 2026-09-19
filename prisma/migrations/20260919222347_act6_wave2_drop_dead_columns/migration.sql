/*
  Warnings:

  - You are about to drop the column `raw_ref` on the `external_balances` table. All the data in the column will be lost.
  - You are about to drop the column `statement_id` on the `external_balances` table. All the data in the column will be lost.
  - You are about to drop the column `statement_id` on the `external_statement_lines` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the column `sourceExternalLineId` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the column `walletRef` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the column `reimbursementObligationId` on the `reconciliation_cases` table. All the data in the column will be lost.
  - You are about to drop the column `externalSource` on the `reconciliation_line_items` table. All the data in the column will be lost.
  - You are about to drop the column `externalTxHash` on the `reconciliation_line_items` table. All the data in the column will be lost.
  - You are about to drop the column `internalTxHash` on the `reconciliation_line_items` table. All the data in the column will be lost.
  - You are about to drop the column `resolutionMemo` on the `reconciliation_line_items` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_external_balances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "cutoff_date" TEXT NOT NULL,
    "closing_balance" DECIMAL NOT NULL,
    "opening_balance" DECIMAL,
    "as_of_at" DATETIME,
    "line_count" INTEGER,
    "ingested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,
    "walletRef" TEXT,
    "coaCode" TEXT,
    "ownerNo" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_external_balances" ("account_ref", "as_of_at", "book", "closing_balance", "coaCode", "created_at", "currency", "cutoff_date", "id", "ingested_at", "line_count", "opening_balance", "ownerNo", "source", "status", "updated_at", "walletRef") SELECT "account_ref", "as_of_at", "book", "closing_balance", "coaCode", "created_at", "currency", "cutoff_date", "id", "ingested_at", "line_count", "opening_balance", "ownerNo", "source", "status", "updated_at", "walletRef" FROM "external_balances";
DROP TABLE "external_balances";
ALTER TABLE "new_external_balances" RENAME TO "external_balances";
CREATE INDEX "external_balances_cutoff_date_idx" ON "external_balances"("cutoff_date");
CREATE INDEX "external_balances_source_book_currency_idx" ON "external_balances"("source", "book", "currency");
CREATE INDEX "external_balances_walletRef_idx" ON "external_balances"("walletRef");
CREATE UNIQUE INDEX "external_balances_source_account_ref_cutoff_date_key" ON "external_balances"("source", "account_ref", "cutoff_date");
CREATE TABLE "new_external_statement_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "sub_account" TEXT,
    "book" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "external_ref" TEXT,
    "channel_ref" TEXT,
    "datetime" DATETIME NOT NULL,
    "balance_after" DECIMAL,
    "description" TEXT,
    "raw" TEXT,
    "ingested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedup_key" TEXT NOT NULL
);
INSERT INTO "new_external_statement_lines" ("account_ref", "amount", "balance_after", "book", "channel_ref", "currency", "datetime", "dedup_key", "description", "direction", "external_ref", "id", "ingested_at", "raw", "source", "sub_account") SELECT "account_ref", "amount", "balance_after", "book", "channel_ref", "currency", "datetime", "dedup_key", "description", "direction", "external_ref", "id", "ingested_at", "raw", "source", "sub_account" FROM "external_statement_lines";
DROP TABLE "external_statement_lines";
ALTER TABLE "new_external_statement_lines" RENAME TO "external_statement_lines";
CREATE INDEX "external_statement_lines_source_account_ref_idx" ON "external_statement_lines"("source", "account_ref");
CREATE INDEX "external_statement_lines_datetime_idx" ON "external_statement_lines"("datetime");
CREATE INDEX "external_statement_lines_external_ref_idx" ON "external_statement_lines"("external_ref");
CREATE INDEX "external_statement_lines_channel_ref_idx" ON "external_statement_lines"("channel_ref");
CREATE INDEX "external_statement_lines_sub_account_idx" ON "external_statement_lines"("sub_account");
CREATE UNIQUE INDEX "external_statement_lines_dedup_key_key" ON "external_statement_lines"("dedup_key");
CREATE TABLE "new_incidents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceCaseNo" TEXT,
    "sourceDispositionNo" TEXT,
    "sourceAdvanceTransferNo" TEXT,
    "customerNo" TEXT,
    "assetCode" TEXT,
    "amount" DECIMAL,
    "assessedAmount" DECIMAL,
    "assessmentBasis" TEXT,
    "reportRequired" BOOLEAN NOT NULL DEFAULT false,
    "reportBasisCodes" TEXT,
    "reportDeadlineAt" DATETIME,
    "reportDraft" TEXT,
    "reportDraftedAt" DATETIME,
    "reportedAt" DATETIME,
    "reportedByUserId" TEXT,
    "reportReference" TEXT,
    "approvalNo" TEXT,
    "registeredByUserId" TEXT NOT NULL,
    "closedAt" DATETIME,
    "withdrawnReason" TEXT,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_incidents" ("amount", "approvalNo", "assessedAmount", "assessmentBasis", "assetCode", "closedAt", "createdAt", "customerNo", "description", "id", "incidentNo", "registeredByUserId", "reportBasisCodes", "reportDeadlineAt", "reportDraft", "reportDraftedAt", "reportReference", "reportRequired", "reportedAt", "reportedByUserId", "sourceAdvanceTransferNo", "sourceCaseNo", "sourceDispositionNo", "status", "title", "traceId", "type", "updatedAt", "withdrawnReason") SELECT "amount", "approvalNo", "assessedAmount", "assessmentBasis", "assetCode", "closedAt", "createdAt", "customerNo", "description", "id", "incidentNo", "registeredByUserId", "reportBasisCodes", "reportDeadlineAt", "reportDraft", "reportDraftedAt", "reportReference", "reportRequired", "reportedAt", "reportedByUserId", "sourceAdvanceTransferNo", "sourceCaseNo", "sourceDispositionNo", "status", "title", "traceId", "type", "updatedAt", "withdrawnReason" FROM "incidents";
DROP TABLE "incidents";
ALTER TABLE "new_incidents" RENAME TO "incidents";
CREATE UNIQUE INDEX "incidents_incidentNo_key" ON "incidents"("incidentNo");
CREATE INDEX "incidents_status_idx" ON "incidents"("status");
CREATE INDEX "incidents_sourceCaseNo_idx" ON "incidents"("sourceCaseNo");
CREATE TABLE "new_reconciliation_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
    "businessDate" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "book" TEXT,
    "tbAmount" DECIMAL NOT NULL DEFAULT 0,
    "inTransitAmount" DECIMAL NOT NULL DEFAULT 0,
    "expectedExternal" DECIMAL NOT NULL DEFAULT 0,
    "actualExternal" DECIMAL NOT NULL DEFAULT 0,
    "deltaAmount" DECIMAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedByRunId" TEXT NOT NULL,
    "closedByRunId" TEXT,
    "lastObservedRunId" TEXT,
    "slaDeadline" DATETIME,
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "traceId" TEXT,
    "walletRef" TEXT,
    "coaCode" TEXT,
    "ownerNo" TEXT,
    "firstSeenRunId" TEXT,
    "lastUpdatedRunId" TEXT,
    "resolvedAt" DATETIME,
    "resolutionReason" TEXT,
    "severity" TEXT,
    "bucket" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reconciliation_cases_openedByRunId_fkey" FOREIGN KEY ("openedByRunId") REFERENCES "reconciliation_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reconciliation_cases_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_reconciliation_cases" ("actualExternal", "assetCode", "assetId", "book", "bucket", "businessDate", "caseNo", "closedByRunId", "coaCode", "createdAt", "deltaAmount", "expectedExternal", "firstSeenRunId", "id", "inTransitAmount", "lastObservedRunId", "lastUpdatedRunId", "layer", "openedByRunId", "ownerNo", "resolutionReason", "resolvedAt", "severity", "slaBreached", "slaDeadline", "status", "tbAmount", "traceId", "updatedAt", "walletRef") SELECT "actualExternal", "assetCode", "assetId", "book", "bucket", "businessDate", "caseNo", "closedByRunId", "coaCode", "createdAt", "deltaAmount", "expectedExternal", "firstSeenRunId", "id", "inTransitAmount", "lastObservedRunId", "lastUpdatedRunId", "layer", "openedByRunId", "ownerNo", "resolutionReason", "resolvedAt", "severity", "slaBreached", "slaDeadline", "status", "tbAmount", "traceId", "updatedAt", "walletRef" FROM "reconciliation_cases";
DROP TABLE "reconciliation_cases";
ALTER TABLE "new_reconciliation_cases" RENAME TO "reconciliation_cases";
CREATE UNIQUE INDEX "reconciliation_cases_caseNo_key" ON "reconciliation_cases"("caseNo");
CREATE INDEX "reconciliation_cases_businessDate_assetId_book_idx" ON "reconciliation_cases"("businessDate", "assetId", "book");
CREATE INDEX "reconciliation_cases_status_idx" ON "reconciliation_cases"("status");
CREATE INDEX "reconciliation_cases_walletRef_idx" ON "reconciliation_cases"("walletRef");
CREATE INDEX "reconciliation_cases_walletRef_businessDate_status_idx" ON "reconciliation_cases"("walletRef", "businessDate", "status");
CREATE TABLE "new_reconciliation_line_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "foundByRunId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "matchStatus" TEXT NOT NULL,
    "internalSourceType" TEXT,
    "internalSourceId" TEXT,
    "internalSourceNo" TEXT,
    "internalAmount" DECIMAL,
    "internalDirection" TEXT,
    "externalTxId" TEXT,
    "externalAmount" DECIMAL,
    "externalDirection" TEXT,
    "externalTimestamp" DATETIME,
    "externalRef" TEXT,
    "walletRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_line_items_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "reconciliation_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reconciliation_line_items_foundByRunId_fkey" FOREIGN KEY ("foundByRunId") REFERENCES "reconciliation_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_reconciliation_line_items" ("caseId", "createdAt", "externalAmount", "externalDirection", "externalRef", "externalTimestamp", "externalTxId", "foundByRunId", "id", "internalAmount", "internalDirection", "internalSourceId", "internalSourceNo", "internalSourceType", "lineNo", "matchStatus", "resolution", "status", "walletRef") SELECT "caseId", "createdAt", "externalAmount", "externalDirection", "externalRef", "externalTimestamp", "externalTxId", "foundByRunId", "id", "internalAmount", "internalDirection", "internalSourceId", "internalSourceNo", "internalSourceType", "lineNo", "matchStatus", "resolution", "status", "walletRef" FROM "reconciliation_line_items";
DROP TABLE "reconciliation_line_items";
ALTER TABLE "new_reconciliation_line_items" RENAME TO "reconciliation_line_items";
CREATE INDEX "reconciliation_line_items_caseId_idx" ON "reconciliation_line_items"("caseId");
CREATE INDEX "reconciliation_line_items_externalRef_idx" ON "reconciliation_line_items"("externalRef");
CREATE INDEX "reconciliation_line_items_walletRef_idx" ON "reconciliation_line_items"("walletRef");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
