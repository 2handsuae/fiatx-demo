-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userNo" TEXT NOT NULL DEFAULT 'TEMP',
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "customer_main" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerNo" TEXT NOT NULL DEFAULT 'TEMP',
    "email" TEXT,
    "phone" TEXT,
    "emailVerifiedAt" DATETIME,
    "phoneVerifiedAt" DATETIME,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "passwordHash" TEXT,
    "passwordUpdatedAt" DATETIME,
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
    "customerType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "cddStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "amlRiskTier" TEXT NOT NULL DEFAULT 'LOW',
    "eddRequired" BOOLEAN NOT NULL DEFAULT false,
    "eddStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "complianceStatus" TEXT NOT NULL DEFAULT 'NONE',
    "cddDocumentExpiresAt" DATETIME,
    "finalApprovalStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "finalApprovalReason" TEXT,
    "finalApprovalReviewerId" TEXT,
    "finalApprovalReviewedAt" DATETIME,
    "nextReviewAt" DATETIME,
    "currentCddCaseId" TEXT,
    "currentEddCaseId" TEXT,
    "investorClassification" TEXT NOT NULL DEFAULT 'RETAIL',
    "investorClassificationSource" TEXT NOT NULL DEFAULT 'CDD',
    "investorClassificationUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "cdd_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL DEFAULT 'TEMP',
    "customerId" TEXT NOT NULL,
    "customerType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
    "subjectKind" TEXT NOT NULL DEFAULT 'INDIVIDUAL_CUSTOMER',
    "subjectRefId" TEXT NOT NULL DEFAULT '',
    "journeyId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
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
    "pepHit" BOOLEAN NOT NULL DEFAULT false,
    "sanctionsHit" BOOLEAN NOT NULL DEFAULT false,
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
    "subjectKind" TEXT NOT NULL DEFAULT 'INDIVIDUAL_CUSTOMER',
    "subjectRefId" TEXT NOT NULL DEFAULT '',
    "journeyId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedAt" DATETIME,
    "mlroReviewedAt" DATETIME,
    "mlroReviewerId" TEXT,
    "mlroDecision" TEXT,
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
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documents" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ubo_profiles_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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

-- CreateTable
CREATE TABLE "cdd_case_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "cddCaseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "providerSessionId" TEXT,
    "rawPayload" TEXT,
    "normalizedPayload" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cdd_case_reports_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cdd_case_reports_cddCaseId_fkey" FOREIGN KEY ("cddCaseId") REFERENCES "cdd_cases" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "edd_case_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "eddCaseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "providerSessionId" TEXT,
    "rawPayload" TEXT,
    "normalizedPayload" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "edd_case_reports_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "edd_case_reports_eddCaseId_fkey" FOREIGN KEY ("eddCaseId") REFERENCES "edd_cases" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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

