-- CreateTable
CREATE TABLE "liquidity_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lpNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiatBankName" TEXT NOT NULL,
    "fiatIban" TEXT NOT NULL,
    "cryptoNetwork" TEXT NOT NULL,
    "cryptoAddress" TEXT NOT NULL,
    "agreementRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvalNo" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "liquidity_providers_lpNo_key" ON "liquidity_providers"("lpNo");

-- CreateIndex
CREATE INDEX "liquidity_providers_status_idx" ON "liquidity_providers"("status");

