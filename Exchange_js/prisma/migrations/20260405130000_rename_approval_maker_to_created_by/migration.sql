-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_approval_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "approval_no" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "entity_ref" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_by_user_no" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "execution_status" TEXT NOT NULL DEFAULT 'NOT_EXECUTED',
    "risk_level" TEXT NOT NULL DEFAULT 'HIGH',
    "checker_roles" TEXT NOT NULL,
    "selected_checker_role" TEXT NOT NULL,
    "allow_cancel" BOOLEAN NOT NULL DEFAULT true,
    "allow_retry" BOOLEAN NOT NULL DEFAULT true,
    "doc_ref" TEXT,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "trace_id" TEXT NOT NULL,
    "workflow_type" TEXT,
    "workflow_id" TEXT,
    "workflow_no" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "submitted_at" DATETIME,
    "timeout_at" DATETIME,
    "decided_at" DATETIME,
    "executed_at" DATETIME,
    "decision_by_user_id" TEXT,
    "decision_by_user_no" TEXT,
    "decision_by_role" TEXT,
    "decision_reason" TEXT,
    "deleted_at" DATETIME,
    "deleted_by" TEXT,
    "delete_request_id" TEXT,
    "delete_reason" TEXT
);
INSERT INTO "new_approval_cases" SELECT "id","approval_no","action_type","entity_ref","maker_user_id","maker_user_no","status","execution_status","risk_level","checker_roles","selected_checker_role","allow_cancel","allow_retry","doc_ref","metadata_json","trace_id","workflow_type","workflow_id","workflow_no","created_at","updated_at","submitted_at","timeout_at","decided_at","executed_at","decision_by_user_id","decision_by_user_no","decision_by_role","decision_reason","deleted_at","deleted_by","delete_request_id","delete_reason" FROM "approval_cases";
DROP TABLE "approval_cases";
ALTER TABLE "new_approval_cases" RENAME TO "approval_cases";
CREATE UNIQUE INDEX "approval_cases_approval_no_key" ON "approval_cases"("approval_no");
CREATE INDEX "approval_cases_action_type_entity_ref_status_idx" ON "approval_cases"("action_type", "entity_ref", "status");
CREATE INDEX "approval_cases_status_timeout_at_idx" ON "approval_cases"("status", "timeout_at");
CREATE INDEX "approval_cases_trace_id_created_at_idx" ON "approval_cases"("trace_id", "created_at");
CREATE INDEX "approval_cases_workflow_type_workflow_no_created_at_idx" ON "approval_cases"("workflow_type", "workflow_no", "created_at");
CREATE INDEX "approval_cases_deleted_at_idx" ON "approval_cases"("deleted_at");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
