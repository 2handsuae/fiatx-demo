-- Drop workflowId and workflowNo from audit_log_events via SQLite table-recreate.
-- These fields became redundant once every business sequence adopted the
-- "one UUID v4 traceId per sequence, inherited by every audit row" rule.
-- Parent-entity pointers that previously lived in workflowId/workflowNo now
-- live in metadata.parentEntityType/parentEntityId/parentEntityNo.
-- See docs/constraints/audit-trace-context-constraints.md.
PRAGMA foreign_keys = OFF;

-- No triggers reference audit_log_events (verified via sqlite_master query).

CREATE TABLE "audit_log_events_new" AS
SELECT
    "id",
    "auditNo",
    "triggerType",
    "action",
    "module",
    "entityType",
    "entityId",
    "entityNo",
    "entityOwnerType",
    "entityOwnerId",
    "statusFrom",
    "statusTo",
    "actorType",
    "actorId",
    "actorRole",
    "requestId",
    "sourceIp",
    "sourcePlatform",
    "result",
    "reason",
    "metadata",
    "beforeData",
    "afterData",
    "occurredAt",
    "createdAt",
    "updatedAt",
    "idempotencyKey",
    "payloadDigest",
    "maskVersion",
    "retainedUntil",
    "archivedAt",
    "actorNo",
    "entityOwnerNo",
    "traceId",
    "workflowType"
FROM "audit_log_events";

DROP TABLE "audit_log_events";
ALTER TABLE "audit_log_events_new" RENAME TO "audit_log_events";

-- Recreate all indexes from the live DB (workflowType_workflowNo_occurredAt dropped along with workflowNo column).
CREATE UNIQUE INDEX "audit_log_events_auditNo_key" ON "audit_log_events"("auditNo");
CREATE INDEX "audit_log_events_occurredAt_idx" ON "audit_log_events"("occurredAt");
CREATE INDEX "audit_log_events_triggerType_occurredAt_idx" ON "audit_log_events"("triggerType", "occurredAt");
CREATE INDEX "audit_log_events_module_occurredAt_idx" ON "audit_log_events"("module", "occurredAt");
CREATE INDEX "audit_log_events_entityType_entityId_idx" ON "audit_log_events"("entityType", "entityId");
CREATE INDEX "audit_log_events_actorType_actorId_idx" ON "audit_log_events"("actorType", "actorId");
CREATE INDEX "audit_log_events_result_occurredAt_idx" ON "audit_log_events"("result", "occurredAt");
CREATE UNIQUE INDEX "audit_log_events_idempotencyKey_key" ON "audit_log_events"("idempotencyKey");
CREATE INDEX "audit_log_events_module_entityType_entityId_occurredAt_idx" ON "audit_log_events"("module", "entityType", "entityId", "occurredAt");
CREATE INDEX "audit_log_events_actorType_actorId_occurredAt_idx" ON "audit_log_events"("actorType", "actorId", "occurredAt");
CREATE INDEX "audit_log_events_retainedUntil_idx" ON "audit_log_events"("retainedUntil");
CREATE INDEX "audit_log_events_archivedAt_idx" ON "audit_log_events"("archivedAt");
CREATE INDEX "audit_log_events_actorNo_occurredAt_idx" ON "audit_log_events"("actorNo", "occurredAt");
CREATE INDEX "audit_log_events_entityOwnerNo_occurredAt_idx" ON "audit_log_events"("entityOwnerNo", "occurredAt");
CREATE INDEX "audit_log_events_traceId_occurredAt_idx" ON "audit_log_events"("traceId", "occurredAt");
CREATE INDEX "audit_log_events_workflowType_occurredAt_idx" ON "audit_log_events"("workflowType", "occurredAt");

PRAGMA foreign_keys = ON;
