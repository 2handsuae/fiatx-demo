-- CreateTable
CREATE TABLE "safeguarding_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runNo" TEXT NOT NULL DEFAULT 'TEMP',
  "businessDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "breakCount" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "traceId" TEXT,
  "summaryJson" TEXT,
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "safeguarding_runs_runNo_key"
  ON "safeguarding_runs"("runNo");
CREATE INDEX "safeguarding_runs_businessDate_createdAt_idx"
  ON "safeguarding_runs"("businessDate", "createdAt");
CREATE INDEX "safeguarding_runs_status_businessDate_idx"
  ON "safeguarding_runs"("status", "businessDate");

-- CreateTable
CREATE TABLE "liability_snapshots" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "customerNo" TEXT,
  "assetId" TEXT NOT NULL,
  "assetCode" TEXT,
  "liabilityAmount" DECIMAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "liability_snapshots_runId_fkey" FOREIGN KEY ("runId") REFERENCES "safeguarding_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "liability_snapshots_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "liability_snapshots_runId_customerId_assetId_key"
  ON "liability_snapshots"("runId", "customerId", "assetId");
CREATE INDEX "liability_snapshots_runId_assetId_idx"
  ON "liability_snapshots"("runId", "assetId");
CREATE INDEX "liability_snapshots_customerId_idx"
  ON "liability_snapshots"("customerId");

-- CreateTable
CREATE TABLE "safeguarding_pool_snapshots" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "assetCode" TEXT,
  "poolRole" TEXT NOT NULL,
  "walletId" TEXT,
  "accountRef" TEXT,
  "sourceType" TEXT,
  "sourceRef" TEXT,
  "balanceAmount" DECIMAL NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "safeguarding_pool_snapshots_runId_fkey" FOREIGN KEY ("runId") REFERENCES "safeguarding_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "safeguarding_pool_snapshots_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "safeguarding_pool_snapshots_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "safeguarding_pool_snapshots_runId_assetId_idx"
  ON "safeguarding_pool_snapshots"("runId", "assetId");
CREATE INDEX "safeguarding_pool_snapshots_assetId_poolRole_idx"
  ON "safeguarding_pool_snapshots"("assetId", "poolRole");
CREATE INDEX "safeguarding_pool_snapshots_walletId_idx"
  ON "safeguarding_pool_snapshots"("walletId");

-- CreateTable
CREATE TABLE "safeguarding_policies" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "policyNo" TEXT NOT NULL DEFAULT 'TEMP',
  "assetId" TEXT NOT NULL,
  "poolRole" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "collectionAmountThreshold" DECIMAL,
  "collectionMaxAgeMinutes" INTEGER,
  "targetMinBalance" DECIMAL,
  "targetMaxBalance" DECIMAL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "safeguarding_policies_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "safeguarding_policies_policyNo_key"
  ON "safeguarding_policies"("policyNo");
CREATE UNIQUE INDEX "safeguarding_policies_assetId_poolRole_key"
  ON "safeguarding_policies"("assetId", "poolRole");
CREATE INDEX "safeguarding_policies_status_poolRole_idx"
  ON "safeguarding_policies"("status", "poolRole");

-- CreateTable
CREATE TABLE "reconciliation_warnings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "warningNo" TEXT NOT NULL DEFAULT 'TEMP',
  "runId" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "assetCode" TEXT,
  "warningType" TEXT NOT NULL,
  "poolRole" TEXT NOT NULL,
  "walletId" TEXT,
  "accountRef" TEXT,
  "observedValue" DECIMAL NOT NULL DEFAULT 0,
  "thresholdValue" DECIMAL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "detailsJson" TEXT,
  "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" DATETIME,
  "resolvedAt" DATETIME,
  "acceptedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "reconciliation_warnings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "safeguarding_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reconciliation_warnings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliation_warnings_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "reconciliation_warnings_warningNo_key"
  ON "reconciliation_warnings"("warningNo");
CREATE INDEX "reconciliation_warnings_runId_status_idx"
  ON "reconciliation_warnings"("runId", "status");
CREATE INDEX "reconciliation_warnings_businessDate_status_idx"
  ON "reconciliation_warnings"("businessDate", "status");
