-- CreateTable
CREATE TABLE "complaints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complaintNo" TEXT NOT NULL,
    "ownerCustomerNo" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "relatedOrderNo" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currentStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackDeadlineAt" DATETIME NOT NULL,
    "acknowledgedAt" DATETIME,
    "resolveDeadlineAt" DATETIME NOT NULL,
    "extendedAt" DATETIME,
    "resolvedAt" DATETIME,
    "resolutionOutcome" TEXT,
    "resolutionText" TEXT,
    "escalatedIncidentNo" TEXT,
    "pendingApprovalNo" TEXT,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "complaint_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "complaintNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "messageType" TEXT,
    "body" TEXT NOT NULL,
    "actorNo" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "complaints_complaintNo_key" ON "complaints"("complaintNo");

-- CreateIndex
CREATE INDEX "complaints_currentStatus_idx" ON "complaints"("currentStatus");

-- CreateIndex
CREATE INDEX "complaints_ownerCustomerNo_idx" ON "complaints"("ownerCustomerNo");

-- CreateIndex
CREATE INDEX "complaint_entries_complaintNo_idx" ON "complaint_entries"("complaintNo");
