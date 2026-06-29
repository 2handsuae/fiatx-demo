-- DropIndex
DROP INDEX "reconciliation_invariant_checks_runId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "reconciliation_invariant_checks";
PRAGMA foreign_keys=on;

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
    "demoManifest" TEXT
);
INSERT INTO "new_reconciliation_runs" ("businessDate", "closedCount", "completedAt", "createdAt", "demoManifest", "id", "invariantStatus", "layer", "mode", "openedCount", "reObservedCount", "runNo", "seq", "startedAt", "status", "traceId", "triggerType") SELECT "businessDate", "closedCount", "completedAt", "createdAt", "demoManifest", "id", "invariantStatus", "layer", "mode", "openedCount", "reObservedCount", "runNo", "seq", "startedAt", "status", "traceId", "triggerType" FROM "reconciliation_runs";
DROP TABLE "reconciliation_runs";
ALTER TABLE "new_reconciliation_runs" RENAME TO "reconciliation_runs";
CREATE UNIQUE INDEX "reconciliation_runs_runNo_key" ON "reconciliation_runs"("runNo");
CREATE INDEX "reconciliation_runs_businessDate_layer_idx" ON "reconciliation_runs"("businessDate", "layer");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

