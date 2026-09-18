-- CreateTable
CREATE TABLE "external_balances" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "cutoff_date" TEXT NOT NULL,
    "closing_balance" DECIMAL NOT NULL,
    "opening_balance" DECIMAL,
    "as_of_at" DATETIME,
    "statement_id" TEXT,
    "line_count" INTEGER,
    "ingested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT,
    "raw_ref" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "external_statement_lines" (
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
    "statement_id" TEXT,
    "raw" TEXT,
    "ingested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedup_key" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "external_balances_cutoff_date_idx" ON "external_balances"("cutoff_date");

-- CreateIndex
CREATE INDEX "external_balances_source_book_currency_idx" ON "external_balances"("source", "book", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "external_balances_source_account_ref_cutoff_date_key" ON "external_balances"("source", "account_ref", "cutoff_date");

-- CreateIndex
CREATE INDEX "external_statement_lines_source_account_ref_idx" ON "external_statement_lines"("source", "account_ref");

-- CreateIndex
CREATE INDEX "external_statement_lines_datetime_idx" ON "external_statement_lines"("datetime");

-- CreateIndex
CREATE INDEX "external_statement_lines_external_ref_idx" ON "external_statement_lines"("external_ref");

-- CreateIndex
CREATE INDEX "external_statement_lines_channel_ref_idx" ON "external_statement_lines"("channel_ref");

-- CreateIndex
CREATE INDEX "external_statement_lines_sub_account_idx" ON "external_statement_lines"("sub_account");

-- CreateIndex
CREATE UNIQUE INDEX "external_statement_lines_dedup_key_key" ON "external_statement_lines"("dedup_key");
