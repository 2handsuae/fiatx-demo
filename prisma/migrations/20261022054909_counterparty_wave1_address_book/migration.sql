-- AlterTable
ALTER TABLE "withdrawal_addresses" ADD COLUMN "beneficiaryRelationship" TEXT;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "declaredHosting" TEXT;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "hostingMismatch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "ownerType" TEXT NOT NULL DEFAULT 'SELF';
ALTER TABLE "withdrawal_addresses" ADD COLUMN "ownershipVerifiedAt" DATETIME;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "screenedAt" DATETIME;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "screeningAnswer" TEXT;
