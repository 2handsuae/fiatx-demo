/*
  Warnings:

  - Added the required column `updatedAt` to the `tier_upgrade_cases` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tier_upgrade_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceCraId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_LEVEL2',
    "phase2ApprovalCaseId" TEXT,
    "completedAt" DATETIME,
    "rejectedAt" DATETIME,
    "rejectedReason" TEXT,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tier_upgrade_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tier_upgrade_cases_sourceCraId_fkey" FOREIGN KEY ("sourceCraId") REFERENCES "client_risk_assessments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tier_upgrade_cases_phase2ApprovalCaseId_fkey" FOREIGN KEY ("phase2ApprovalCaseId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tier_upgrade_cases" ("caseNo", "completedAt", "createdAt", "customerId", "id", "phase2ApprovalCaseId", "rejectedAt", "sourceCraId", "status", "traceId") SELECT "caseNo", "completedAt", "createdAt", "customerId", "id", "phase2ApprovalCaseId", "rejectedAt", "sourceCraId", "status", "traceId" FROM "tier_upgrade_cases";
DROP TABLE "tier_upgrade_cases";
ALTER TABLE "new_tier_upgrade_cases" RENAME TO "tier_upgrade_cases";
CREATE UNIQUE INDEX "tier_upgrade_cases_caseNo_key" ON "tier_upgrade_cases"("caseNo");
CREATE UNIQUE INDEX "tier_upgrade_cases_sourceCraId_key" ON "tier_upgrade_cases"("sourceCraId");
CREATE UNIQUE INDEX "tier_upgrade_cases_phase2ApprovalCaseId_key" ON "tier_upgrade_cases"("phase2ApprovalCaseId");
CREATE UNIQUE INDEX "tier_upgrade_cases_traceId_key" ON "tier_upgrade_cases"("traceId");
CREATE INDEX "tier_upgrade_cases_customerId_status_idx" ON "tier_upgrade_cases"("customerId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
