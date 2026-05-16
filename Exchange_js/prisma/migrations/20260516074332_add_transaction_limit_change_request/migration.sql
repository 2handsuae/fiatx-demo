-- CreateTable
CREATE TABLE "transaction_limit_change_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL DEFAULT 'TEMP',
    "policyId" TEXT NOT NULL,
    "policyNo" TEXT NOT NULL,
    "currentAmount" DECIMAL NOT NULL,
    "proposedAmount" DECIMAL NOT NULL,
    "changeReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedByUserId" TEXT NOT NULL,
    "approvalCaseId" TEXT,
    "approvalCaseNo" TEXT,
    "executedAt" DATETIME,
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_limit_change_requests_requestNo_key" ON "transaction_limit_change_requests"("requestNo");

-- CreateIndex
CREATE INDEX "transaction_limit_change_requests_policyId_status_idx" ON "transaction_limit_change_requests"("policyId", "status");
