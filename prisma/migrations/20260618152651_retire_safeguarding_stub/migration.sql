/*
  Warnings:

  - You are about to drop the `fiat_statement_entries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `fiat_statement_imports` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `liability_snapshots` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `reconciliation_breaks` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `reconciliation_warnings` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `safeguarding_policies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `safeguarding_pool_snapshots` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `safeguarding_runs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "fiat_statement_entries";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "fiat_statement_imports";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "liability_snapshots";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "reconciliation_breaks";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "reconciliation_warnings";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "safeguarding_policies";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "safeguarding_pool_snapshots";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "safeguarding_runs";
PRAGMA foreign_keys=on;
