-- AlterTable
ALTER TABLE "audit_log_events" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "audit_log_events" ADD COLUMN "payloadDigest" TEXT NOT NULL DEFAULT '';
ALTER TABLE "audit_log_events" ADD COLUMN "maskVersion" TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE "audit_log_events" ADD COLUMN "retainedUntil" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "audit_log_events" ADD COLUMN "archivedAt" DATETIME;

-- Backfill retainedUntil to +8 years for existing rows
UPDATE "audit_log_events"
SET "retainedUntil" = datetime(COALESCE("occurredAt", CURRENT_TIMESTAMP), '+8 years')
WHERE "retainedUntil" IS NULL OR "retainedUntil" = '';

-- Backfill payload digest for existing rows (deterministic placeholder for historical rows)
UPDATE "audit_log_events"
SET "payloadDigest" =
  lower(hex(randomblob(16))) || lower(hex(randomblob(16)))
WHERE "payloadDigest" = '';

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_events_idempotencyKey_key" ON "audit_log_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "audit_log_events_module_entityType_entityId_occurredAt_idx"
ON "audit_log_events"("module", "entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_events_actorType_actorId_occurredAt_idx"
ON "audit_log_events"("actorType", "actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_log_events_retainedUntil_idx" ON "audit_log_events"("retainedUntil");

-- CreateIndex
CREATE INDEX "audit_log_events_archivedAt_idx" ON "audit_log_events"("archivedAt");
