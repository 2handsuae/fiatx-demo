# 转账码抽核表（戊波一 · 附录 B 波一列对照）

> 谁、何时：T13 收尾，2026-11-06，代码头 `a35a04f1`。对应 spec §7 验收第 5 条（「每个转账码在 `tb_transfer_evidence` 取一条，借贷助记码与附录 B 一致」）。
> 结论：**产品落账行 240 条、275 次比对（每次都核「借贷科目码对」，附录 B 点名钱包角色的 49 次再核「钱包角色」），0 处不符、0 个无期望的码**；e2e 夹具行 47 条单列、不计入（其中 4 条注资夹具的借方是 `Company Fees` 而非附录 B 的 `Company Operations`，原因见下表后的「夹具行」节）。没有行的码逐码交代在「没有行的码」。
> 2026-11-06 终审修订：此前版本只对样本行核了钱包角色、码 80 只核每格第一行，且把 e2e 夹具行混计；本版 `a4-table.js` 已改成逐行双检、夹具单列，数字与表格均由落盘原始行离线重生成。

## 怎么取的（证据在它断言的位置取）

- `tb_transfer_evidence` 里**没有存 u16 转账码**（只有 `eventCode` 与借贷助记码），所以「码 → 凭证号」不能靠 SQL 单查。做法：把 evidence 每一行的 `tbTransferId`（TB u128 hex）拿去 **TigerBeetle `lookup_transfers`**，读 TB 里**真实落账记录**的 `code`、借方 / 贷方账户 id，再 `lookup_accounts` 读两个账户自己的 `code`（科目码）。「凭证号」列 = evidence 的 `tbTransferId`；「TB 实记借 / 贷科目码」列来自 TB，不来自 evidence 自述；「evidence 借 / 贷助记码」列是 evidence 行自己写的助记码，要与 TB 科目码逐位对应（`1=A.CLIENT_CASH` … `300=X.EXPENSE_BANK_CUSTODY`）。
- 两份库、两次取样（都取自干净重铺之后；取样后栈即被下一轮重铺，所以证据原始行已落盘，见 `evidence-raw-phaseA.json` / `evidence-raw-phaseB.json`，用 `a4-table.js` 可逐字复现下表）：
  - **A** = `stack.sh reset self` → `up` → `demo:all`（exit 0）→ `recon:demo:pass` → `recon:demo:break`（18/18）→ `verify:coa` 之后：**106 行**（充值 47 / 兑换 26 / 提现 27 / LP 兑换 3 / 注资 2 / 支付 1）。
  - **B** = 另一轮干净重铺 + 7 个私库 + `demo:setup` 后跑完整套串行 e2e：**181 行**（充值 75 / 提现 38 / 兑换 42 / 调账单 12 / 划转 7 / LP 兑换 3 / 注资 2 / 支付 1 / ledger-flags 1）。
- 两段式（锁定 → 落账 / 作废）的码：evidence 行的 `tbTransferId` = **锁定那笔（pending）**；落账 / 作废是另一笔 `post_pending` / `void_pending` 转账，evidence 的 `pendingId` 列存的是它的 id。按 R34，post / void **提交时 code 填 0，TigerBeetle 落库时存的是 pending 的 code**——原始行里每个阶段转账的 `stage.code` 都等于其锁定笔的码（见表后统计「stored code = 其 pending 的 code」）。所以 `6 / 7 / 9 / 12 / 15 / 20` 这些阶段码**永远不会作为 TB 存的转账码出现**（脚本把「存储码是阶段码」当 UNEXPECTED 报），只能经「锁定行 + 它的阶段转账」验证：表里「记录形态」列写成「xx 阶段」，并回 TB 查过阶段转账存在、flag 是 `post_pending` / `void_pending`、`pending_id` 指回该行（`✓=true`）、存的 code = 锁定笔的码，借贷科目码 / 钱包角色取锁定笔的账户。11 / 14 另有 Henry 种子腿的单笔落账行（TB code 直接 = 11 / 14），表里取的就是那种。
- 提现锁定的作废（12 / 15）走 `voidPendingTransferBestEffort`（只作废、**不改写 evidence**），故 evidence 行仍显示 PENDING；这两行是「按锁定行的借方账户翻 TB 转账、找到指向它的 void」得到的，已在记录形态里写明。
- 每个码**所有**候选行都做了比对（不只样本），**每一行都过两项检查**（角色一项只在附录 B 点名角色处适用）：①借贷科目码对（TB 实记科目码 = 附录 B，且 evidence 助记码与之逐位对应）；②钱包角色（凡附录 B 点名角色处——公司 Fees / Operations / Settlement / Liquidity——TB 账户户名要含该角色；码 80 附录 B 不点名角色，故该项对 80 不适用）。码 80 逐行核（每行都要落进附录 B 的 9 格之一），不是每格只核第一行。
- 结果（`a4-table.js` 离线重生成，退出码 0）：evidence 共 287 行（A 106 + B 181）= **产品行 240 + 夹具行 47 + 无 TigerBeetle 转账的行 0**；产品行 **275 次比对**（含 35 次阶段比对）：借贷对 275/275、钱包角色 49/49（275 次里 49 次附录 B 点名了角色）、阶段转账记录 35/35，**0 处不符、0 个 UNEXPECTED**。TB 里存的转账码全部落在附录 B 有期望的集合内，没有任何阶段码作为存储码出现。
- 夹具行的判定标记：`eventCode` 为 `E2E_*`（`E2E_FIRM_FIXTURE`、`E2E_LEDGER_FLAGS`），或 `sourceNo` 以 `E2E-` 开头（`test/*.e2e-spec.ts` 里直接调记账服务给钱包预充值的写法）。它们不是产品落账，不计入符合 / 不符，单列在表后。
- 阶段转账的统计（R34 的实证）：TB 里查到的 post / void 转账共 95 笔，**存的 code = 其 pending 的 code：95；存为 0：0；其他：0**。

