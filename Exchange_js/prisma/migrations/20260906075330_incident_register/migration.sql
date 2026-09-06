-- AlterTable
ALTER TABLE "reconciliation_dispositions" ADD COLUMN "incidentNo" TEXT;

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceCaseNo" TEXT,
    "sourceDispositionNo" TEXT,
    "sourceExternalLineId" TEXT,
    "sourceAdvanceTransferNo" TEXT,
    "walletRef" TEXT,
    "customerId" TEXT,
    "customerNo" TEXT,
    "assetCode" TEXT,
    "amount" DECIMAL,
    "assessedAmount" DECIMAL,
    "assessmentBasis" TEXT,
    "reportRequired" BOOLEAN NOT NULL DEFAULT false,
    "reportBasisCodes" TEXT,
    "reportDeadlineAt" DATETIME,
    "reportDraft" TEXT,
    "reportDraftedAt" DATETIME,
    "reportedAt" DATETIME,
    "reportedByUserId" TEXT,
    "reportReference" TEXT,
    "approvalNo" TEXT,
    "registeredByUserId" TEXT NOT NULL,
    "closedAt" DATETIME,
    "withdrawnReason" TEXT,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "incident_notes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "escalatedTo" TEXT,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_notes_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "incident_remediations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "linkedByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "incident_remediations_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "incidents_incidentNo_key" ON "incidents"("incidentNo");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_sourceCaseNo_idx" ON "incidents"("sourceCaseNo");

-- CreateIndex
CREATE INDEX "incident_notes_incidentId_idx" ON "incident_notes"("incidentId");

-- CreateIndex
CREATE INDEX "incident_remediations_incidentId_idx" ON "incident_remediations"("incidentId");
