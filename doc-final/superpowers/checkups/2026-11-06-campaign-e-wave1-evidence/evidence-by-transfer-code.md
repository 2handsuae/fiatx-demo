# 转账码抽核表（戊波一 · 附录 B 波一列对照）

> 谁、何时：T13 收尾，2026-11-06，代码头 `a35a04f1`。对应 spec §7 验收第 5 条（「每个转账码在 `tb_transfer_evidence` 取一条，借贷助记码与附录 B 一致」）。
> 结论：**附录 B 波一列、码表常量注释、实际落账三者一致，抽核范围内 0 处不符**（下表 + 其后「没有行的码」逐码交代）。

## 怎么取的（证据在它断言的位置取）

- `tb_transfer_evidence` 里**没有存 u16 转账码**（只有 `eventCode` 与借贷助记码），所以「码 → 凭证号」不能靠 SQL 单查。做法：把 evidence 每一行的 `tbTransferId`（TB u128 hex）拿去 **TigerBeetle `lookup_transfers`**，读 TB 里**真实落账记录**的 `code`、借方 / 贷方账户 id，再 `lookup_accounts` 读两个账户自己的 `code`（科目码）。「凭证号」列 = evidence 的 `tbTransferId`；「TB 实记借 / 贷科目码」列来自 TB，不来自 evidence 自述；「evidence 借 / 贷助记码」列是 evidence 行自己写的助记码，要与 TB 科目码逐位对应（`1=A.CLIENT_CASH` … `300=X.EXPENSE_BANK_CUSTODY`）。
- 两份库、两次取样（都取自干净重铺之后；取样后栈即被下一轮重铺，所以证据原始行已落盘，见 `evidence-raw-phaseA.json` / `evidence-raw-phaseB.json`，用 `a4-table.js` 可逐字复现下表）：
  - **A** = `stack.sh reset self` → `up` → `demo:all`（exit 0）→ `recon:demo:pass` → `recon:demo:break`（18/18）→ `verify:coa` 之后：**106 行**（充值 47 / 兑换 26 / 提现 27 / LP 兑换 3 / 注资 2 / 支付 1）。
  - **B** = 另一轮干净重铺 + 7 个私库 + `demo:setup` 后跑完整套串行 e2e：**181 行**（充值 75 / 提现 38 / 兑换 42 / 调账单 12 / 划转 7 / LP 兑换 3 / 注资 2 / 支付 1 / ledger-flags 1）。
- 两段式（锁定 → 落账 / 作废）的码：evidence 行的 `tbTransferId` = **锁定那笔（pending）**；落账 / 作废是另一笔 `post_pending` / `void_pending` 转账，**TB 里 code 为 0（继承 pending）**，evidence 的 `pendingId` 列存的是它的 id。所以 `6 / 7 / 9 / 12 / 15` 这类「阶段码」在表里的「记录形态」列写成「xx 阶段」，并回 TB 查过 post / void 转账确实存在、`pending_id` 指回该行（`✓=true`）。11 / 14 另有 Henry 种子腿的单笔落账行（TB code 直接 = 11 / 14），表里取的就是那种。
- 提现锁定的作废（12 / 15）走 `voidPendingTransferBestEffort`（只作废、**不改写 evidence**），故 evidence 行仍显示 PENDING；这两行是「按锁定行的借方账户翻 TB 转账、找到指向它的 void」得到的，已在记录形态里写明。
- 每个码**所有**候选行都做了比对（不只样本）：**322 次比对（含阶段行），0 处不符**；evidence 共 287 行（A 106 + B 181），TB 码全部落在 1–21 / 30–38 / 70 / 80–87 内（范围外 0 行）。
- 「对照」列：借 / 贷科目码与附录 B 一致，且凡附录 B 点名钱包角色处（公司 Fees / Operations / Settlement / Liquidity）户名也对得上。

## 抽核表

