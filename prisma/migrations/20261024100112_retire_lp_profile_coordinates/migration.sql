/*
  Warnings:

  - You are about to drop the column `cryptoAddress` on the `liquidity_providers` table. All the data in the column will be lost.
  - You are about to drop the column `cryptoNetwork` on the `liquidity_providers` table. All the data in the column will be lost.
  - You are about to drop the column `fiatBankName` on the `liquidity_providers` table. All the data in the column will be lost.
  - You are about to drop the column `fiatIban` on the `liquidity_providers` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_liquidity_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lpNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "agreementRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalNo" TEXT,
    "screeningAnswer" TEXT,
    "screenedAt" DATETIME,
    "dueDiligenceRef" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_liquidity_providers" ("agreementRef", "approvalNo", "createdAt", "createdByUserId", "dueDiligenceRef", "id", "lpNo", "name", "screenedAt", "screeningAnswer", "status", "updatedAt") SELECT "agreementRef", "approvalNo", "createdAt", "createdByUserId", "dueDiligenceRef", "id", "lpNo", "name", "screenedAt", "screeningAnswer", "status", "updatedAt" FROM "liquidity_providers";
DROP TABLE "liquidity_providers";
ALTER TABLE "new_liquidity_providers" RENAME TO "liquidity_providers";
CREATE UNIQUE INDEX "liquidity_providers_lpNo_key" ON "liquidity_providers"("lpNo");
CREATE INDEX "liquidity_providers_status_idx" ON "liquidity_providers"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
