/*
  Warnings:

  - You are about to drop the `transaction_limit_change_requests` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `transaction_limit_policies` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "transaction_limit_change_requests";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "transaction_limit_policies";
PRAGMA foreign_keys=on;
