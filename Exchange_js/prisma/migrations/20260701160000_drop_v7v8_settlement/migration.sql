-- C5b: drop V7/V8 delayed-settlement residue tables.
--
-- The deposit/withdraw/swap flows now drive funds_orders directly (real-time 1:1);
-- the V7/V8 settlement machinery (EOD/fiat settlement workflows, internal transfers,
-- settlement batches, outstanding + fee-accrual ledgers) was removed in C5b code.
-- These 5 tables are the last physical residue. All are empty in every live stack.
--
-- Why plain DROP TABLE (no table rebuild, unlike C5a):
--   C5a rebuilt deposit_transactions / inbound_transfer_signals because *kept* tables
--   held FK COLUMNS pointing INTO the dropped payins table. Here it is the reverse —
--   the FK columns (outstandings.closedByInternalFundId / settledByTransferId /
--   settlementBatchId, fee_accruals.*, internal_transaction_audit_logs.internalTransactionId)
--   all live ON the dropped tables, pointing OUT to kept tables (funds_orders / assets /
--   internal_transactions). No kept table references any of these 5, so dropping them
--   cannot dangle a kept-side FK. foreign_keys=OFF + child-first order handles the
--   inter-target FKs (audit_logs → internal_transactions; outstandings / fee_accruals →
--   settlement_batches + internal_transactions).

PRAGMA foreign_keys=OFF;

DROP TABLE "internal_transaction_audit_logs";
DROP TABLE "outstandings";
DROP TABLE "fee_accruals";
DROP TABLE "settlement_batches";
DROP TABLE "internal_transactions";

PRAGMA foreign_keys=ON;
