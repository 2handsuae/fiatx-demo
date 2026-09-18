ALTER TABLE "approval_cases" ADD COLUMN "workflowType" TEXT;
ALTER TABLE "approval_cases" ADD COLUMN "workflowId" TEXT;
ALTER TABLE "approval_cases" ADD COLUMN "workflowNo" TEXT;

CREATE INDEX "approval_cases_workflowType_workflowNo_createdAt_idx"
  ON "approval_cases"("workflowType", "workflowNo", "createdAt");

UPDATE "approval_cases"
SET "workflowType" = COALESCE("workflowType", 'ONBOARDING'),
    "workflowId" = COALESCE("workflowId", NULLIF(TRIM(json_extract(COALESCE("metadataJson", '{}'), '$.journeyId')), '')),
    "workflowNo" = COALESCE("workflowNo", NULLIF(TRIM(json_extract(COALESCE("metadataJson", '{}'), '$.journeyId')), ''))
WHERE UPPER(TRIM(COALESCE("actionType", ''))) = 'ONBOARDING_FINAL_APPROVAL'
  AND NULLIF(TRIM(json_extract(COALESCE("metadataJson", '{}'), '$.journeyId')), '') IS NOT NULL;

UPDATE "audit_log_events"
SET "workflowType" = COALESCE("workflowType", (
      SELECT ac."workflowType"
      FROM "approval_cases" ac
      WHERE ac."id" = "audit_log_events"."entityId"
    )),
    "workflowId" = COALESCE("workflowId", (
      SELECT ac."workflowId"
      FROM "approval_cases" ac
      WHERE ac."id" = "audit_log_events"."entityId"
    )),
    "workflowNo" = COALESCE("workflowNo", (
      SELECT ac."workflowNo"
      FROM "approval_cases" ac
      WHERE ac."id" = "audit_log_events"."entityId"
    ))
WHERE UPPER(TRIM(COALESCE("entityType", ''))) = 'APPROVAL_CASE'
  AND EXISTS (
    SELECT 1
    FROM "approval_cases" ac
    WHERE ac."id" = "audit_log_events"."entityId"
      AND ac."workflowType" IS NOT NULL
      AND ac."workflowId" IS NOT NULL
      AND ac."workflowNo" IS NOT NULL
  );

