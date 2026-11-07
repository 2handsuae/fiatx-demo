# 转账码抽核表（戊波二 · 附录 B 波一 / 波二列对照）

> 谁、何时：T12 收尾，2026-11-07，代码头 `8b40965d`。对应 spec §8.10 / 任务 12 Step 4。**本文件正文（从下面的表起）由 `a4-table.js` 离线重生成，前言手写**——重生成会覆盖前言。
> 结论：**产品行 327 次比对（借贷科目码对 327/327、点名钱包角色处 59/59、阶段转账记录 38/38），0 处不符、0 个无期望的码**；e2e 夹具行 76 条单列、不计入。

## 怎么取的（证据在它断言的位置取）

- `tb_transfer_evidence` 里没有存 u16 转账码，所以拿每行的 `tbTransferId`（TB u128 hex）去 **TigerBeetle `lookup_transfers`** 读真实落账记录的 `code` 与借 / 贷账户 id，再 `lookup_accounts` 读两个账户自己的 `code`（`a4-evidence.js`，只改了一处：助记表加 `2 → A.CLIENT_SHORTFALL`、`51 → A.LP_RECEIVABLE`）；两段式转账的 post / void 阶段另取（R34：提交时 code 填 0，TB 存 pending 的 code，本次取到 98 笔，全部 = 其 pending 的 code）。
- 两次取样（原始行落盘，`a4-table.js` 可逐字复现）：**A** = `reset self` → `up` → `demo:all` → `recon:demo:pass` / `break` → `verify:coa` ×2 → LP 真批准走查之后：`evidence-raw-phaseA.json`，107 行（含种子 LP 兑换单四腿 84 → 88 → 85 → 86）；**B** = 另一轮干净重铺 + 7 私库 + `demo:setup` 后整套串行 e2e 之后：`evidence-raw-phaseB.json`，258 行（`house-transfer` 的 89 / 90、`recon-internal-transfer` 与 `incident-register` 的 91 / 83、`lp-receivable` 的 88 / 85 等都在这里）。
- 期望来源：总纲附录 B（波一列 + 波二列）与 spec §3.2。`a4-table.js` 相对波一只做了：助记表加 2 / 51；期望表加 88–91、改 85 贷方为 51、87 与 81 的出钱钱包放宽为「运营或手续费」（付款单 / 认损补缺单 from 可选）；**83、90 按 `eventCode` 分形态判并各取一个样本**（83：`INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN` 借 1 / 贷 2、`INTERNAL_TRANSFER_ADVANCE_IN` 借 1 / 贷 100；90：`FEE_INCOME_CLOSE_SWAP / _WITHDRAW / _OTHER` 借 210 / 211 / 212、贷 200）。每个码**所有**候选行都比，不只样本。
- 本波新码与改写的核对结果：**88**（借 51 / 贷 200）｜**89**（借 50 / 贷 50，运营 ⇄ 手续费）｜**90** 三个 eventCode 各一行｜**91**（借 2 / 贷 1，4 条产品行 + 1 条 e2e 夹具行 `E2E_SHORTFALL_RECOGNIZED`）｜**83** 的 `SHORTFALL_TOPUP` 形态借 1 / 贷 2（3 条）、`CLIENT_ADVANCE` 形态**无 live 行**｜**85** 新贷方 51。
- 失效验证：把脚本副本里 85 的期望贷方改成 200、91 的借贷对调换，重跑 → 退出码 1，7 行 `MISMATCH`（scratch 副本，未入库）；首次生成时 `81` 因贷方角色仍按波一写「运营户」报过 1 处不符，该行是认损补缺单（`fromVault = F_FEE`）的合法新形态，已改期望（见 README §5.4）。
- 没有 live 行的码（两次取样都没有产品行）：18、19、20、21——与本波无关。

## 抽核表（以下为生成内容）

