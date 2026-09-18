CREATE TABLE "material_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sumsubApplicantId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "levelName" TEXT NOT NULL,
    "applicantActionId" TEXT NOT NULL,
    "externalActionId" TEXT NOT NULL,
    "orderDomain" TEXT,
    "orderRef" TEXT,
    "restrictionNo" TEXT,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SUBMISSION',
    "reason" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "reviewAnswer" TEXT,
    "reviewRejectType" TEXT,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "traceId" TEXT NOT NULL,
    CONSTRAINT "material_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "material_requests_requestNo_key" ON "material_requests"("requestNo");
CREATE UNIQUE INDEX "material_requests_externalActionId_key" ON "material_requests"("externalActionId");
CREATE INDEX "material_requests_customerId_status_idx" ON "material_requests"("customerId", "status");
CREATE INDEX "material_requests_orderDomain_orderRef_idx" ON "material_requests"("orderDomain", "orderRef");
CREATE INDEX "material_requests_restrictionNo_idx" ON "material_requests"("restrictionNo");
