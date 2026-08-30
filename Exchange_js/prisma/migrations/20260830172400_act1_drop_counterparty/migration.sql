/*
  Warnings:

  - You are about to drop the `liquidity_configurations` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `liquidity_provider` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "liquidity_configurations";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "liquidity_provider";
PRAGMA foreign_keys=on;
