-- Stage 5: remove legacy customer compatibility fields after canonical cutover
ALTER TABLE "customer_main" DROP COLUMN "accountStatus";
ALTER TABLE "customer_main" DROP COLUMN "accountStatusReason";
ALTER TABLE "customer_main" DROP COLUMN "accountStatusChangedAt";
ALTER TABLE "customer_main" DROP COLUMN "accountStatusChangedBy";
ALTER TABLE "customer_main" DROP COLUMN "publicStatus";
ALTER TABLE "customer_main" DROP COLUMN "cddStatus";
ALTER TABLE "customer_main" DROP COLUMN "eddStatus";
ALTER TABLE "customer_main" DROP COLUMN "complianceStatus";
ALTER TABLE "customer_main" DROP COLUMN "finalApprovalStatus";
ALTER TABLE "customer_main" DROP COLUMN "finalApprovalReason";
ALTER TABLE "customer_main" DROP COLUMN "finalApprovalReviewerId";
ALTER TABLE "customer_main" DROP COLUMN "finalApprovalReviewedAt";
ALTER TABLE "customer_main" DROP COLUMN "activeCaseType";
ALTER TABLE "customer_main" DROP COLUMN "activeCaseId";
ALTER TABLE "customer_main" DROP COLUMN "currentCddCaseId";
ALTER TABLE "customer_main" DROP COLUMN "currentEddCaseId";
