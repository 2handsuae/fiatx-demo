/*
  Warnings:

  - You are about to drop the `delete_requests` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "delete_requests";
PRAGMA foreign_keys=on;
