-- Add generic transaction compliance case/report tables for KYT and Travel Rule.

CREATE TABLE "kyt_cases" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "screeningStage" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT,
  "assetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MOCK',
  "providerCaseId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "riskScore" INTEGER,
  "checkedAt" DATETIME,
  "latestRawPayload" TEXT,
  "latestNormalizedPayload" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "kyt_cases_caseNo_key" ON "kyt_cases"("caseNo");
CREATE UNIQUE INDEX "kyt_cases_sourceType_sourceId_screeningStage_key"
ON "kyt_cases"("sourceType", "sourceId", "screeningStage");
CREATE INDEX "kyt_cases_sourceType_sourceId_idx" ON "kyt_cases"("sourceType", "sourceId");
CREATE INDEX "kyt_cases_status_idx" ON "kyt_cases"("status");
CREATE INDEX "kyt_cases_provider_providerCaseId_idx" ON "kyt_cases"("provider", "providerCaseId");

CREATE TABLE "kyt_case_reports" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kytCaseId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "screeningStage" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MOCK',
  "providerCaseId" TEXT,
  "rawPayload" TEXT,
  "normalizedPayload" TEXT,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "kyt_case_reports_kytCaseId_fkey"
    FOREIGN KEY ("kytCaseId") REFERENCES "kyt_cases" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "kyt_case_reports_kytCaseId_idx" ON "kyt_case_reports"("kytCaseId");
CREATE INDEX "kyt_case_reports_sourceType_sourceId_screeningStage_idx"
ON "kyt_case_reports"("sourceType", "sourceId", "screeningStage");
CREATE INDEX "kyt_case_reports_provider_providerCaseId_idx"
ON "kyt_case_reports"("provider", "providerCaseId");
CREATE INDEX "kyt_case_reports_receivedAt_idx" ON "kyt_case_reports"("receivedAt");

CREATE TABLE "travel_rule_cases" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT,
  "assetId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MOCK',
  "providerTransferId" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "counterpartyVasp" TEXT,
  "checkedAt" DATETIME,
  "latestRawPayload" TEXT,
  "latestNormalizedPayload" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "travel_rule_cases_caseNo_key" ON "travel_rule_cases"("caseNo");
CREATE UNIQUE INDEX "travel_rule_cases_sourceType_sourceId_key"
ON "travel_rule_cases"("sourceType", "sourceId");
CREATE INDEX "travel_rule_cases_sourceType_sourceId_idx" ON "travel_rule_cases"("sourceType", "sourceId");
CREATE INDEX "travel_rule_cases_status_idx" ON "travel_rule_cases"("status");
CREATE INDEX "travel_rule_cases_provider_providerTransferId_idx"
ON "travel_rule_cases"("provider", "providerTransferId");

CREATE TABLE "travel_rule_case_reports" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "travelRuleCaseId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MOCK',
  "providerTransferId" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL,
  "counterpartyVasp" TEXT,
  "rawPayload" TEXT,
  "normalizedPayload" TEXT,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "travel_rule_case_reports_travelRuleCaseId_fkey"
    FOREIGN KEY ("travelRuleCaseId") REFERENCES "travel_rule_cases" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "travel_rule_case_reports_travelRuleCaseId_idx"
ON "travel_rule_case_reports"("travelRuleCaseId");
CREATE INDEX "travel_rule_case_reports_sourceType_sourceId_idx"
ON "travel_rule_case_reports"("sourceType", "sourceId");
CREATE INDEX "travel_rule_case_reports_provider_providerTransferId_idx"
ON "travel_rule_case_reports"("provider", "providerTransferId");
CREATE INDEX "travel_rule_case_reports_receivedAt_idx"
ON "travel_rule_case_reports"("receivedAt");
