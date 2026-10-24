-- AlterTable
ALTER TABLE "liquidity_providers" ADD COLUMN "dueDiligenceRef" TEXT;
ALTER TABLE "liquidity_providers" ADD COLUMN "screenedAt" DATETIME;
ALTER TABLE "liquidity_providers" ADD COLUMN "screeningAnswer" TEXT;

-- AlterTable
ALTER TABLE "lp_exchanges" ADD COLUMN "deliveryFromAddress" TEXT;
ALTER TABLE "lp_exchanges" ADD COLUMN "deliveryFromIban" TEXT;
ALTER TABLE "lp_exchanges" ADD COLUMN "deliveryScreenedAt" DATETIME;
ALTER TABLE "lp_exchanges" ADD COLUMN "deliveryScreeningAnswer" TEXT;
ALTER TABLE "lp_exchanges" ADD COLUMN "payoutAddress" TEXT;
ALTER TABLE "lp_exchanges" ADD COLUMN "payoutAddressNo" TEXT;
ALTER TABLE "lp_exchanges" ADD COLUMN "payoutIban" TEXT;

-- CreateTable
CREATE TABLE "lp_payout_addresses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "addressNo" TEXT NOT NULL,
    "lpId" TEXT NOT NULL,
    "lpNo" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "network" TEXT,
    "address" TEXT,
    "iban" TEXT,
    "bankName" TEXT,
    "swiftBic" TEXT,
    "declaredHosting" TEXT,
    "addressType" TEXT,
    "hostingMismatch" BOOLEAN NOT NULL DEFAULT false,
    "counterpartyVaspName" TEXT,
    "counterpartyVaspDid" TEXT,
    "screeningAnswer" TEXT,
    "screenedAt" DATETIME,
    "evidenceRef" TEXT NOT NULL,
    "label" TEXT,
    "approvalNo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "suspendedAt" DATETIME,
    "cancelledAt" DATETIME,
    "deactivatedAt" DATETIME,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "lp_payout_addresses_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "liquidity_providers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "lp_payout_addresses_addressNo_key" ON "lp_payout_addresses"("addressNo");

-- CreateIndex
CREATE INDEX "lp_payout_addresses_lpId_assetId_status_idx" ON "lp_payout_addresses"("lpId", "assetId", "status");
