CREATE TABLE "business_config_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subjectType" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "payloadJson" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "changeSummary" TEXT,
  "status" TEXT NOT NULL DEFAULT 'STAGED',
  "sourceCommitSha" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "business_config_revisions_subjectType_businessKey_revisionNo_key"
  ON "business_config_revisions"("subjectType", "businessKey", "revisionNo");
CREATE INDEX "business_config_revisions_subjectType_businessKey_createdAt_idx"
  ON "business_config_revisions"("subjectType", "businessKey", "createdAt");
CREATE INDEX "business_config_revisions_subjectType_contentHash_idx"
  ON "business_config_revisions"("subjectType", "contentHash");

CREATE TABLE "business_config_releases" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "subjectType" TEXT NOT NULL,
  "releaseNo" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "basedOnReleaseNo" TEXT,
  "changeTicketId" TEXT,
  "approvalCaseId" TEXT,
  "effectiveFrom" DATETIME,
  "publishedAt" DATETIME,
  "publishedBy" TEXT,
  "validationSummaryJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "business_config_releases_releaseNo_key"
  ON "business_config_releases"("releaseNo");
CREATE INDEX "business_config_releases_subjectType_status_createdAt_idx"
  ON "business_config_releases"("subjectType", "status", "createdAt");
CREATE INDEX "business_config_releases_subjectType_createdAt_idx"
  ON "business_config_releases"("subjectType", "createdAt");

CREATE TABLE "business_config_release_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "releaseId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_config_release_items_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "business_config_releases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "business_config_release_items_revisionId_fkey"
    FOREIGN KEY ("revisionId") REFERENCES "business_config_revisions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "business_config_release_items_releaseId_businessKey_key"
  ON "business_config_release_items"("releaseId", "businessKey");
CREATE INDEX "business_config_release_items_releaseId_sortOrder_idx"
  ON "business_config_release_items"("releaseId", "sortOrder");
CREATE INDEX "business_config_release_items_revisionId_idx"
  ON "business_config_release_items"("revisionId");
CREATE INDEX "business_config_release_items_subjectType_businessKey_idx"
  ON "business_config_release_items"("subjectType", "businessKey");
