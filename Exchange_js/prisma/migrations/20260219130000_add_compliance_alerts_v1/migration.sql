-- CreateTable
CREATE TABLE "compliance_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertNo" TEXT NOT NULL DEFAULT 'TEMP',
    "dedupeKey" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "capCode" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceNo" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityNo" TEXT,
    "ownerType" TEXT,
    "ownerId" TEXT,
    "ownerNo" TEXT,
    "customerId" TEXT,
    "customerNo" TEXT,
    "firstOccurredAt" DATETIME NOT NULL,
    "lastOccurredAt" DATETIME NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "assigneeUserId" TEXT,
    "assigneeUserNo" TEXT,
    "assignedAt" DATETIME,
    "closedAt" DATETIME,
    "closeReason" TEXT,
    "lastActionById" TEXT,
    "lastActionByNo" TEXT,
    "lastActionByRole" TEXT,
    "lastActionAt" DATETIME,
    "metadata" TEXT,
    "retainedUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "compliance_alert_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorNo" TEXT,
    "actorRole" TEXT,
    "note" TEXT,
    "payload" TEXT,
    "sourcePlatform" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "compliance_alert_events_alertId_fkey"
      FOREIGN KEY ("alertId") REFERENCES "compliance_alerts" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_alerts_alertNo_key" ON "compliance_alerts"("alertNo");
CREATE UNIQUE INDEX "compliance_alerts_dedupeKey_key" ON "compliance_alerts"("dedupeKey");
CREATE INDEX "compliance_alerts_status_lastOccurredAt_idx" ON "compliance_alerts"("status", "lastOccurredAt");
CREATE INDEX "compliance_alerts_severity_status_dueAt_idx" ON "compliance_alerts"("severity", "status", "dueAt");
CREATE INDEX "compliance_alerts_ruleCode_lastOccurredAt_idx" ON "compliance_alerts"("ruleCode", "lastOccurredAt");
CREATE INDEX "compliance_alerts_sourceType_sourceId_lastOccurredAt_idx" ON "compliance_alerts"("sourceType", "sourceId", "lastOccurredAt");
CREATE INDEX "compliance_alerts_customerNo_lastOccurredAt_idx" ON "compliance_alerts"("customerNo", "lastOccurredAt");
CREATE INDEX "compliance_alert_events_alertId_eventAt_idx" ON "compliance_alert_events"("alertId", "eventAt");