-- CreateTable
CREATE TABLE "liquidity_provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetNo" TEXT,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "network" TEXT,
    "decimals" INTEGER NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "payins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payinNo" TEXT NOT NULL DEFAULT 'TEMP',
    "depositId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'crypto',
    "status" TEXT NOT NULL,
    "toWalletId" TEXT,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "toAddress" TEXT,
    "toIban" TEXT,
    "fromWalletId" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "providerTxnId" TEXT,
    "receivedAt" DATETIME,
    "confirmedAt" DATETIME,
    "statusHistory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT,
    CONSTRAINT "payins_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payins_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "payins_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payins_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "liquidity_configurations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lpId" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "rateSourceType" TEXT NOT NULL,
    "feePercent" DECIMAL NOT NULL DEFAULT 0,
    "feeFixedAmount" DECIMAL NOT NULL DEFAULT 0,
    "feeAssetId" TEXT,
    "minFromAmount" DECIMAL,
    "maxFromAmount" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "liquidity_configurations_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "liquidity_provider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "liquidity_configurations_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "liquidity_configurations_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "liquidity_configurations_feeAssetId_fkey" FOREIGN KEY ("feeAssetId") REFERENCES "assets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerNo" TEXT,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "balance" DECIMAL NOT NULL DEFAULT 0,
    "lockedBalance" DECIMAL NOT NULL DEFAULT 0,
    "address" TEXT,
    "memo" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "bankCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "accountName" TEXT,
    "beneficiaryName" TEXT,
    "counterpartyVasp" TEXT,
    "iban" TEXT,
    CONSTRAINT "wallets_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "wallets_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deposit_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depositNo" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "toWalletId" TEXT NOT NULL,
    "payinId" TEXT,
    "amount" DECIMAL NOT NULL,
    "netAmount" DECIMAL NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "fromWalletId" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "txHash" TEXT,
    "referenceNo" TEXT,
    "expiresAt" DATETIME,
    "kytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kytScreeningId" TEXT,
    "kytRiskScore" INTEGER,
    "kytCheckedAt" DATETIME,
    "travelRuleRequired" BOOLEAN NOT NULL DEFAULT false,
    "travelRuleStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "travelRuleTransferId" TEXT,
    "counterpartyVasp" TEXT,
    "travelRuleCheckedAt" DATETIME,
    "statusHistory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "deposit_transactions_payinId_fkey" FOREIGN KEY ("payinId") REFERENCES "payins" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_toWalletId_fkey" FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_fromWalletId_fkey" FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deposit_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payin_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payinId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payin_audit_logs_payinId_fkey" FOREIGN KEY ("payinId") REFERENCES "payins" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "deposit_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "depositTransactionId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deposit_audit_logs_depositTransactionId_fkey" FOREIGN KEY ("depositTransactionId") REFERENCES "deposit_transactions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requiredTags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "journals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalNo" TEXT NOT NULL DEFAULT 'TEMP',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNo" TEXT,
    "eventCode" TEXT NOT NULL,
    "postingStatus" TEXT NOT NULL DEFAULT 'POSTED',
    "postedAt" DATETIME,
    "baseAssetId" TEXT NOT NULL,
    "reversalOfJournalId" TEXT,
    "description" TEXT,
    "totalAmount" DECIMAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "journalHeaderTemplateId" TEXT,
    CONSTRAINT "journals_baseAssetId_fkey" FOREIGN KEY ("baseAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journals_journalHeaderTemplateId_fkey" FOREIGN KEY ("journalHeaderTemplateId") REFERENCES "journal_header_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "drCr" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "baseAmount" DECIMAL,
    "fxRate" DECIMAL,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "dimensions" TEXT NOT NULL DEFAULT '{}',
    "description" TEXT,
    "referenceId" TEXT,
    "journalLineTemplateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_lines_journalLineTemplateId_fkey" FOREIGN KEY ("journalLineTemplateId") REFERENCES "journal_line_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "journals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "chart_of_accounts" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_lines_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "acct_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventCode" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "ownerScope" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "postingMode" TEXT NOT NULL,
    "clearingMode" TEXT NOT NULL,
    "postingReversalOfEventCode" TEXT,
    "clearingReversalOfEventCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "triggerKey" TEXT,
    "clearingTemplateCode" TEXT,
    CONSTRAINT "acct_events_postingReversalOfEventCode_fkey" FOREIGN KEY ("postingReversalOfEventCode") REFERENCES "acct_events" ("eventCode") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "acct_events_clearingReversalOfEventCode_fkey" FOREIGN KEY ("clearingReversalOfEventCode") REFERENCES "acct_events" ("eventCode") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "journal_header_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateCode" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "baseAssetId" TEXT NOT NULL,
    "description" TEXT,
    "effectiveFrom" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    CONSTRAINT "journal_header_templates_eventCode_fkey" FOREIGN KEY ("eventCode") REFERENCES "acct_events" ("eventCode") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "journal_header_templates_baseAssetId_fkey" FOREIGN KEY ("baseAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "journal_line_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "drCr" TEXT NOT NULL,
    "amountSource" TEXT NOT NULL,
    "assetSource" TEXT NOT NULL,
    "ownerTypeSource" TEXT,
    "ownerIdSource" TEXT,
    "fxRateSource" TEXT,
    "referenceSource" TEXT,
    "dimensionsRule" TEXT NOT NULL DEFAULT '{}',
    "conditionExpr" TEXT,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_line_templates_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "journal_header_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "journal_line_templates_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "chart_of_accounts" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "swap_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "swapNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "status" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "fromAssetCode" TEXT,
    "fromAmount" DECIMAL NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "toAssetCode" TEXT,
    "toAmount" DECIMAL NOT NULL,
    "exchangeRate" DECIMAL NOT NULL,
    "statusHistory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "swap_transactions_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_transactions_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "swap_transaction_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "swapTransactionId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "swap_transaction_audit_logs_swapTransactionId_fkey" FOREIGN KEY ("swapTransactionId") REFERENCES "swap_transactions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "withdraw_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawNo" TEXT NOT NULL,
    "payoutId" TEXT,
    "payoutNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerNo" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "netAmount" DECIMAL NOT NULL,
    "toWalletId" TEXT,
    "toWalletNo" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "fromWalletId" TEXT,
    "fromWalletNo" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "providerTxnId" TEXT,
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "preKytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "preKytId" TEXT,
    "preKytRiskScore" INTEGER,
    "preKytCheckedAt" DATETIME,
    "kytStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kytScreeningId" TEXT,
    "kytRiskScore" INTEGER,
    "kytCheckedAt" DATETIME,
    "travelRuleRequired" BOOLEAN NOT NULL DEFAULT false,
    "counterpartyVasp" TEXT,
    "travelRuleStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "travelRuleTransferId" TEXT,
    "travelRuleCheckedAt" DATETIME,
    "complianceStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "complianceReviewedAt" DATETIME,
    "parentType" TEXT,
    "parentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "payoutRequestedAt" DATETIME,
    "completedAt" DATETIME,
    "statusHistory" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "withdraw_transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "withdraw_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payoutNo" TEXT NOT NULL DEFAULT 'TEMP',
    "withdrawId" TEXT NOT NULL,
    "ownerId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL NOT NULL,
    "assetId" TEXT NOT NULL,
    "toWalletId" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "txHash" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "referenceNo" TEXT,
    "providerTxnId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "statusHistory" TEXT,
    CONSTRAINT "payouts_withdrawId_fkey" FOREIGN KEY ("withdrawId") REFERENCES "withdraw_transactions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payouts_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payouts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payout_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payoutId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payout_audit_logs_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "withdraw_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawTransactionId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "withdraw_audit_logs_withdrawTransactionId_fkey" FOREIGN KEY ("withdrawTransactionId") REFERENCES "withdraw_transactions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "clearing_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "clearingType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL,
    "feeMethod" TEXT NOT NULL DEFAULT 'CONFIGURED_FEE',
    "outAssetSource" TEXT NOT NULL,
    "outAmountSource" TEXT NOT NULL,
    "inAssetSource" TEXT NOT NULL,
    "inAmountSource" TEXT NOT NULL,
    "feeAssetSource" TEXT NOT NULL,
    "feeAmountSource" TEXT NOT NULL,
    "outPayoutIdSource" TEXT,
    "inPayinIdSource" TEXT,
    "memoTemplate" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "clearing_line_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clearingTemplateId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "lineType" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "partyIdSource" TEXT,
    "assetSource" TEXT NOT NULL,
    "amountSource" TEXT NOT NULL,
    "refTypeConst" TEXT,
    "refIdSource" TEXT,
    "memoTemplate" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clearing_line_templates_clearingTemplateId_fkey" FOREIGN KEY ("clearingTemplateId") REFERENCES "clearing_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "clearings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clearingNo" TEXT NOT NULL DEFAULT 'TEMP',
    "clearingType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "outAssetId" TEXT NOT NULL,
    "outAmount" DECIMAL NOT NULL,
    "inAssetId" TEXT NOT NULL,
    "inAmount" DECIMAL NOT NULL,
    "feeAssetId" TEXT NOT NULL,
    "feeAmount" DECIMAL NOT NULL,
    "feeMethod" TEXT NOT NULL DEFAULT 'CONFIGURED_FEE',
    "outPayoutId" TEXT,
    "inPayinId" TEXT,
    "clearingStatus" TEXT NOT NULL DEFAULT 'OPEN',
    "memo" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "clearings_inPayinId_fkey" FOREIGN KEY ("inPayinId") REFERENCES "payins" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "clearings_outPayoutId_fkey" FOREIGN KEY ("outPayoutId") REFERENCES "payouts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "clearing_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clearingId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "lineType" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "partyId" TEXT,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clearing_lines_clearingId_fkey" FOREIGN KEY ("clearingId") REFERENCES "clearings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_userNo_key" ON "users"("userNo");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");

-- CreateIndex
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "cdd_cases_caseNo_key" ON "cdd_cases"("caseNo");

-- CreateIndex
CREATE INDEX "cdd_cases_customerId_status_idx" ON "cdd_cases"("customerId", "status");

-- CreateIndex
CREATE INDEX "cdd_cases_customerId_journeyId_idx" ON "cdd_cases"("customerId", "journeyId");

-- CreateIndex
CREATE INDEX "cdd_cases_subjectKind_subjectRefId_idx" ON "cdd_cases"("subjectKind", "subjectRefId");

-- CreateIndex
CREATE UNIQUE INDEX "edd_cases_caseNo_key" ON "edd_cases"("caseNo");

-- CreateIndex
CREATE INDEX "edd_cases_customerId_status_idx" ON "edd_cases"("customerId", "status");

-- CreateIndex
CREATE INDEX "edd_cases_cddCaseId_idx" ON "edd_cases"("cddCaseId");

-- CreateIndex
CREATE INDEX "edd_cases_customerId_journeyId_idx" ON "edd_cases"("customerId", "journeyId");

-- CreateIndex
CREATE INDEX "edd_cases_subjectKind_subjectRefId_idx" ON "edd_cases"("subjectKind", "subjectRefId");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_profiles_customerId_key" ON "corporate_profiles"("customerId");

-- CreateIndex
CREATE INDEX "ubo_profiles_customerId_idx" ON "ubo_profiles"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_sessions_providerSessionId_key" ON "compliance_sessions"("providerSessionId");

-- CreateIndex
CREATE INDEX "compliance_sessions_customerId_caseType_caseId_idx" ON "compliance_sessions"("customerId", "caseType", "caseId");

-- CreateIndex
CREATE INDEX "compliance_sessions_status_expiresAt_idx" ON "compliance_sessions"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_sessions_caseType_caseId_pending_unique" ON "compliance_sessions"("caseType", "caseId") WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "cdd_case_reports_customerId_cddCaseId_idx" ON "cdd_case_reports"("customerId", "cddCaseId");

-- CreateIndex
CREATE INDEX "cdd_case_reports_provider_providerSessionId_idx" ON "cdd_case_reports"("provider", "providerSessionId");

-- CreateIndex
CREATE INDEX "edd_case_reports_customerId_eddCaseId_idx" ON "edd_case_reports"("customerId", "eddCaseId");

-- CreateIndex
CREATE INDEX "edd_case_reports_provider_providerSessionId_idx" ON "edd_case_reports"("provider", "providerSessionId");

-- CreateIndex
CREATE INDEX "onboarding_audit_logs_customerId_createdAt_idx" ON "onboarding_audit_logs"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "liquidity_provider_email_key" ON "liquidity_provider"("email");

-- CreateIndex
CREATE INDEX "liquidity_provider_name_idx" ON "liquidity_provider"("name");

-- CreateIndex
CREATE INDEX "liquidity_provider_status_idx" ON "liquidity_provider"("status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_assetNo_key" ON "assets"("assetNo");

-- CreateIndex
CREATE UNIQUE INDEX "assets_type_code_network_key" ON "assets"("type", "code", "network");

-- CreateIndex
CREATE UNIQUE INDEX "payins_payinNo_key" ON "payins"("payinNo");

-- CreateIndex
CREATE INDEX "payins_depositId_idx" ON "payins"("depositId");

-- CreateIndex
CREATE INDEX "payins_status_idx" ON "payins"("status");

-- CreateIndex
CREATE INDEX "payins_assetId_idx" ON "payins"("assetId");

-- CreateIndex
CREATE INDEX "payins_receivedAt_idx" ON "payins"("receivedAt");

-- CreateIndex
CREATE INDEX "payins_providerTxnId_idx" ON "payins"("providerTxnId");

-- CreateIndex
CREATE INDEX "payins_txHash_idx" ON "payins"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "payins_txHash_assetId_toAddress_key" ON "payins"("txHash", "assetId", "toAddress");

-- CreateIndex
CREATE INDEX "liquidity_configurations_lpId_idx" ON "liquidity_configurations"("lpId");

-- CreateIndex
CREATE INDEX "liquidity_configurations_fromAssetId_toAssetId_idx" ON "liquidity_configurations"("fromAssetId", "toAssetId");

-- CreateIndex
CREATE INDEX "liquidity_configurations_status_idx" ON "liquidity_configurations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_walletNo_key" ON "wallets"("walletNo");

-- CreateIndex
CREATE INDEX "wallets_ownerType_ownerId_idx" ON "wallets"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "wallets_assetId_idx" ON "wallets"("assetId");

-- CreateIndex
CREATE INDEX "wallets_status_idx" ON "wallets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_transactions_depositNo_key" ON "deposit_transactions"("depositNo");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_transactions_payinId_key" ON "deposit_transactions"("payinId");

-- CreateIndex
CREATE INDEX "deposit_transactions_depositNo_idx" ON "deposit_transactions"("depositNo");

-- CreateIndex
CREATE INDEX "deposit_transactions_ownerType_ownerId_idx" ON "deposit_transactions"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "deposit_transactions_status_idx" ON "deposit_transactions"("status");

-- CreateIndex
CREATE INDEX "deposit_transactions_createdAt_idx" ON "deposit_transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_accounts_code_key" ON "chart_of_accounts"("code");

-- CreateIndex
CREATE INDEX "chart_of_accounts_code_idx" ON "chart_of_accounts"("code");

-- CreateIndex
CREATE INDEX "chart_of_accounts_status_idx" ON "chart_of_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "journals_journalNo_key" ON "journals"("journalNo");

-- CreateIndex
CREATE INDEX "journals_sourceType_sourceId_idx" ON "journals"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journals_sourceNo_idx" ON "journals"("sourceNo");

-- CreateIndex
CREATE INDEX "journals_eventCode_idx" ON "journals"("eventCode");

-- CreateIndex
CREATE INDEX "journals_postingStatus_idx" ON "journals"("postingStatus");

-- CreateIndex
CREATE INDEX "journals_baseAssetId_idx" ON "journals"("baseAssetId");

-- CreateIndex
CREATE INDEX "journals_createdAt_idx" ON "journals"("createdAt");

-- CreateIndex
CREATE INDEX "journals_journalHeaderTemplateId_idx" ON "journals"("journalHeaderTemplateId");

-- CreateIndex
CREATE INDEX "journal_lines_journalId_idx" ON "journal_lines"("journalId");

-- CreateIndex
CREATE INDEX "journal_lines_accountCode_idx" ON "journal_lines"("accountCode");

-- CreateIndex
CREATE INDEX "journal_lines_assetId_idx" ON "journal_lines"("assetId");

-- CreateIndex
CREATE INDEX "journal_lines_ownerType_ownerId_idx" ON "journal_lines"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "journal_lines_accountCode_ownerType_ownerId_idx" ON "journal_lines"("accountCode", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "journal_lines_journalLineTemplateId_idx" ON "journal_lines"("journalLineTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journalId_lineNo_key" ON "journal_lines"("journalId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "acct_events_eventCode_key" ON "acct_events"("eventCode");

-- CreateIndex
CREATE UNIQUE INDEX "journal_header_templates_templateCode_key" ON "journal_header_templates"("templateCode");

-- CreateIndex
CREATE UNIQUE INDEX "journal_line_templates_templateId_lineNo_key" ON "journal_line_templates"("templateId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "swap_transactions_swapNo_key" ON "swap_transactions"("swapNo");

-- CreateIndex
CREATE INDEX "swap_transactions_swapNo_idx" ON "swap_transactions"("swapNo");

-- CreateIndex
CREATE INDEX "swap_transactions_ownerType_ownerId_idx" ON "swap_transactions"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "swap_transactions_ownerNo_idx" ON "swap_transactions"("ownerNo");

-- CreateIndex
CREATE INDEX "swap_transactions_fromAssetCode_idx" ON "swap_transactions"("fromAssetCode");

-- CreateIndex
CREATE INDEX "swap_transactions_toAssetCode_idx" ON "swap_transactions"("toAssetCode");

-- CreateIndex
CREATE INDEX "swap_transactions_status_idx" ON "swap_transactions"("status");

-- CreateIndex
CREATE INDEX "swap_transactions_createdAt_idx" ON "swap_transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdraw_transactions_withdrawNo_key" ON "withdraw_transactions"("withdrawNo");

-- CreateIndex
CREATE UNIQUE INDEX "withdraw_transactions_payoutId_key" ON "withdraw_transactions"("payoutId");

-- CreateIndex
CREATE INDEX "withdraw_transactions_withdrawNo_idx" ON "withdraw_transactions"("withdrawNo");

-- CreateIndex
CREATE INDEX "withdraw_transactions_payoutId_idx" ON "withdraw_transactions"("payoutId");

-- CreateIndex
CREATE INDEX "withdraw_transactions_ownerId_idx" ON "withdraw_transactions"("ownerId");

-- CreateIndex
CREATE INDEX "withdraw_transactions_status_idx" ON "withdraw_transactions"("status");

-- CreateIndex
CREATE INDEX "withdraw_transactions_assetId_idx" ON "withdraw_transactions"("assetId");

-- CreateIndex
CREATE INDEX "withdraw_transactions_toWalletId_idx" ON "withdraw_transactions"("toWalletId");

-- CreateIndex
CREATE INDEX "withdraw_transactions_providerTxnId_idx" ON "withdraw_transactions"("providerTxnId");

-- CreateIndex
CREATE INDEX "withdraw_transactions_txHash_idx" ON "withdraw_transactions"("txHash");

-- CreateIndex
CREATE INDEX "withdraw_transactions_parentId_idx" ON "withdraw_transactions"("parentId");

-- CreateIndex
CREATE INDEX "withdraw_transactions_createdAt_idx" ON "withdraw_transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_payoutNo_key" ON "payouts"("payoutNo");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_withdrawId_key" ON "payouts"("withdrawId");

-- CreateIndex
CREATE INDEX "payouts_withdrawId_idx" ON "payouts"("withdrawId");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- CreateIndex
CREATE INDEX "payouts_assetId_idx" ON "payouts"("assetId");

-- CreateIndex
CREATE INDEX "payouts_createdAt_idx" ON "payouts"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "clearing_templates_code_key" ON "clearing_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "clearing_line_templates_clearingTemplateId_lineNo_key" ON "clearing_line_templates"("clearingTemplateId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "clearings_clearingNo_key" ON "clearings"("clearingNo");

-- CreateIndex
CREATE INDEX "clearings_sourceType_sourceId_idx" ON "clearings"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "clearings_clearingStatus_idx" ON "clearings"("clearingStatus");

-- CreateIndex
CREATE INDEX "clearings_outPayoutId_idx" ON "clearings"("outPayoutId");

-- CreateIndex
CREATE INDEX "clearings_inPayinId_idx" ON "clearings"("inPayinId");

-- CreateIndex
CREATE INDEX "clearing_lines_clearingId_idx" ON "clearing_lines"("clearingId");

-- CreateIndex
CREATE UNIQUE INDEX "clearing_lines_clearingId_lineNo_key" ON "clearing_lines"("clearingId", "lineNo");
