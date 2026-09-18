/*
  Warnings:

  - You are about to drop the `change_ticket_gate_runs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `change_tickets` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "change_ticket_gate_runs";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "change_tickets";
PRAGMA foreign_keys=on;
