-- Drop workflowId and workflowNo from audit_log_events.
-- Uses SQLite 3.35+ native ALTER TABLE DROP COLUMN support to avoid the
-- table-recreate pattern's pitfalls.
-- These fields became redundant once every business sequence adopted the
-- "one UUID v4 traceId per sequence, inherited by every audit row" rule.
-- Parent-entity pointers that previously lived in workflowId/workflowNo now
-- live in metadata.parentEntityType/parentEntityId/parentEntityNo.
-- See docs/constraints/audit-trace-context-constraints.md.

-- The compound index covers workflowNo, so it must be dropped before the
-- column drop. SQLite will refuse ALTER TABLE DROP COLUMN on indexed columns.
DROP INDEX IF EXISTS "audit_log_events_workflowType_workflowNo_occurredAt_idx";

ALTER TABLE "audit_log_events" DROP COLUMN "workflowId";
ALTER TABLE "audit_log_events" DROP COLUMN "workflowNo";
