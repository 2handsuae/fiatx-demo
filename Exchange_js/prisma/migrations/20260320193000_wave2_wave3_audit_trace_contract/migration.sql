ALTER TABLE "onboarding_audit_logs" ADD COLUMN "traceId" TEXT;
ALTER TABLE "onboarding_audit_logs" ADD COLUMN "workflowType" TEXT;
ALTER TABLE "onboarding_audit_logs" ADD COLUMN "workflowId" TEXT;
ALTER TABLE "onboarding_audit_logs" ADD COLUMN "workflowNo" TEXT;

CREATE INDEX "onboarding_audit_logs_traceId_createdAt_idx"
ON "onboarding_audit_logs"("traceId", "createdAt");

CREATE INDEX "onboarding_audit_logs_workflowType_workflowNo_createdAt_idx"
ON "onboarding_audit_logs"("workflowType", "workflowNo", "createdAt");
