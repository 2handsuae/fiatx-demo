-- 充值红标（提现/兑换早有此列，本批补齐充值）
ALTER TABLE "deposit_transactions" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- L1 判定快照（三域，Task B2 使用；一次迁移建全，避免两次表重建）
ALTER TABLE "deposit_transactions"  ADD COLUMN "l1Snapshot" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "l1Snapshot" TEXT;
ALTER TABLE "swap_transactions"     ADD COLUMN "l1Snapshot" TEXT;
