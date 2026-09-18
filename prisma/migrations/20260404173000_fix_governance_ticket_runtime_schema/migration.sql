ALTER TABLE "change_tickets" ADD COLUMN "changeReason" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "bindingSnapshotJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "change_tickets" ADD COLUMN "bindingDigest" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "approvalCaseId" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "approvalNo" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "createdByUserNo" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "submittedByUserNo" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "consumedByUserId" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "consumedByUserNo" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "consumedAt" DATETIME;
ALTER TABLE "change_tickets" ADD COLUMN "resultNote" TEXT;
ALTER TABLE "change_tickets" ADD COLUMN "deleteRequestNo" TEXT;

UPDATE "change_tickets"
SET "changeReason" = COALESCE(
  NULLIF(TRIM("emergencyReason"), ''),
  NULLIF(TRIM("scopeSummary"), ''),
  NULLIF(TRIM("changeType"), ''),
  'Legacy change ticket migrated without explicit changeReason'
)
WHERE "changeReason" IS NULL;

UPDATE "change_tickets"
SET "bindingSnapshotJson" = json_object(
  'ticketNo', "ticketNo",
  'changeType', "changeType",
  'changeReason', "changeReason",
  'scopeSummary', "scopeSummary",
  'testEvidenceRef', "testEvidenceRef",
  'rollbackPlanRef', "rollbackPlanRef",
  'traceId', "traceId",
  'createdByUserId', "createdByUserId"
)
WHERE "bindingSnapshotJson" IS NULL
   OR "bindingSnapshotJson" = '{}';

UPDATE "change_tickets"
SET "approvalCaseId" = "latestApprovalId"
WHERE "approvalCaseId" IS NULL
  AND "latestApprovalId" IS NOT NULL;

UPDATE "change_tickets"
SET "approvalNo" = (
  SELECT "approvalNo"
  FROM "approval_cases"
  WHERE "approval_cases"."id" = "change_tickets"."approvalCaseId"
)
WHERE "approvalCaseId" IS NOT NULL
  AND "approvalNo" IS NULL;

UPDATE "change_tickets"
SET "createdByUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "change_tickets"."createdByUserId"
)
WHERE "createdByUserId" IS NOT NULL
  AND "createdByUserNo" IS NULL;

UPDATE "change_tickets"
SET "submittedByUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "change_tickets"."submittedByUserId"
)
WHERE "submittedByUserId" IS NOT NULL
  AND "submittedByUserNo" IS NULL;

UPDATE "change_tickets"
SET "consumedByUserId" = "closedByUserId"
WHERE "consumedByUserId" IS NULL
  AND "closedByUserId" IS NOT NULL;

UPDATE "change_tickets"
SET "consumedAt" = COALESCE("closedAt", "deployedAt")
WHERE "consumedAt" IS NULL
  AND ("closedAt" IS NOT NULL OR "deployedAt" IS NOT NULL);

UPDATE "change_tickets"
SET "consumedByUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "change_tickets"."consumedByUserId"
)
WHERE "consumedByUserId" IS NOT NULL
  AND "consumedByUserNo" IS NULL;

UPDATE "change_tickets"
SET "deleteRequestNo" = (
  SELECT "requestNo"
  FROM "delete_requests"
  WHERE "delete_requests"."id" = "change_tickets"."deleteRequestId"
)
WHERE "deleteRequestId" IS NOT NULL
  AND "deleteRequestNo" IS NULL;

UPDATE "change_tickets"
SET "resultNote" = CASE
  WHEN "status" IN ('DEPLOYED', 'CLOSED') THEN 'Legacy change ticket migrated from release flow'
  WHEN "status" IN ('DEPLOY_FAILED', 'FAILED') THEN 'Legacy change ticket migrated with failed release result'
  ELSE NULL
END
WHERE "resultNote" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "change_tickets_approvalCaseId_key"
ON "change_tickets"("approvalCaseId");

CREATE INDEX IF NOT EXISTS "change_tickets_approvalNo_createdAt_idx"
ON "change_tickets"("approvalNo", "createdAt");

ALTER TABLE "delete_requests" ADD COLUMN "approvalCaseId" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "approvalNo" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "createdByUserNo" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "submittedByUserNo" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "consumedByUserId" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "consumedByUserNo" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "resultNote" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "targetSnapshotDigest" TEXT;
ALTER TABLE "delete_requests" ADD COLUMN "consumedAt" DATETIME;

UPDATE "delete_requests"
SET "createdByUserId" = "makerUserId"
WHERE "createdByUserId" IS NULL
  AND "makerUserId" IS NOT NULL;

UPDATE "delete_requests"
SET "approvalCaseId" = "latestApprovalId"
WHERE "approvalCaseId" IS NULL
  AND "latestApprovalId" IS NOT NULL;

UPDATE "delete_requests"
SET "approvalNo" = (
  SELECT "approvalNo"
  FROM "approval_cases"
  WHERE "approval_cases"."id" = "delete_requests"."approvalCaseId"
)
WHERE "approvalCaseId" IS NOT NULL
  AND "approvalNo" IS NULL;

UPDATE "delete_requests"
SET "createdByUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "delete_requests"."createdByUserId"
)
WHERE "createdByUserId" IS NOT NULL
  AND "createdByUserNo" IS NULL;

UPDATE "delete_requests"
SET "submittedByUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "delete_requests"."submittedByUserId"
)
WHERE "submittedByUserId" IS NOT NULL
  AND "submittedByUserNo" IS NULL;

UPDATE "delete_requests"
SET "consumedByUserId" = "executedByUserId"
WHERE "consumedByUserId" IS NULL
  AND "executedByUserId" IS NOT NULL;

UPDATE "delete_requests"
SET "consumedAt" = "executedAt"
WHERE "consumedAt" IS NULL
  AND "executedAt" IS NOT NULL;

UPDATE "delete_requests"
SET "consumedByUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "delete_requests"."consumedByUserId"
)
WHERE "consumedByUserId" IS NOT NULL
  AND "consumedByUserNo" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "delete_requests_approvalCaseId_key"
ON "delete_requests"("approvalCaseId");

CREATE INDEX IF NOT EXISTS "delete_requests_approvalNo_createdAt_idx"
ON "delete_requests"("approvalNo", "createdAt");
