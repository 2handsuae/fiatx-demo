-- AlterTable
ALTER TABLE "regulatory_filing_entries" ADD COLUMN "commDraftedBy" TEXT;

-- AlterTable
ALTER TABLE "regulatory_filings" ADD COLUMN "externalCaseRef" TEXT;
ALTER TABLE "regulatory_filings" ADD COLUMN "noFilingReason" TEXT;
