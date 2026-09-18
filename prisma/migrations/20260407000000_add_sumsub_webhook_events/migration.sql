CREATE TABLE "sumsub_webhook_events" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "sumsub_webhook_events_eventNo_key" ON "sumsub_webhook_events"("eventNo");
CREATE INDEX "sumsub_webhook_events_status_createdAt_idx" ON "sumsub_webhook_events"("status", "createdAt");
CREATE INDEX "sumsub_webhook_events_applicantId_idx" ON "sumsub_webhook_events"("applicantId");
CREATE INDEX "sumsub_webhook_events_externalUserId_idx" ON "sumsub_webhook_events"("externalUserId");
CREATE INDEX "sumsub_webhook_events_eventType_status_idx" ON "sumsub_webhook_events"("eventType", "status");
