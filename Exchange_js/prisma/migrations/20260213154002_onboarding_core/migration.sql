-- CreateTable
CREATE TABLE "cdd_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerId" TEXT NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "reviewerId" TEXT,
    "reviewerRole" TEXT,
    "reviewerDecision" TEXT,
    "decisionReason" TEXT,
    "requiresEdd" BOOLEAN NOT NULL DEFAULT false,
    "riskScore" INTEGER,
    "riskLevel" TEXT,
    "screeningSummary" TEXT,
    "inputData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cdd_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "edd_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerId" TEXT NOT NULL,
    "cddCaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedAt" DATETIME,
    "mlroReviewedAt" DATETIME,
    "mlroReviewerId" TEXT,
    "mlroDecision" TEXT,
    "seniorReviewedAt" DATETIME,
    "seniorReviewerId" TEXT,
    "seniorDecision" TEXT,
    "decisionReason" TEXT,
    "sourceOfFunds" TEXT,
    "sourceOfWealth" TEXT,
    "inputData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "edd_cases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "edd_cases_cddCaseId_fkey" FOREIGN KEY ("cddCaseId") REFERENCES "cdd_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "corporate_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "incorporationCountry" TEXT NOT NULL,
    "registeredAddress" TEXT,
    "licenseType" TEXT,
    "licenseNumber" TEXT,
    "authorizedSignatoryName" TEXT,
    "authorizedSignatoryTitle" TEXT,
    "documents" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "corporate_profiles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ubo_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "ownershipPercent" DECIMAL,
    "nationality" TEXT,
    "idNumber" TEXT,
    "pepFlag" BOOLEAN NOT NULL DEFAULT false,
    "documents" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ubo_profiles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "onboarding_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "caseType" TEXT,
    "caseId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_audit_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customer_main" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerNo" TEXT NOT NULL DEFAULT 'TEMP',
    "email" TEXT,
    "phone" TEXT,
    "emailVerifiedAt" DATETIME,
    "phoneVerifiedAt" DATETIME,
    "firstName" TEXT,
    "lastName" TEXT,
    "passwordHash" TEXT,
    "passwordUpdatedAt" DATETIME,
    "authStatus" TEXT NOT NULL DEFAULT 'NONE',
    "authLevel" TEXT NOT NULL DEFAULT 'NONE',
    "kycId" TEXT,
    "eddId" TEXT,
    "authLevelExpiresAt" DATETIME,
    "riskScore" INTEGER,
    "riskLevel" TEXT,
    "riskUpdatedAt" DATETIME,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "lastLoginIp" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "termsAcceptedAt" DATETIME,
    "statusHistory" TEXT,
    "customerType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "onboardingStage" TEXT NOT NULL DEFAULT 'REGISTERED',
    "onboardingApprovedAt" DATETIME,
    "onboardingRejectedAt" DATETIME,
    "onboardingRejectReason" TEXT,
    "canTradeSwap" BOOLEAN NOT NULL DEFAULT false,
    "canTradeWithdraw" BOOLEAN NOT NULL DEFAULT false,
    "activeCddCaseId" TEXT,
    "activeEddCaseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_customer_main" ("authLevel", "authLevelExpiresAt", "authStatus", "createdAt", "customerNo", "eddId", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "kycId", "lastLoginAt", "lastLoginIp", "lastName", "locale", "lockedUntil", "passwordHash", "passwordUpdatedAt", "phone", "phoneVerifiedAt", "riskLevel", "riskScore", "riskUpdatedAt", "statusHistory", "termsAcceptedAt", "timezone", "updatedAt") SELECT "authLevel", "authLevelExpiresAt", "authStatus", "createdAt", "customerNo", "eddId", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "kycId", "lastLoginAt", "lastLoginIp", "lastName", "locale", "lockedUntil", "passwordHash", "passwordUpdatedAt", "phone", "phoneVerifiedAt", "riskLevel", "riskScore", "riskUpdatedAt", "statusHistory", "termsAcceptedAt", "timezone", "updatedAt" FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "cdd_cases_caseNo_key" ON "cdd_cases"("caseNo");

-- CreateIndex
CREATE INDEX "cdd_cases_customerId_status_idx" ON "cdd_cases"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "edd_cases_caseNo_key" ON "edd_cases"("caseNo");

-- CreateIndex
CREATE INDEX "edd_cases_customerId_status_idx" ON "edd_cases"("customerId", "status");

-- CreateIndex
CREATE INDEX "edd_cases_cddCaseId_idx" ON "edd_cases"("cddCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_profiles_customerId_key" ON "corporate_profiles"("customerId");

-- CreateIndex
CREATE INDEX "ubo_profiles_customerId_idx" ON "ubo_profiles"("customerId");

-- CreateIndex
CREATE INDEX "onboarding_audit_logs_customerId_createdAt_idx" ON "onboarding_audit_logs"("customerId", "createdAt");

