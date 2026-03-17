ALTER TABLE "compliance_incidents" ADD COLUMN "stage" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "ruleCode" TEXT;

CREATE INDEX "compliance_incidents_sourceType_stage_lastActionAt_idx"
  ON "compliance_incidents"("sourceType", "stage", "lastActionAt");

CREATE INDEX "compliance_incidents_ruleCode_lastActionAt_idx"
  ON "compliance_incidents"("ruleCode", "lastActionAt");

UPDATE "compliance_alerts"
SET "ruleCode" = 'ONB_CDD_REVIEW_REQUIRED'
WHERE "sourceType" = 'ONBOARDING_JOURNEY'
  AND "stage" = 'REVIEW_CDD'
  AND "ruleCode" = 'ONB_ONBOARDING_JOURNEY_REVIEW';

UPDATE "compliance_alerts"
SET "ruleCode" = 'ONB_EDD_REVIEW_REQUIRED'
WHERE "sourceType" = 'ONBOARDING_JOURNEY'
  AND "stage" = 'REVIEW_EDD'
  AND "ruleCode" = 'ONB_ONBOARDING_JOURNEY_REVIEW';

UPDATE "compliance_incidents"
SET
  "caseType" = 'ONBOARDING',
  "stage" = (
    SELECT "stage"
    FROM "compliance_alerts"
    WHERE "compliance_alerts"."id" = "compliance_incidents"."primaryAlertId"
  ),
  "ruleCode" = (
    SELECT "ruleCode"
    FROM "compliance_alerts"
    WHERE "compliance_alerts"."id" = "compliance_incidents"."primaryAlertId"
  )
WHERE "sourceType" = 'ONBOARDING_JOURNEY';
