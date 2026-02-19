-- CreateTable
CREATE TABLE "admin_user_invitations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "admin_user_invitations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_invitations_tokenHash_key" ON "admin_user_invitations"("tokenHash");
CREATE INDEX "admin_user_invitations_userId_idx" ON "admin_user_invitations"("userId");
CREATE INDEX "admin_user_invitations_expiresAt_idx" ON "admin_user_invitations"("expiresAt");
