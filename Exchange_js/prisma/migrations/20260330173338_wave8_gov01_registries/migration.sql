-- CreateTable
CREATE TABLE "shareholding_registry_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "registryNo" TEXT NOT NULL DEFAULT 'TEMP',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "versionLabel" TEXT,
    "effectiveFrom" DATETIME,
    "effectiveTo" DATETIME,
    "supersededById" TEXT,
    "latestApprovalId" TEXT,
    "latestApprovalStatus" TEXT,
    "docRef" TEXT,
    "evidenceRef" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "shareholding_registry_participants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "participantType" TEXT NOT NULL,
    "participantName" TEXT NOT NULL,
    "ownershipPercent" DECIMAL,
    "controlSummary" TEXT,
    "evidenceRef" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "shareholding_registry_participants_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "shareholding_registry_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "appointment_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appointmentNo" TEXT NOT NULL DEFAULT 'TEMP',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "roleType" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "regulatedFlag" BOOLEAN NOT NULL DEFAULT false,
    "proposedEffectiveAt" DATETIME,
    "effectiveAt" DATETIME,
    "endedAt" DATETIME,
    "latestApprovalId" TEXT,
    "latestApprovalStatus" TEXT,
    "docRef" TEXT,
    "evidenceRef" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "training_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainingNo" TEXT NOT NULL DEFAULT 'TEMP',
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "assignee" TEXT NOT NULL,
    "trainingType" TEXT NOT NULL,
    "dueAt" DATETIME,
    "completedAt" DATETIME,
    "waiverReason" TEXT,
    "evidenceRef" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "conflict_disclosures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "disclosureNo" TEXT NOT NULL DEFAULT 'TEMP',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "disclosureType" TEXT NOT NULL,
    "disclosedByName" TEXT NOT NULL,
    "disclosedAt" DATETIME NOT NULL,
    "reviewDueAt" DATETIME,
    "mitigationSummary" TEXT,
    "closedAt" DATETIME,
    "evidenceRef" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "wind_down_material_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialNo" TEXT NOT NULL DEFAULT 'TEMP',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "materialType" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "effectiveAt" DATETIME,
    "reviewDueAt" DATETIME,
    "supersededAt" DATETIME,
    "supersededById" TEXT,
    "evidenceRef" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "shareholding_registry_versions_registryNo_key" ON "shareholding_registry_versions"("registryNo");

-- CreateIndex
CREATE INDEX "shareholding_registry_versions_status_createdAt_idx" ON "shareholding_registry_versions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "shareholding_registry_versions_registryNo_createdAt_idx" ON "shareholding_registry_versions"("registryNo", "createdAt");

-- CreateIndex
CREATE INDEX "shareholding_registry_versions_traceId_createdAt_idx" ON "shareholding_registry_versions"("traceId", "createdAt");

-- CreateIndex
CREATE INDEX "shareholding_registry_versions_latestApprovalStatus_createdAt_idx" ON "shareholding_registry_versions"("latestApprovalStatus", "createdAt");

-- CreateIndex
CREATE INDEX "shareholding_registry_participants_versionId_sortOrder_idx" ON "shareholding_registry_participants"("versionId", "sortOrder");

-- CreateIndex
CREATE INDEX "shareholding_registry_participants_participantType_createdAt_idx" ON "shareholding_registry_participants"("participantType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_records_appointmentNo_key" ON "appointment_records"("appointmentNo");

-- CreateIndex
CREATE INDEX "appointment_records_status_createdAt_idx" ON "appointment_records"("status", "createdAt");

-- CreateIndex
CREATE INDEX "appointment_records_appointmentNo_createdAt_idx" ON "appointment_records"("appointmentNo", "createdAt");

-- CreateIndex
CREATE INDEX "appointment_records_traceId_createdAt_idx" ON "appointment_records"("traceId", "createdAt");

-- CreateIndex
CREATE INDEX "appointment_records_latestApprovalStatus_createdAt_idx" ON "appointment_records"("latestApprovalStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "training_records_trainingNo_key" ON "training_records"("trainingNo");

-- CreateIndex
CREATE INDEX "training_records_status_createdAt_idx" ON "training_records"("status", "createdAt");

-- CreateIndex
CREATE INDEX "training_records_trainingNo_createdAt_idx" ON "training_records"("trainingNo", "createdAt");

-- CreateIndex
CREATE INDEX "training_records_dueAt_status_idx" ON "training_records"("dueAt", "status");

-- CreateIndex
CREATE INDEX "training_records_traceId_createdAt_idx" ON "training_records"("traceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "conflict_disclosures_disclosureNo_key" ON "conflict_disclosures"("disclosureNo");

-- CreateIndex
CREATE INDEX "conflict_disclosures_status_createdAt_idx" ON "conflict_disclosures"("status", "createdAt");

-- CreateIndex
CREATE INDEX "conflict_disclosures_disclosureNo_createdAt_idx" ON "conflict_disclosures"("disclosureNo", "createdAt");

-- CreateIndex
CREATE INDEX "conflict_disclosures_reviewDueAt_status_idx" ON "conflict_disclosures"("reviewDueAt", "status");

-- CreateIndex
CREATE INDEX "conflict_disclosures_traceId_createdAt_idx" ON "conflict_disclosures"("traceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "wind_down_material_records_materialNo_key" ON "wind_down_material_records"("materialNo");

-- CreateIndex
CREATE INDEX "wind_down_material_records_status_createdAt_idx" ON "wind_down_material_records"("status", "createdAt");

-- CreateIndex
CREATE INDEX "wind_down_material_records_materialNo_createdAt_idx" ON "wind_down_material_records"("materialNo", "createdAt");

-- CreateIndex
CREATE INDEX "wind_down_material_records_reviewDueAt_status_idx" ON "wind_down_material_records"("reviewDueAt", "status");

-- CreateIndex
CREATE INDEX "wind_down_material_records_traceId_createdAt_idx" ON "wind_down_material_records"("traceId", "createdAt");
