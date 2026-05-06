-- Migration: drop triggerType from audit_log_events + partial unique index on users.email
-- Part A: Remove triggerType column from audit_log_events (SQLite table recreate pattern)
-- Part B: Replace unconditional email unique index with partial unique index on users

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Part A: Drop indexes that reference triggerType
DROP INDEX IF EXISTS "audit_log_events_triggerType_occurredAt_idx";

-- Recreate audit_log_events WITHOUT triggerType column
CREATE TABLE "audit_log_events_new" (
    "id"              TEXT      NOT NULL PRIMARY KEY,
    "auditNo"         TEXT      NOT NULL DEFAULT 'TEMP',
    "action"          TEXT      NOT NULL,
    "entityType"      TEXT      NOT NULL,
    "entityId"        TEXT,
    "entityNo"        TEXT,
    "traceId"         TEXT,
    "workflowType"    TEXT,
    "entityOwnerType" TEXT,
    "entityOwnerId"   TEXT,
    "actorType"       TEXT      NOT NULL,
    "actorId"         TEXT      NOT NULL,
    "actorNo"         TEXT,
    "actorRole"       TEXT,
    "requestId"       TEXT,
    "sourceIp"        TEXT,
    "sourcePlatform"  TEXT,
    "result"          TEXT      NOT NULL DEFAULT 'SUCCESS',
    "reason"          TEXT,
    "metadata"        TEXT,
    "idempotencyKey"  TEXT,
    "payloadDigest"   TEXT      NOT NULL,
    "retainedUntil"   DATETIME  NOT NULL,
    "entityOwnerNo"   TEXT,
    "archivedAt"      DATETIME,
    "occurredAt"      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       DATETIME  NOT NULL
);

INSERT INTO "audit_log_events_new" (
    "id", "auditNo", "action", "entityType", "entityId", "entityNo",
    "traceId", "workflowType", "entityOwnerType", "entityOwnerId",
    "actorType", "actorId", "actorNo", "actorRole", "requestId",
    "sourceIp", "sourcePlatform", "result", "reason", "metadata",
    "idempotencyKey", "payloadDigest", "retainedUntil", "entityOwnerNo",
    "archivedAt", "occurredAt", "createdAt", "updatedAt"
)
SELECT
    "id", "auditNo", "action", "entityType", "entityId", "entityNo",
    "traceId", "workflowType", "entityOwnerType", "entityOwnerId",
    "actorType", "actorId", "actorNo", "actorRole", "requestId",
    "sourceIp", "sourcePlatform", "result", "reason", "metadata",
    "idempotencyKey", "payloadDigest", "retainedUntil", "entityOwnerNo",
    "archivedAt", "occurredAt", "createdAt", "updatedAt"
FROM "audit_log_events";

DROP TABLE "audit_log_events";
ALTER TABLE "audit_log_events_new" RENAME TO "audit_log_events";

-- Recreate all indexes on audit_log_events (excluding the dropped triggerType one)
CREATE UNIQUE INDEX "audit_log_events_auditNo_key" ON "audit_log_events"("auditNo");
CREATE UNIQUE INDEX "audit_log_events_idempotencyKey_key" ON "audit_log_events"("idempotencyKey");
CREATE INDEX "audit_log_events_occurredAt_idx" ON "audit_log_events"("occurredAt");
CREATE INDEX "audit_log_events_entityType_entityId_idx" ON "audit_log_events"("entityType", "entityId");
CREATE INDEX "audit_log_events_actorType_actorId_idx" ON "audit_log_events"("actorType", "actorId");
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

-- Part B: Replace unconditional email unique index with partial unique index
DROP INDEX IF EXISTS "users_email_key";
CREATE UNIQUE INDEX "users_email_active_unique" ON "users"("email") WHERE "deleted_at" IS NULL;
