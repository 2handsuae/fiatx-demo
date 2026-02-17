-- 1) New internal transaction tables
CREATE TABLE "internal_transactions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "internalTxNo" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceNo" TEXT,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "ownerNo" TEXT,
  "assetId" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "feeAmount" DECIMAL NOT NULL DEFAULT 0,
  "netAmount" DECIMAL NOT NULL,
  "fromWalletId" TEXT,
  "fromAddress" TEXT,
  "fromIban" TEXT,
  "toWalletId" TEXT,
  "toAddress" TEXT,
  "toIban" TEXT,
  "referenceNo" TEXT,
  "statusHistory" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "internal_transactions_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "internal_transactions_fromWalletId_fkey"
    FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "internal_transactions_toWalletId_fkey"
    FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "internal_funds" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "internalFundNo" TEXT NOT NULL,
  "internalTransactionId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "amount" DECIMAL NOT NULL,
  "feeAmount" DECIMAL NOT NULL DEFAULT 0,
  "netAmount" DECIMAL NOT NULL,
  "fromWalletId" TEXT,
  "fromAddress" TEXT,
  "fromIban" TEXT,
  "toWalletId" TEXT,
  "toAddress" TEXT,
  "toIban" TEXT,
  "txHash" TEXT,
  "confirmations" INTEGER NOT NULL DEFAULT 0,
  "referenceNo" TEXT,
  "providerTxnId" TEXT,
  "nonce" TEXT,
  "blockNo" TEXT,
  "gasUsed" TEXT,
  "effectiveGasPrice" TEXT,
  "sentAt" DATETIME,
  "confirmedAt" DATETIME,
  "completedAt" DATETIME,
  "statusHistory" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "internal_funds_internalTransactionId_fkey"
    FOREIGN KEY ("internalTransactionId") REFERENCES "internal_transactions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "internal_funds_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "internal_funds_fromWalletId_fkey"
    FOREIGN KEY ("fromWalletId") REFERENCES "wallets" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "internal_funds_toWalletId_fkey"
    FOREIGN KEY ("toWalletId") REFERENCES "wallets" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "internal_transaction_audit_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "internalTransactionId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "oldStatus" TEXT NOT NULL,
  "newStatus" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_transaction_audit_logs_internalTransactionId_fkey"
    FOREIGN KEY ("internalTransactionId") REFERENCES "internal_transactions" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "internal_fund_audit_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "internalFundId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "oldStatus" TEXT NOT NULL,
  "newStatus" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_fund_audit_logs_internalFundId_fkey"
    FOREIGN KEY ("internalFundId") REFERENCES "internal_funds" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "internal_transactions_internalTxNo_key"
ON "internal_transactions"("internalTxNo");
CREATE UNIQUE INDEX "internal_transactions_sourceType_sourceId_type_key"
ON "internal_transactions"("sourceType", "sourceId", "type");
CREATE INDEX "internal_transactions_status_idx"
ON "internal_transactions"("status");
CREATE INDEX "internal_transactions_createdAt_idx"
ON "internal_transactions"("createdAt");
CREATE INDEX "internal_transactions_assetId_idx"
ON "internal_transactions"("assetId");

CREATE UNIQUE INDEX "internal_funds_internalFundNo_key"
ON "internal_funds"("internalFundNo");
CREATE INDEX "internal_funds_internalTransactionId_idx"
ON "internal_funds"("internalTransactionId");
CREATE INDEX "internal_funds_status_idx"
ON "internal_funds"("status");
CREATE INDEX "internal_funds_txHash_idx"
ON "internal_funds"("txHash");
CREATE INDEX "internal_funds_createdAt_idx"
ON "internal_funds"("createdAt");

CREATE INDEX "internal_transaction_audit_logs_internalTransactionId_idx"
ON "internal_transaction_audit_logs"("internalTransactionId");
CREATE INDEX "internal_fund_audit_logs_internalFundId_idx"
ON "internal_fund_audit_logs"("internalFundId");

