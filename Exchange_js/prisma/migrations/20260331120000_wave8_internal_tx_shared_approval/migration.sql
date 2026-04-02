ALTER TABLE "internal_transactions"
  ADD COLUMN "approvalCaseId" TEXT
  REFERENCES "approval_cases" ("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX "internal_transactions_approvalCaseId_key"
  ON "internal_transactions"("approvalCaseId");

CREATE INDEX "internal_transactions_approvalCaseId_idx"
  ON "internal_transactions"("approvalCaseId");
