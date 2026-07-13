/*
  Warnings:

  - You are about to drop the `swap_fee_level_bindings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `withdrawal_fee_level_bindings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "swap_fee_level_bindings";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "withdrawal_fee_level_bindings";
PRAGMA foreign_keys=on;
