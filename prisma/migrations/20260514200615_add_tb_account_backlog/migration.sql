-- CreateTable
CREATE TABLE "tb_account_backlog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetCode" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "code" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FAILED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "tb_account_backlog_status_idx" ON "tb_account_backlog"("status");

-- CreateIndex
CREATE INDEX "tb_account_backlog_assetCode_idx" ON "tb_account_backlog"("assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "tb_account_backlog_ledger_customerId_code_key" ON "tb_account_backlog"("ledger", "customerId", "code");
