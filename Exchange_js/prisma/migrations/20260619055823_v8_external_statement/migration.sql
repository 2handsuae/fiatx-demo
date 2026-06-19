-- CreateTable
CREATE TABLE "reconciliation_external_statements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL,
    "closingBalance" DECIMAL NOT NULL,
    "rawJson" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "reconciliation_external_statements_businessDate_idx" ON "reconciliation_external_statements"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_external_statements_source_businessDate_currency_key" ON "reconciliation_external_statements"("source", "businessDate", "currency");
