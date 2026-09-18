ALTER TABLE "compliance_incidents"
ADD COLUMN "caseType" TEXT NOT NULL DEFAULT 'GENERIC';

UPDATE "compliance_incidents"
SET "caseType" = CASE
  WHEN "sourceType" = 'ONBOARDING_JOURNEY' THEN 'ONBOARDING'
  WHEN "sourceType" IN ('DEPOSIT', 'WITHDRAW') THEN 'TRANSACTION'
  ELSE 'GENERIC'
END;

CREATE INDEX "compliance_incidents_caseType_status_dueAt_idx"
ON "compliance_incidents"("caseType", "status", "dueAt");