CREATE INDEX "reconciliation_warnings_assetId_poolRole_status_idx"
  ON "reconciliation_warnings"("assetId", "poolRole", "status");

-- CreateTable
CREATE TABLE "fiat_statement_imports" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "importNo" TEXT NOT NULL DEFAULT 'TEMP',
  "runId" TEXT,
  "businessDate" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "closingBalance" DECIMAL,
  "parsedAt" DATETIME,
  "traceId" TEXT,
  "detailsJson" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "fiat_statement_imports_runId_fkey" FOREIGN KEY ("runId") REFERENCES "safeguarding_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fiat_statement_imports_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fiat_statement_imports_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fiat_statement_imports_importNo_key"
  ON "fiat_statement_imports"("importNo");
CREATE INDEX "fiat_statement_imports_businessDate_assetId_walletId_idx"
  ON "fiat_statement_imports"("businessDate", "assetId", "walletId");
CREATE INDEX "fiat_statement_imports_runId_idx"
  ON "fiat_statement_imports"("runId");

-- CreateTable
CREATE TABLE "fiat_statement_entries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "importId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "valueDate" TEXT,
  "referenceNo" TEXT,
  "description" TEXT,
  "amount" DECIMAL NOT NULL DEFAULT 0,
  "balance" DECIMAL,
  "rawRowJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiat_statement_entries_importId_fkey" FOREIGN KEY ("importId") REFERENCES "fiat_statement_imports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fiat_statement_entries_importId_lineNo_key"
  ON "fiat_statement_entries"("importId", "lineNo");
CREATE INDEX "fiat_statement_entries_importId_referenceNo_idx"
  ON "fiat_statement_entries"("importId", "referenceNo");

-- CreateTable
CREATE TABLE "reconciliation_breaks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "breakNo" TEXT NOT NULL DEFAULT 'TEMP',
  "runId" TEXT,
  "businessDate" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL DEFAULT 'WITHDRAW',
  "sourceId" TEXT NOT NULL,
  "sourceNo" TEXT,
  "withdrawId" TEXT,
  "withdrawNo" TEXT,
  "payoutId" TEXT,
  "payoutNo" TEXT,
  "assetId" TEXT NOT NULL,
  "assetCode" TEXT,
  "breakType" TEXT,
  "liabilityAmount" DECIMAL NOT NULL DEFAULT 0,
  "poolAmount" DECIMAL NOT NULL DEFAULT 0,
  "externalAmount" DECIMAL,
  "expectedNetDelta" DECIMAL NOT NULL DEFAULT 0,
  "observedNetDelta" DECIMAL NOT NULL DEFAULT 0,
  "deltaAmount" DECIMAL NOT NULL DEFAULT 0,
  "reasonCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "linkedAlertId" TEXT,
  "linkedCaseId" TEXT,
  "detailsJson" TEXT,
  "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME,
  "reopenedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "reconciliation_breaks_runId_fkey" FOREIGN KEY ("runId") REFERENCES "safeguarding_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "reconciliation_breaks_breakNo_key"
  ON "reconciliation_breaks"("breakNo");
CREATE UNIQUE INDEX "reconciliation_breaks_businessDate_sourceType_sourceId_key"
  ON "reconciliation_breaks"("businessDate", "sourceType", "sourceId");
CREATE INDEX "reconciliation_breaks_businessDate_status_idx"
  ON "reconciliation_breaks"("businessDate", "status");
CREATE INDEX "reconciliation_breaks_runId_idx"
  ON "reconciliation_breaks"("runId");
CREATE INDEX "reconciliation_breaks_sourceType_sourceId_idx"
  ON "reconciliation_breaks"("sourceType", "sourceId");
CREATE INDEX "reconciliation_breaks_withdrawId_idx"
  ON "reconciliation_breaks"("withdrawId");
CREATE INDEX "reconciliation_breaks_payoutId_idx"
  ON "reconciliation_breaks"("payoutId");
CREATE INDEX "reconciliation_breaks_linkedAlertId_idx"
  ON "reconciliation_breaks"("linkedAlertId");
CREATE INDEX "reconciliation_breaks_linkedCaseId_idx"
  ON "reconciliation_breaks"("linkedCaseId");
