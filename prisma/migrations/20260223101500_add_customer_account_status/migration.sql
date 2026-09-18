-- Add manual customer account access status fields.
ALTER TABLE "customer_main" ADD COLUMN "accountStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "customer_main" ADD COLUMN "accountStatusReason" TEXT;
ALTER TABLE "customer_main" ADD COLUMN "accountStatusChangedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "accountStatusChangedBy" TEXT;
