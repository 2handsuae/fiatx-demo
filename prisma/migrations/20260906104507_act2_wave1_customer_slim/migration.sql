/*
  Warnings:

  - You are about to drop the `customer_material_holdings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `material_refresh_cycles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `assignedByUserId` on the `customer_explicit_tags` table. All the data in the column will be lost.
  - You are about to drop the column `cddDocumentExpiresAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `emailVerifiedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `investorTier` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `investorTierUpdatedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `lastLoginIp` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `latestRiskApprovalId` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `latestRiskApprovalStatus` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `latestRiskAssessmentId` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `locale` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `nextReviewAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `pepConfirmedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `pepStatus` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `phoneVerifiedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `riskLevel` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `sumsubExperiencedLevel2` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `sumsubLatestAttemptId` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `sumsubLatestReviewId` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `termsAcceptedAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `timezone` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `verificationCanContinue` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `verificationCustomerActionRequired` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `verificationLatestEventAt` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `verificationLatestEventType` on the `customer_main` table. All the data in the column will be lost.
  - You are about to drop the column `verificationSubstatus` on the `customer_main` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "customer_material_holdings_holdingNo_key";

-- DropIndex
DROP INDEX "customer_material_holdings_customerId_materialType_key";

-- DropIndex
DROP INDEX "customer_material_holdings_customerId_idx";

-- DropIndex
DROP INDEX "customer_material_holdings_expiresAt_status_idx";

-- DropIndex
DROP INDEX "customer_material_holdings_activeRefreshCycleId_key";

-- DropIndex
DROP INDEX "material_refresh_cycles_status_graceExpiresAt_idx";

-- DropIndex
DROP INDEX "material_refresh_cycles_customerId_status_idx";

-- DropIndex
DROP INDEX "material_refresh_cycles_traceId_key";

-- DropIndex
DROP INDEX "material_refresh_cycles_cycleNo_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "customer_material_holdings";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "material_refresh_cycles";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customer_explicit_tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "tagCode" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_explicit_tags_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_customer_explicit_tags" ("assignedAt", "customerId", "id", "tagCode") SELECT "assignedAt", "customerId", "id", "tagCode" FROM "customer_explicit_tags";
DROP TABLE "customer_explicit_tags";
ALTER TABLE "new_customer_explicit_tags" RENAME TO "customer_explicit_tags";
CREATE INDEX "customer_explicit_tags_tagCode_idx" ON "customer_explicit_tags"("tagCode");
CREATE UNIQUE INDEX "customer_explicit_tags_customerId_tagCode_key" ON "customer_explicit_tags"("customerId", "tagCode");
CREATE TABLE "new_customer_main" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "email" TEXT,
    "phone" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "passwordHash" TEXT,
    "passwordUpdatedAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lifecycle" TEXT NOT NULL DEFAULT 'PROSPECT',
    "onboardingApprovedAt" DATETIME,
    "hard_line_dispositioned_at" DATETIME,
    "tradingTier" TEXT NOT NULL DEFAULT 'BASIC',
    "riskRating" TEXT NOT NULL DEFAULT 'LOW',
    "riskRatingUpdatedAt" DATETIME,
    "eddRequired" BOOLEAN NOT NULL DEFAULT false,
    "sumsubApplicantId" TEXT,
    "sumsubCurrentLevelName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_customer_main" ("companyName", "createdAt", "customerNo", "customerType", "eddRequired", "email", "failedLoginCount", "firstName", "hard_line_dispositioned_at", "id", "lastLoginAt", "lastName", "lifecycle", "lockedUntil", "onboardingApprovedAt", "passwordHash", "passwordUpdatedAt", "phone", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "tradingTier", "updatedAt") SELECT "companyName", "createdAt", "customerNo", "customerType", "eddRequired", "email", "failedLoginCount", "firstName", "hard_line_dispositioned_at", "id", "lastLoginAt", "lastName", "lifecycle", "lockedUntil", "onboardingApprovedAt", "passwordHash", "passwordUpdatedAt", "phone", "riskRating", "riskRatingUpdatedAt", "sumsubApplicantId", "sumsubCurrentLevelName", "tradingTier", "updatedAt" FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE UNIQUE INDEX "customer_main_sumsubApplicantId_key" ON "customer_main"("sumsubApplicantId");
CREATE INDEX "customer_main_riskRating_idx" ON "customer_main"("riskRating");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
