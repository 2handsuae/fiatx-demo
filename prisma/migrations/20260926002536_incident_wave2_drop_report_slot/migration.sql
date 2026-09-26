/*
  Warnings:

  - You are about to drop the column `reportDeadlineAt` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the column `reportDraft` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the column `reportDraftedAt` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the column `reportReference` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the column `reportedAt` on the `incidents` table. All the data in the column will be lost.
  - You are about to drop the column `reportedByUserId` on the `incidents` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_incidents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentNo" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sourceCaseNo" TEXT,
    "sourceDispositionNo" TEXT,
    "sourceAdvanceTransferNo" TEXT,
    "customerNo" TEXT,
    "assetCode" TEXT,
    "amount" DECIMAL,
    "assessedAmount" DECIMAL,
    "assessmentBasis" TEXT,
    "subjectRefs" TEXT,
    "impactSummary" TEXT,
    "impactCount" INTEGER,
    "reportRequired" BOOLEAN NOT NULL DEFAULT false,
    "reportBasisCodes" TEXT,
    "approvalNo" TEXT,
    "registeredByUserId" TEXT NOT NULL,
    "closedAt" DATETIME,
    "withdrawnReason" TEXT,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_incidents" ("amount", "approvalNo", "assessedAmount", "assessmentBasis", "assetCode", "closedAt", "createdAt", "customerNo", "description", "id", "impactCount", "impactSummary", "incidentNo", "registeredByUserId", "reportBasisCodes", "reportRequired", "sourceAdvanceTransferNo", "sourceCaseNo", "sourceDispositionNo", "status", "subjectRefs", "title", "traceId", "type", "updatedAt", "withdrawnReason") SELECT "amount", "approvalNo", "assessedAmount", "assessmentBasis", "assetCode", "closedAt", "createdAt", "customerNo", "description", "id", "impactCount", "impactSummary", "incidentNo", "registeredByUserId", "reportBasisCodes", "reportRequired", "sourceAdvanceTransferNo", "sourceCaseNo", "sourceDispositionNo", "status", "subjectRefs", "title", "traceId", "type", "updatedAt", "withdrawnReason" FROM "incidents";
DROP TABLE "incidents";
ALTER TABLE "new_incidents" RENAME TO "incidents";
CREATE UNIQUE INDEX "incidents_incidentNo_key" ON "incidents"("incidentNo");
CREATE INDEX "incidents_status_idx" ON "incidents"("status");
CREATE INDEX "incidents_sourceCaseNo_idx" ON "incidents"("sourceCaseNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
