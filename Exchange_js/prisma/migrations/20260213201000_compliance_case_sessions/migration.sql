-- AlterTable
ALTER TABLE "cdd_cases" ADD COLUMN "subjectKind" TEXT NOT NULL DEFAULT 'INDIVIDUAL_CUSTOMER';
ALTER TABLE "cdd_cases" ADD COLUMN "subjectRefId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "cdd_cases" ADD COLUMN "journeyId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "edd_cases" ADD COLUMN "subjectKind" TEXT NOT NULL DEFAULT 'INDIVIDUAL_CUSTOMER';
ALTER TABLE "edd_cases" ADD COLUMN "subjectRefId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "edd_cases" ADD COLUMN "journeyId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ubo_profiles" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';

-- Data backfill for existing rows
UPDATE "cdd_cases"
SET
  "subjectKind" = CASE
    WHEN "customerType" = 'CORPORATE' THEN 'CORPORATE_ENTITY'
    ELSE 'INDIVIDUAL_CUSTOMER'
  END,
  "subjectRefId" = CASE
    WHEN "subjectRefId" = '' THEN "customerId"
    ELSE "subjectRefId"
  END,
  "journeyId" = CASE
    WHEN "journeyId" = '' THEN "caseNo"
    ELSE "journeyId"
  END;

UPDATE "edd_cases"
SET
  "subjectRefId" = CASE
    WHEN "subjectRefId" = '' THEN "customerId"
    ELSE "subjectRefId"
  END,
  "journeyId" = CASE
    WHEN "journeyId" = '' THEN "caseNo"
    ELSE "journeyId"
  END;

UPDATE "customer_main"
SET "customerType" = 'INDIVIDUAL'
WHERE "customerType" = 'UNKNOWN';

-- CreateTable
CREATE TABLE "compliance_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "caseType" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MOCK',
  "providerSessionId" TEXT NOT NULL,
  "qrCodeUrl" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "rawPayload" TEXT,
  "expiresAt" DATETIME NOT NULL,
  "completedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "compliance_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "cdd_cases_customerId_journeyId_idx" ON "cdd_cases"("customerId", "journeyId");
CREATE INDEX "cdd_cases_subjectKind_subjectRefId_idx" ON "cdd_cases"("subjectKind", "subjectRefId");
CREATE INDEX "edd_cases_customerId_journeyId_idx" ON "edd_cases"("customerId", "journeyId");
CREATE INDEX "edd_cases_subjectKind_subjectRefId_idx" ON "edd_cases"("subjectKind", "subjectRefId");
CREATE UNIQUE INDEX "compliance_sessions_providerSessionId_key" ON "compliance_sessions"("providerSessionId");
CREATE INDEX "compliance_sessions_customerId_caseType_caseId_idx" ON "compliance_sessions"("customerId", "caseType", "caseId");
CREATE INDEX "compliance_sessions_status_expiresAt_idx" ON "compliance_sessions"("status", "expiresAt");
