/*
  Warnings:

  - You are about to drop the column `assetId` on the `withdrawal_addresses` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_withdrawal_addresses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "addressNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressType" TEXT NOT NULL,
    "label" TEXT,
    "beneficiaryName" TEXT,
    "memo" TEXT,
    "iban" TEXT,
    "swiftBic" TEXT,
    "bankName" TEXT,
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
    "deactivatedAt" DATETIME,
    "deactivatedBy" TEXT,
    "traceId" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "withdrawal_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_withdrawal_addresses" ("activatedAt", "activatesAt", "address", "addressNo", "addressType", "bankName", "beneficiaryName", "cancelledAt", "counterpartyVaspDid", "counterpartyVaspName", "created_at", "customerId", "customerNo", "deactivatedAt", "deactivatedBy", "iban", "id", "label", "memo", "network", "ownershipDeclaredAt", "ownershipProofType", "status", "suspendReason", "suspendedAt", "suspendedBy", "swiftBic", "traceId", "updated_at") SELECT "activatedAt", "activatesAt", "address", "addressNo", "addressType", "bankName", "beneficiaryName", "cancelledAt", "counterpartyVaspDid", "counterpartyVaspName", "created_at", "customerId", "customerNo", "deactivatedAt", "deactivatedBy", "iban", "id", "label", "memo", "network", "ownershipDeclaredAt", "ownershipProofType", "status", "suspendReason", "suspendedAt", "suspendedBy", "swiftBic", "traceId", "updated_at" FROM "withdrawal_addresses";
DROP TABLE "withdrawal_addresses";
ALTER TABLE "new_withdrawal_addresses" RENAME TO "withdrawal_addresses";
CREATE UNIQUE INDEX "withdrawal_addresses_addressNo_key" ON "withdrawal_addresses"("addressNo");
CREATE INDEX "withdrawal_addresses_customerId_network_status_idx" ON "withdrawal_addresses"("customerId", "network", "status");
CREATE INDEX "withdrawal_addresses_status_activatesAt_idx" ON "withdrawal_addresses"("status", "activatesAt");
CREATE UNIQUE INDEX "withdrawal_addresses_customerId_network_address_key" ON "withdrawal_addresses"("customerId", "network", "address");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
