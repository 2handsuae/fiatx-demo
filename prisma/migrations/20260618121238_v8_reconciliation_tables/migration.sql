-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runNo" TEXT NOT NULL DEFAULT 'TEMP',
    "businessDate" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "triggerType" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'APPLY',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "invariantStatus" TEXT NOT NULL DEFAULT 'PASS',
    "openedCount" INTEGER NOT NULL DEFAULT 0,
    "reObservedCount" INTEGER NOT NULL DEFAULT 0,
    "closedCount" INTEGER NOT NULL DEFAULT 0,
    "traceId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "reconciliation_invariant_checks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "invariantCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "lhsLabel" TEXT NOT NULL,
    "lhsValue" DECIMAL NOT NULL,
    "rhsLabel" TEXT NOT NULL,
    "rhsValue" DECIMAL NOT NULL,
    "delta" DECIMAL NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_invariant_checks_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reconciliation_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reconciliation_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
    "businessDate" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
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
    "traceId" TEXT,
    "reimbursementObligationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reconciliation_cases_openedByRunId_fkey" FOREIGN KEY ("openedByRunId") REFERENCES "reconciliation_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reconciliation_cases_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reconciliation_line_items" (
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
    "internalTxHash" TEXT,
    "externalSource" TEXT,
    "externalTxId" TEXT,
    "externalTxHash" TEXT,
    "externalAmount" DECIMAL,
    "externalDirection" TEXT,
    "externalTimestamp" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolutionMemo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_line_items_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "reconciliation_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reconciliation_line_items_foundByRunId_fkey" FOREIGN KEY ("foundByRunId") REFERENCES "reconciliation_runs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_runs_runNo_key" ON "reconciliation_runs"("runNo");

-- CreateIndex
CREATE INDEX "reconciliation_runs_businessDate_layer_idx" ON "reconciliation_runs"("businessDate", "layer");

-- CreateIndex
CREATE INDEX "reconciliation_invariant_checks_runId_idx" ON "reconciliation_invariant_checks"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_cases_caseNo_key" ON "reconciliation_cases"("caseNo");

-- CreateIndex
CREATE INDEX "reconciliation_cases_status_idx" ON "reconciliation_cases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_cases_businessDate_assetId_key" ON "reconciliation_cases"("businessDate", "assetId");

-- CreateIndex
CREATE INDEX "reconciliation_line_items_caseId_idx" ON "reconciliation_line_items"("caseId");
