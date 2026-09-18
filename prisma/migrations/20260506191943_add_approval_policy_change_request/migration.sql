-- CreateTable
CREATE TABLE "approval_policy_change_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL DEFAULT 'TEMP',
    "targetActionType" TEXT NOT NULL,
    "currentCheckerRoles" TEXT NOT NULL,
    "proposedCheckerRoles" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "executedAt" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_policy_change_requests_requestNo_key" ON "approval_policy_change_requests"("requestNo");

-- CreateIndex
CREATE INDEX "approval_policy_change_requests_targetActionType_status_idx" ON "approval_policy_change_requests"("targetActionType", "status");

-- CreateIndex
CREATE INDEX "approval_policy_change_requests_approvalCaseId_idx" ON "approval_policy_change_requests"("approvalCaseId");

-- CreateIndex
CREATE INDEX "approval_policy_change_requests_status_idx" ON "approval_policy_change_requests"("status");

-- CreateIndex
CREATE INDEX "approval_policy_change_requests_requestedByUserId_idx" ON "approval_policy_change_requests"("requestedByUserId");
