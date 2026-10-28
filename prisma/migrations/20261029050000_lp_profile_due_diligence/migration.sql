/*
  Warnings:

  - You are about to drop the column `dueDiligenceRef` on the `liquidity_providers` table. All the data in the column will be lost.
  - You are about to drop the column `screenedAt` on the `liquidity_providers` table. All the data in the column will be lost.
  - You are about to drop the column `screeningAnswer` on the `liquidity_providers` table. All the data in the column will be lost.
  - Added the required columns `applicationReason`, `contactEmail`, `contactName`, `expectedMonthlyVolume`, `licenceNo`, `licensingAuthority`, `registeredIn`, `registrationNo`, `tradingTypes`, `volumeCurrency` to the `liquidity_providers` table without a default value. This is not possible if the table is not empty.

  甲波六 T4：本迁移只重建 liquidity_providers。按「数据随时可重铺」不写回填——新必填列在 INSERT … SELECT 里
  给空串 / 0 占位，只为让 `stack.sh reset` 在已有行的库上也能走完迁移（行随即被业务重置清掉）；空库直接建表，无行可搬。
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_liquidity_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lpNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registeredIn" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "licensingAuthority" TEXT NOT NULL,
    "licenceNo" TEXT NOT NULL,
    "beneficialOwners" TEXT NOT NULL DEFAULT '[]',
    "tradingTypes" TEXT NOT NULL,
    "expectedMonthlyVolume" DECIMAL NOT NULL,
    "volumeCurrency" TEXT NOT NULL,
    "applicationReason" TEXT NOT NULL,
    "agreementRef" TEXT NOT NULL,
    "agreementStart" DATETIME,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_ASSESSMENT',
    "approvalNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_liquidity_providers" ("agreementRef", "applicationReason", "approvalNo", "contactEmail", "contactName", "createdAt", "createdByUserId", "expectedMonthlyVolume", "id", "licenceNo", "licensingAuthority", "lpNo", "name", "registeredIn", "registrationNo", "status", "tradingTypes", "updatedAt", "volumeCurrency") SELECT "agreementRef", '', "approvalNo", '', '', "createdAt", "createdByUserId", 0, "id", '', '', "lpNo", "name", '', '', "status", '', "updatedAt", '' FROM "liquidity_providers";
DROP TABLE "liquidity_providers";
ALTER TABLE "new_liquidity_providers" RENAME TO "liquidity_providers";
CREATE UNIQUE INDEX "liquidity_providers_lpNo_key" ON "liquidity_providers"("lpNo");
CREATE INDEX "liquidity_providers_status_idx" ON "liquidity_providers"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

