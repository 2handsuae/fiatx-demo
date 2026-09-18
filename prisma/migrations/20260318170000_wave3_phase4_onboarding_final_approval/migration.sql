ALTER TABLE "customer_main"
ADD COLUMN "latestFinalApprovalId" TEXT REFERENCES "approval_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_main"
ADD COLUMN "latestFinalApprovalStatus" TEXT;

CREATE UNIQUE INDEX "customer_main_latestFinalApprovalId_key"
ON "customer_main"("latestFinalApprovalId");

CREATE INDEX "customer_main_latestFinalApprovalStatus_idx"
ON "customer_main"("latestFinalApprovalStatus");
