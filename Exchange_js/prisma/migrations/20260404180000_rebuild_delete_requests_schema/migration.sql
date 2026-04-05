PRAGMA foreign_keys=OFF;

CREATE TABLE "delete_requests__new" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestNo" TEXT NOT NULL DEFAULT 'TEMP',
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetNo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "approvalCaseId" TEXT,
  "approvalNo" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdByUserNo" TEXT NOT NULL,
  "submittedByUserId" TEXT,
  "submittedByUserNo" TEXT,
  "consumedByUserId" TEXT,
  "consumedByUserNo" TEXT,
  "deleteReason" TEXT NOT NULL,
  "resultNote" TEXT,
  "docRef" TEXT,
  "targetSnapshotJson" TEXT NOT NULL DEFAULT '{}',
  "targetSnapshotDigest" TEXT,
  "traceId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "submittedAt" DATETIME,
  "consumedAt" DATETIME,
  CONSTRAINT "delete_requests_approvalCaseId_fkey"
    FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "delete_requests__new" (
  "id",
  "requestNo",
  "targetType",
  "targetId",
  "targetNo",
  "status",
  "approvalCaseId",
  "approvalNo",
  "createdByUserId",
  "createdByUserNo",
  "submittedByUserId",
  "submittedByUserNo",
  "consumedByUserId",
  "consumedByUserNo",
  "deleteReason",
  "resultNote",
  "docRef",
  "targetSnapshotJson",
  "targetSnapshotDigest",
  "traceId",
  "createdAt",
  "updatedAt",
  "submittedAt",
  "consumedAt"
)
SELECT
  "id",
  "requestNo",
  "targetType",
  "targetId",
  "targetNo",
  "status",
  COALESCE("approvalCaseId", "latestApprovalId"),
  "approvalNo",
  COALESCE("createdByUserId", "makerUserId"),
  COALESCE("createdByUserNo", (
    SELECT "userNo" FROM "users" WHERE "users"."id" = COALESCE("delete_requests"."createdByUserId", "delete_requests"."makerUserId")
  ), 'UNKNOWN'),
  "submittedByUserId",
  "submittedByUserNo",
  COALESCE("consumedByUserId", "executedByUserId"),
  COALESCE("consumedByUserNo", (
    SELECT "userNo" FROM "users" WHERE "users"."id" = COALESCE("delete_requests"."consumedByUserId", "delete_requests"."executedByUserId")
  )),
  "deleteReason",
  "resultNote",
  "docRef",
  COALESCE("targetSnapshotJson", '{}'),
  "targetSnapshotDigest",
  "traceId",
  "createdAt",
  "updatedAt",
  "submittedAt",
  COALESCE("consumedAt", "executedAt")
FROM "delete_requests";

DROP TABLE "delete_requests";
ALTER TABLE "delete_requests__new" RENAME TO "delete_requests";

CREATE UNIQUE INDEX "delete_requests_requestNo_key"
ON "delete_requests"("requestNo");

CREATE UNIQUE INDEX "delete_requests_approvalCaseId_key"
ON "delete_requests"("approvalCaseId");

CREATE INDEX "delete_requests_status_createdAt_idx"
ON "delete_requests"("status", "createdAt");

CREATE INDEX "delete_requests_requestNo_createdAt_idx"
ON "delete_requests"("requestNo", "createdAt");

CREATE INDEX "delete_requests_targetType_targetId_status_idx"
ON "delete_requests"("targetType", "targetId", "status");

CREATE INDEX "delete_requests_targetType_targetNo_status_idx"
ON "delete_requests"("targetType", "targetNo", "status");

CREATE INDEX "delete_requests_traceId_createdAt_idx"
ON "delete_requests"("traceId", "createdAt");

CREATE INDEX "delete_requests_approvalNo_createdAt_idx"
ON "delete_requests"("approvalNo", "createdAt");

PRAGMA foreign_keys=ON;
