/*
  Warnings:

  - You are about to drop the column `accountName` on the `wallets` table. All the data in the column will be lost.
  - You are about to drop the column `assetId` on the `wallets` table. All the data in the column will be lost.
  - You are about to drop the column `bankName` on the `wallets` table. All the data in the column will be lost.
  - You are about to drop the column `mockBalance` on the `wallets` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `wallets` table. All the data in the column will be lost.
  - You are about to drop the column `vaultId` on the `wallets` table. All the data in the column will be lost.
  - Added the required column `network` to the `wallets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `vaultCode` to the `wallets` table without a default value. This is not possible if the table is not empty.
  - Made the column `ownerNo` on table `wallets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `walletNo` on table `wallets` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_wallets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletNo" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT,
    "ownerNo" TEXT NOT NULL,
    "vaultCode" TEXT NOT NULL,
    "walletRole" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT,
    "iban" TEXT,
    "custodianRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_wallets" ("address", "created_at", "iban", "id", "ownerId", "ownerNo", "ownerType", "status", "updated_at", "walletNo", "walletRole") SELECT "address", "created_at", "iban", "id", "ownerId", "ownerNo", "ownerType", "status", "updated_at", "walletNo", "walletRole" FROM "wallets";
DROP TABLE "wallets";
ALTER TABLE "new_wallets" RENAME TO "wallets";
CREATE UNIQUE INDEX "wallets_walletNo_key" ON "wallets"("walletNo");
CREATE INDEX "wallets_ownerType_ownerId_idx" ON "wallets"("ownerType", "ownerId");
CREATE INDEX "wallets_network_address_idx" ON "wallets"("network", "address");
CREATE INDEX "wallets_network_iban_idx" ON "wallets"("network", "iban");
CREATE UNIQUE INDEX "wallets_vaultCode_network_ownerNo_key" ON "wallets"("vaultCode", "network", "ownerNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
