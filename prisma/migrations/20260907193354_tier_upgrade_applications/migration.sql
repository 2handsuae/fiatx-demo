-- CreateTable
CREATE TABLE "tier_upgrade_applications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "upgradeNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_REVIEW',
    "fromTier" TEXT NOT NULL,
    "toTier" TEXT NOT NULL,
    "materialsSubmittedAt" DATETIME,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tier_upgrade_applications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "tier_upgrade_applications_upgradeNo_key" ON "tier_upgrade_applications"("upgradeNo");

-- CreateIndex
CREATE INDEX "tier_upgrade_applications_customerId_status_idx" ON "tier_upgrade_applications"("customerId", "status");
