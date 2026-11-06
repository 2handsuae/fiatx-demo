/*
  戊波一（科目表 v3）：凭证表的钱包标签与「跨外部」标记退役。

  - tb_transfer_evidence / account_flows 删 isExternalCrossing：现金户一钱包一户后，
    "哪些流水是外部看得见的" 由账户本身表达（对账引擎直接按现金户读），不再靠逐条打标。
  - tb_transfer_evidence 删 debitWalletRef / creditWalletRef 及其两个索引：钱包标签改由
    account_flows.walletRef 按注册表派生，凭证上这两列无人写、无人读。
  - isExternalCrossing 两列无索引、无约束；debit/creditWalletRef 先删索引再删列（SQLite 不许删被索引的列）。
    均走 SQLite 3.35+ 的 ALTER TABLE DROP COLUMN（同 20260408020000_drop_customer_active_journey_id 先例）。
  按「数据随时可重铺」不写回填：改完 = stack.sh reset 重铺。
*/
-- DropIndex
DROP INDEX "tb_transfer_evidence_debitWalletRef_idx";

-- DropIndex
DROP INDEX "tb_transfer_evidence_creditWalletRef_idx";

-- AlterTable
ALTER TABLE "tb_transfer_evidence" DROP COLUMN "debitWalletRef";

-- AlterTable
ALTER TABLE "tb_transfer_evidence" DROP COLUMN "creditWalletRef";

-- AlterTable
ALTER TABLE "tb_transfer_evidence" DROP COLUMN "isExternalCrossing";

-- AlterTable
ALTER TABLE "account_flows" DROP COLUMN "isExternalCrossing";
