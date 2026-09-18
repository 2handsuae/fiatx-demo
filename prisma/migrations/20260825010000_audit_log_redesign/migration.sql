-- 审计日志重构第一批：按应然规范重建主表 + 恢复 2026-05-20 被 DROP 的多主体子表
-- demo 数据可重铺，不做 backfill，直接建目标终态

DROP TABLE IF EXISTS "audit_log_events";

CREATE TABLE "audit_log_events" (
    -- seq 是 INTEGER PRIMARY KEY AUTOINCREMENT = SQLite rowid 别名，DB 保证单调且不复用
    "seq"                INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id"                 TEXT NOT NULL,
    "eventNo"            TEXT NOT NULL DEFAULT 'TEMP',
    "schemaVersion"      INTEGER NOT NULL DEFAULT 1,
    "category"           TEXT NOT NULL,
    "isReadOnly"         BOOLEAN NOT NULL DEFAULT false,
    "supersedesEventNo"  TEXT,
    "correctionReason"   TEXT,
    "occurredAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate"      DATETIME,
    "action"             TEXT NOT NULL,
    "actionDomain"       TEXT NOT NULL,
    "workflowType"       TEXT,
    "actorType"          TEXT NOT NULL,
    "actorNo"            TEXT NOT NULL,
    "actorDisplayName"   TEXT NOT NULL,
    "onBehalfOfType"     TEXT,
    "onBehalfOfNo"       TEXT,
    "actorRolesAtTime"   TEXT NOT NULL DEFAULT '[]',
    "authnMethod"        TEXT,
    "sourcePlatform"     TEXT NOT NULL,
    "requestId"          TEXT,
    "sessionId"          TEXT,
    "sourceIp"           TEXT,
    "userAgent"          TEXT,
    "endpoint"           TEXT,
    "primarySubjectType" TEXT,
    "primarySubjectNo"   TEXT,
    "ownerCustomerNo"    TEXT,
    "outcome"            TEXT NOT NULL DEFAULT 'SUCCESS',
    "reasonCode"         TEXT,
    "reason"             TEXT,
    "fromStatus"         TEXT,
    "toStatus"           TEXT,
    "beforeData"         TEXT,
    "afterData"          TEXT,
    "amount"             TEXT,
    "currency"           TEXT,
    "permissionCode"     TEXT,
    "policyCode"         TEXT,
    "policyVersion"      INTEGER,
    "approvalNo"         TEXT,
    "ruleCode"           TEXT,
    "ruleVersion"        INTEGER,
    "isOverride"         BOOLEAN NOT NULL DEFAULT false,
    "overrideReason"     TEXT,
    "correlationId"       TEXT,
    "causationId"         TEXT,
    "traceId"             TEXT,
    "groupEventId"        TEXT,
    "externalEvidenceRef" TEXT,
    "payloadDigest"      TEXT NOT NULL,
    "prevHash"           TEXT,
    "selfHash"           TEXT,
    "retentionClass"     TEXT NOT NULL DEFAULT 'STANDARD_8Y',
    "retainedUntil"      DATETIME NOT NULL,
    "legalHold"          BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey"     TEXT,
    "signature"          TEXT,
    "archivedAt"         DATETIME,
    "storageTier"        TEXT DEFAULT 'HOT',
    "metadata"           TEXT
);

CREATE UNIQUE INDEX "audit_log_events_id_key"             ON "audit_log_events"("id");
CREATE UNIQUE INDEX "audit_log_events_eventNo_key"        ON "audit_log_events"("eventNo");
CREATE UNIQUE INDEX "audit_log_events_idempotencyKey_key" ON "audit_log_events"("idempotencyKey");
CREATE INDEX "audit_log_events_occurredAt_idx"            ON "audit_log_events"("occurredAt");
CREATE INDEX "audit_log_events_actorNo_occurredAt_idx"    ON "audit_log_events"("actorNo","occurredAt");
CREATE INDEX "audit_log_events_ownerCustomerNo_occurredAt_idx"      ON "audit_log_events"("ownerCustomerNo","occurredAt");
CREATE INDEX "audit_log_events_action_occurredAt_idx"     ON "audit_log_events"("action","occurredAt");
CREATE INDEX "audit_log_events_actionDomain_occurredAt_idx"     ON "audit_log_events"("actionDomain","occurredAt");
CREATE INDEX "audit_log_events_correlationId_occurredAt_idx"       ON "audit_log_events"("correlationId","occurredAt");
CREATE INDEX "audit_log_events_causationId_idx"           ON "audit_log_events"("causationId");
CREATE INDEX "audit_log_events_traceId_occurredAt_idx"    ON "audit_log_events"("traceId","occurredAt");
CREATE INDEX "audit_log_events_outcome_occurredAt_idx"    ON "audit_log_events"("outcome","occurredAt");
CREATE INDEX "audit_log_events_primarySubjectType_primarySubjectNo_idx"        ON "audit_log_events"("primarySubjectType","primarySubjectNo");
CREATE INDEX "audit_log_events_isReadOnly_occurredAt_idx" ON "audit_log_events"("isReadOnly","occurredAt");
CREATE INDEX "audit_log_events_retainedUntil_idx"         ON "audit_log_events"("retainedUntil");
CREATE INDEX "audit_log_events_legalHold_idx"             ON "audit_log_events"("legalHold");

-- 多主体子表：恢复 2026-05-20 被 DROP 的 audit_log_subject_nos，形状按应然重建
CREATE TABLE "audit_log_subjects" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "eventId"     TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectNo"   TEXT NOT NULL,
    "subjectRole" TEXT NOT NULL,
    "occurredAt"  DATETIME NOT NULL,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_subjects_eventId_fkey" FOREIGN KEY ("eventId")
        REFERENCES "audit_log_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "audit_log_subjects_eventId_subjectType_subjectNo_subjectRole_key"
    ON "audit_log_subjects"("eventId","subjectType","subjectNo","subjectRole");
CREATE INDEX "audit_log_subjects_subjectNo_occurredAt_idx"
    ON "audit_log_subjects"("subjectNo","occurredAt");
CREATE INDEX "audit_log_subjects_subjectType_subjectNo_occurredAt_idx"
    ON "audit_log_subjects"("subjectType","subjectNo","occurredAt");
CREATE INDEX "audit_log_subjects_subjectRole_occurredAt_idx"
    ON "audit_log_subjects"("subjectRole","occurredAt");
CREATE INDEX "audit_log_subjects_eventId_idx"
    ON "audit_log_subjects"("eventId");
