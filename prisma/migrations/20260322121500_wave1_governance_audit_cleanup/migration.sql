ALTER TABLE "users" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "users" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "users" ADD COLUMN "deleteRequestId" TEXT;
ALTER TABLE "users" ADD COLUMN "deleteReason" TEXT;

ALTER TABLE "compliance_case_evidence_packages" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "compliance_case_evidence_packages" ADD COLUMN "deletedBy" TEXT;
ALTER TABLE "compliance_case_evidence_packages" ADD COLUMN "deleteRequestId" TEXT;
ALTER TABLE "compliance_case_evidence_packages" ADD COLUMN "deleteReason" TEXT;

CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
CREATE INDEX "compliance_case_evidence_packages_deletedAt_idx"
ON "compliance_case_evidence_packages"("deletedAt");

UPDATE "approval_action_policies"
SET "actionType" = 'AUDIT_EVIDENCE_EXPORT_APPROVAL'
WHERE "actionType" = 'SENSITIVE_EXPORT_APPROVAL'
  AND NOT EXISTS (
    SELECT 1
    FROM "approval_action_policies"
    WHERE "actionType" = 'AUDIT_EVIDENCE_EXPORT_APPROVAL'
  );

INSERT OR IGNORE INTO "approval_action_policies" (
  "actionType",
  "riskLevel",
  "checkerRoles",
  "timeoutHours",
  "allowCancel",
  "allowRetry",
  "updatedAt"
)
VALUES (
  'AUDIT_EVIDENCE_EXPORT_APPROVAL',
  'HIGH',
  'DPO,MLRO',
  24,
  1,
  1,
  CURRENT_TIMESTAMP
);

DELETE FROM "approval_action_policies"
WHERE "actionType" = 'SENSITIVE_EXPORT_APPROVAL';
