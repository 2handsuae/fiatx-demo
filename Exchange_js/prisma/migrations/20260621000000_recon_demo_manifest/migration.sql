-- Add demo-only manifest column (JSON answer-key of injected breaks) to reconciliation_runs.
ALTER TABLE "reconciliation_runs" ADD COLUMN "demoManifest" TEXT;
