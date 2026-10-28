/*
  Warnings:

  - Added the required columns `applicationReason`, `contactEmail`, `contactName`, `deliveryLocations`, `impactContinuity`, `impactFinancial`, `impactLegal`, `impactLicence`, `involvesConfidentialInfo`, `involvesPersonalData`, `regulatedFunction`, `registeredIn`, `registrationNo`, `replaceability` to the `outsourcing_vendors` table without a default value. This is not possible if the table is not empty.

  甲波六 T6：本迁移只重建 outsourcing_vendors（服务商登记册改成服务商准入申请表，状态默认 PENDING_ASSESSMENT）。按「数据随时可重铺」不写回填——
  新必填列在 INSERT … SELECT 里给空串 / 0 占位（仅常量，不从旧行推导任何值），只为让 `stack.sh reset` 在已有行的库上也能走完迁移
  （行随即被业务重置清掉）；空库直接建表，无行可搬。
*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_outsourcing_vendors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registeredIn" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "deliveryLocations" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "beneficialOwners" TEXT NOT NULL DEFAULT '[]',
    "licensingAuthority" TEXT,
    "licenceNo" TEXT,
    "serviceDescription" TEXT NOT NULL,
    "regulatedFunction" BOOLEAN NOT NULL,
    "contractStart" DATETIME NOT NULL,
    "contractEnd" DATETIME,
    "involvesPersonalData" BOOLEAN NOT NULL,
    "involvesConfidentialInfo" BOOLEAN NOT NULL,
    "annualFee" DECIMAL,
    "feeCurrency" TEXT,
    "subcontracts" BOOLEAN NOT NULL DEFAULT false,
    "subcontractorNames" TEXT,
    "applicationReason" TEXT NOT NULL,
    "impactLicence" BOOLEAN NOT NULL,
    "impactLegal" BOOLEAN NOT NULL,
    "impactFinancial" BOOLEAN NOT NULL,
    "impactContinuity" BOOLEAN NOT NULL,
    "replaceability" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "criticalityReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_ASSESSMENT',
    "approvalNo" TEXT,
    "notificationFilingNo" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_outsourcing_vendors" ("applicationReason", "contactEmail", "contactName", "contractEnd", "contractStart", "createdAt", "createdByUserId", "criticality", "deliveryLocations", "id", "impactContinuity", "impactFinancial", "impactLegal", "impactLicence", "involvesConfidentialInfo", "involvesPersonalData", "name", "notes", "regulatedFunction", "registeredIn", "registrationNo", "replaceability", "serviceDescription", "status", "traceId", "updatedAt", "vendorNo") SELECT '', '', '', "contractEnd", "contractStart", "createdAt", "createdByUserId", "criticality", '', "id", 0, 0, 0, 0, 0, 0, "name", "notes", 0, '', '', '', "serviceDescription", "status", "traceId", "updatedAt", "vendorNo" FROM "outsourcing_vendors";
DROP TABLE "outsourcing_vendors";
ALTER TABLE "new_outsourcing_vendors" RENAME TO "outsourcing_vendors";
CREATE UNIQUE INDEX "outsourcing_vendors_vendorNo_key" ON "outsourcing_vendors"("vendorNo");
CREATE INDEX "outsourcing_vendors_status_idx" ON "outsourcing_vendors"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

