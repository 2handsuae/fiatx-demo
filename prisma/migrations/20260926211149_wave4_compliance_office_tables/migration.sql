-- CreateTable
CREATE TABLE "compliance_obligations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "obligationNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "basisNote" TEXT NOT NULL,
    "leadBusinessDays" INTEGER NOT NULL DEFAULT 5,
    "nextDueAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastFilingNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "outsourcing_vendors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceDescription" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "contractStart" DATETIME NOT NULL,
    "contractEnd" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "responsible_individuals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riNo" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "incumbentName" TEXT NOT NULL,
    "varaRef" TEXT,
    "effectiveFrom" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pendingApprovalNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_obligations_obligationNo_key" ON "compliance_obligations"("obligationNo");

-- CreateIndex
CREATE INDEX "compliance_obligations_status_idx" ON "compliance_obligations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "outsourcing_vendors_vendorNo_key" ON "outsourcing_vendors"("vendorNo");

-- CreateIndex
CREATE INDEX "outsourcing_vendors_status_idx" ON "outsourcing_vendors"("status");

-- CreateIndex
CREATE UNIQUE INDEX "responsible_individuals_riNo_key" ON "responsible_individuals"("riNo");
