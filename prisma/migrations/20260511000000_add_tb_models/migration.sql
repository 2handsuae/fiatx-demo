-- AlterTable
ALTER TABLE "assets" ADD COLUMN "tbLedgerId" INTEGER;

-- CreateTable
CREATE TABLE "tb_account_registry" (
    "tbAccountId" TEXT NOT NULL PRIMARY KEY,
    "code" INTEGER NOT NULL,
    "ledger" INTEGER NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerUuid" TEXT,
    "ownerNo" TEXT,
    "assetCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "flags" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tb_transfer_evidence" (
    "tbTransferId" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceNo" TEXT NOT NULL,
    "eventCode" TEXT NOT NULL,
    "debitCode" TEXT NOT NULL,
    "creditCode" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "assetCode" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "memo" TEXT,
    "pendingId" TEXT,
    "transferType" TEXT NOT NULL DEFAULT 'POSTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tb_evidence_backlog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tbTransferId" TEXT NOT NULL,
    "transferData" TEXT NOT NULL,
    "evidenceData" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "tb_account_registry_ownerUuid_idx" ON "tb_account_registry"("ownerUuid");

-- CreateIndex
CREATE INDEX "tb_account_registry_ownerNo_idx" ON "tb_account_registry"("ownerNo");

-- CreateIndex
CREATE UNIQUE INDEX "tb_account_registry_code_ledger_ownerType_ownerUuid_key" ON "tb_account_registry"("code", "ledger", "ownerType", "ownerUuid");

-- CreateIndex
CREATE INDEX "tb_transfer_evidence_sourceType_sourceNo_idx" ON "tb_transfer_evidence"("sourceType", "sourceNo");

-- CreateIndex
CREATE INDEX "tb_transfer_evidence_traceId_idx" ON "tb_transfer_evidence"("traceId");

-- CreateIndex
CREATE INDEX "tb_transfer_evidence_eventCode_idx" ON "tb_transfer_evidence"("eventCode");

-- CreateIndex
CREATE INDEX "tb_transfer_evidence_assetCode_idx" ON "tb_transfer_evidence"("assetCode");

-- CreateIndex
CREATE INDEX "tb_transfer_evidence_actorType_actorId_idx" ON "tb_transfer_evidence"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "tb_transfer_evidence_createdAt_idx" ON "tb_transfer_evidence"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tb_evidence_backlog_tbTransferId_key" ON "tb_evidence_backlog"("tbTransferId");

-- CreateIndex
CREATE INDEX "tb_evidence_backlog_status_idx" ON "tb_evidence_backlog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "assets_tbLedgerId_key" ON "assets"("tbLedgerId");
