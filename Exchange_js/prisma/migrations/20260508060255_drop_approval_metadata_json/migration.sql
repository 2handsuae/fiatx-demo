/*
  Warnings:

  - You are about to drop the column `metadataJson` on the `approval_cases` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_approval_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvalNo" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "entityRef" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByUserNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "executionStatus" TEXT NOT NULL DEFAULT 'NOT_EXECUTED',
    "riskLevel" TEXT NOT NULL DEFAULT 'HIGH',
    "checkerRoles" TEXT NOT NULL,
    "selectedCheckerRole" TEXT NOT NULL,
    "allowCancel" BOOLEAN NOT NULL DEFAULT true,
    "allowRetry" BOOLEAN NOT NULL DEFAULT true,
    "docRef" TEXT,
    "objectSnapshot" TEXT,
    "traceId" TEXT NOT NULL,
    "workflowType" TEXT,
    "workflowId" TEXT,
    "workflowNo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    "timeoutAt" DATETIME,
    "decidedAt" DATETIME,
    "executedAt" DATETIME,
    "decisionByUserId" TEXT,
    "decisionByUserNo" TEXT,
    "decisionByRole" TEXT,
    "decisionReason" TEXT,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "deleteRequestId" TEXT,
    "deleteReason" TEXT
);
INSERT INTO "new_approval_cases" ("actionType", "allowCancel", "allowRetry", "approvalNo", "checkerRoles", "createdAt", "createdByUserId", "createdByUserNo", "decidedAt", "decisionByRole", "decisionByUserId", "decisionByUserNo", "decisionReason", "deleteReason", "deleteRequestId", "deletedAt", "deletedBy", "docRef", "entityRef", "executedAt", "executionStatus", "id", "objectSnapshot", "riskLevel", "selectedCheckerRole", "status", "submittedAt", "timeoutAt", "traceId", "updatedAt", "workflowId", "workflowNo", "workflowType") SELECT "actionType", "allowCancel", "allowRetry", "approvalNo", "checkerRoles", "createdAt", "createdByUserId", "createdByUserNo", "decidedAt", "decisionByRole", "decisionByUserId", "decisionByUserNo", "decisionReason", "deleteReason", "deleteRequestId", "deletedAt", "deletedBy", "docRef", "entityRef", "executedAt", "executionStatus", "id", "objectSnapshot", "riskLevel", "selectedCheckerRole", "status", "submittedAt", "timeoutAt", "traceId", "updatedAt", "workflowId", "workflowNo", "workflowType" FROM "approval_cases";
DROP TABLE "approval_cases";
ALTER TABLE "new_approval_cases" RENAME TO "approval_cases";
CREATE UNIQUE INDEX "approval_cases_approvalNo_key" ON "approval_cases"("approvalNo");
CREATE INDEX "approval_cases_actionType_entityRef_status_idx" ON "approval_cases"("actionType", "entityRef", "status");
CREATE INDEX "approval_cases_status_timeoutAt_idx" ON "approval_cases"("status", "timeoutAt");
CREATE INDEX "approval_cases_traceId_createdAt_idx" ON "approval_cases"("traceId", "createdAt");
CREATE INDEX "approval_cases_workflowType_workflowNo_createdAt_idx" ON "approval_cases"("workflowType", "workflowNo", "createdAt");
CREATE INDEX "approval_cases_deletedAt_idx" ON "approval_cases"("deletedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
