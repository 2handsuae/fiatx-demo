/*
  Warnings:

  - You are about to drop the column `createdAt` on the `liquidity_provider` table. All the data in the column will be lost.
  - You are about to drop the column `riskLevel` on the `liquidity_provider` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `liquidity_provider` table. All the data in the column will be lost.
  - Added the required column `updated_at` to the `liquidity_provider` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_liquidity_provider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_liquidity_provider" ("email", "id", "name", "status") SELECT "email", "id", "name", "status" FROM "liquidity_provider";
DROP TABLE "liquidity_provider";
ALTER TABLE "new_liquidity_provider" RENAME TO "liquidity_provider";
CREATE UNIQUE INDEX "liquidity_provider_email_key" ON "liquidity_provider"("email");
CREATE INDEX "liquidity_provider_name_idx" ON "liquidity_provider"("name");
CREATE INDEX "liquidity_provider_status_idx" ON "liquidity_provider"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
