ALTER TABLE "customer_main" ADD COLUMN "complianceHoldStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "customer_main" ADD COLUMN "complianceHoldCaseId" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "complianceHoldReason" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "complianceHoldSetAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "complianceHoldReleasedAt" DATETIME;

ALTER TABLE "compliance_alerts" ADD COLUMN "overdueMarkedAt" DATETIME;

ALTER TABLE "compliance_incidents" ADD COLUMN "freezeStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "compliance_incidents" ADD COLUMN "frozenAt" DATETIME;
ALTER TABLE "compliance_incidents" ADD COLUMN "freezeReason" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "reportStatus" TEXT NOT NULL DEFAULT 'NOT_REPORTED';
ALTER TABLE "compliance_incidents" ADD COLUMN "reportRefNo" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "reportedAt" DATETIME;
ALTER TABLE "compliance_incidents" ADD COLUMN "reportReason" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "reportedByUserId" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "reportedByUserNo" TEXT;
ALTER TABLE "compliance_incidents" ADD COLUMN "overdueMarkedAt" DATETIME;

CREATE TABLE "compliance_case_evidence_packages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "packageNo" TEXT NOT NULL DEFAULT 'TEMP',
  "approvalCaseId" TEXT,
  "exportedByType" TEXT NOT NULL,
  "exportedById" TEXT NOT NULL,
  "exportedByRole" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  "exportMode" TEXT NOT NULL DEFAULT 'CASE_SELECTION',
  "fileName" TEXT,
  "filterSnapshot" TEXT,
  "selectedCaseIdsSnapshot" TEXT,
  "itemCount" INTEGER NOT NULL,
  "digest" TEXT NOT NULL,
  "manifest" TEXT NOT NULL,
  "packageBody" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "compliance_case_evidence_packages_approvalCaseId_fkey"
    FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "customer_main_complianceHoldStatus_idx" ON "customer_main"("complianceHoldStatus");
CREATE INDEX "compliance_alerts_status_dueAt_overdueMarkedAt_idx"
  ON "compliance_alerts"("status", "dueAt", "overdueMarkedAt");
CREATE UNIQUE INDEX "compliance_incidents_reportRefNo_key" ON "compliance_incidents"("reportRefNo");
CREATE INDEX "compliance_incidents_status_dueAt_overdueMarkedAt_idx"
  ON "compliance_incidents"("status", "dueAt", "overdueMarkedAt");
CREATE INDEX "compliance_incidents_reportStatus_reportedAt_idx"
  ON "compliance_incidents"("reportStatus", "reportedAt");
CREATE UNIQUE INDEX "compliance_case_evidence_packages_packageNo_key"
  ON "compliance_case_evidence_packages"("packageNo");
CREATE UNIQUE INDEX "compliance_case_evidence_packages_approvalCaseId_key"
  ON "compliance_case_evidence_packages"("approvalCaseId");
CREATE INDEX "compliance_case_evidence_packages_createdAt_idx"
  ON "compliance_case_evidence_packages"("createdAt");
CREATE INDEX "compliance_case_evidence_packages_exportedByType_exportedById_idx"
  ON "compliance_case_evidence_packages"("exportedByType", "exportedById");
CREATE INDEX "compliance_case_evidence_packages_status_createdAt_idx"
  ON "compliance_case_evidence_packages"("status", "createdAt");
