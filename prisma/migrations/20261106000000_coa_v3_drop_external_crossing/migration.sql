/*
  戊波一（科目表 v3）：「跨外部」标记退役。

  - tb_transfer_evidence / account_flows 删 isExternalCrossing：现金户一钱包一户后，
    "哪些流水是外部看得见的" 由账户本身表达（对账引擎直接按现金户读），不再靠逐条打标。
  - 两列均无索引、无约束，SQLite 3.35+ 的 ALTER TABLE DROP COLUMN 直接可用
    （同 20260408020000_drop_customer_active_journey_id 先例）。
  按「数据随时可重铺」不写回填：改完 = stack.sh reset 重铺。
*/
-- AlterTable
ALTER TABLE "tb_transfer_evidence" DROP COLUMN "isExternalCrossing";

-- AlterTable
ALTER TABLE "account_flows" DROP COLUMN "isExternalCrossing";
