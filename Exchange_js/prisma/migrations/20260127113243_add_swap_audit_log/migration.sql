-- CreateTable
CREATE TABLE "swap_transaction_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "swapTransactionId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "oldStatus" TEXT NOT NULL,
    "newStatus" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "swap_transaction_audit_logs_swapTransactionId_fkey" FOREIGN KEY ("swapTransactionId") REFERENCES "swap_transactions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
