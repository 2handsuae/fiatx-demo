/*
  Warnings:

  - You are about to drop the `tb_account_backlog` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "withdraw_transactions" ADD COLUMN "tbPendingFeeId" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "tbPendingNetId" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "traceId" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "tb_account_backlog";
PRAGMA foreign_keys=on;