| 码 | 取自 | eventCode | 凭证号（evidence.tbTransferId，TB u128 hex） | 记录形态 | evidence 借 / 贷助记码 | TB 实记借 / 贷科目码 | 借方户名 ⟶ 贷方户名 | 附录 B 波一 | 对照 | 该码全部行 ✓/行数 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | `DEPOSIT_ASSET_TO_SUSPENSE` | `fe624ec9cabacb68d950e58bca679905` | one-shot posted | A.CLIENT_CASH / L.DEPOSIT_SUSPENSE | 1 / 101 | ClCash·CU2601012635 · vIBAN ⟶ DEPOSIT_SUSPENSE for CU2601012635/AED | A.CLIENT_CASH / L.DEPOSIT_SUSPENSE | ✓ | 64/64 |
| 2 | A | `DEPOSIT_SUSPENSE_TO_PAYABLE` | `e530453656557ccc81b452841e7c2541` | one-shot posted | L.DEPOSIT_SUSPENSE / L.CLIENT_PAYABLE | 101 / 100 | DEPOSIT_SUSPENSE for CU2601012635/AED ⟶ CLIENT_PAYABLE for CU2601012635/AED | L.DEPOSIT_SUSPENSE / L.CLIENT_PAYABLE | ✓ | 46/46 |
| 3 | A | `CONFISCATE_REVERSE_SUSPENSE` | `5c63052b3f40c78c12d49f967610f854` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601014381/AED ⟶ ClCash·CU2601014381 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | 1/1 |
| 4 | A | `CONFISCATE_INCOME_OTHER` | `b5ed6d059a4e5e51c80f2f9dbaabb863` | lock-record, later POSTED | A.FIRM_CASH / E.INCOME_OTHER | 50 / 212 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_OTHER for AED | A.FIRM_CASH / E.INCOME_OTHER (Dr Company Fees) | ✓ | 1/1 |
| 5 | A | `DEPOSIT_RETURN_POST` | `4e84ff7c35757449aa8063af0b72ec38` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | 5/5 |
| 6 | A | `DEPOSIT_RETURN_POST` | `4e84ff7c35757449aa8063af0b72ec38` | post stage of code 5 (post transfer 01a1b154…, flags post_pending, pending_id→evidence id ✓=true) | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | 2/2 |
| 7 | B | `DEPOSIT_RETURN_PENDING` | `3df33b17916cb4354e2799264ee52e19` | void stage of code 5 (void transfer 01a1b15d…, flags void_pending, pending_id→evidence id ✓=true) | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601017625/AED ⟶ ClCash·CU2601017625 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | 1/1 |
| 8 | A | `SEIZE_REVERSE_SUSPENSE` | `f3b9fce38602123ef916914b8974a092` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | 2/2 |
| 9 | A | `SEIZE_REVERSE_SUSPENSE` | `f3b9fce38602123ef916914b8974a092` | post stage of code 8 (post transfer 01a1b154…, flags post_pending, pending_id→evidence id ✓=true) | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | 2/2 |
| 10 | A | `WITHDRAW_NET_POST` | `859a50d4e10be402fffdab6f6da5ffde` | lock-record, later POSTED | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | 24/24 |
| 11 | A | `WITHDRAW_NET_POST` | `f5545ee9b49634e74be1e43a5111ad81` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | 15/15 |
| 12 | B | `WITHDRAW_LOCK_NET` | `d5c83d26d41c7b6aaa40119844bfd4db` | void stage of code 10, found in TigerBeetle (void transfer 01a1b15c…, flags void_pending); evidence row still says PENDING — releaseLock uses the best-effort void, which skips the evidence update | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | 2/2 |
| 13 | A | `WITHDRAW_FEE_POST` | `6147994b6c6bdc1c0f1a096fc3ba7a97` | lock-record, later POSTED | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | 24/24 |
| 14 | A | `WITHDRAW_FEE_POST` | `fbe3da80d308789ee8a172253e968430` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | 14/14 |
| 15 | B | `WITHDRAW_LOCK_FEE` | `20594716be1afd2a9092d8d972170945` | void stage of code 13, found in TigerBeetle (void transfer 01a1b15c…, flags void_pending); evidence row still says PENDING — releaseLock uses the best-effort void, which skips the evidence update | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | 3/3 |
| 16 | A | `WITHDRAW_FEE_FIRM` | `da73a6812acdb86ed7ca76b0d1a85bec` | one-shot posted | A.FIRM_CASH / E.INCOME_WITHDRAW_FEE | 50 / 211 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_WITHDRAW_FEE for AED | A.FIRM_CASH / E.INCOME_WITHDRAW_FEE (Dr Company Fees) | ✓ | 11/11 |
| 17 | B | `WITHDRAW_BOUNCE_REENTRY` | `30349996e70b055961bfd7a5596843fc` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU2601010484 · vIBAN ⟶ CLIENT_PAYABLE for CU2601010484/AED | A.CLIENT_CASH / L.CLIENT_PAYABLE | ✓ | 2/2 |
| 30 | A | `SWAP_SELL_CLIENT` | `6a8360e44875ad01dba7179e9e90e5e1` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | 13/13 |
| 31 | A | `SWAP_SELL_FIRM` | `9927d1fc8598270d69f6fc1e194cb996` | pending (open) | A.FIRM_CASH / E.FIRM_EQUITY | 50 / 200 | CoCash·Company Settlement · AED_ZAND ⟶ FIRM_EQUITY for AED | A.FIRM_CASH / E.FIRM_EQUITY | ✓ | 11/11 |
| 32 | A | `SWAP_BUY_OPS_TO_SET` | `1daf34b1f4009010b7d5b0eb08c0b711` | lock-record, later POSTED | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Settlement · AED_ZAND ⟶ CoCash·Company Operations · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Settlement, Cr Company Operations) | ✓ | 3/3 |
| 33 | A | `SWAP_BUY_SET_TO_ASSET` | `042d6cde8afb91f670a125fe81a77f78` | lock-record, later POSTED | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for AED ⟶ CoCash·Company Settlement · AED_ZAND | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Settlement) | ✓ | 3/3 |
| 34 | A | `SWAP_BUY_CLIENT` | `50eeedf212343d38baba51adf0abf6e0` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU2601012635 · Deposit address ⟶ CLIENT_PAYABLE for CU2601012635/USDT-TRON | A.CLIENT_CASH / L.CLIENT_PAYABLE | ✓ | 10/10 |
| 35 | A | `SWAP_FEE_CLIENT` | `a23dad64a639c94d01186bcac4dc2f80` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/USDT-TRON ⟶ ClCash·CU2601012635 · Deposit address | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | 10/10 |
| 36 | A | `SWAP_FEE_FIRM` | `2f21d7d1d9220715dd1e04a1f64d7a8e` | lock-record, later POSTED | A.FIRM_CASH / E.INCOME_SWAP_FEE | 50 / 210 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_SWAP_FEE for AED | A.FIRM_CASH / E.INCOME_SWAP_FEE (Dr Company Fees) | ✓ | 8/8 |
| 37 | A | `SWAP_SELL_SET_TO_OPS` | `60cdb94dfa2a9349283dd5bedef978e5` | lock-record, later POSTED | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Operations · AED_ZAND ⟶ CoCash·Company Settlement · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Operations, Cr Company Settlement) | ✓ | 5/5 |
| 38 | A | `SWAP_BUY_OPS_TO_ASSET` | `224543e2bfaf4cf95e58089fdd5638a0` | lock-record, later POSTED | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for USDT-TRON ⟶ CoCash·Company Operations · TRON | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Operations) | ✓ | 5/5 |
| 70 | A | `CAPITAL_INJECTION` | `91f321404748bf874fa4df672fb0b219` | one-shot posted | A.FIRM_CASH / E.FIRM_EQUITY | 50 / 200 | CoCash·Company Operations · AED_ZAND ⟶ FIRM_EQUITY for AED | A.FIRM_CASH / E.FIRM_EQUITY (Dr Company Operations) | ✓ | 8/8 |
| 81 | B | `INTERNAL_TRANSFER_OPS_TO_SET` | `a956783a7acbf5848acf4bdc8a6c1292` | one-shot posted | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Settlement · AED_ZAND ⟶ CoCash·Company Operations · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Settlement, Cr Company Operations) | ✓ | 1/1 |
| 82 | B | `INTERNAL_TRANSFER_FIRM_OUT` | `3efc8b3eff84e807381af6bb1e8dbef3` | one-shot posted | X.EXPENSE_RECON_LOSS / A.FIRM_CASH | 301 / 50 | EXPENSE_RECON_LOSS for USDT-TRON ⟶ CoCash·Company Operations · TRON | X.EXPENSE_RECON_LOSS / A.FIRM_CASH | ✓ | 3/3 |
| 83 | B | `INTERNAL_TRANSFER_COMPENSATION_IN` | `5fba1cd4022832e91bf61b30a1f08299` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU-E2E-ITR-A-fe8ee0dc · Deposit address ⟶ e2e fixture customer CLIENT_PAYABLE (USDT) | A.CLIENT_CASH / L.CLIENT_PAYABLE | ✓ | 3/3 |
| 84 | A | `LP_EXCHANGE_PAY` | `0e00b1c37f4c238b5869e97fa0deb9e9` | one-shot posted | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for AED ⟶ CoCash·Company Operations · AED_ZAND | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Operations) | ✓ | 2/2 |
| 85 | A | `LP_EXCHANGE_RECEIVE` | `a1f295da36064084595ed450df7fb4f6` | one-shot posted | A.FIRM_CASH / E.FIRM_EQUITY | 50 / 200 | CoCash·Company Liquidity · TRON ⟶ FIRM_EQUITY for USDT-TRON | A.FIRM_CASH / E.FIRM_EQUITY (Dr Company Liquidity) | ✓ | 2/2 |
| 86 | A | `LP_EXCHANGE_ACCEPT` | `43e1ef515e19c1823b4e49aa23f3959d` | one-shot posted | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Operations · TRON ⟶ CoCash·Company Liquidity · TRON | A.FIRM_CASH / A.FIRM_CASH (Dr Company Operations, Cr Company Liquidity) | ✓ | 2/2 |
| 87 | A | `VENDOR_PAYMENT` | `852ad4a83e5c8e6ea71fe8ba9901feba` | one-shot posted | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH | 300 / 50 | EXPENSE_BANK_CUSTODY for AED ⟶ CoCash·Company Operations · AED_ZAND | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH (Cr Company Operations) | ✓ | 2/2 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `771fea9fb14133d7f37184ff8db51bb6` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | e2e recon-adjustment 100/AED ⟶ ClCash·CU261106831137 · vIBAN | 客户池冲正/冲销/认损·REDUCE：借应付 / 贷客户现金 | ✓ | 7/7 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `cdc6474c7c2a226f0eed9cb8889f379c` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU261106374007 · vIBAN ⟶ e2e recon-adjustment 100/AED | 客户池·INCREASE：借客户现金 / 贷应付 | ✓ | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `e871d4220600a76bfbab168fb572b76f` | one-shot posted | A.FIRM_CASH / E.INCOME_OTHER | 50 / 212 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_OTHER for AED | 补记银行利息 / 核销（托管多出）：借公司现金 / 贷其他收入 | ✓ | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `bd04e5030093ecc92fd19c9fec353c87` | one-shot posted | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH | 300 / 50 | EXPENSE_BANK_CUSTODY for AED ⟶ CoCash·Company Fees · AED_ZAND | 补记银行杂费：借银行与托管费用 / 贷公司现金 | ✓ | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `9efc4f956239d16e025c3f40892294b5` | one-shot posted | L.CLIENT_PAYABLE / L.CLIENT_PAYABLE | 100 / 100 | e2e recon-reattribution 100/AED ⟶ e2e recon-reattribution 100/AED | 改记·应付对：借应付·错记方 / 贷应付·正主 | ✓ | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED_CASH` | `fb0b09e4c8e459f2f232a430180f3f1a` | one-shot posted | A.CLIENT_CASH / A.CLIENT_CASH | 1 / 1 | ClCash·CU261106585962 · vIBAN ⟶ ClCash·CU261106783559 · vIBAN | 改记·现金对：借现金·正主 / 贷现金·错记方 | ✓ | 1/1 |

Checked rows: 322 (each logical code's every candidate row, not just the sample); match 322; mismatch 0. Codes with no row in the supplied DB(s): 18, 19, 20, 21.


## 没有行的码，及原因

| 码 | 没有行的原因 |
|---|---|
| 18、19 | 码表里**没有分配**（`TB_TRANSFER_CODES` 无这两个编号），不是漏测 |
| 20（上缴作废） | 没有任何演示 / e2e 路径把「上缴」推到失败作废；代码路径是 `DEPOSIT_SEIZE_VOID`，落账形状与 8 / 9 相同（`L.DEPOSIT_SUSPENSE` / `A.CLIENT_CASH`，对方栏是当局）——**本轮没有实证行**，只有 8 / 9 的实证 |
| 21（入账后被银行追回） | **业主裁定挂起**（附录 B 划线行）：UI 置灰、无 live 路径，常量保留；单测覆盖，无 live evidence 行 |
| 垫款腿（`INTERNAL_TRANSFER_ADVANCE_IN`，落在码 82 / 83） | 业主裁定「应收垫款」挂起：垫款记 `X.EXPENSE_RECON_LOSS` 的形状只有单测 + e2e B 覆盖，而 e2e B 受 `AGREEMENT_NOT_ACCEPTED` 基线债挡住（`recon-internal-transfer` B，改前也红），故没有该事件的 live 行；码 82 / 83 本身有 live 行（e2e A / C） |

## 码 80（调账单）的格覆盖

码 80 是调账单共用一个码，附录 B「平账调账单」共 9 种落账形状。本轮两份库里**出现 6 种，全部与附录 B 一致**；另 3 种不在这两份库里：

| 形状 | 本轮 | 说明 |
|---|---|---|
| 客户池冲正 / 冲销 / 认损 REDUCE：借应付 / 贷客户现金（100→1） | ✓ B 7 行 | |
| 客户池 INCREASE：借客户现金 / 贷应付（1→100） | ✓ B 1 行 | |
| 补记银行利息：借公司现金 / 贷其他收入（50→212） | ✓ B 1 行 | 同形也是「核销·托管里多出」 |
| 补记银行杂费：借银行与托管费用 / 贷公司现金（300→50） | ✓ B 1 行 | |
| 改记·应付对（100→100）与现金对（1→1） | ✓ B 各 1 行 | 同一张凭证两笔码 80（四腿）；现金对用 eventCode `RECON_ADJUSTMENT_POSTED_CASH` |
| 公司池更正 / 冲销（200↔50） | 本轮两份库里无行 | T9 当时用一次性 live 探针在真实 TB + 审批链上走过（task-9-report，探针已删）；e2e 里没有对应用例 |
| 核销·托管里少了：借对账核销损失 / 贷公司现金（301→50） | 本轮无行 | e2e `recon-aging-write-off` 主链路是**基线红**（时区，改前也红），走不到落账；T9 探针走过两个方向 |

## 复现

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
E=doc-final/superpowers/checkups/2026-11-06-campaign-e-wave1-evidence
# 栈活着、TigerBeetle 在监听时（self 栈 TB 端口见 .stackports）：从库 + TB 取原始行
node $E/a4-evidence.js <dev.db 路径> 127.0.0.1:<TB端口> /tmp/raw.json
# 不需要栈：用落盘的原始行逐字复现本文表格
node $E/a4-table.js /tmp/table.md A=$E/evidence-raw-phaseA.json B=$E/evidence-raw-phaseB.json
```

**失效验证**（纪律 2：说得出它什么时候会红）：把落盘原始行改两处再喂 `a4-table.js`——码 87 的借方科目码改成 50（旧形状）、码 16 的借方户名改成「Company Operations」——输出 `mismatch 1` 并列出 `MISMATCHES`：码 87 `PAIR`、码 16 `ROLE` 两条（改动副本已删）。

**搜索边界**：只覆盖这两份库里实际存在的 evidence 行；动态拼 code 的写法、本轮没触发的分支（20、21、垫款腿、调账单 3 种借贷对（200→50、50→200、301→50））没有 live 行，已在上节逐项交代。
