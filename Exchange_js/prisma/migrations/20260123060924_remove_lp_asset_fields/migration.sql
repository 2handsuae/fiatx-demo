/*
  Warnings:

  - You are about to drop the `assets` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `supportedCurrencies` on the `liquidity_provider` table. All the data in the column will be lost.
  - You are about to drop the column `supportedNetworks` on the `liquidity_provider` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "assets_currency_network_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "assets";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_liquidity_provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_liquidity_provider" ("createdAt", "email", "id", "name", "riskLevel", "status", "updatedAt") SELECT "createdAt", "email", "id", "name", "riskLevel", "status", "updatedAt" FROM "liquidity_provider";
DROP TABLE "liquidity_provider";
ALTER TABLE "new_liquidity_provider" RENAME TO "liquidity_provider";
CREATE UNIQUE INDEX "liquidity_provider_email_key" ON "liquidity_provider"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
