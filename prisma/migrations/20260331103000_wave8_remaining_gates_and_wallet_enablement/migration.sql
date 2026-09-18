ALTER TABLE "wallets" ADD COLUMN "regulatoryEnablementStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "wallets" ADD COLUMN "regulatoryEnabledAt" DATETIME;

UPDATE "wallets"
SET
  "regulatoryEnablementStatus" = 'EFFECTIVE',
  "regulatoryEnabledAt" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP)
WHERE UPPER(COALESCE("walletRole", '')) = 'CUST_BANK';

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_regulatory_gate_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateNo" TEXT NOT NULL DEFAULT 'TEMP',
    "gateType" TEXT NOT NULL,
    "authority" TEXT NOT NULL DEFAULT 'VARA',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectNo" TEXT NOT NULL,
    "scopeSummary" TEXT,
    "shareholdingRegistryVersionId" TEXT,
    "appointmentRecordId" TEXT,
    "businessConfigReleaseId" TEXT,
    "walletId" TEXT,
    "linkedApprovalId" TEXT,
    "internalApprovalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "filingStatus" TEXT NOT NULL DEFAULT 'REQUIRED',
    "receiptStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "effectivenessStatus" TEXT NOT NULL DEFAULT 'BLOCKED',
    "gateResult" TEXT NOT NULL DEFAULT 'BLOCKED',
    "filingRefNo" TEXT,
    "filingSubmittedAt" DATETIME,
    "latestFeedback" TEXT,
    "latestFeedbackAt" DATETIME,
    "receiptType" TEXT,
    "receiptRefNo" TEXT,
    "receiptBoundAt" DATETIME,
    "proposedEffectiveAt" DATETIME,
    "effectiveAt" DATETIME,
    "revokedAt" DATETIME,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "traceId" TEXT NOT NULL,
    "activeKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "regulatory_gate_items_shareholdingRegistryVersionId_fkey" FOREIGN KEY ("shareholdingRegistryVersionId") REFERENCES "shareholding_registry_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_appointmentRecordId_fkey" FOREIGN KEY ("appointmentRecordId") REFERENCES "appointment_records" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_businessConfigReleaseId_fkey" FOREIGN KEY ("businessConfigReleaseId") REFERENCES "business_config_releases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "regulatory_gate_items_linkedApprovalId_fkey" FOREIGN KEY ("linkedApprovalId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_regulatory_gate_items" (
  "id",
  "gateNo",
  "gateType",
  "authority",
  "subjectType",
  "subjectId",
  "subjectNo",
  "scopeSummary",
  "shareholdingRegistryVersionId",
  "appointmentRecordId",
  "linkedApprovalId",
  "internalApprovalStatus",
  "filingStatus",
  "receiptStatus",
  "effectivenessStatus",
  "gateResult",
  "filingRefNo",
  "filingSubmittedAt",
  "latestFeedback",
  "latestFeedbackAt",
  "receiptType",
  "receiptRefNo",
  "receiptBoundAt",
  "proposedEffectiveAt",
  "effectiveAt",
  "revokedAt",
  "metadataJson",
  "traceId",
  "activeKey",
  "createdByUserId",
  "updatedByUserId",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "gateNo",
  "gateType",
  "authority",
  "subjectType",
  "subjectId",
  "subjectNo",
  "scopeSummary",
  "shareholdingRegistryVersionId",
  "appointmentRecordId",
  "linkedApprovalId",
  "internalApprovalStatus",
  "filingStatus",
  "receiptStatus",
  "effectivenessStatus",
  "gateResult",
  "filingRefNo",
  "filingSubmittedAt",
  "latestFeedback",
  "latestFeedbackAt",
  "receiptType",
  "receiptRefNo",
  "receiptBoundAt",
  "proposedEffectiveAt",
  "effectiveAt",
  "revokedAt",
  "metadataJson",
  "traceId",
  "activeKey",
  "createdByUserId",
  "updatedByUserId",
  "createdAt",
  "updatedAt"
FROM "regulatory_gate_items";

DROP TABLE "regulatory_gate_items";
ALTER TABLE "new_regulatory_gate_items" RENAME TO "regulatory_gate_items";

CREATE UNIQUE INDEX "regulatory_gate_items_gateNo_key" ON "regulatory_gate_items"("gateNo");
CREATE UNIQUE INDEX "regulatory_gate_items_activeKey_key" ON "regulatory_gate_items"("activeKey");
CREATE INDEX "regulatory_gate_items_gateType_createdAt_idx" ON "regulatory_gate_items"("gateType", "createdAt");
CREATE INDEX "regulatory_gate_items_subjectType_subjectId_createdAt_idx" ON "regulatory_gate_items"("subjectType", "subjectId", "createdAt");
CREATE INDEX "regulatory_gate_items_subjectType_subjectNo_createdAt_idx" ON "regulatory_gate_items"("subjectType", "subjectNo", "createdAt");
CREATE INDEX "regulatory_gate_items_gateResult_createdAt_idx" ON "regulatory_gate_items"("gateResult", "createdAt");
CREATE INDEX "regulatory_gate_items_filingStatus_receiptStatus_effectivenessStatus_idx" ON "regulatory_gate_items"("filingStatus", "receiptStatus", "effectivenessStatus");
CREATE INDEX "regulatory_gate_items_traceId_createdAt_idx" ON "regulatory_gate_items"("traceId", "createdAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
