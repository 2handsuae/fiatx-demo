-- CreateTable
CREATE TABLE "customer_agreement_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "effectiveAt" DATETIME,
    "publishedAt" DATETIME,
    "pendingApprovalNo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "customer_agreement_consents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "customerNo" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_agreement_versions_versionKey_key" ON "customer_agreement_versions"("versionKey");

-- CreateIndex
CREATE INDEX "customer_agreement_consents_customerId_versionKey_idx" ON "customer_agreement_consents"("customerId", "versionKey");
