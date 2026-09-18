-- Remove module field from AuditLogEvent
-- The module field is redundant; workflow context is captured via workflowType + action.

DROP INDEX IF EXISTS "audit_log_events_module_occurredAt_idx";
DROP INDEX IF EXISTS "audit_log_events_module_entityType_entityId_occurredAt_idx";

ALTER TABLE "audit_log_events" DROP COLUMN "module";
