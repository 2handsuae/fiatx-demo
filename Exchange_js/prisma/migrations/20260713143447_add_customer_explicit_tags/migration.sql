-- AlterTable
ALTER TABLE "customer_main" ADD COLUMN "onboardingApprovedAt" DATETIME;

-- CreateTable
CREATE TABLE "customer_explicit_tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "tagCode" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_explicit_tags_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "customer_explicit_tags_tagCode_idx" ON "customer_explicit_tags"("tagCode");

-- CreateIndex
CREATE UNIQUE INDEX "customer_explicit_tags_customerId_tagCode_key" ON "customer_explicit_tags"("customerId", "tagCode");
