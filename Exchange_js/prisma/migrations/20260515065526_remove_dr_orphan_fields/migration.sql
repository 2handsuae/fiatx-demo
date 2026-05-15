/*
  Warnings:

  - You are about to drop the column `deleteReason` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `deleteRequestId` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `deleteReason` on the `audit_evidence_packages` table. All the data in the column will be lost.
  - You are about to drop the column `deleteRequestId` on the `audit_evidence_packages` table. All the data in the column will be lost.
  - You are about to drop the column `deleteReason` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `deleteRequestId` on the `users` table. All the data in the column will be lost.

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
    "deletedBy" TEXT
);
INSERT INTO "new_approval_cases" ("actionType", "allowCancel", "allowRetry", "approvalNo", "checkerRoles", "createdAt", "createdByUserId", "createdByUserNo", "decidedAt", "decisionByRole", "decisionByUserId", "decisionByUserNo", "decisionReason", "deletedAt", "deletedBy", "docRef", "entityRef", "executedAt", "executionStatus", "id", "objectSnapshot", "riskLevel", "selectedCheckerRole", "status", "submittedAt", "timeoutAt", "traceId", "updatedAt", "workflowId", "workflowNo", "workflowType") SELECT "actionType", "allowCancel", "allowRetry", "approvalNo", "checkerRoles", "createdAt", "createdByUserId", "createdByUserNo", "decidedAt", "decisionByRole", "decisionByUserId", "decisionByUserNo", "decisionReason", "deletedAt", "deletedBy", "docRef", "entityRef", "executedAt", "executionStatus", "id", "objectSnapshot", "riskLevel", "selectedCheckerRole", "status", "submittedAt", "timeoutAt", "traceId", "updatedAt", "workflowId", "workflowNo", "workflowType" FROM "approval_cases";
DROP TABLE "approval_cases";
ALTER TABLE "new_approval_cases" RENAME TO "approval_cases";
CREATE UNIQUE INDEX "approval_cases_approvalNo_key" ON "approval_cases"("approvalNo");
CREATE INDEX "approval_cases_actionType_entityRef_status_idx" ON "approval_cases"("actionType", "entityRef", "status");
CREATE INDEX "approval_cases_status_timeoutAt_idx" ON "approval_cases"("status", "timeoutAt");
CREATE INDEX "approval_cases_traceId_createdAt_idx" ON "approval_cases"("traceId", "createdAt");
CREATE INDEX "approval_cases_workflowType_workflowNo_createdAt_idx" ON "approval_cases"("workflowType", "workflowNo", "createdAt");
CREATE INDEX "approval_cases_deletedAt_idx" ON "approval_cases"("deletedAt");
CREATE TABLE "new_audit_evidence_packages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageNo" TEXT NOT NULL DEFAULT 'TEMP',
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "exportedByType" TEXT NOT NULL,
    "exportedById" TEXT NOT NULL,
    "exportedByNo" TEXT,
    "exportedByRole" TEXT,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "exportMode" TEXT NOT NULL DEFAULT 'SELECTION',
    "fileName" TEXT,
    "filterSnapshot" TEXT,
    "selectedEventIdsSnapshot" TEXT,
    "itemCount" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "manifest" TEXT NOT NULL,
    "packageBody" TEXT,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "audit_evidence_packages_approvalCaseId_fkey" FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_audit_evidence_packages" ("approvalCaseId", "approvalCaseNo", "createdAt", "deletedAt", "deletedBy", "digest", "exportMode", "exportedById", "exportedByNo", "exportedByRole", "exportedByType", "fileName", "filterSnapshot", "id", "itemCount", "manifest", "packageBody", "packageNo", "selectedEventIdsSnapshot", "status", "updatedAt") SELECT "approvalCaseId", "approvalCaseNo", "createdAt", "deletedAt", "deletedBy", "digest", "exportMode", "exportedById", "exportedByNo", "exportedByRole", "exportedByType", "fileName", "filterSnapshot", "id", "itemCount", "manifest", "packageBody", "packageNo", "selectedEventIdsSnapshot", "status", "updatedAt" FROM "audit_evidence_packages";
DROP TABLE "audit_evidence_packages";
ALTER TABLE "new_audit_evidence_packages" RENAME TO "audit_evidence_packages";
CREATE UNIQUE INDEX "audit_evidence_packages_packageNo_key" ON "audit_evidence_packages"("packageNo");
CREATE UNIQUE INDEX "audit_evidence_packages_approvalCaseId_key" ON "audit_evidence_packages"("approvalCaseId");
CREATE INDEX "audit_evidence_packages_createdAt_idx" ON "audit_evidence_packages"("createdAt");
CREATE INDEX "audit_evidence_packages_exportedByType_exportedById_idx" ON "audit_evidence_packages"("exportedByType", "exportedById");
CREATE INDEX "audit_evidence_packages_status_createdAt_idx" ON "audit_evidence_packages"("status", "createdAt");
CREATE INDEX "audit_evidence_packages_exportMode_createdAt_idx" ON "audit_evidence_packages"("exportMode", "createdAt");
CREATE INDEX "audit_evidence_packages_approvalCaseId_idx" ON "audit_evidence_packages"("approvalCaseId");
CREATE INDEX "audit_evidence_packages_approvalCaseNo_idx" ON "audit_evidence_packages"("approvalCaseNo");
CREATE INDEX "audit_evidence_packages_deletedAt_idx" ON "audit_evidence_packages"("deletedAt");
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userNo" TEXT NOT NULL DEFAULT 'TEMP',
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "suspendedAt" DATETIME,
    "lastLoginAt" DATETIME,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "firstLoginStatus" TEXT NOT NULL DEFAULT 'PENDING_IDENTITY_CONFIRM',
    "mfaSecret" TEXT,
    "mfaEnabledAt" DATETIME,
    "mfaVerifyFailCount" INTEGER NOT NULL DEFAULT 0,
    "mfaVerifyLockedUntil" DATETIME,
    "securityAckAt" DATETIME,
    "firstLoginTraceId" TEXT
);
INSERT INTO "new_users" ("createdAt", "deletedAt", "deletedBy", "email", "failedLoginAttempts", "firstLoginStatus", "firstLoginTraceId", "id", "lastLoginAt", "lockedUntil", "mfaEnabledAt", "mfaSecret", "mfaVerifyFailCount", "mfaVerifyLockedUntil", "password", "role", "securityAckAt", "status", "suspendedAt", "updatedAt", "userNo") SELECT "createdAt", "deletedAt", "deletedBy", "email", "failedLoginAttempts", "firstLoginStatus", "firstLoginTraceId", "id", "lastLoginAt", "lockedUntil", "mfaEnabledAt", "mfaSecret", "mfaVerifyFailCount", "mfaVerifyLockedUntil", "password", "role", "securityAckAt", "status", "suspendedAt", "updatedAt", "userNo" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_userNo_key" ON "users"("userNo");
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
