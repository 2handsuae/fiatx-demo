-- Drop legacy per-domain audit tables (superseded by canonical audit_log_events)
-- and the unused asset_valuation_rates table.
PRAGMA foreign_keys=off;
DROP TABLE "onboarding_audit_logs";
DROP TABLE "payin_audit_logs";
DROP TABLE "deposit_audit_logs";
DROP TABLE "payout_audit_logs";
DROP TABLE "withdraw_audit_logs";
DROP TABLE "asset_valuation_rates";
PRAGMA foreign_keys=on;