-- 2) Remove withdraw_transactions.type
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_withdraw_transactions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "withdrawNo" TEXT NOT NULL,
  "payoutId" TEXT,
  "payoutNo" TEXT,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "ownerNo" TEXT,
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
  CONSTRAINT "withdraw_transactions_withdrawNo_key" UNIQUE ("withdrawNo"),
  CONSTRAINT "withdraw_transactions_payoutId_key" UNIQUE ("payoutId"),
  CONSTRAINT "withdraw_transactions_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "assets" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "withdraw_transactions_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "customer_main" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_withdraw_transactions" (
  "id",
  "withdrawNo",
  "payoutId",
  "payoutNo",
  "ownerType",
  "ownerId",
  "ownerNo",
  "status",
  "assetId",
  "amount",
  "feeAmount",
  "netAmount",
  "toWalletId",
  "toWalletNo",
  "toAddress",
  "toIban",
  "fromWalletId",
  "fromWalletNo",
  "fromAddress",
  "fromIban",
  "providerTxnId",
  "txHash",
  "confirmations",
  "referenceNo",
  "preKytStatus",
  "preKytId",
  "preKytRiskScore",
  "preKytCheckedAt",
  "kytStatus",
  "kytScreeningId",
  "kytRiskScore",
  "kytCheckedAt",
  "travelRuleRequired",
  "counterpartyVasp",
  "travelRuleStatus",
  "travelRuleTransferId",
  "travelRuleCheckedAt",
  "complianceStatus",
  "complianceReviewedAt",
  "parentType",
  "parentId",
  "createdAt",
  "approvedAt",
  "payoutRequestedAt",
  "completedAt",
  "statusHistory",
  "updatedAt"
)
SELECT
  "id",
  "withdrawNo",
  "payoutId",
  "payoutNo",
  "ownerType",
  "ownerId",
  "ownerNo",
  "status",
  "assetId",
  "amount",
  "feeAmount",
  "netAmount",
  "toWalletId",
  "toWalletNo",
  "toAddress",
  "toIban",
  "fromWalletId",
  "fromWalletNo",
  "fromAddress",
  "fromIban",
  "providerTxnId",
  "txHash",
  "confirmations",
  "referenceNo",
  "preKytStatus",
  "preKytId",
  "preKytRiskScore",
  "preKytCheckedAt",
  "kytStatus",
  "kytScreeningId",
  "kytRiskScore",
  "kytCheckedAt",
  "travelRuleRequired",
  "counterpartyVasp",
  "travelRuleStatus",
  "travelRuleTransferId",
  "travelRuleCheckedAt",
  "complianceStatus",
  "complianceReviewedAt",
  "parentType",
  "parentId",
  "createdAt",
  "approvedAt",
  "payoutRequestedAt",
  "completedAt",
  "statusHistory",
  "updatedAt"
FROM "withdraw_transactions";

DROP TABLE "withdraw_transactions";
ALTER TABLE "new_withdraw_transactions" RENAME TO "withdraw_transactions";

CREATE INDEX "withdraw_transactions_withdrawNo_idx"
ON "withdraw_transactions"("withdrawNo");
CREATE INDEX "withdraw_transactions_payoutId_idx"
ON "withdraw_transactions"("payoutId");
CREATE INDEX "withdraw_transactions_ownerId_idx"
ON "withdraw_transactions"("ownerId");
CREATE INDEX "withdraw_transactions_status_idx"
ON "withdraw_transactions"("status");
CREATE INDEX "withdraw_transactions_assetId_idx"
ON "withdraw_transactions"("assetId");
CREATE INDEX "withdraw_transactions_toWalletId_idx"
ON "withdraw_transactions"("toWalletId");
CREATE INDEX "withdraw_transactions_providerTxnId_idx"
ON "withdraw_transactions"("providerTxnId");
CREATE INDEX "withdraw_transactions_txHash_idx"
ON "withdraw_transactions"("txHash");
CREATE INDEX "withdraw_transactions_parentId_idx"
ON "withdraw_transactions"("parentId");
CREATE INDEX "withdraw_transactions_createdAt_idx"
ON "withdraw_transactions"("createdAt");

PRAGMA foreign_keys=ON;
