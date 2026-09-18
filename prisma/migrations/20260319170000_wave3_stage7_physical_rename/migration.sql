ALTER TABLE "cdd_cases" RENAME TO "cdd_responses";
ALTER TABLE "edd_cases" RENAME TO "edd_responses";
ALTER TABLE "cdd_case_reports" RENAME TO "cdd_response_reports";
ALTER TABLE "edd_case_reports" RENAME TO "edd_response_reports";
ALTER TABLE "onboarding_decision_records" RENAME TO "workflow_decision_records";

ALTER TABLE "edd_responses" RENAME COLUMN "cddCaseId" TO "cddResponseId";
ALTER TABLE "cdd_response_reports" RENAME COLUMN "cddCaseId" TO "cddResponseId";
ALTER TABLE "edd_response_reports" RENAME COLUMN "eddCaseId" TO "eddResponseId";
ALTER TABLE "periodic_review_cycles" RENAME COLUMN "currentCddCaseId" TO "currentCddResponseId";
ALTER TABLE "periodic_review_cycles" RENAME COLUMN "currentEddCaseId" TO "currentEddResponseId";
