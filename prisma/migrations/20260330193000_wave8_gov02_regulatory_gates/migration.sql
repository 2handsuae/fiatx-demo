-- CreateTable
CREATE TABLE "regulatory_gate_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateNo" TEXT NOT NULL DEFAULT 'TEMP',
    "gateType" TEXT NOT NULL,
    "authority" TEXT NOT NULL DEFAULT 'VARA',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectNo" TEXT NOT NULL,
    "scopeSummary" TEXT,
    "shareholdingRegistryVersionId" TEXT,
    "appointmentRecordId" TEXT,
    "linkedApprovalId" TEXT,
    "internalApprovalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "filingStatus" TEXT NOT NULL DEFAULT 'REQUIRED',
    "receiptStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "effectivenessStatus" TEXT NOT NULL DEFAULT 'BLOCKED',
    "gateResult" TEXT NOT NULL DEFAULT 'BLOCKED',
    "filingRefNo" TEXT,
    "filingSubmittedAt" DATETIME,
    "latestFeedback" TEXT,
    "latestFeedbackAt" DATETIME,
    "receiptType" TEXT,
    "receiptRefNo" TEXT,
    "receiptBoundAt" DATETIME,
    "proposedEffectiveAt" DATETIME,
    "effectiveAt" DATETIME,
    "revokedAt" DATETIME,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "activeKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "regulatory_gate_items_shareholdingRegistryVersionId_fkey" FOREIGN KEY ("shareholdingRegistryVersionId") REFERENCES "shareholding_registry_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_appointmentRecordId_fkey" FOREIGN KEY ("appointmentRecordId") REFERENCES "appointment_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_linkedApprovalId_fkey" FOREIGN KEY ("linkedApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_gate_items_gateNo_key" ON "regulatory_gate_items"("gateNo");

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_gate_items_activeKey_key" ON "regulatory_gate_items"("activeKey");

-- CreateIndex
CREATE INDEX "regulatory_gate_items_gateType_createdAt_idx" ON "regulatory_gate_items"("gateType", "createdAt");

-- CreateIndex
CREATE INDEX "regulatory_gate_items_subjectType_subjectId_createdAt_idx" ON "regulatory_gate_items"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "regulatory_gate_items_subjectType_subjectNo_createdAt_idx" ON "regulatory_gate_items"("subjectType", "subjectNo", "createdAt");

-- CreateIndex
CREATE INDEX "regulatory_gate_items_gateResult_createdAt_idx" ON "regulatory_gate_items"("gateResult", "createdAt");

-- CreateIndex
CREATE INDEX "regulatory_gate_items_filingStatus_receiptStatus_effectivenessStatus_idx" ON "regulatory_gate_items"("filingStatus", "receiptStatus", "effectivenessStatus");

-- CreateIndex
CREATE INDEX "regulatory_gate_items_traceId_createdAt_idx" ON "regulatory_gate_items"("traceId", "createdAt");
