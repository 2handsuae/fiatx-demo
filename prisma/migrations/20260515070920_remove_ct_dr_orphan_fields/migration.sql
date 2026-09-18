/*
  Warnings:

  - You are about to drop the column `deleteReason` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `deleteRequestId` on the `change_tickets` table. All the data in the column will be lost.
  - You are about to drop the column `deleteRequestNo` on the `change_tickets` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_change_tickets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketNo" TEXT NOT NULL DEFAULT 'TEMP',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "changeType" TEXT NOT NULL,
    "changeReason" TEXT NOT NULL,
    "bindingSnapshotJson" TEXT NOT NULL DEFAULT '{}',
    "bindingDigest" TEXT,
    "scopeSummary" TEXT NOT NULL,
    "testEvidenceRef" TEXT NOT NULL,
    "rollbackPlanRef" TEXT NOT NULL,
    "approvalCaseId" TEXT,
    "approvalNo" TEXT,
    "traceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdByUserNo" TEXT NOT NULL,
    "submittedByUserId" TEXT,
    "submittedByUserNo" TEXT,
    "consumedByUserId" TEXT,
    "consumedByUserNo" TEXT,
    "submittedAt" DATETIME,
    "consumedAt" DATETIME,
    "resultNote" TEXT,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "change_tickets_approvalCaseId_fkey" FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_change_tickets" ("approvalCaseId", "approvalNo", "bindingDigest", "bindingSnapshotJson", "changeReason", "changeType", "consumedAt", "consumedByUserId", "consumedByUserNo", "createdAt", "createdByUserId", "createdByUserNo", "deletedAt", "deletedBy", "id", "resultNote", "rollbackPlanRef", "scopeSummary", "status", "submittedAt", "submittedByUserId", "submittedByUserNo", "testEvidenceRef", "ticketNo", "traceId", "updatedAt") SELECT "approvalCaseId", "approvalNo", "bindingDigest", "bindingSnapshotJson", "changeReason", "changeType", "consumedAt", "consumedByUserId", "consumedByUserNo", "createdAt", "createdByUserId", "createdByUserNo", "deletedAt", "deletedBy", "id", "resultNote", "rollbackPlanRef", "scopeSummary", "status", "submittedAt", "submittedByUserId", "submittedByUserNo", "testEvidenceRef", "ticketNo", "traceId", "updatedAt" FROM "change_tickets";
DROP TABLE "change_tickets";
ALTER TABLE "new_change_tickets" RENAME TO "change_tickets";
CREATE UNIQUE INDEX "change_tickets_ticketNo_key" ON "change_tickets"("ticketNo");
CREATE UNIQUE INDEX "change_tickets_approvalCaseId_key" ON "change_tickets"("approvalCaseId");
CREATE INDEX "change_tickets_status_createdAt_idx" ON "change_tickets"("status", "createdAt");
CREATE INDEX "change_tickets_ticketNo_createdAt_idx" ON "change_tickets"("ticketNo", "createdAt");
CREATE INDEX "change_tickets_traceId_createdAt_idx" ON "change_tickets"("traceId", "createdAt");
CREATE INDEX "change_tickets_approvalNo_createdAt_idx" ON "change_tickets"("approvalNo", "createdAt");
CREATE INDEX "change_tickets_deletedAt_idx" ON "change_tickets"("deletedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
