/*
  Warnings:

  - You are about to drop the column `walletId` on the `deposit_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `counterpartyVasp` on the `payins` table. All the data in the column will be lost.
  - You are about to drop the column `kytCheckedAt` on the `payins` table. All the data in the column will be lost.
  - You are about to drop the column `kytRiskScore` on the `payins` table. All the data in the column will be lost.
  - You are about to drop the column `kytScreeningId` on the `payins` table. All the data in the column will be lost.
  - You are about to drop the column `kytStatus` on the `payins` table. All the data in the column will be lost.
  - You are about to drop the column `travelRuleCheckedAt` on the `payins` table. All the data in the column will be lost.
  - You are about to drop the column `travelRuleRequired` on the `payins` table. All the data in the column will be lost.
  - You are about to drop the column `travelRuleStatus` on the `payins` table. All the data in the column will be lost.
  - You are about to drop the column `travelRuleTransferId` on the `payins` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[assetNo]` on the table `assets` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `toWalletId` to the `deposit_transactions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "acct_events" ADD COLUMN "clearingTemplateCode" TEXT;

-- AlterTable
ALTER TABLE "assets" ADD COLUMN "assetNo" TEXT;

-- CreateTable
CREATE TABLE "kyc_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "providerReference" TEXT,
    "status" TEXT NOT NULL,
    "idType" TEXT,
    "idNumber" TEXT,
    "idExpiry" DATETIME,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" DATETIME,
    "nationality" TEXT,
    "documentFrontUrl" TEXT,
    "documentBackUrl" TEXT,
    "selfieUrl" TEXT,
    "faceMatchScore" DECIMAL,
    "compImage" TEXT,
    "residentialAddress" TEXT,
    "poaType" TEXT,
    "poaDocuments" TEXT,
    "rejectionReason" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "kyc_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "edd_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceOfWealth" TEXT,
    "sourceOfFunds" TEXT,
    "occupation" TEXT,
    "employerName" TEXT,
    "expectedMonthlyVolume" DECIMAL,
    "sorDocuments" TEXT,
    "sofDocuments" TEXT,
    "supportingDocUrls" TEXT,
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "edd_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
CREATE TABLE "withdraw_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "withdrawNo" TEXT NOT NULL,
    "payoutId" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "feeAmount" DECIMAL NOT NULL DEFAULT 0,
    "netAmount" DECIMAL NOT NULL,
    "toWalletId" TEXT,
    "toAddress" TEXT,
    "toIban" TEXT,
    "fromAddress" TEXT,
    "fromIban" TEXT,
    "providerTxnId" TEXT,
    "txHash" TEXT,
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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customer_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_audit_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_customer_audit_logs" ("changedAt", "customerId", "id", "newStatus", "oldStatus", "operatorId") SELECT "changedAt", "customerId", "id", "newStatus", "oldStatus", "operatorId" FROM "customer_audit_logs";
DROP TABLE "customer_audit_logs";
ALTER TABLE "new_customer_audit_logs" RENAME TO "customer_audit_logs";
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_customer_main" ("authLevel", "authLevelExpiresAt", "authStatus", "createdAt", "eddId", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "kycId", "lastLoginAt", "lastLoginIp", "lastName", "locale", "lockedUntil", "passwordHash", "passwordUpdatedAt", "phone", "phoneVerifiedAt", "riskLevel", "riskScore", "riskUpdatedAt", "termsAcceptedAt", "timezone", "updatedAt") SELECT "authLevel", "authLevelExpiresAt", "authStatus", "createdAt", "eddId", "email", "emailVerifiedAt", "failedLoginCount", "firstName", "id", "kycId", "lastLoginAt", "lastLoginIp", "lastName", "locale", "lockedUntil", "passwordHash", "passwordUpdatedAt", "phone", "phoneVerifiedAt", "riskLevel", "riskScore", "riskUpdatedAt", "termsAcceptedAt", "timezone", "updatedAt" FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ON "customer_main"("customerNo");
CREATE UNIQUE INDEX "customer_main_email_key" ON "customer_main"("email");
CREATE UNIQUE INDEX "customer_main_phone_key" ON "customer_main"("phone");
CREATE TABLE "new_deposit_transactions" (
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
    CONSTRAINT "deposit_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_deposit_transactions" ("amount", "assetId", "completedAt", "createdAt", "depositNo", "fromAddress", "fromIban", "id", "ownerId", "ownerType", "referenceNo", "status", "txHash", "updatedAt") SELECT "amount", "assetId", "completedAt", "createdAt", "depositNo", "fromAddress", "fromIban", "id", "ownerId", "ownerType", "referenceNo", "status", "txHash", "updatedAt" FROM "deposit_transactions";
DROP TABLE "deposit_transactions";
ALTER TABLE "new_deposit_transactions" RENAME TO "deposit_transactions";
CREATE UNIQUE INDEX "deposit_transactions_depositNo_key" ON "deposit_transactions"("depositNo");
CREATE UNIQUE INDEX "deposit_transactions_payinId_key" ON "deposit_transactions"("payinId");
CREATE INDEX "deposit_transactions_depositNo_idx" ON "deposit_transactions"("depositNo");
CREATE INDEX "deposit_transactions_ownerType_ownerId_idx" ON "deposit_transactions"("ownerType", "ownerId");
CREATE INDEX "deposit_transactions_status_idx" ON "deposit_transactions"("status");
CREATE INDEX "deposit_transactions_createdAt_idx" ON "deposit_transactions"("createdAt");
CREATE TABLE "new_journals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalNo" TEXT NOT NULL DEFAULT 'TEMP',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
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
INSERT INTO "new_journals" ("baseAssetId", "createdAt", "description", "eventCode", "id", "journalHeaderTemplateId", "postedAt", "postingStatus", "reversalOfJournalId", "sourceId", "sourceType", "totalAmount", "updatedAt") SELECT "baseAssetId", "createdAt", "description", "eventCode", "id", "journalHeaderTemplateId", "postedAt", "postingStatus", "reversalOfJournalId", "sourceId", "sourceType", "totalAmount", "updatedAt" FROM "journals";
DROP TABLE "journals";
ALTER TABLE "new_journals" RENAME TO "journals";
CREATE UNIQUE INDEX "journals_journalNo_key" ON "journals"("journalNo");
CREATE INDEX "journals_sourceType_sourceId_idx" ON "journals"("sourceType", "sourceId");
CREATE INDEX "journals_eventCode_idx" ON "journals"("eventCode");
CREATE INDEX "journals_postingStatus_idx" ON "journals"("postingStatus");
CREATE INDEX "journals_baseAssetId_idx" ON "journals"("baseAssetId");
CREATE INDEX "journals_createdAt_idx" ON "journals"("createdAt");
CREATE INDEX "journals_journalHeaderTemplateId_idx" ON "journals"("journalHeaderTemplateId");
CREATE TABLE "new_payins" (
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
    CONSTRAINT "payins_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payins_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_payins" ("amount", "assetId", "confirmations", "confirmedAt", "createdAt", "depositId", "fromAddress", "fromIban", "id", "providerTxnId", "receivedAt", "referenceNo", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "txHash", "type", "updatedAt") SELECT "amount", "assetId", "confirmations", "confirmedAt", "createdAt", "depositId", "fromAddress", "fromIban", "id", "providerTxnId", "receivedAt", "referenceNo", "status", "statusHistory", "toAddress", "toIban", "toWalletId", "txHash", "type", "updatedAt" FROM "payins";
DROP TABLE "payins";
ALTER TABLE "new_payins" RENAME TO "payins";
CREATE UNIQUE INDEX "payins_payinNo_key" ON "payins"("payinNo");
CREATE INDEX "payins_depositId_idx" ON "payins"("depositId");
CREATE INDEX "payins_status_idx" ON "payins"("status");
CREATE INDEX "payins_assetId_idx" ON "payins"("assetId");
CREATE INDEX "payins_receivedAt_idx" ON "payins"("receivedAt");
CREATE INDEX "payins_providerTxnId_idx" ON "payins"("providerTxnId");
CREATE INDEX "payins_txHash_idx" ON "payins"("txHash");
CREATE UNIQUE INDEX "payins_txHash_assetId_toAddress_key" ON "payins"("txHash", "assetId", "toAddress");
CREATE TABLE "new_swap_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "swapNo" TEXT,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fromAssetId" TEXT NOT NULL,
    "fromAmount" DECIMAL NOT NULL,
    "toAssetId" TEXT NOT NULL,
    "toAmount" DECIMAL NOT NULL,
    "exchangeRate" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "swap_transactions_fromAssetId_fkey" FOREIGN KEY ("fromAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_transactions_toAssetId_fkey" FOREIGN KEY ("toAssetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "swap_transactions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_swap_transactions" ("completedAt", "createdAt", "exchangeRate", "fromAmount", "fromAssetId", "id", "ownerId", "ownerType", "status", "swapNo", "toAmount", "toAssetId", "updatedAt") SELECT "completedAt", "createdAt", "exchangeRate", "fromAmount", "fromAssetId", "id", "ownerId", "ownerType", "status", "swapNo", "toAmount", "toAssetId", "updatedAt" FROM "swap_transactions";
DROP TABLE "swap_transactions";
ALTER TABLE "new_swap_transactions" RENAME TO "swap_transactions";
CREATE UNIQUE INDEX "swap_transactions_swapNo_key" ON "swap_transactions"("swapNo");
CREATE INDEX "swap_transactions_swapNo_idx" ON "swap_transactions"("swapNo");
CREATE INDEX "swap_transactions_ownerType_ownerId_idx" ON "swap_transactions"("ownerType", "ownerId");
CREATE INDEX "swap_transactions_status_idx" ON "swap_transactions"("status");
CREATE INDEX "swap_transactions_createdAt_idx" ON "swap_transactions"("createdAt");
CREATE TABLE "new_users" (
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
INSERT INTO "new_users" ("createdAt", "email", "failedLoginAttempts", "id", "lastLoginAt", "lockedUntil", "password", "role", "status", "updatedAt") SELECT "createdAt", "email", "failedLoginAttempts", "id", "lastLoginAt", "lockedUntil", "password", "role", "status", "updatedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_userNo_key" ON "users"("userNo");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE TABLE "new_wallets" (
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
INSERT INTO "new_wallets" ("accountName", "address", "assetId", "balance", "bankAccount", "bankCode", "bankName", "beneficiaryName", "counterpartyVasp", "created_at", "direction", "iban", "id", "lockedBalance", "memo", "ownerId", "ownerType", "status", "type", "updated_at") SELECT "accountName", "address", "assetId", "balance", "bankAccount", "bankCode", "bankName", "beneficiaryName", "counterpartyVasp", "created_at", "direction", "iban", "id", "lockedBalance", "memo", "ownerId", "ownerType", "status", "type", "updated_at" FROM "wallets";
DROP TABLE "wallets";
ALTER TABLE "new_wallets" RENAME TO "wallets";
CREATE UNIQUE INDEX "wallets_walletNo_key" ON "wallets"("walletNo");
CREATE INDEX "wallets_ownerType_ownerId_idx" ON "wallets"("ownerType", "ownerId");
CREATE INDEX "wallets_assetId_idx" ON "wallets"("assetId");
CREATE INDEX "wallets_status_idx" ON "wallets"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "kyc_records_providerReference_key" ON "kyc_records"("providerReference");

-- CreateIndex
CREATE INDEX "kyc_records_customerId_idx" ON "kyc_records"("customerId");

-- CreateIndex
CREATE INDEX "kyc_records_status_idx" ON "kyc_records"("status");

-- CreateIndex
CREATE INDEX "edd_records_customerId_idx" ON "edd_records"("customerId");

-- CreateIndex
CREATE INDEX "edd_records_status_idx" ON "edd_records"("status");

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

-- CreateIndex
CREATE UNIQUE INDEX "assets_assetNo_key" ON "assets"("assetNo");
