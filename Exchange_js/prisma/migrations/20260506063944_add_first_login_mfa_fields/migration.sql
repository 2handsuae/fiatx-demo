-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userNo" TEXT NOT NULL DEFAULT 'TEMP',
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "suspendedAt" DATETIME,
    "lastLoginAt" DATETIME,
    "deletedAt" DATETIME,
    "deletedBy" TEXT,
    "deleteRequestId" TEXT,
    "deleteReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "firstLoginStatus" TEXT NOT NULL DEFAULT 'PENDING_IDENTITY_CONFIRM',
    "mfaSecret" TEXT,
    "mfaEnabledAt" DATETIME,
    "mfaVerifyFailCount" INTEGER NOT NULL DEFAULT 0,
    "mfaVerifyLockedUntil" DATETIME,
    "securityAckAt" DATETIME,
    "firstLoginTraceId" TEXT
);
INSERT INTO "new_users" ("createdAt", "deleteReason", "deleteRequestId", "deletedAt", "deletedBy", "email", "failedLoginAttempts", "id", "lastLoginAt", "lockedUntil", "password", "role", "status", "suspendedAt", "updatedAt", "userNo") SELECT "createdAt", "deleteReason", "deleteRequestId", "deletedAt", "deletedBy", "email", "failedLoginAttempts", "id", "lastLoginAt", "lockedUntil", "password", "role", "status", "suspendedAt", "updatedAt", "userNo" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_userNo_key" ON "users"("userNo");
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: existing accounts skip the first-login ceremony
UPDATE "users"
SET "firstLoginStatus" = 'COMPLETED'
WHERE "status" IN ('ACTIVE', 'SUSPENDED', 'INVITE_SENT', 'LOCKED');
