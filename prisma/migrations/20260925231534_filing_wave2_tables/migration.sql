-- CreateTable
CREATE TABLE "regulatory_filings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filingNo" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "ccAuthorities" TEXT,
    "basisCode" TEXT,
    "incidentNo" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "receivedAt" DATETIME,
    "deadlineAt" DATETIME,
    "externalRef" TEXT,
    "submittedAt" DATETIME,
    "submittedByUserId" TEXT,
    "overdueMarkedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalNo" TEXT,
    "closedAt" DATETIME,
    "cancelledReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "regulatory_filing_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "externalRef" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "regulatory_filing_entries_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "regulatory_filings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_filings_filingNo_key" ON "regulatory_filings"("filingNo");

-- CreateIndex
CREATE INDEX "regulatory_filings_incidentNo_idx" ON "regulatory_filings"("incidentNo");

-- CreateIndex
CREATE INDEX "regulatory_filings_status_idx" ON "regulatory_filings"("status");

-- CreateIndex
CREATE INDEX "regulatory_filing_entries_filingId_idx" ON "regulatory_filing_entries"("filingId");