| 码 | 取自 | eventCode | 凭证号（evidence.tbTransferId，TB u128 hex） | 记录形态 | evidence 借 / 贷助记码 | TB 实记借 / 贷科目码 | 借方户名 ⟶ 贷方户名 | 附录 B 期望（波一 / 波二列） | 借贷对 | 钱包角色 | 该码全部产品行 ✓/行数 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | `DEPOSIT_ASSET_TO_SUSPENSE` | `fe624ec9cabacb68d950e58bca679905` | one-shot posted | A.CLIENT_CASH / L.DEPOSIT_SUSPENSE | 1 / 101 | ClCash·CU2601012635 · vIBAN ⟶ DEPOSIT_SUSPENSE for CU2601012635/AED | A.CLIENT_CASH / L.DEPOSIT_SUSPENSE | ✓ | — | 42/42 |
| 2 | A | `DEPOSIT_SUSPENSE_TO_PAYABLE` | `e530453656557ccc81b452841e7c2541` | one-shot posted | L.DEPOSIT_SUSPENSE / L.CLIENT_PAYABLE | 101 / 100 | DEPOSIT_SUSPENSE for CU2601012635/AED ⟶ CLIENT_PAYABLE for CU2601012635/AED | L.DEPOSIT_SUSPENSE / L.CLIENT_PAYABLE | ✓ | — | 25/25 |
| 3 | A | `CONFISCATE_REVERSE_SUSPENSE` | `76f8c69ee04c696dddda170bc17aa9ab` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601014381/AED ⟶ ClCash·CU2601014381 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 1/1 |
| 4 | A | `CONFISCATE_INCOME_OTHER` | `ba3f39d35b57db9b2edd3bb892238cca` | lock-record, later POSTED | A.FIRM_CASH / E.INCOME_OTHER | 50 / 212 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_OTHER for AED | A.FIRM_CASH / E.INCOME_OTHER (Dr Company Fees) | ✓ | ✓ | 1/1 |
| 5 | A | `DEPOSIT_RETURN_POST` | `5b5fddcae5706a0258293740b02632d4` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 5/5 |
| 6 | A | `DEPOSIT_RETURN_POST` | `5b5fddcae5706a0258293740b02632d4` | post stage of code 5 (post transfer 01a1b48f…, flags post_pending, pending_id→evidence id ✓=true); stored code 5 = pending's | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 3/3 |
| 7 | B | `DEPOSIT_RETURN_PENDING` | `fec06641edcfd0c2940c4c7ebf7642e1` | void stage of code 5 (void transfer 01a1b496…, flags void_pending, pending_id→evidence id ✓=true); stored code 5 = pending's | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601017625/AED ⟶ ClCash·CU2601017625 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 1/1 |
| 8 | A | `SEIZE_REVERSE_SUSPENSE` | `6bf0a85f3a4870429bc5abee0e5b43f0` | lock-record, later POSTED | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 2/2 |
| 9 | A | `SEIZE_REVERSE_SUSPENSE` | `6bf0a85f3a4870429bc5abee0e5b43f0` | post stage of code 8 (post transfer 01a1b48f…, flags post_pending, pending_id→evidence id ✓=true); stored code 8 = pending's | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | 101 / 1 | DEPOSIT_SUSPENSE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.DEPOSIT_SUSPENSE / A.CLIENT_CASH | ✓ | — | 2/2 |
| 10 | A | `WITHDRAW_NET_POST` | `6e1acb9110b4efe9c5a1667073bf1494` | lock-record, later POSTED | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 38/38 |
| 11 | A | `WITHDRAW_NET_POST` | `f5545ee9b49634e74be1e43a5111ad81` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 15/15 |
| 12 | B | `WITHDRAW_LOCK_NET` | `27ad51251ee37ff2b344f3d9fa6f0bbb` | void stage of code 10, found in TigerBeetle (void transfer 01a1b495…, flags void_pending); evidence row still says PENDING — releaseLock uses the best-effort void, which skips the evidence update; stored code 10 = pending's | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 3/3 |
| 13 | A | `WITHDRAW_FEE_POST` | `c628bdba702ce0d885667afb1d63e1c1` | lock-record, later POSTED | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601019430/AED ⟶ ClCash·CU2601019430 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 38/38 |
| 14 | A | `WITHDRAW_FEE_POST` | `fbe3da80d308789ee8a172253e968430` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 14/14 |
| 15 | B | `WITHDRAW_LOCK_FEE` | `4919e31203edb6b405149c4500ae08d5` | void stage of code 13, found in TigerBeetle (void transfer 01a1b495…, flags void_pending); evidence row still says PENDING — releaseLock uses the best-effort void, which skips the evidence update; stored code 13 = pending's | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601010484/AED ⟶ ClCash·CU2601010484 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 4/4 |
| 16 | A | `WITHDRAW_FEE_FIRM` | `13fb03eb5d3c9675e1fcafd884ec9b2e` | one-shot posted | A.FIRM_CASH / E.INCOME_WITHDRAW_FEE | 50 / 211 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_WITHDRAW_FEE for AED | A.FIRM_CASH / E.INCOME_WITHDRAW_FEE (Dr Company Fees) | ✓ | ✓ | 11/11 |
| 17 | B | `WITHDRAW_BOUNCE_REENTRY` | `a756fc34f37fea2b04921cbf8aef9f22` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU2601010484 · vIBAN ⟶ CLIENT_PAYABLE for CU2601010484/AED | A.CLIENT_CASH / L.CLIENT_PAYABLE | ✓ | — | 2/2 |
| 30 | A | `SWAP_SELL_CLIENT` | `6a8360e44875ad01dba7179e9e90e5e1` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/AED ⟶ ClCash·CU2601012635 · vIBAN | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 13/13 |
| 31 | A | `SWAP_SELL_FIRM` | `9207e30b0813fb28542888d2dc4346c7` | pending (open) | A.FIRM_CASH / E.FIRM_EQUITY | 50 / 200 | CoCash·Company Settlement · AED_ZAND ⟶ FIRM_EQUITY for AED | A.FIRM_CASH / E.FIRM_EQUITY | ✓ | — | 11/11 |
| 32 | A | `SWAP_BUY_OPS_TO_SET` | `349c932eefa2c2ad33e78795091a3a27` | lock-record, later POSTED | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Settlement · AED_ZAND ⟶ CoCash·Company Operations · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Settlement, Cr Company Operations) | ✓ | ✓ | 3/3 |
| 33 | A | `SWAP_BUY_SET_TO_ASSET` | `7a52ff72734fd69f916a70bf92a03fec` | lock-record, later POSTED | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for AED ⟶ CoCash·Company Settlement · AED_ZAND | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Settlement) | ✓ | ✓ | 3/3 |
| 34 | A | `SWAP_BUY_CLIENT` | `50eeedf212343d38baba51adf0abf6e0` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU2601012635 · Deposit address ⟶ CLIENT_PAYABLE for CU2601012635/USDT-TRON | A.CLIENT_CASH / L.CLIENT_PAYABLE | ✓ | — | 10/10 |
| 35 | A | `SWAP_FEE_CLIENT` | `a23dad64a639c94d01186bcac4dc2f80` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | CLIENT_PAYABLE for CU2601012635/USDT-TRON ⟶ ClCash·CU2601012635 · Deposit address | L.CLIENT_PAYABLE / A.CLIENT_CASH | ✓ | — | 10/10 |
| 36 | A | `SWAP_FEE_FIRM` | `b48f177e80c30b2c705480faecee8868` | lock-record, later POSTED | A.FIRM_CASH / E.INCOME_SWAP_FEE | 50 / 210 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_SWAP_FEE for AED | A.FIRM_CASH / E.INCOME_SWAP_FEE (Dr Company Fees) | ✓ | ✓ | 8/8 |
| 37 | A | `SWAP_SELL_SET_TO_OPS` | `380eaa1c632909eb95379c181c81bdfd` | lock-record, later POSTED | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Operations · AED_ZAND ⟶ CoCash·Company Settlement · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Operations, Cr Company Settlement) | ✓ | ✓ | 5/5 |
| 38 | A | `SWAP_BUY_OPS_TO_ASSET` | `11384e925a0ac2a37a9c90c3b061e6a3` | lock-record, later POSTED | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for USDT-TRON ⟶ CoCash·Company Operations · TRON | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Operations) | ✓ | ✓ | 5/5 |
| 70 | A | `CAPITAL_INJECTION` | `91f321404748bf874fa4df672fb0b219` | one-shot posted | A.FIRM_CASH / E.FIRM_EQUITY | 50 / 200 | CoCash·Company Operations · AED_ZAND ⟶ FIRM_EQUITY for AED | A.FIRM_CASH / E.FIRM_EQUITY (Dr Company Operations) | ✓ | ✓ | 4/4 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `154b77e3b62c600fa16705e5d62a4407` | one-shot posted | L.CLIENT_PAYABLE / A.CLIENT_CASH | 100 / 1 | e2e recon-adjustment 100/AED ⟶ ClCash·CU261107131717 · vIBAN | 客户池冲正/冲销/认损·REDUCE：借应付 / 贷客户现金 | ✓ | — | 2/2 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `486564b899080d189385e74220acdf18` | one-shot posted | A.CLIENT_CASH / L.CLIENT_PAYABLE | 1 / 100 | ClCash·CU261107458206 · vIBAN ⟶ e2e recon-adjustment 100/AED | 客户池·INCREASE：借客户现金 / 贷应付 | ✓ | — | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `1109053dadac18a52eb767cae055702b` | one-shot posted | A.FIRM_CASH / E.INCOME_OTHER | 50 / 212 | CoCash·Company Fees · AED_ZAND ⟶ INCOME_OTHER for AED | 补记银行利息 / 核销（托管多出）：借公司现金 / 贷其他收入 | ✓ | — | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `a19ec32cff2e6827c152e3947faaf1aa` | one-shot posted | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH | 300 / 50 | EXPENSE_BANK_CUSTODY for AED ⟶ CoCash·Company Fees · AED_ZAND | 补记银行杂费：借银行与托管费用 / 贷公司现金 | ✓ | — | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED` | `3b0c20a4c3204352919d9d7e12128be0` | one-shot posted | L.CLIENT_PAYABLE / L.CLIENT_PAYABLE | 100 / 100 | e2e recon-reattribution 100/AED ⟶ e2e recon-reattribution 100/AED | 改记·应付对：借应付·错记方 / 贷应付·正主 | ✓ | — | 1/1 |
| 80 | B | `RECON_ADJUSTMENT_POSTED_CASH` | `beca3fa6eb783e9f64538c0d3322a729` | one-shot posted | A.CLIENT_CASH / A.CLIENT_CASH | 1 / 1 | ClCash·CU261107741725 · vIBAN ⟶ ClCash·CU261107706154 · vIBAN | 改记·现金对：借现金·正主 / 贷现金·错记方 | ✓ | — | 1/1 |
| 81 | B | `INTERNAL_TRANSFER_OPS_TO_SET` | `21a55df16948e1dcc046a60de09aae0c` | one-shot posted | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Settlement · AED_ZAND ⟶ CoCash·Company Fees · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company Settlement, Cr Company (Operations|Fees)) | ✓ | ✓ | 1/1 |
| 82 | B | `INTERNAL_TRANSFER_FIRM_OUT` | `f797972ed415aa17d7c517a061fdddd4` | one-shot posted | X.EXPENSE_RECON_LOSS / A.FIRM_CASH | 301 / 50 | EXPENSE_RECON_LOSS for USDT-TRON ⟶ CoCash·Company Operations · TRON | X.EXPENSE_RECON_LOSS / A.FIRM_CASH | ✓ | — | 3/3 |
| 83 | B | `INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN` | `11c6b9be195b4d82d0d8b8be635bacdf` | one-shot posted | A.CLIENT_CASH / A.CLIENT_SHORTFALL | 1 / 2 | ClCash·CU-E2E-ITR-A-f27c645f · Deposit address ⟶ Custody Shortfall · CU-E2E-ITR-A-f27c645f · Deposit address | A.CLIENT_CASH / A.CLIENT_SHORTFALL (INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN) | ✓ | — | 3/3 |
| 84 | A | `LP_EXCHANGE_PAY` | `0e00b1c37f4c238b5869e97fa0deb9e9` | one-shot posted | E.FIRM_EQUITY / A.FIRM_CASH | 200 / 50 | FIRM_EQUITY for AED ⟶ CoCash·Company Operations · AED_ZAND | E.FIRM_EQUITY / A.FIRM_CASH (Cr Company Operations) | ✓ | ✓ | 3/3 |
| 85 | A | `LP_EXCHANGE_RECEIVE` | `a1f295da36064084595ed450df7fb4f6` | one-shot posted | A.FIRM_CASH / A.LP_RECEIVABLE | 50 / 51 | CoCash·Company Liquidity · TRON ⟶ Due from LP · Falcon Liquidity FZE | A.FIRM_CASH / A.LP_RECEIVABLE (Dr Company Liquidity) | ✓ | ✓ | 3/3 |
| 86 | A | `LP_EXCHANGE_ACCEPT` | `43e1ef515e19c1823b4e49aa23f3959d` | one-shot posted | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Operations · TRON ⟶ CoCash·Company Liquidity · TRON | A.FIRM_CASH / A.FIRM_CASH (Dr Company Operations, Cr Company Liquidity) | ✓ | ✓ | 3/3 |
| 87 | A | `VENDOR_PAYMENT` | `852ad4a83e5c8e6ea71fe8ba9901feba` | one-shot posted | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH | 300 / 50 | EXPENSE_BANK_CUSTODY for AED ⟶ CoCash·Company Operations · AED_ZAND | X.EXPENSE_BANK_CUSTODY / A.FIRM_CASH (Cr Company (Operations|Fees)) | ✓ | ✓ | 3/3 |
| 88 | A | `LP_EXCHANGE_RECEIVABLE` | `050f812b5efceb4d9d14a7b9aa722da3` | one-shot posted | A.LP_RECEIVABLE / E.FIRM_EQUITY | 51 / 200 | Due from LP · Falcon Liquidity FZE ⟶ FIRM_EQUITY for USDT-TRON | A.LP_RECEIVABLE / E.FIRM_EQUITY | ✓ | — | 3/3 |
| 89 | B | `HOUSE_TRANSFER` | `cc4f5a2c6c38e8f175fa752620df82b3` | one-shot posted | A.FIRM_CASH / A.FIRM_CASH | 50 / 50 | CoCash·Company Operations · AED_ZAND ⟶ CoCash·Company Fees · AED_ZAND | A.FIRM_CASH / A.FIRM_CASH (Dr Company (Operations|Fees), Cr Company (Operations|Fees)) | ✓ | ✓ | 6/6 |
| 90 | B | `FEE_INCOME_CLOSE_SWAP` | `769b63e2d84ea246ade8c556d785f290` | one-shot posted | E.INCOME_SWAP_FEE / E.FIRM_EQUITY | 210 / 200 | INCOME_SWAP_FEE for AED ⟶ FIRM_EQUITY for AED | E.INCOME_SWAP_FEE / E.FIRM_EQUITY (FEE_INCOME_CLOSE_SWAP) | ✓ | — | 4/4 |
| 90 | B | `FEE_INCOME_CLOSE_WITHDRAW` | `6cec19f305c9503343f2b47480b2d372` | one-shot posted | E.INCOME_WITHDRAW_FEE / E.FIRM_EQUITY | 211 / 200 | INCOME_WITHDRAW_FEE for AED ⟶ FIRM_EQUITY for AED | E.INCOME_WITHDRAW_FEE / E.FIRM_EQUITY (FEE_INCOME_CLOSE_WITHDRAW) | ✓ | — | 3/3 |
| 90 | B | `FEE_INCOME_CLOSE_OTHER` | `846be8c409b2d26462da641ce671f5e4` | one-shot posted | E.INCOME_OTHER / E.FIRM_EQUITY | 212 / 200 | INCOME_OTHER for AED ⟶ FIRM_EQUITY for AED | E.INCOME_OTHER / E.FIRM_EQUITY (FEE_INCOME_CLOSE_OTHER) | ✓ | — | 2/2 |
| 91 | B | `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED` | `e28747265bbb5df9d9ec44a867fc800a` | one-shot posted | A.CLIENT_SHORTFALL / A.CLIENT_CASH | 2 / 1 | Custody Shortfall · CU-E2E-ITR-A-f27c645f · Deposit address ⟶ ClCash·CU-E2E-ITR-A-f27c645f · Deposit address | A.CLIENT_SHORTFALL / A.CLIENT_CASH | ✓ | — | 4/4 |

Evidence rows: 365 (A 107 + B 258) = product 289 + fixture 76 + no-TigerBeetle-transfer 0.

Product comparisons: 327 (every candidate row of every code, not just the sample; a two-phase lock row also counts once under its post / void stage code); borrow-lend pair ✓ 327/327; wallet role ✓ 59/59 (appendix B names a role; 268 comparisons name none, incl. all of code 80); stage-transfer record ✓ 38/38; match 327; mismatch 0; UNEXPECTED 0.

Codes with no product row in the supplied DB(s): 18, 19, 20, 21.

Stage transfers found in TigerBeetle (post / void): 98; stored code = their pending's code: 98; stored code 0: 0; other: 0.

### 夹具行（e2e fixture，不是产品落账；不计入上表的符合 / 不符）

判定标记：`eventCode` 为 `E2E_*`，或 `sourceNo` 以 `E2E-` 开头（原始行里实际出现的就是这两种）。这些行由 e2e 用例直接调记账服务造出来（给客户 / 公司钱包预充值），不是产品流程的落账；下面照样跑同两项检查，仅供参考。其中 `E2E_FIRM_FIXTURE` 用码 70 给 `Company Fees` 钱包预充值（`test/recon-aging-write-off`、`recon-reattribution`、`recon-adjustment-money-arcs` 三支 e2e），借方因此是 Fees 而不是产品注资（`CAPITAL_INJECTION`）的 Operations——这是夹具与产品落账的差别，不是产品账错。

| 取自 | 码 | eventCode | 行数 | sourceNo | TB 借 / 贷科目码 | 借 / 贷方钱包角色 | 借贷对 | 钱包角色 | 若当产品行会怎样 |
|---|---|---|---|---|---|---|---|---|---|
| B | 1 | `DEPOSIT_ASSET_TO_SUSPENSE` | 28 | `E2E-ITR-FUND-A-2ed68285`<br>`E2E-ITR-FUND-C2-5f68d932`<br>…（共 28 条） | 1 / 101 | — / — | ✓ | — | 符合 |
| B | 2 | `DEPOSIT_SUSPENSE_TO_PAYABLE` | 28 | `E2E-ITR-FUND-A-2ed68285`<br>`E2E-ITR-FUND-C2-5f68d932`<br>…（共 28 条） | 101 / 100 | — / — | ✓ | — | 符合 |
| B | 70 | `E2E_FIRM_FIXTURE` | 5 | `E2E-ITR-FIRMFUND-P2-903a4c82`<br>`E2E-RECON-ADJ-FIRMFUND-F3-6f445d72`<br>…（共 5 条） | 50 / 200 | Company Fees / — | ✓ | ✗ | 不符（角色：附录 B 要求 Dr Company Operations） |
| B | 70 | `E2E_FIRM_FIXTURE` | 1 | `E2E-RECON-ADJ-FIRMFUND-EX3-d9f30e4c` | 50 / 200 | Company Operations / — | ✓ | ✓ | 符合 |
| B | 36 | `SWAP_FEE_FIRM` | 5 | `E2E-HTR-07CB5C1C-1`<br>`E2E-HTR-07CB5C1C-4`<br>…（共 5 条） | 50 / 210 | Company Fees / — | ✓ | ✓ | 符合 |
| B | 16 | `WITHDRAW_FEE_FIRM` | 3 | `E2E-HTR-07CB5C1C-2`<br>`E2E-HTR-07CB5C1C-5`<br>`E2E-HTR-07CB5C1C-8` | 50 / 211 | Company Fees / — | ✓ | ✓ | 符合 |
| B | 4 | `CONFISCATE_INCOME_OTHER` | 2 | `E2E-HTR-07CB5C1C-3`<br>`E2E-HTR-07CB5C1C-6` | 50 / 212 | Company Fees / — | ✓ | ✓ | 符合 |
| B | 2 | `E2E_INTERNAL_DELTA` | 1 | `E2E-INTDELTA-E2E_INTERNAL_DELTA-d6e0a62b` | 1 / 100 | — / — | ✗ | — | 不符（借贷对 ） |
| B | 2 | `E2E_INTERNAL_DELTA_REVERSE` | 1 | `E2E-INTDELTA-E2E_INTERNAL_DELTA_REVERSE-36ef5b60` | 100 / 1 | — / — | ✗ | — | 不符（借贷对 ） |
| B | 91 | `E2E_SHORTFALL_RECOGNIZED` | 1 | `E2E-INTDELTA-SHORTFALL-ba350db9` | 2 / 1 | — / — | ✓ | — | 符合 |
| B | 1 | `E2E_LEDGER_FLAGS` | 1 | `E2E-LEDGER-FLAGS-1794031179272-fund` | 1 / 101 | — / — | ✓ | — | 符合 |

夹具行共 76 条（比对 76 次）。

### 没有 TigerBeetle 转账的 evidence 行

0 行（预期 0）。

### 无附录 B 期望的转账码（UNEXPECTED）

0 行（预期 0）。TB 里存的转账码全部落在附录 B 有期望的集合内，且没有任何阶段码（6 / 7 / 9 / 12 / 15 / 20）作为存储码出现。
