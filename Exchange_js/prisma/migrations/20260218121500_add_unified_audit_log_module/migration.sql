-- CreateTable
CREATE TABLE "audit_log_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditNo" TEXT NOT NULL DEFAULT 'TEMP',
    "triggerType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityNo" TEXT,
    "entityOwnerType" TEXT,
    "entityOwnerId" TEXT,
    "statusFrom" TEXT,
    "statusTo" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT,
    "requestId" TEXT,
    "sourceIp" TEXT,
    "sourcePlatform" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "metadata" TEXT,
    "beforeData" TEXT,
    "afterData" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_evidence_packages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageNo" TEXT NOT NULL DEFAULT 'TEMP',
    "exportedByType" TEXT NOT NULL,
    "exportedById" TEXT NOT NULL,
    "exportedByRole" TEXT,
    "filterSnapshot" TEXT,
    "itemCount" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "manifest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_events_auditNo_key" ON "audit_log_events"("auditNo");

-- CreateIndex
CREATE INDEX "audit_log_events_occurredAt_idx" ON "audit_log_events"("occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_events_triggerType_occurredAt_idx" ON "audit_log_events"("triggerType", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_events_module_occurredAt_idx" ON "audit_log_events"("module", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_events_entityType_entityId_idx" ON "audit_log_events"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_events_actorType_actorId_idx" ON "audit_log_events"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "audit_log_events_result_occurredAt_idx" ON "audit_log_events"("result", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_evidence_packages_packageNo_key" ON "audit_evidence_packages"("packageNo");

-- CreateIndex
CREATE INDEX "audit_evidence_packages_createdAt_idx" ON "audit_evidence_packages"("createdAt");

-- CreateIndex
CREATE INDEX "audit_evidence_packages_exportedByType_exportedById_idx" ON "audit_evidence_packages"("exportedByType", "exportedById");
