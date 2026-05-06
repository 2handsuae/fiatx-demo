-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resetNo" TEXT NOT NULL DEFAULT 'TEMP',
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestSource" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedByUserNo" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_resetNo_key" ON "password_reset_tokens"("resetNo");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_status_expiresAt_idx" ON "password_reset_tokens"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "password_reset_tokens_traceId_createdAt_idx" ON "password_reset_tokens"("traceId", "createdAt");
