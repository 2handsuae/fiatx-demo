/*
  Warnings:

  - You are about to drop the column `lineItemId` on the `reconciliation_adjustments` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reconciliation_adjustments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adjustmentNo" TEXT NOT NULL DEFAULT 'TEMP',
    "caseNo" TEXT NOT NULL,
    "explainedFlowId" TEXT,
    "explainedExternalLineId" TEXT,
    "walletRef" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "relatedOrderNo" TEXT,
    "assetCode" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "reasonInternal" TEXT NOT NULL,
    "reasonCustomer" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalCaseId" TEXT,
    "approvalNo" TEXT,
    "ownerNo" TEXT,
    "ownerId" TEXT,
    "traceId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "postedAt" DATETIME,
    "tbTransferId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_reconciliation_adjustments" ("adjustmentNo", "amount", "approvalCaseId", "approvalNo", "assetCode", "book", "caseNo", "createdAt", "createdByUserId", "decidedByUserId", "direction", "effectiveDate", "id", "ownerId", "ownerNo", "postedAt", "reasonCode", "reasonCustomer", "reasonInternal", "relatedOrderNo", "status", "tbTransferId", "traceId", "updatedAt", "walletRef") SELECT "adjustmentNo", "amount", "approvalCaseId", "approvalNo", "assetCode", "book", "caseNo", "createdAt", "createdByUserId", "decidedByUserId", "direction", "effectiveDate", "id", "ownerId", "ownerNo", "postedAt", "reasonCode", "reasonCustomer", "reasonInternal", "relatedOrderNo", "status", "tbTransferId", "traceId", "updatedAt", "walletRef" FROM "reconciliation_adjustments";
DROP TABLE "reconciliation_adjustments";
ALTER TABLE "new_reconciliation_adjustments" RENAME TO "reconciliation_adjustments";
CREATE UNIQUE INDEX "reconciliation_adjustments_adjustmentNo_key" ON "reconciliation_adjustments"("adjustmentNo");
CREATE INDEX "reconciliation_adjustments_caseNo_idx" ON "reconciliation_adjustments"("caseNo");
CREATE INDEX "reconciliation_adjustments_status_idx" ON "reconciliation_adjustments"("status");
CREATE INDEX "reconciliation_adjustments_walletRef_status_idx" ON "reconciliation_adjustments"("walletRef", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
