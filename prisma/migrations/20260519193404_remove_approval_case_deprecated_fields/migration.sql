/*
  Warnings:

  - You are about to drop the column `allowRetry` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `checkerRoles` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `decidedAt` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `decisionByRole` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `decisionByUserId` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `decisionByUserNo` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `decisionReason` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `deletedAt` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `deletedBy` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `docRef` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `executedAt` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `executionStatus` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `riskLevel` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `selectedCheckerRole` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `workflowId` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `workflowNo` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `workflowType` on the `approval_cases` table. All the data in the column will be lost.
  - You are about to drop the column `approvalNo` on the `approval_steps` table. All the data in the column will be lost.
  - Made the column `currency` on table `assets` required. This step will fail if there are existing NULL values in that column.

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
    "allowCancel" BOOLEAN NOT NULL DEFAULT true,
    "objectSnapshot" TEXT,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "submittedAt" DATETIME,
    "timeoutAt" DATETIME
);
INSERT INTO "new_approval_cases" ("actionType", "allowCancel", "approvalNo", "createdAt", "createdByUserId", "createdByUserNo", "entityRef", "id", "objectSnapshot", "status", "submittedAt", "timeoutAt", "traceId", "updatedAt") SELECT "actionType", "allowCancel", "approvalNo", "createdAt", "createdByUserId", "createdByUserNo", "entityRef", "id", "objectSnapshot", "status", "submittedAt", "timeoutAt", "traceId", "updatedAt" FROM "approval_cases";
DROP TABLE "approval_cases";
ALTER TABLE "new_approval_cases" RENAME TO "approval_cases";
CREATE UNIQUE INDEX "approval_cases_approvalNo_key" ON "approval_cases"("approvalNo");
CREATE INDEX "approval_cases_actionType_entityRef_status_idx" ON "approval_cases"("actionType", "entityRef", "status");
CREATE INDEX "approval_cases_status_timeoutAt_idx" ON "approval_cases"("status", "timeoutAt");
CREATE INDEX "approval_cases_traceId_createdAt_idx" ON "approval_cases"("traceId", "createdAt");
CREATE TABLE "new_approval_steps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approvalCaseId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "checkerRoleCandidates" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedByUserNo" TEXT,
    "decidedByRole" TEXT,
    "reason" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "approval_steps_approvalCaseId_fkey" FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_approval_steps" ("approvalCaseId", "checkerRoleCandidates", "createdAt", "decidedAt", "decidedByRole", "decidedByUserId", "decidedByUserNo", "id", "reason", "status", "stepNo", "updatedAt") SELECT "approvalCaseId", "checkerRoleCandidates", "createdAt", "decidedAt", "decidedByRole", "decidedByUserId", "decidedByUserNo", "id", "reason", "status", "stepNo", "updatedAt" FROM "approval_steps";
DROP TABLE "approval_steps";
ALTER TABLE "new_approval_steps" RENAME TO "approval_steps";
CREATE INDEX "approval_steps_approvalCaseId_stepNo_idx" ON "approval_steps"("approvalCaseId", "stepNo");
CREATE UNIQUE INDEX "approval_steps_approvalCaseId_stepNo_key" ON "approval_steps"("approvalCaseId", "stepNo");
CREATE TABLE "new_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetNo" TEXT,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "network" TEXT,
    "decimals" INTEGER NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tbLedgerId" INTEGER,
    "contractAddress" TEXT,
    "minDepositAmount" REAL,
    "maxDepositAmount" REAL,
    "minWithdrawAmount" REAL,
    "maxWithdrawAmount" REAL,
    "depositEnabled" BOOLEAN NOT NULL DEFAULT true,
    "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "suspendedAt" DATETIME,
    "suspendReason" TEXT,
    "preSuspendDepositEnabled" BOOLEAN,
    "preSuspendWithdrawalEnabled" BOOLEAN,
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_assets" ("approvalCaseId", "approvalCaseNo", "assetNo", "code", "contractAddress", "createdAt", "currency", "decimals", "depositEnabled", "description", "id", "maxDepositAmount", "maxWithdrawAmount", "minDepositAmount", "minWithdrawAmount", "network", "preSuspendDepositEnabled", "preSuspendWithdrawalEnabled", "status", "suspendReason", "suspendedAt", "tbLedgerId", "type", "updatedAt", "withdrawalEnabled") SELECT "approvalCaseId", "approvalCaseNo", "assetNo", "code", "contractAddress", "createdAt", "currency", "decimals", "depositEnabled", "description", "id", "maxDepositAmount", "maxWithdrawAmount", "minDepositAmount", "minWithdrawAmount", "network", "preSuspendDepositEnabled", "preSuspendWithdrawalEnabled", "status", "suspendReason", "suspendedAt", "tbLedgerId", "type", "updatedAt", "withdrawalEnabled" FROM "assets";
DROP TABLE "assets";
ALTER TABLE "new_assets" RENAME TO "assets";
CREATE UNIQUE INDEX "assets_assetNo_key" ON "assets"("assetNo");
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");
CREATE UNIQUE INDEX "assets_tbLedgerId_key" ON "assets"("tbLedgerId");
CREATE UNIQUE INDEX "assets_type_currency_network_key" ON "assets"("type", "currency", "network");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
