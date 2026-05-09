-- CreateTable
CREATE TABLE "role_definition_modify_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL DEFAULT 'TEMP',
    "roleId" TEXT NOT NULL,
    "currentName" TEXT NOT NULL,
    "currentDescription" TEXT,
    "currentPermissionGroups" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "proposedDescription" TEXT,
    "proposedPermissionGroups" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "executedAt" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "role_definition_modify_requests_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "role_definition_modify_requests_requestNo_key" ON "role_definition_modify_requests"("requestNo");

-- CreateIndex
CREATE INDEX "role_definition_modify_requests_roleId_status_idx" ON "role_definition_modify_requests"("roleId", "status");
