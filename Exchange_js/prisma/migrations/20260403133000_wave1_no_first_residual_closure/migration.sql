ALTER TABLE "audit_evidence_packages" ADD COLUMN "approvalCaseNo" TEXT;
ALTER TABLE "audit_evidence_packages" ADD COLUMN "exportedByNo" TEXT;

UPDATE "audit_evidence_packages"
SET "approvalCaseNo" = (
  SELECT "approvalNo"
  FROM "approval_cases"
  WHERE "approval_cases"."id" = "audit_evidence_packages"."approvalCaseId"
)
WHERE "approvalCaseId" IS NOT NULL
  AND "approvalCaseNo" IS NULL;

UPDATE "audit_evidence_packages"
SET "exportedByNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "audit_evidence_packages"."exportedById"
)
WHERE "exportedByNo" IS NULL;

CREATE INDEX "audit_evidence_packages_approvalCaseNo_idx"
ON "audit_evidence_packages"("approvalCaseNo");

ALTER TABLE "compliance_case_evidence_packages" ADD COLUMN "approvalCaseNo" TEXT;
ALTER TABLE "compliance_case_evidence_packages" ADD COLUMN "exportedByNo" TEXT;

UPDATE "compliance_case_evidence_packages"
SET "approvalCaseNo" = (
  SELECT "approvalNo"
  FROM "approval_cases"
  WHERE "approval_cases"."id" = "compliance_case_evidence_packages"."approvalCaseId"
)
WHERE "approvalCaseId" IS NOT NULL
  AND "approvalCaseNo" IS NULL;

UPDATE "compliance_case_evidence_packages"
SET "exportedByNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "compliance_case_evidence_packages"."exportedById"
)
WHERE "exportedByNo" IS NULL;

CREATE INDEX "compliance_case_evidence_packages_approvalCaseNo_idx"
ON "compliance_case_evidence_packages"("approvalCaseNo");

ALTER TABLE "approval_cases" ADD COLUMN "makerUserNo" TEXT;
ALTER TABLE "approval_cases" ADD COLUMN "decisionByUserNo" TEXT;

UPDATE "approval_cases"
SET "makerUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "approval_cases"."makerUserId"
)
WHERE "makerUserNo" IS NULL;

UPDATE "approval_cases"
SET "decisionByUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "approval_cases"."decisionByUserId"
)
WHERE "decisionByUserId" IS NOT NULL
  AND "decisionByUserNo" IS NULL;

ALTER TABLE "approval_steps" ADD COLUMN "approvalNo" TEXT;
ALTER TABLE "approval_steps" ADD COLUMN "decidedByUserNo" TEXT;

UPDATE "approval_steps"
SET "approvalNo" = (
  SELECT "approvalNo"
  FROM "approval_cases"
  WHERE "approval_cases"."id" = "approval_steps"."approvalCaseId"
)
WHERE "approvalNo" IS NULL;

UPDATE "approval_steps"
SET "decidedByUserNo" = (
  SELECT "userNo"
  FROM "users"
  WHERE "users"."id" = "approval_steps"."decidedByUserId"
)
WHERE "decidedByUserId" IS NOT NULL
  AND "decidedByUserNo" IS NULL;

CREATE INDEX "approval_steps_approvalNo_stepNo_idx"
ON "approval_steps"("approvalNo", "stepNo");
