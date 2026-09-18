-- SQLite does not support ALTER COLUMN RENAME directly.
-- Recreate the table with snake_case timestamp columns to match Prisma @map directives.

CREATE TABLE "sumsub_webhook_events_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventNo" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT 'ONBOARDING',
    "rawPayload" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" DATETIME,
    "lastErrorMessage" TEXT,
    "processedAt" DATETIME,
    "dispatchedTo" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "simulatedByUserId" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "sumsub_webhook_events_new"
SELECT
    "id", "eventNo", "eventType", "applicantId", "externalUserId",
    "context", "rawPayload", "receivedAt", "status", "retryCount",
    "lastRetryAt", "lastErrorMessage", "processedAt", "dispatchedTo",
    "isSimulated", "simulatedByUserId", "createdAt", "updatedAt"
FROM "sumsub_webhook_events";

DROP TABLE "sumsub_webhook_events";
ALTER TABLE "sumsub_webhook_events_new" RENAME TO "sumsub_webhook_events";

CREATE UNIQUE INDEX "sumsub_webhook_events_eventNo_key" ON "sumsub_webhook_events"("eventNo");
CREATE INDEX "sumsub_webhook_events_status_createdAt_idx" ON "sumsub_webhook_events"("status", "created_at");
CREATE INDEX "sumsub_webhook_events_applicantId_idx" ON "sumsub_webhook_events"("applicantId");
CREATE INDEX "sumsub_webhook_events_externalUserId_idx" ON "sumsub_webhook_events"("externalUserId");
CREATE INDEX "sumsub_webhook_events_eventType_status_idx" ON "sumsub_webhook_events"("eventType", "status");
