ALTER TABLE "admin_user_invitations"
  ADD COLUMN "workflowType" TEXT;

ALTER TABLE "admin_user_invitations"
  ADD COLUMN "workflowNo" TEXT;

ALTER TABLE "admin_user_invitations"
  ADD COLUMN "traceId" TEXT;

CREATE INDEX IF NOT EXISTS "admin_user_invitations_traceId_idx"
  ON "admin_user_invitations"("traceId");
