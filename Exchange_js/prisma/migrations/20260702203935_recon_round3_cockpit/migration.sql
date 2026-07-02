-- AlterTable
ALTER TABLE "reconciliation_cases" ADD COLUMN "bucket" TEXT;

-- CreateTable
CREATE TABLE "reconciliation_run_wallets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "walletRef" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "coaCode" TEXT,
    "ownerNo" TEXT,
    "bucket" TEXT NOT NULL,
    "internalTotal" DECIMAL NOT NULL DEFAULT 0,
    "externalClosing" DECIMAL NOT NULL DEFAULT 0,
    "deltaAmount" DECIMAL NOT NULL DEFAULT 0,
    "inTransitAmount" DECIMAL NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "orphanInternal" INTEGER NOT NULL DEFAULT 0,
    "orphanExternal" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "inTransitCount" INTEGER NOT NULL DEFAULT 0,
    "caseNo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reconciliation_run_wallets_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reconciliation_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reconciliation_runs" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "walletCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "inTransitCount" INTEGER NOT NULL DEFAULT 0,
    "softFlagCount" INTEGER NOT NULL DEFAULT 0,
    "breakCount" INTEGER NOT NULL DEFAULT 0,
    "demoManifest" TEXT
);
INSERT INTO "new_reconciliation_runs" ("businessDate", "closedCount", "completedAt", "createdAt", "demoManifest", "id", "invariantStatus", "layer", "mode", "openedCount", "reObservedCount", "runNo", "seq", "startedAt", "status", "traceId", "triggerType") SELECT "businessDate", "closedCount", "completedAt", "createdAt", "demoManifest", "id", "invariantStatus", "layer", "mode", "openedCount", "reObservedCount", "runNo", "seq", "startedAt", "status", "traceId", "triggerType" FROM "reconciliation_runs";
DROP TABLE "reconciliation_runs";
ALTER TABLE "new_reconciliation_runs" RENAME TO "reconciliation_runs";
CREATE UNIQUE INDEX "reconciliation_runs_runNo_key" ON "reconciliation_runs"("runNo");
CREATE INDEX "reconciliation_runs_businessDate_layer_idx" ON "reconciliation_runs"("businessDate", "layer");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "reconciliation_run_wallets_runId_idx" ON "reconciliation_run_wallets"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_run_wallets_runId_walletRef_key" ON "reconciliation_run_wallets"("runId", "walletRef");
