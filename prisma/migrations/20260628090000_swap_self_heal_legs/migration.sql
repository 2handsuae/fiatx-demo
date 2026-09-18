-- AlterTable: per-leg retry counter for swap self-heal (attempt N of legSeq)
ALTER TABLE "internal_funds" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;

-- AlterTable: swap operator-facing projection fields (derived from legs, display-only)
ALTER TABLE "swap_transactions" ADD COLUMN "currentStage" TEXT;
ALTER TABLE "swap_transactions" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
