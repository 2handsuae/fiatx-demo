/*
  Warnings:

  - You are about to drop the column `reasonCustomer` on the `reconciliation_adjustments` table. All the data in the column will be lost.

  对账处置原因字段统一（业主 2026-11-04 拍板）：
  - reconciliation_adjustments 删 reasonCustomer——系统没有「客户可见自由文本原因」，客户面措辞一律由成因码生成；
  - reconciliation_dispositions 加 otherCause（可空）——成因=OTHER 时必填的一行成因名，其余成因恒 null。
  按「数据随时可重铺」不写回填：旧行 otherCause 留 null，reasonCustomer 随表重建直接丢弃；改完 = stack.sh reset 重铺。
*/
-- AlterTable
ALTER TABLE "reconciliation_dispositions" ADD COLUMN "otherCause" TEXT;

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
    "toWalletRef" TEXT,
    "toOwnerNo" TEXT,
    "book" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "relatedOrderNo" TEXT,
    "assetCode" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "reasonInternal" TEXT NOT NULL,
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
INSERT INTO "new_reconciliation_adjustments" ("adjustmentNo", "amount", "approvalCaseId", "approvalNo", "assetCode", "book", "caseNo", "createdAt", "createdByUserId", "decidedByUserId", "direction", "effectiveDate", "explainedExternalLineId", "explainedFlowId", "id", "ownerId", "ownerNo", "postedAt", "reasonCode", "reasonInternal", "relatedOrderNo", "status", "tbTransferId", "toOwnerNo", "toWalletRef", "traceId", "updatedAt", "walletRef") SELECT "adjustmentNo", "amount", "approvalCaseId", "approvalNo", "assetCode", "book", "caseNo", "createdAt", "createdByUserId", "decidedByUserId", "direction", "effectiveDate", "explainedExternalLineId", "explainedFlowId", "id", "ownerId", "ownerNo", "postedAt", "reasonCode", "reasonInternal", "relatedOrderNo", "status", "tbTransferId", "toOwnerNo", "toWalletRef", "traceId", "updatedAt", "walletRef" FROM "reconciliation_adjustments";
DROP TABLE "reconciliation_adjustments";
ALTER TABLE "new_reconciliation_adjustments" RENAME TO "reconciliation_adjustments";
CREATE UNIQUE INDEX "reconciliation_adjustments_adjustmentNo_key" ON "reconciliation_adjustments"("adjustmentNo");
CREATE INDEX "reconciliation_adjustments_caseNo_idx" ON "reconciliation_adjustments"("caseNo");
CREATE INDEX "reconciliation_adjustments_status_idx" ON "reconciliation_adjustments"("status");
CREATE INDEX "reconciliation_adjustments_walletRef_status_idx" ON "reconciliation_adjustments"("walletRef", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