UPDATE "onboarding_audit_logs"
SET "traceId" = COALESCE("traceId", (
      SELECT CASE
        WHEN UPPER(TRIM(COALESCE(c."workflow", ''))) = 'ONBOARDING'
          AND NULLIF(TRIM(COALESCE(c."journeyId", '')), '') IS NOT NULL
          THEN 'ONBOARDING:' || TRIM(c."journeyId")
        ELSE NULL
      END
      FROM "cdd_responses" c
      WHERE c."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowType" = COALESCE("workflowType", (
      SELECT CASE
        WHEN UPPER(TRIM(COALESCE(c."workflow", ''))) = 'ONBOARDING'
          AND NULLIF(TRIM(COALESCE(c."journeyId", '')), '') IS NOT NULL
          THEN 'ONBOARDING'
        ELSE NULL
      END
      FROM "cdd_responses" c
      WHERE c."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowId" = COALESCE("workflowId", (
      SELECT CASE
        WHEN UPPER(TRIM(COALESCE(c."workflow", ''))) = 'ONBOARDING'
          AND NULLIF(TRIM(COALESCE(c."journeyId", '')), '') IS NOT NULL
          THEN TRIM(c."journeyId")
        ELSE NULL
      END
      FROM "cdd_responses" c
      WHERE c."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowNo" = COALESCE("workflowNo", (
      SELECT CASE
        WHEN UPPER(TRIM(COALESCE(c."workflow", ''))) = 'ONBOARDING'
          AND NULLIF(TRIM(COALESCE(c."journeyId", '')), '') IS NOT NULL
          THEN TRIM(c."journeyId")
        ELSE NULL
      END
      FROM "cdd_responses" c
      WHERE c."id" = "onboarding_audit_logs"."caseId"
    ))
WHERE UPPER(TRIM(COALESCE("caseType", ''))) = 'CDD'
  AND "caseId" IS NOT NULL;

UPDATE "onboarding_audit_logs"
SET "traceId" = COALESCE("traceId", (
      SELECT CASE
        WHEN UPPER(TRIM(COALESCE(e."workflow", ''))) = 'ONBOARDING'
          AND NULLIF(TRIM(COALESCE(e."journeyId", '')), '') IS NOT NULL
          THEN 'ONBOARDING:' || TRIM(e."journeyId")
        ELSE NULL
      END
      FROM "edd_responses" e
      WHERE e."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowType" = COALESCE("workflowType", (
      SELECT CASE
        WHEN UPPER(TRIM(COALESCE(e."workflow", ''))) = 'ONBOARDING'
          AND NULLIF(TRIM(COALESCE(e."journeyId", '')), '') IS NOT NULL
          THEN 'ONBOARDING'
        ELSE NULL
      END
      FROM "edd_responses" e
      WHERE e."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowId" = COALESCE("workflowId", (
      SELECT CASE
        WHEN UPPER(TRIM(COALESCE(e."workflow", ''))) = 'ONBOARDING'
          AND NULLIF(TRIM(COALESCE(e."journeyId", '')), '') IS NOT NULL
          THEN TRIM(e."journeyId")
        ELSE NULL
      END
      FROM "edd_responses" e
      WHERE e."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowNo" = COALESCE("workflowNo", (
      SELECT CASE
        WHEN UPPER(TRIM(COALESCE(e."workflow", ''))) = 'ONBOARDING'
          AND NULLIF(TRIM(COALESCE(e."journeyId", '')), '') IS NOT NULL
          THEN TRIM(e."journeyId")
        ELSE NULL
      END
      FROM "edd_responses" e
      WHERE e."id" = "onboarding_audit_logs"."caseId"
    ))
WHERE UPPER(TRIM(COALESCE("caseType", ''))) = 'EDD'
  AND "caseId" IS NOT NULL;

UPDATE "onboarding_audit_logs"
SET "traceId" = COALESCE("traceId", (
      SELECT CASE
        WHEN c."periodicReviewCycleId" IS NOT NULL
          AND pr."cycleNo" IS NOT NULL
          THEN 'PERIODIC_REVIEW:' || c."periodicReviewCycleId"
        ELSE NULL
      END
      FROM "cdd_responses" c
      JOIN "periodic_review_cycles" pr ON pr."id" = c."periodicReviewCycleId"
      WHERE c."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowType" = COALESCE("workflowType", (
      SELECT CASE
        WHEN c."periodicReviewCycleId" IS NOT NULL
          AND pr."cycleNo" IS NOT NULL
          THEN 'PERIODIC_REVIEW'
        ELSE NULL
      END
      FROM "cdd_responses" c
      JOIN "periodic_review_cycles" pr ON pr."id" = c."periodicReviewCycleId"
      WHERE c."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowId" = COALESCE("workflowId", (
      SELECT c."periodicReviewCycleId"
      FROM "cdd_responses" c
      JOIN "periodic_review_cycles" pr ON pr."id" = c."periodicReviewCycleId"
      WHERE c."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowNo" = COALESCE("workflowNo", (
      SELECT pr."cycleNo"
      FROM "cdd_responses" c
      JOIN "periodic_review_cycles" pr ON pr."id" = c."periodicReviewCycleId"
      WHERE c."id" = "onboarding_audit_logs"."caseId"
    ))
WHERE UPPER(TRIM(COALESCE("caseType", ''))) = 'CDD'
  AND "caseId" IS NOT NULL
  AND ("workflowType" IS NULL OR "workflowId" IS NULL OR "workflowNo" IS NULL OR "traceId" IS NULL);

UPDATE "onboarding_audit_logs"
SET "traceId" = COALESCE("traceId", (
      SELECT CASE
        WHEN e."periodicReviewCycleId" IS NOT NULL
          AND pr."cycleNo" IS NOT NULL
          THEN 'PERIODIC_REVIEW:' || e."periodicReviewCycleId"
        ELSE NULL
      END
      FROM "edd_responses" e
      JOIN "periodic_review_cycles" pr ON pr."id" = e."periodicReviewCycleId"
      WHERE e."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowType" = COALESCE("workflowType", (
      SELECT CASE
        WHEN e."periodicReviewCycleId" IS NOT NULL
          AND pr."cycleNo" IS NOT NULL
          THEN 'PERIODIC_REVIEW'
        ELSE NULL
      END
      FROM "edd_responses" e
      JOIN "periodic_review_cycles" pr ON pr."id" = e."periodicReviewCycleId"
      WHERE e."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowId" = COALESCE("workflowId", (
      SELECT e."periodicReviewCycleId"
      FROM "edd_responses" e
      JOIN "periodic_review_cycles" pr ON pr."id" = e."periodicReviewCycleId"
      WHERE e."id" = "onboarding_audit_logs"."caseId"
    )),
    "workflowNo" = COALESCE("workflowNo", (
      SELECT pr."cycleNo"
      FROM "edd_responses" e
      JOIN "periodic_review_cycles" pr ON pr."id" = e."periodicReviewCycleId"
      WHERE e."id" = "onboarding_audit_logs"."caseId"
    ))
WHERE UPPER(TRIM(COALESCE("caseType", ''))) = 'EDD'
  AND "caseId" IS NOT NULL
  AND ("workflowType" IS NULL OR "workflowId" IS NULL OR "workflowNo" IS NULL OR "traceId" IS NULL);
