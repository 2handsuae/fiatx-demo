PRAGMA foreign_keys=OFF;

ALTER TABLE "compliance_incident_disposition_records" RENAME TO "_compliance_incident_disposition_records_old_fk_repair";

CREATE TABLE "compliance_incident_disposition_records" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "incidentId" TEXT NOT NULL,
  "dispositionCode" TEXT NOT NULL,
  "reason" TEXT,
  "isFinal" BOOLEAN NOT NULL DEFAULT false,
  "supersedesRecordId" TEXT,
  "decisionRecordId" TEXT,
  "source" TEXT,
  "sourceRefId" TEXT,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorNo" TEXT,
  "actorRole" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "compliance_incident_disposition_records_incidentId_fkey"
    FOREIGN KEY ("incidentId") REFERENCES "compliance_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "compliance_incident_disposition_records" (
  "id",
  "incidentId",
  "dispositionCode",
  "reason",
  "isFinal",
  "supersedesRecordId",
  "decisionRecordId",
  "source",
  "sourceRefId",
  "actorType",
  "actorId",
  "actorNo",
  "actorRole",
  "createdAt"
)
SELECT
  "id",
  "incidentId",
  "dispositionCode",
  "reason",
  "isFinal",
  "supersedesRecordId",
  "decisionRecordId",
  "source",
  "sourceRefId",
  "actorType",
  "actorId",
  "actorNo",
  "actorRole",
  "createdAt"
FROM "_compliance_incident_disposition_records_old_fk_repair";

DROP TABLE "_compliance_incident_disposition_records_old_fk_repair";

CREATE INDEX "compliance_incident_disposition_records_incidentId_createdAt_idx"
  ON "compliance_incident_disposition_records"("incidentId", "createdAt");
CREATE INDEX "compliance_incident_disposition_records_dispositionCode_createdAt_idx"
  ON "compliance_incident_disposition_records"("dispositionCode", "createdAt");

PRAGMA foreign_keys=ON;
