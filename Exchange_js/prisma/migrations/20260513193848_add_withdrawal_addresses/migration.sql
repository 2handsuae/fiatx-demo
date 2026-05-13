-- CreateTable
CREATE TABLE "withdrawal_addresses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "addressNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressType" TEXT NOT NULL,
    "label" TEXT,
    "counterpartyVaspName" TEXT,
    "counterpartyVaspDid" TEXT,
    "ownershipDeclaredAt" DATETIME,
    "ownershipProofType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
    "activatesAt" DATETIME NOT NULL,
    "activatedAt" DATETIME,
    "suspendedAt" DATETIME,
    "suspendedBy" TEXT,
    "suspendReason" TEXT,
    "cancelledAt" DATETIME,
    "traceId" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "withdrawal_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "withdrawal_addresses_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_addresses_addressNo_key" ON "withdrawal_addresses"("addressNo");

-- CreateIndex
CREATE INDEX "withdrawal_addresses_customerId_assetId_status_idx" ON "withdrawal_addresses"("customerId", "assetId", "status");

-- CreateIndex
CREATE INDEX "withdrawal_addresses_status_activatesAt_idx" ON "withdrawal_addresses"("status", "activatesAt");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_addresses_customerId_assetId_address_key" ON "withdrawal_addresses"("customerId", "assetId", "address");