## 抽核表

| 码 | 取自 | eventCode | 凭证号（evidence.tbTransferId，TB u128 hex） | 记录形态 | evidence 借 / 贷助记码 | TB 实记借 / 贷科目码 | 借方户名 ⟶ 贷方户名 | 附录 B 波一 | 借贷对 | 钱包角色 | 该码全部产品行 ✓/行数 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | `DEPOSIT_ASSET_TO_SUSPENSE` | `fe624ec9cabacb68d950e58bca679905` | one-shot posted | A.CLIENT_CASH / L.DEPOSIT_SUSPENSE | 1 / 101 | ClCash·CU2601012635 · vIBAN ⟶ DEPOSIT_SUSPENSE for CU2601012635/AED | A.CLIENT_CASH / L.DEPOSIT_SUSPENSE | ✓ | — | 42/42 |
| 2 | A | `DEPOSIT_SUSPENSE_TO_PAYABLE` | `e530453656557ccc81b452841e7c2541` | one-shot posted | L.DEPOSIT_SUSPENSE / L.CLIENT_PAYABLE | 101 / 100 | DEPOSIT_SUSPENSE for CU2601012635/AED ⟶ CLIENT_PAYABLE for CU2601012635/AED | L.DEPOSIT_SUSPENSE / L.CLIENT_PAYABLE | ✓ | — | 25/25 |
| 3 | A | `CONFISCATE_REVERSE_SUSPENSE` | `5c63052b3f40c78c12d49f967610f854` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601014381/AED ⟶ ClCash·CU2601014381 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 1/1 |
| 4 | A | `CONFISCATE_INCOME_OTHER` | `b5ed6d059a4e5e51c80f2f9dbaabb863` | lock-record, later POSTED | A.FIRM_CASH / E.INCOME_OTHER | 50 / 212 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_OTHER for AED | A.FIRM_CASH / E.INCOME_OTHER (Dr Company Fees) | ✓ | ✓ | 1/1 |
| 5 | A | `DEPOSIT_RETURN_POST` | `4e84ff7c35757449aa8063af0b72ec38` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 5/5 |
| 6 | A | `DEPOSIT_RETURN_POST` | `4e84ff7c35757449aa8063af0b72ec38` | post stage of code 5 (post transfer 01a1b154…, flags post_pending, pending_id→evidence id ✓=true); stored code 5 = pending's | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 2/2 |
| 7 | B | `DEPOSIT_RETURN_PENDING` | `3df33b17916cb4354e2799264ee52e19` | void stage of code 5 (void transfer 01a1b15d…, flags void_pending, pending_id→evidence id ✓=true); stored code 5 = pending's | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601017625/AED ⟶ ClCash·CU2601017625 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 1/1 |
| 8 | A | `SEIZE_REVERSE_SUSPENSE` | `f3b9fce38602123ef916914b8974a092` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 2/2 |
| 9 | A | `SEIZE_REVERSE_SUSPENSE` | `f3b9fce38602123ef916914b8974a092` | post stage of code 8 (post transfer 01a1b154…, flags post_pending, pending_id→evidence id ✓=true); stored code 8 = pending's | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 2/2 |
| 10 | A | `WITHDRAW_NET_POST` | `859a50d4e10be402fffdab6f6da5ffde` | lock-record, later POSTED | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 24/24 |
| 11 | A | `WITHDRAW_NET_POST` | `f5545ee9b49634e74be1e43a5111ad81` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 15/15 |
| 12 | B | `WITHDRAW_LOCK_NET` | `d5c83d26d41c7b6aaa40119844bfd4db` | void stage of code 10, found in TigerBeetle (void transfer 01a1b15c…, flags void_pending); evidence row still says PENDING — releaseLock uses the best-effort void, which skips the evidence update; stored code 10 = pending's | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 2/2 |
| 13 | A | `WITHDRAW_FEE_POST` | `6147994b6c6bdc1c0f1a096fc3ba7a97` | lock-record, later POSTED | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 24/24 |
| 14 | A | `WITHDRAW_FEE_POST` | `fbe3da80d308789ee8a172253e968430` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 14/14 |
| 15 | B | `WITHDRAW_LOCK_FEE` | `20594716be1afd2a9092d8d972170945` | void stage of code 13, found in TigerBeetle (void transfer 01a1b15c…, flags void_pending); evidence row still says PENDING — releaseLock uses the best-effort void, which skips the evidence update; stored code 13 = pending's | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 3/3 |
| 16 | A | `WITHDRAW_FEE_FIRM` | `da73a6812acdb86ed7ca76b0d1a85bec` | one-shot posted | A.FIRM_CASH / E.INCOME_WITHDRAW_FEE | 50 / 211 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_WITHDRAW_FEE for AED | A.FIRM_CASH / E.INCOME_WITHDRAW_FEE (Dr Company Fees) | ✓ | ✓ | 11/11 |
| 17 | B | `WITHDRAW_BOUNCE_REENTRY` | `30349996e70b055961bfd7a5596843fc` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU2601010484 · vIBAN ⟶ CLIENT_PAYABLE for CU2601010484/AED | A.CLIENT_CASH / L.CLIENT_PAYABLE | ✓ | — | 2/2 |
| 30 | A | `SWAP_SELL_CLIENT` | `6a8360e44875ad01dba7179e9e90e5e1` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 13/13 |
| 31 | A | `SWAP_SELL_FIRM` | `9927d1fc8598270d69f6fc1e194cb996` | pending (open) | A.FIRM_CASH / E.FIRM_EQUITY | 50 / 200 | CoCash·Company Settlement · AED_ZAND ⟶ FIRM_EQUITY for AED | A.FIRM_CASH / E.FIRM_EQUITY | ✓ | — | 11/11 |
| 32 | A | `SWAP_BUY_OPS_TO_SET` | `1daf34b1f4009010b7d5b0eb08c0b711` | lock-record, later POSTED | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Settlement · AED_ZAND ⟶ CoCash·Company Operations · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Settlement, Cr Company Operations) | ✓ | ✓ | 3/3 |
| 33 | A | `SWAP_BUY_SET_TO_ASSET` | `042d6cde8afb91f670a125fe81a77f78` | lock-record, later POSTED | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for AED ⟶ CoCash·Company Settlement · AED_ZAND | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Settlement) | ✓ | ✓ | 3/3 |
| 34 | A | `SWAP_BUY_CLIENT` | `50eeedf212343d38baba51adf0abf6e0` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU2601012635 · Deposit address ⟶ CLIENT_PAYABLE for CU2601012635/USDT-TRON | A.CLIENT_CASH / L.CLIENT_PAYABLE | ✓ | — | 10/10 |
| 35 | A | `SWAP_FEE_CLIENT` | `a23dad64a639c94d01186bcac4dc2f80` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/USDT-TRON ⟶ ClCash·CU2601012635 · Deposit address | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 10/10 |
| 36 | A | `SWAP_FEE_FIRM` | `2f21d7d1d9220715dd1e04a1f64d7a8e` | lock-record, later POSTED | A.FIRM_CASH / E.INCOME_SWAP_FEE | 50 / 210 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_SWAP_FEE for AED | A.FIRM_CASH / E.INCOME_SWAP_FEE (Dr Company Fees) | ✓ | ✓ | 8/8 |
| 37 | A | `SWAP_SELL_SET_TO_OPS` | `60cdb94dfa2a9349283dd5bedef978e5` | lock-record, later POSTED | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Operations · AED_ZAND ⟶ CoCash·Company Settlement · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Operations, Cr Company Settlement) | ✓ | ✓ | 5/5 |
| 38 | A | `SWAP_BUY_OPS_TO_ASSET` | `224543e2bfaf4cf95e58089fdd5638a0` | lock-record, later POSTED | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for USDT-TRON ⟶ CoCash·Company Operations · TRON | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Operations) | ✓ | ✓ | 5/5 |
| 70 | A | `CAPITAL_INJECTION` | `91f321404748bf874fa4df672fb0b219` | one-shot posted | A.FIRM_CASH / E.FIRM_EQUITY | 50 / 200 | CoCash·Company Operations · AED_ZAND ⟶ FIRM_EQUITY for AED | A.FIRM_CASH / E.FIRM_EQUITY (Dr Company Operations) | ✓ | ✓ | 4/4 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `771fea9fb14133d7f37184ff8db51bb6` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | e2e recon-adjustment 100/AED ⟶ ClCash·CU261106831137 · vIBAN | 客户池冲正/冲销/认损·REDUCE：借应付 / 贷客户现金 | ✓ | — | 7/7 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `cdc6474c7c2a226f0eed9cb8889f379c` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU261106374007 · vIBAN ⟶ e2e recon-adjustment 100/AED | 客户池·INCREASE：借客户现金 / 贷应付 | ✓ | — | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `e871d4220600a76bfbab168fb572b76f` | one-shot posted | A.FIRM_CASH / E.INCOME_OTHER | 50 / 212 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_OTHER for AED | 补记银行利息 / 核销（托管多出）：借公司现金 / 贷其他收入 | ✓ | — | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `bd04e5030093ecc92fd19c9fec353c87` | one-shot posted | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH | 300 / 50 | EXPENSE_BANK_CUSTODY for AED ⟶ CoCash·Company Fees · AED_ZAND | 补记银行杂费：借银行与托管费用 / 贷公司现金 | ✓ | — | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `9efc4f956239d16e025c3f40892294b5` | one-shot posted | L.CLIENT_PAYABLE / L.CLIENT_PAYABLE | 100 / 100 | e2e recon-reattribution 100/AED ⟶ e2e recon-reattribution 100/AED | 改记·应付对：借应付·错记方 / 贷应付·正主 | ✓ | — | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED_CASH` | `fb0b09e4c8e459f2f232a430180f3f1a` | one-shot posted | A.CLIENT_CASH / A.CLIENT_CASH | 1 / 1 | ClCash·CU261106585962 · vIBAN ⟶ ClCash·CU261106783559 · vIBAN | 改记·现金对：借现金·正主 / 贷现金·错记方 | ✓ | — | 1/1 |
| 81 | B | `INTERNAL_TRANSFER_OPS_TO_SET` | `a956783a7acbf5848acf4bdc8a6c1292` | one-shot posted | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Settlement · AED_ZAND ⟶ CoCash·Company Operations · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Settlement, Cr Company Operations) | ✓ | ✓ | 1/1 |
| 82 | B | `INTERNAL_TRANSFER_FIRM_OUT` | `3efc8b3eff84e807381af6bb1e8dbef3` | one-shot posted | X.EXPENSE_RECON_LOSS / A.FIRM_CASH | 301 / 50 | EXPENSE_RECON_LOSS for USDT-TRON ⟶ CoCash·Company Operations · TRON | X.EXPENSE_RECON_LOSS / A.FIRM_CASH | ✓ | — | 3/3 |
| 83 | B | `INTERNAL_TRANSFER_COMPENSATION_IN` | `5fba1cd4022832e91bf61b30a1f08299` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU-E2E-ITR-A-fe8ee0dc · Deposit address ⟶ e2e fixture customer CLIENT_PAYABLE (USDT) | A.CLIENT_CASH / L.CLIENT_PAYABLE | ✓ | — | 3/3 |
| 84 | A | `LP_EXCHANGE_PAY` | `0e00b1c37f4c238b5869e97fa0deb9e9` | one-shot posted | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for AED ⟶ CoCash·Company Operations · AED_ZAND | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Operations) | ✓ | ✓ | 2/2 |
| 85 | A | `LP_EXCHANGE_RECEIVE` | `a1f295da36064084595ed450df7fb4f6` | one-shot posted | A.FIRM_CASH / E.FIRM_EQUITY | 50 / 200 | CoCash·Company Liquidity · TRON ⟶ FIRM_EQUITY for USDT-TRON | A.FIRM_CASH / E.FIRM_EQUITY (Dr Company Liquidity) | ✓ | ✓ | 2/2 |
| 86 | A | `LP_EXCHANGE_ACCEPT` | `43e1ef515e19c1823b4e49aa23f3959d` | one-shot posted | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Operations · TRON ⟶ CoCash·Company Liquidity · TRON | A.FIRM_CASH / A.FIRM_CASH (Dr Company Operations, Cr Company Liquidity) | ✓ | ✓ | 2/2 |
| 87 | A | `VENDOR_PAYMENT` | `852ad4a83e5c8e6ea71fe8ba9901feba` | one-shot posted | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH | 300 / 50 | EXPENSE_BANK_CUSTODY for AED ⟶ CoCash·Company Operations · AED_ZAND | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH (Cr Company Operations) | ✓ | ✓ | 2/2 |

Evidence rows: 287 (A 106 + B 181) = product 240 + fixture 47 + no-TigerBeetle-transfer 0.

Product comparisons: 275 (every candidate row of every code, not just the sample; a two-phase lock row also counts once under its post / void stage code); borrow-lend pair ✓ 275/275; wallet role ✓ 49/49 (appendix B names a role; 226 comparisons name none, incl. all of code 80); stage-transfer record ✓ 35/35; match 275; mismatch 0; UNEXPECTED 0.

Codes with no product row in the supplied DB(s): 18, 19, 20, 21.

Stage transfers found in TigerBeetle (post / void): 95; stored code = their pending's code: 95; stored code 0: 0; other: 0.

### 夹具行（e2e fixture，不是产品落账；不计入上表的符合 / 不符）

判定标记：`eventCode` 为 `E2E_*`，或 `sourceNo` 以 `E2E-` 开头（原始行里实际出现的就是这两种）。这些行由 e2e 用例直接调记账服务造出来（给客户 / 公司钱包预充值），不是产品流程的落账；下面照样跑同两项检查，仅供参考。其中 `E2E_FIRM_FIXTURE` 用码 70 给 `Company Fees` 钱包预充值（`test/recon-aging-write-off`、`recon-reattribution`、`recon-adjustment-money-arcs` 三支 e2e），借方因此是 Fees 而不是产品注资（`CAPITAL_INJECTION`）的 Operations——这是夹具与产品落账的差别，不是产品账错。

| 取自 | 码 | eventCode | 行数 | sourceNo | TB 借 / 贷科目码 | 借 / 贷方钱包角色 | 借贷对 | 钱包角色 | 若当产品行会怎样 |
|---|---|---|---|---|---|---|---|---|---|
| B | 1 | `DEPOSIT_ASSET_TO_SUSPENSE` | 21 | `E2E-RECON-ADJ-FUND-C1-A-d7ea17d6`<br>`E2E-RECON-ADJ-FUND-C1-B-63dd8c11`<br>…（共 21 条） | 1 / 101 | — / — | ✓ | — | 符合 |
| B | 2 | `DEPOSIT_SUSPENSE_TO_PAYABLE` | 21 | `E2E-RECON-ADJ-FUND-C1-A-d7ea17d6`<br>`E2E-RECON-ADJ-FUND-C1-B-63dd8c11`<br>…（共 21 条） | 101 / 100 | — / — | ✓ | — | 符合 |
| B | 70 | `E2E_FIRM_FIXTURE` | 4 | `E2E-RECON-ADJ-FIRMFUND-F3-f41db89b`<br>`E2E-RECON-ADJ-FIRMFUND-F7-8f94704d`<br>`E2E-REATTR-FIRMFUND-B-82bace2c`<br>`E2E-RECON-ADJ-FIRMFUND-WO-9f854742` | 50 / 200 | Company Fees / — | ✓ | ✗ | 不符（角色：附录 B 要求 Dr Company Operations） |
| B | 1 | `E2E_LEDGER_FLAGS` | 1 | `E2E-LEDGER-FLAGS-1793977090860-fund` | 1 / 101 | — / — | ✓ | — | 符合 |

夹具行共 47 条（比对 47 次）。

### 没有 TigerBeetle 转账的 evidence 行

0 行（预期 0）。

### 无附录 B 期望的转账码（UNEXPECTED）

0 行（预期 0）。TB 里存的转账码全部落在附录 B 有期望的集合内，且没有任何阶段码（6 / 7 / 9 / 12 / 15 / 20）作为存储码出现。

## 没有行的码，及原因

| 码 | 没有行的原因 |
|---|---|
| 18、19 | 码表里**没有分配**（`TB_TRANSFER_CODES` 无这两个编号），不是漏测 |
| 20（上缴作废） | 没有任何演示 / e2e 路径把「上缴」推到失败作废。代码路径是 `DispositionService.voidAttempt` → `voidPendingTransfer`（提交 code 填 0，TB 存锁定笔的码 8）——常量 `DEPOSIT_SEIZE_VOID = 20` 不被任何落账调用引用，**TB 里永远不会出现存储码 20**（同 6 / 7 / 9 / 12 / 15，见「怎么取的」R34 一条）；上缴作废的落账形状与锁定笔 8 相同（`L.DEPOSIT_SUSPENSE` / `A.CLIENT_CASH`，对方栏是当局）——**本轮没有该路径的实证行**，只有锁定笔 8 与其落账阶段 9 的实证 |
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

脚本有红的出口：产品行不符、出现 UNEXPECTED 码、或有 evidence 行没有 TigerBeetle 转账时 `process.exitCode = 1`，否则 0。

**失效验证**（纪律 2：说得出它什么时候会红；终审修订后在新脚本上重做，每条改动都在落盘原始行的临时副本上做、副本不入库）：

| 改动（一次一处） | 结果 |
|---|---|
| 无改动 | exit 0，`match 275; mismatch 0; UNEXPECTED 0` |
| 码 87 的借方科目码改成 50（旧形状） | exit 1，`pair ✓ 274/275; mismatch 1`，`MISMATCH 87 … PAIR` |
| 码 16 的**第 3 行**（非样本行）借方户名改成 `Company Operations` | exit 1，`wallet role ✓ 48/49; mismatch 1`，`MISMATCH 16 … ROLE`（证明角色检查逐行，不再只看样本） |
| 码 80 的 100→1 格里**第 3 行**贷方科目码改成 50 | exit 1，`pair ✓ 274/275; mismatch 1`，`MISMATCH 80 … PAIR`（证明 80 逐行，不再只看每格第一行） |
| 把 4 条 `E2E_FIRM_FIXTURE` 注资夹具行的标记去掉（当产品行） | exit 1，`wallet role ✓ 49/53; mismatch 4`，4 条 `MISMATCH 70 … ROLE`；夹具行数 47 → 43（证明夹具分流是靠标记、且角色检查真的会抓到这 4 行） |
| 一行 evidence 的 `tb` 置空（无 TigerBeetle 转账） | exit 1，`no-TB rows 1`，`NO-TB …` |
| 某行存储码改成 18（未分配）、另一行改成 9（阶段码） | exit 1，`UNEXPECTED 2`：18 报「无附录 B 期望」、9 报「post/void 阶段码，R34：从不存储」，脚本不抛异常 |
| 某笔 post 阶段转账的存储码改成 0 | exit 1，`stage-transfer record ✓ 34/35; mismatch 1`，`MISMATCH 6 … STAGE` |

**`a4-evidence.js` 的截断防护**：`getAccountTransfers` 取一页 `limit: 1000`，原先页满时会把「页外的 void」当成「没有 void」静默报 not-found；现在页满（`list.length >= 1000`）就抛错、要求调大或分页。**这一改动没有重跑**（需要活的栈 + TigerBeetle，终审修复轮离线）：已通过 `node --check`，但没有真实执行过。落盘的 A / B 原始行是在改动前取的，当时没有这道防护、原始行也没记每户的转账数，所以「当时没有截断」只有间接依据（两库 evidence 总共 106 / 181 行，单个账户几乎不可能接近 1000 笔），**不是直接证据**。

**搜索边界**：只覆盖这两份库里实际存在的 evidence 行；夹具行（`E2E_*` 事件码 / `E2E-` 单号）不在产品比对内、单列；动态拼 code 的写法、本轮没触发的分支（20、21、垫款腿、调账单 3 种借贷对（200→50、50→200、301→50））没有 live 行，已在上节逐项交代。
