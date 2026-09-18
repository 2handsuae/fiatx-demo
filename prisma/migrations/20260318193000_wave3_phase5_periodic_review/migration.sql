-- Wave 3 Phase 5: Periodic review becomes an independent workflow.

ALTER TABLE "customer_main"
ADD COLUMN "activePeriodicReviewCycleId" TEXT;

ALTER TABLE "customer_main"
ADD COLUMN "periodicReviewOverdueAt" DATETIME;

ALTER TABLE "customer_main"
ADD COLUMN "periodicReviewOverdueReason" TEXT;

ALTER TABLE "cdd_cases"
ADD COLUMN "workflow" TEXT NOT NULL DEFAULT 'ONBOARDING';

ALTER TABLE "cdd_cases"
ADD COLUMN "periodicReviewCycleId" TEXT;

ALTER TABLE "edd_cases"
ADD COLUMN "workflow" TEXT NOT NULL DEFAULT 'ONBOARDING';

ALTER TABLE "edd_cases"
ADD COLUMN "periodicReviewCycleId" TEXT;

CREATE TABLE "periodic_review_cycles" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cycleNo" TEXT NOT NULL DEFAULT 'TEMP',
  "customerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_CDD_INPUT',
  "dueAt" DATETIME NOT NULL,
  "triggeredAt" DATETIME,
  "clearedAt" DATETIME,
  "rejectedAt" DATETIME,
  "currentCddCaseId" TEXT,
  "currentEddCaseId" TEXT,
  "primaryAlertId" TEXT,
  "primaryIncidentId" TEXT,
  "latestDecisionRecordId" TEXT,
  "resolutionReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "periodic_review_cycles_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_main_activePeriodicReviewCycleId_key"
ON "customer_main"("activePeriodicReviewCycleId");

CREATE UNIQUE INDEX "periodic_review_cycles_cycleNo_key"
ON "periodic_review_cycles"("cycleNo");

CREATE INDEX "customer_main_activePeriodicReviewCycleId_idx"
ON "customer_main"("activePeriodicReviewCycleId");

CREATE INDEX "cdd_cases_workflow_status_idx"
ON "cdd_cases"("workflow", "status");

CREATE INDEX "cdd_cases_periodicReviewCycleId_idx"
ON "cdd_cases"("periodicReviewCycleId");

CREATE INDEX "edd_cases_workflow_status_idx"
ON "edd_cases"("workflow", "status");

CREATE INDEX "edd_cases_periodicReviewCycleId_idx"
ON "edd_cases"("periodicReviewCycleId");

CREATE INDEX "periodic_review_cycles_customerId_status_idx"
ON "periodic_review_cycles"("customerId", "status");

CREATE INDEX "periodic_review_cycles_status_dueAt_idx"
ON "periodic_review_cycles"("status", "dueAt");

CREATE INDEX "periodic_review_cycles_primaryAlertId_idx"
ON "periodic_review_cycles"("primaryAlertId");

CREATE INDEX "periodic_review_cycles_primaryIncidentId_idx"
ON "periodic_review_cycles"("primaryIncidentId");
