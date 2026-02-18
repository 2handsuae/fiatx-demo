-- AlterTable
ALTER TABLE "audit_log_events" ADD COLUMN "actorNo" TEXT;
ALTER TABLE "audit_log_events" ADD COLUMN "entityOwnerNo" TEXT;

-- CreateTable
CREATE TABLE "audit_log_subject_nos" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "subjectRole" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectNo" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_subject_nos_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "audit_log_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "audit_log_events_actorNo_occurredAt_idx" ON "audit_log_events"("actorNo", "occurredAt");
CREATE INDEX "audit_log_events_entityOwnerNo_occurredAt_idx" ON "audit_log_events"("entityOwnerNo", "occurredAt");
CREATE INDEX "audit_log_subject_nos_subjectNo_occurredAt_idx" ON "audit_log_subject_nos"("subjectNo", "occurredAt");
CREATE INDEX "audit_log_subject_nos_subjectType_subjectNo_occurredAt_idx" ON "audit_log_subject_nos"("subjectType", "subjectNo", "occurredAt");
CREATE INDEX "audit_log_subject_nos_eventId_idx" ON "audit_log_subject_nos"("eventId");

-- Backfill actorNo / entityOwnerNo for existing audit logs (best-effort)
UPDATE "audit_log_events"
SET "actorNo" = (
  SELECT "userNo" FROM "users" u
  WHERE u."id" = "audit_log_events"."actorId"
)
WHERE "actorType" = 'ADMIN' AND "actorNo" IS NULL;

UPDATE "audit_log_events"
SET "actorNo" = (
  SELECT "customerNo" FROM "customer_main" c
  WHERE c."id" = "audit_log_events"."actorId"
)
WHERE "actorType" = 'CUSTOMER' AND "actorNo" IS NULL;

UPDATE "audit_log_events"
SET "actorNo" = 'SYSTEM'
WHERE "actorType" = 'SYSTEM' AND "actorNo" IS NULL;

UPDATE "audit_log_events"
SET "entityOwnerNo" = (
  SELECT "customerNo" FROM "customer_main" c
  WHERE c."id" = "audit_log_events"."entityOwnerId"
)
WHERE "entityOwnerType" = 'CUSTOMER' AND "entityOwnerNo" IS NULL;
