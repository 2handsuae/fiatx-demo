-- CreateTable
CREATE TABLE "admin_role_change_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL DEFAULT 'TEMP',
    "targetUserId" TEXT NOT NULL,
    "currentRoleCodes" TEXT NOT NULL,
    "proposedRoleCodes" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "executedAt" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "admin_role_change_requests_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_role_change_requests_requestNo_key" ON "admin_role_change_requests"("requestNo");

-- CreateIndex
CREATE INDEX "admin_role_change_requests_targetUserId_idx" ON "admin_role_change_requests"("targetUserId");

-- CreateIndex
CREATE INDEX "admin_role_change_requests_approvalCaseId_idx" ON "admin_role_change_requests"("approvalCaseId");

-- CreateIndex
CREATE INDEX "admin_role_change_requests_status_idx" ON "admin_role_change_requests"("status");

-- CreateIndex
CREATE INDEX "admin_role_change_requests_requestedByUserId_idx" ON "admin_role_change_requests"("requestedByUserId");
