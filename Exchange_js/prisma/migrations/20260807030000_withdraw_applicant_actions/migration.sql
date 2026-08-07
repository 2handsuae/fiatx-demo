-- AlterTable
ALTER TABLE "withdraw_transactions" ADD COLUMN "actionSubmittedAt" DATETIME;

-- CreateTable
CREATE TABLE "withdraw_applicant_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawTransactionId" TEXT NOT NULL,
    "applicantActionId" TEXT NOT NULL,
    "externalActionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    CONSTRAINT "withdraw_applicant_actions_withdrawTransactionId_fkey" FOREIGN KEY ("withdrawTransactionId") REFERENCES "withdraw_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "withdraw_applicant_actions_withdrawTransactionId_seq_idx" ON "withdraw_applicant_actions"("withdrawTransactionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "withdraw_applicant_actions_withdrawTransactionId_applicantActionId_key" ON "withdraw_applicant_actions"("withdrawTransactionId", "applicantActionId");

-- CreateIndex
CREATE UNIQUE INDEX "withdraw_applicant_actions_withdrawTransactionId_seq_key" ON "withdraw_applicant_actions"("withdrawTransactionId", "seq");
