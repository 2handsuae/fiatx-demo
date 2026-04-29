/*
  Warnings:

  - You are about to drop the column `afterData` on the `audit_log_events` table. All the data in the column will be lost.
  - You are about to drop the column `beforeData` on the `audit_log_events` table. All the data in the column will be lost.
  - You are about to drop the column `maskVersion` on the `audit_log_events` table. All the data in the column will be lost.
  - You are about to drop the column `statusFrom` on the `audit_log_events` table. All the data in the column will be lost.
  - You are about to drop the column `statusTo` on the `audit_log_events` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_audit_log_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "auditNo" TEXT NOT NULL DEFAULT 'TEMP',
    "triggerType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityNo" TEXT,
    "traceId" TEXT,
    "workflowType" TEXT,
    "entityOwnerType" TEXT,
    "entityOwnerId" TEXT,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorNo" TEXT,
    "actorRole" TEXT,
    "requestId" TEXT,
    "sourceIp" TEXT,
    "sourcePlatform" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "reason" TEXT,
    "metadata" TEXT,
    "idempotencyKey" TEXT,
    "payloadDigest" TEXT NOT NULL,
    "retainedUntil" DATETIME NOT NULL,
    "entityOwnerNo" TEXT,
    "archivedAt" DATETIME,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_audit_log_events" ("action", "actorId", "actorNo", "actorRole", "actorType", "archivedAt", "auditNo", "createdAt", "entityId", "entityNo", "entityOwnerId", "entityOwnerNo", "entityOwnerType", "entityType", "id", "idempotencyKey", "metadata", "module", "occurredAt", "payloadDigest", "reason", "requestId", "result", "retainedUntil", "sourceIp", "sourcePlatform", "traceId", "triggerType", "updatedAt", "workflowType") SELECT "action", "actorId", "actorNo", "actorRole", "actorType", "archivedAt", "auditNo", "createdAt", "entityId", "entityNo", "entityOwnerId", "entityOwnerNo", "entityOwnerType", "entityType", "id", "idempotencyKey", "metadata", "module", "occurredAt", "payloadDigest", "reason", "requestId", "result", "retainedUntil", "sourceIp", "sourcePlatform", "traceId", "triggerType", "updatedAt", "workflowType" FROM "audit_log_events";
DROP TABLE "audit_log_events";
ALTER TABLE "new_audit_log_events" RENAME TO "audit_log_events";
CREATE UNIQUE INDEX "audit_log_events_auditNo_key" ON "audit_log_events"("auditNo");
CREATE UNIQUE INDEX "audit_log_events_idempotencyKey_key" ON "audit_log_events"("idempotencyKey");
CREATE INDEX "audit_log_events_occurredAt_idx" ON "audit_log_events"("occurredAt");
CREATE INDEX "audit_log_events_triggerType_occurredAt_idx" ON "audit_log_events"("triggerType", "occurredAt");
CREATE INDEX "audit_log_events_module_occurredAt_idx" ON "audit_log_events"("module", "occurredAt");
CREATE INDEX "audit_log_events_entityType_entityId_idx" ON "audit_log_events"("entityType", "entityId");
CREATE INDEX "audit_log_events_actorType_actorId_idx" ON "audit_log_events"("actorType", "actorId");
CREATE INDEX "audit_log_events_module_entityType_entityId_occurredAt_idx" ON "audit_log_events"("module", "entityType", "entityId", "occurredAt");
CREATE INDEX "audit_log_events_actorType_actorId_occurredAt_idx" ON "audit_log_events"("actorType", "actorId", "occurredAt");
CREATE INDEX "audit_log_events_actorNo_occurredAt_idx" ON "audit_log_events"("actorNo", "occurredAt");
CREATE INDEX "audit_log_events_entityOwnerNo_occurredAt_idx" ON "audit_log_events"("entityOwnerNo", "occurredAt");
CREATE INDEX "audit_log_events_traceId_occurredAt_idx" ON "audit_log_events"("traceId", "occurredAt");
CREATE INDEX "audit_log_events_workflowType_occurredAt_idx" ON "audit_log_events"("workflowType", "occurredAt");
CREATE INDEX "audit_log_events_result_occurredAt_idx" ON "audit_log_events"("result", "occurredAt");
CREATE INDEX "audit_log_events_retainedUntil_idx" ON "audit_log_events"("retainedUntil");
CREATE INDEX "audit_log_events_archivedAt_idx" ON "audit_log_events"("archivedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
