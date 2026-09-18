-- Create decision record table for risk-engine replay/audit.
CREATE TABLE "onboarding_decision_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "contextType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "inputPayload" TEXT,
    "inputHash" TEXT NOT NULL,
    "outputDecision" TEXT,
    "recommendedActions" TEXT,
    "outputs" TEXT,
    "reasonCodes" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "onboarding_decision_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "onboarding_decision_records_customerId_createdAt_idx" ON "onboarding_decision_records"("customerId", "createdAt");
CREATE INDEX "onboarding_decision_records_contextType_subjectId_createdAt_idx" ON "onboarding_decision_records"("contextType", "subjectId", "createdAt");
CREATE INDEX "onboarding_decision_records_status_createdAt_idx" ON "onboarding_decision_records"("status", "createdAt");

-- Add optional action/result fields to alert/incident for list filtering.
ALTER TABLE "compliance_alerts" ADD COLUMN "journeyId" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "decisionRecommendation" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "decision" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "linkedCaseIds" TEXT;
ALTER TABLE "compliance_alerts" ADD COLUMN "decisionRecordIds" TEXT;

ALTER TABLE "compliance_incidents" ADD COLUMN "decision" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "linkedCaseIds" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "decisionRecordIds" TEXT;

-- Normalize legacy status values into new minimal state machines.
UPDATE "cdd_cases" SET "status" = 'CREATED' WHERE "status" = 'PENDING';
UPDATE "cdd_cases" SET "status" = 'RECEIVED' WHERE "status" = 'SUBMITTED';
UPDATE "cdd_cases" SET "status" = 'FINAL' WHERE "status" IN ('APPROVED', 'REJECTED');

UPDATE "edd_cases" SET "status" = 'CREATED' WHERE "status" = 'PENDING';
UPDATE "edd_cases" SET "status" = 'RECEIVED' WHERE "status" = 'SUBMITTED';
UPDATE "edd_cases" SET "status" = 'FINAL' WHERE "status" IN ('APPROVED', 'REJECTED');

UPDATE "compliance_alerts" SET "status" = 'OPEN' WHERE "status" IN ('NEW', 'IN_REVIEW');
UPDATE "compliance_alerts" SET "status" = 'CLOSED' WHERE "status" IN ('RESOLVED', 'FALSE_POSITIVE');

UPDATE "compliance_incidents" SET "status" = 'OPEN' WHERE "status" IN ('NEW', 'INVESTIGATING');
UPDATE "compliance_incidents" SET "status" = 'CLOSED' WHERE "status" = 'FALSE_POSITIVE';
