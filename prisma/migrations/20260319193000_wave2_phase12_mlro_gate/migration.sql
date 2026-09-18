ALTER TABLE "compliance_incidents"
ADD COLUMN "proposedWorkflowDecision" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "proposedWorkflowReason" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "proposedFinalDispositionCode" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "proposedFinalDispositionReason" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "submittedForMlroAt" DATETIME;

ALTER TABLE "compliance_incidents"
ADD COLUMN "submittedForMlroById" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "submittedForMlroByNo" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "submittedForMlroByRole" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "mlroReviewOutcome" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "mlroReviewNote" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "mlroReviewedAt" DATETIME;

ALTER TABLE "compliance_incidents"
ADD COLUMN "mlroReviewedById" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "mlroReviewedByNo" TEXT;

ALTER TABLE "compliance_incidents"
ADD COLUMN "mlroReviewedByRole" TEXT;
