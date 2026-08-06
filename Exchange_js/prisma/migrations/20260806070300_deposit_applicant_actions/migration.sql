-- CreateTable
CREATE TABLE "deposit_applicant_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depositTransactionId" TEXT NOT NULL,
    "applicantActionId" TEXT NOT NULL,
    "externalActionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    CONSTRAINT "deposit_applicant_actions_depositTransactionId_fkey" FOREIGN KEY ("depositTransactionId") REFERENCES "deposit_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "deposit_applicant_actions_depositTransactionId_seq_idx" ON "deposit_applicant_actions"("depositTransactionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_applicant_actions_depositTransactionId_applicantActionId_key" ON "deposit_applicant_actions"("depositTransactionId", "applicantActionId");
