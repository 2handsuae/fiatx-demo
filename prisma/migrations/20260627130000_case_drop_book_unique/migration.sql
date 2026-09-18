-- T2 / Phase B: drop the (businessDate, assetId, book) UNIQUE on reconciliation_cases.
--
-- Why: Phase B's per-wallet engine (T7) opens one Case per (walletRef, businessDate).
-- A book like CUSTOMER/USDT may legitimately host >1 breaking wallet on the same day —
-- the old V8_FORMULA engine collapsed them into a single Case (deltaAmount accumulated,
-- walletRef pinned to the first observer). With T2's wallet-keyed upsert, each wallet
-- gets its own Case row, so this DB-level unique would falsely reject the second wallet.
--
-- Idempotency now lives at the service layer: WalletReconRunService.upsertCaseForWallet
-- findFirst's by (walletRef, businessDate, status=OPEN) and updates in place if found.
-- A DB-level partial-unique on (walletRef, businessDate, status=OPEN) is deferred to
-- Phase C (SQLite expression-index compatibility pending). The (walletRef, businessDate,
-- status) index added in T1 (20260627120000_case_idempotent_fields) already accelerates
-- that lookup.
--
-- We replace the unique with a non-unique index on the same triple so queries that
-- filter cases by (businessDate, assetId, book) (the legacy aggregate view) keep their
-- index plan.

DROP INDEX "reconciliation_cases_businessDate_assetId_book_key";
CREATE INDEX "reconciliation_cases_businessDate_assetId_book_idx" ON "reconciliation_cases"("businessDate", "assetId", "book");
