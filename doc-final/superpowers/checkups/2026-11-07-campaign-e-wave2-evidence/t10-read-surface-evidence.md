# 戊波二 T10 证据 · 读面汇总（案件页副行与 INVARIANT 行、跑批页对内列、看板应收 LP 格）

基底 `9bc59a12`。栈 = `self`（API 3110 / 管理台 3111 / TB 3113）；每条命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`，jest 前 `set -a; . ./.env; set +a`。

## 1. 闸门（命令 · 退出码 · 关键行）

| 闸 | 命令 | 退出 | 关键行 |
|---|---|---|---|
| ① | `npx tsc --noEmit -p tsconfig.json` | 0 | 0 字节 |
| ② | `cd admin-web && npx tsc -b --noEmit` | 0 | 0 字节 |
| ③ | `cd client-web && npx tsc -b --noEmit` | 0 | 0 字节 |
| ④ | `npx jest src/modules/clearing-settle/reconciliation src/modules/audit-logging admin-web/src` | 0 | `Test Suites: 48 passed, 48 total` ｜ `Tests: 845 passed, 845 total` |
| lint | `cd admin-web && npx eslint <本任务改的 12 个文件>` | 0 | 0 error；1 条 warning 在 `CompanyFundsDashboard.tsx:376`（既有的 `useEffect` 上多余 disable，非本任务行） |
| e2e（对账引擎 7 文件） | `reset self` → `up` → `demo:setup` → `bash scripts/on-stack.sh self test:e2e --runInBand --verbose --cacheDirectory=<新空目录> test/recon-internal-delta test/recon-reattribution test/recon-internal-transfer test/incident-register test/recon-adjustment-money-arcs test/recon-aging-write-off test/recon-supplement`（UTC 04:03，窗口外） | 1 | `Test Suites: 5 failed, 2 passed, 7 total` ｜ `Tests: 7 failed, 34 passed, 41 total`；7 个失败名**逐名在** `e2e-baseline-0c6eb7b0.md` §2.1：money-arcs 9 / supplement ② ③ 拒绝路径 / internal-transfer B / incident-register 9 / aging 主链路。`recon-internal-delta` 2/2、`recon-reattribution` 2/2 绿 |
| ⑥ | `reset self` → `up` → `on-stack.sh self demo:all` | 0 / 0 / 0 | `花名册：35/35`、`asserts: 5/5 PASS` |
| ⑥ | `on-stack.sh self recon:demo:pass` | 0 | `status=PASS walletsChecked=21 casesOpened=0` |
| ⑥ | `on-stack.sh self recon:demo:break` | 0 | `scenarios: 18/18 DETECTED`、`wallets 12/12`、`casesOpened 12/12`、`identities OK` |
| ⑦ | `on-stack.sh self verify:coa`（break 后一次；走完场景 16 全弧 + 重对账后又一次） | 0 / 0 | `105 个科目全部 ≥ 0`、`ALL INVARIANTS PASS` |
| 收尾态 | `reset self` → `up` → `demo:all` | 0 / 0 / 0 | 见 §6 |

**e2e 的中间一次红（已修）**：第一轮 e2e 多出一个**基线外**失败名 `recon-internal-transfer › A · 账龄路全弧`（断言 `doneRow.transfer` 在案子 RESOLVED 后读不到回链）。原因 = 本任务把「已结案案子按结案轮截止点重建」（见 §3）之后，原差异行在结案后的页面上是 MATCHED，而 MATCHED 行原先不挂划转单回链。修法 = 第 0 轮配成 MATCHED 且由本案认损补缺单（ITR…）解释的行把那张单的回链挂回来（`annotateRow`），前端用它继续打「Shortfall recognised · topping up / Explained / top-up failed」。重铺后同 7 文件再跑，A 绿，失败名收回基线 7 名。

### 失效验证（变异；每次用 scratchpad 备份还原并 `diff -q` 确认字节一致）

| # | 变异 | 结果 |
|---|---|---|
| M1 | `listCases` 的差异行统计去掉 `'INVARIANT'` | `2 failed`（含新的「groupBy mock 忠实按 where 过滤」行为用例） |
| M2 | `appendInvariantRow` 去掉 `status !== 'OPEN'` 门 | `1 failed`（「已结案不并入」） |
| M3 | builder 的 `explainedAmount` 不再只数锚点清单里的流水 | `1 failed`（期望 25，收到 125） |
| M4 | 检查器 `internalBreakdown` 把短缺户净额恒置 0 | `1 failed` |
| M5 | 开案审计去掉 `internalDeltaAmount` | `3 failed`（case.service ×2、run.service ×1） |
| M6 | `visibleFlowRows` 不再放行被解释的 MATCHED 行 | `1 failed` |
| M7 | `explainedSumMinor` 去掉「只数带 explainedBy 的行」过滤 | **首次存活**（`7 passed`）——夹具里只有被解释行才带 `explainedAmount`，抓不到；补一例「没有 explainedBy 却带 explainedAmount 的行不算」后再变异 → `1 failed` |
| M8 | Hero 结论句去掉「对外 0 + 对内 ≠ 0」分支 | `2 failed` |
| M9 | 跑批列 `internalCheckCell` 的 0 → ✓ 判断 | `1 failed` |
| M10 | `dueFromLpRows` 不再滤掉余额 0 的户 | `1 failed` |
| M11 | `explainedByKind` 恒返回 ADJUSTMENT | `1 failed` |
| M12 | `annotateRow` 不再给被 ITR 解释的 MATCHED 行挂回链 | `1 failed` |

## 2. 做了什么（逐条对应 brief）

- **案件页 Internal 格副行**：`CaseBalanceTiles.tsx` 五格下面一整行（单格宽度放不下），`Cash x + Shortfall y ｜ Payable p + Held q ｜ Δ d`，Δ ≠ 0 红。四个数与 Δ 后端现算：`WalletBalanceCheckerService.internalBreakdown(walletRef, cutoff)`（与 `checkBalance` 共用同一个私有 `customerBreakdown`，算式只有一份），`reconciliation-query.service.ts` `getCase` 把它放进 `explain.internalBreakdown`。纯排版函数 `utils/caseInternalCheck.ts`（+spec）。
- **R32 INVARIANT 行**：`getCase` 在逐行注解之后把本案持久化的 `INVARIANT` 差异行并入 `flowComparison`（`matchType:'INVARIANT'`、`invariant:{amount,direction}`、两侧 null），只在案子 `OPEN` 时并入。`CaseFlowTable.tsx`：Type 芯片「Internal books」、Status 标签 `Books out of balance · needs correction`、无 Resolve 菜单、不可锚 / 不可解释。**偏离 brief 一处**：brief 说「（builder）」，我按 IN_TRANSIT 先例放在 query service 里（`appendInvariantRow`，与 `appendInTransitRows` 并列）——builder 只管从源数据实时重算的行，INVARIANT 与在途行一样取自持久化差异行。
- **跑批详情页 Internal check 列**：`ReconciliationRunsDetailPage.tsx`，✓（Δ=0）/ 红 `Δ +250.00`（Δ≠0）/ `—`（公司钱包）。数据是 T9a 就下发的 `accountStatusTable[].internalDelta`。
- **看板「Due from LP — Pending Delivery」**：`CompanyFundsDashboard.tsx` 第五路并发读 `GET /admin/tb/accounts?ownerType=LP&code=51&take=100`，每行 `LP 名 · 币种` + 余额，**只列余额 ≠ 0 的户**（交货冲平后整格回到 `No LP delivery outstanding.`；过滤是纯函数 `dueFromLpRows`，在 `companyFundsFormat.ts` + spec）。
- **R34**：`listCases` 差异行统计 `matchStatus in [...,'INVARIANT']`——仅对内不平的案子列表上是 `0/1` 而不是 `—`。
- **R35**：开案审计 `RECON_CASE_OPENED` 的 metadata 加 `internalDeltaAmount`（公司钱包 null）与 `caseReason`（`OpenCaseInput` / `auditCaseOpened` 签名同步加必填入参，调用方只有 run service 一处）。**审计冻结规格核查**：`audit-actions.constant.ts` 里 `RECON_CASE_OPENED` 冻结的是信封四属性（`requiredFields: []`），metadata 的键由 `auditCaseOpened` 的 TS 签名强制；`audit-logging.md` 与该文件里没有任何 spec 断言「必填 metadata 键清单」。故不需要改冻结规格，只改了常量上方一句注释（「破口三件套」→ 现状）。`doc-final/rules/audit-logging.md` 未改。
- **T9 交接**：被解释的 MATCHED 行（`explainedByAdjustmentNo` 非空）默认展示（不进折叠区）、「Show N matched rows」只数普通 MATCHED 行、Hero 的 explained 合计改读后端新下发的 `explainedAmount`（= 组内那张单自己落账的流水金额：认损补缺时外部 750 / 内部原流水 1000，被解释的是记短缺那一条的 250——行两侧金额推不出，所以必须后端给）；`explainedByAdjustmentNo` 是 ITR 号时链到划转单页（`/admin/custody/internal-transfers/ITR…`，已用 puppeteer 读 DOM 的 `href` 核实）。规则在 `utils/caseFlowRows.ts`（+spec）。
- **R11**：`ledger-account.constants.ts` 的 `TB_CODE_LABELS` / `ACTIVE_CODES` / `CLASS_PREFIX` 加码 2（`CLIENT_SHORTFALL`）与 51（`LP_RECEIVABLE`），台账页 Code 筛选与凭证页 COA 筛选自动带上。凭证页**没有**转账码标签表（只原样打 `eventCode`），故 88–91 无标签可加。

### 本任务自作主张的几处（都小、可撤；原因在各条里）

1. **Hero 结论句**：对外差额 = 0 而对内差额 ≠ 0 的案子，原句「External balance is 0.00 … in excess of our books … full amount unexplained」是句空话（首张 INVARIANT 截图上就是它）。`caseConclusion.ts` 加一支：`External balance matches our cash, but this wallet's own books do not agree — cash + shortfall is 250.00 AED more than payable + held. Needs a correcting entry.`（+spec 4 例）。已结案时 explained 句不再带「awaiting re-reconcile」。
2. **已结案案子按结案轮的截止点重建整页**（`closedByRun ?? lastObservedRun`，差异行与副行同一个点）：否则 R25 要的「Re-reconcile 愈合后原行显示 MATCHED · Explained · ITR…」做不到——案子按破口那一轮的截止点重建，更正分录 / 记短缺流水都在窗外（实测：愈合后页面还停在 Mismatch 行，副行还停在红 Δ +250.00 上）。开着的案子行为不变。
3. 顺带发现一处工具债，已登记 `doc-final/TOOLING-DEBT.md`（`reconciliation_dispositions` 不在 `reset-business-data.ts` 清单里，重铺后案件列表「Disposition」列显示 `5/1` 这类陈年计数；复现命令在条目里，本任务实测 `reset self` 前后该表行数不变、案件表归 0）。走查前我在 self 栈库里手清过一次该表，仅为截图观感。

## 3. matchStatus 读面消费点清点（`grep -rn "matchStatus" src admin-web/src client-web/src scripts --include='*.ts' --include='*.tsx'`，排除 spec；边界：字面量 grep，不含动态拼接）

| 位置 | 取什么 | INVARIANT 怎么办 |
|---|---|---|
| `reconciliation-query.service.ts:258`（listCases） | 差异行计数 `in [...]` | **改**（R34） |
| `reconciliation-query.service.ts:848`（appendInTransitRows） | 只取 `IN_TRANSIT` | 不相干；INVARIANT 另有 `appendInvariantRow` |
| `disposition.service.ts:279`（可改记候选） | `ORPHAN_INTERNAL / ORPHAN_EXTERNAL` | 不进候选，正确（对内差额不可改记） |
| `supplement-evidence.service.ts:142`（补单取证） | 只认 `ORPHAN_EXTERNAL` | 行不是外部孤儿 → 被拒，正确 |
| `wallet-recon-run.service.ts:894–988` | 写端：各类行的写入点 | T9a 已写 `INVARIANT` |
| `scripts/recon-demo.ts:1859–1908` | 铺场答案键校验（`lineType`、`IN_TRANSIT`） | 铺场不会产生 INVARIANT |
| `admin-web/src/utils/reconTypes.ts:13` | `CaseLineItem.matchStatus: string`，无人渲染（页面按 `flowComparison` 展示） | 不相干 |

前端按 `matchType` 分支的点（`rg "matchType" admin-web/src` 逐个看过）：`CaseFlowTable`（改）、`ReconciliationCasesDetailPage` 的 `MATCH_RANK`（加 INVARIANT: 0）、`causeRegistry` 的 `MATCH_TONE / MATCH_LABEL`（加）、`caseDetailBits.MatchChip`（走上两张表）、三个弹层（`ReconciliationHoldModal / DispositionFindingModal / AdjustmentCreateModal`，只在有菜单的行上被打开，INVARIANT 行无菜单，不可达）。

## 4. 走查（self 栈；`scripts/demo-shot.js`，`--cookie shared_simulation_mode=true`；业务流程用 HTTP 端点驱动，截图每张都 Read 过）

驱动脚本都在 scratchpad（不入库）：`imbalance.ts`（`AccountingService.executeTransfer` 同本跨客户造不平，T9a e2e 同款）、`walk.js`（登录 / 定性 / 拨钟 / 开单 / 批 / 推腿）、`lp.js`、`house.js`、`shot-select-open.js`（把 `<select>` 展开成列表框再截，原生下拉在无头截图里不渲染）。

| 截图 | 怎么来的 | 看到什么 |
|---|---|---|
| `t10-case-invariant-row.png` | `reset self`→`up`→`demo:all`→`recon:demo:pass`（PASS）→ 造「借 1·Grace 钱包现金 / 贷 100·Henry 应付」250.00 AED → 再 `recon:demo:pass`（引擎结果 `BREAK walletsChecked=21 casesOpened=2`，`orphan/mismatch 0`）→ 案件页 `REC20261107-002` | Hero 新句；副行 `Cash 5,085.00 + Shortfall 0.00 ｜ Payable 4,800.00 + Held 35.00 ｜ Δ +250.00`（红）；Differences 一行：Internal books / IN / 250.00 / `Books out of balance · needs correction`，无 Resolve 菜单 |
| `t10-case-list-invariant-count.png` | 同态，案件列表 | 两个仅对内不平的案子 Disposition 列 `0/1`（改前该列恒为 `—`，见 `ReconciliationCasesListPage.tsx` 的 `anomalyLineCount > 0 ? … : '—'`，改前未单独截图） |
| `t10-run-detail-internal-check.png` | 同态，`RUN20261107-1` 详情 | 新列：Grace `Δ +250.00`、Henry `Δ -250.00`（红）、其余客户钱包 ✓、公司钱包 `—` |
| `t10-case-invariant-healed.png` | 造一笔更正分录（`Dr 100·Henry / Cr 100·Grace` 250.00，不动现金，外部对账单不用重铺）→ `POST /admin/reconciliation/runs/wallet` → `casesAutoHealed: 2`，两案 `RESOLVED / AUTO_HEALED` | Resolved；副行 `Payable 5,050.00 … Δ 0.00`（灰）；`0 open rows`——INVARIANT 行消失 |
| `t10-case-customer-balance-row.png` | `recon:demo:break` 后案件页 `REC20261107-003`（场景 16，Alice USDT −7.5） | 客户案副行 `Cash 2,700.000000 + Shortfall 0.000000 ｜ Payable 2,700.000000 + Held 0.000000 ｜ Δ 0.000000`（Δ=0 灰） |
| `t10-case-explained-topping-up.png` | 同案：HTTP 定性 `HOLD_INVESTIGATING` → 拨钟 → 扫描后 `nextStep SHORTFALL_TOPUP`（金额 7.5 USDT）→ `POST /admin/internal-transfers/shortfall-topup`（从 F_OPS USDT 钱包）→ CFO 批 | 行 Status `Shortfall recognised · topping up ITR…`（案子开着，页面仍按破口轮截止点，记短缺流水在窗外，行仍是 Mismatch） |
| `t10-case-explained-before-reheal.png` | 推腿 ⚡ SUBMIT → OBSERVE_CONFIRMING → CONFIRM，划转单 `SUCCESS` | 行 Status `Explained · ITR…`（绿，带对勾；链到划转单页） |
| `t10-case-healed-after-topup.png`（**R25**，最终代码上重走一遍重拍） | 同上再 `POST /admin/reconciliation/runs/wallet`（= Re-reconcile 按钮同一端点）→ `REC20261107-003 RESOLVED / AUTO_HEALED` | Resolved；Hero `…; 7.500000 explained.`；Differences `0 open rows`；原行 **Matched** + `Explained · ITR…`；副行 Δ 0 |
| `t10-dashboard-due-from-lp.png` | 种子 Falcon Liquidity FZE（`LPP2601010183`）+ 其 ACTIVE 的 AED 收款地址 `LPA2601014044`：`POST /admin/lp-exchanges`（卖 50,000 AED 买 13,600 USDT）→ CFO 批 → 卖出腿 ⚡ SUBMIT / CONFIRM（`AWAITING_DELIVERY`，88 落账） | 新格：`FALCON LIQUIDITY FZE · USDT  13,600.000000 USDT` |
| `t10-dashboard-due-from-lp-delivered.png` | `POST /admin/lp-exchanges/:no/simulate-delivery`（85 贷 51）→ `DELIVERED` | 新格回到 `No LP delivery outstanding.`；「LP Delivery in Transit」USDT 13,600.000000 |
| `t10-ledger-accounts-owner-lp.png` | 第二笔 LP 兑换（同量，卖出腿确认后）时截台账页 Owner=LP | 4 个码 51 户，其中一户 13,600.000000 USDT |
| `t10-ledger-accounts-code-filter-options.png` | 台账页 Code 下拉展开 | 含 `2 · CLIENT_SHORTFALL`、`51 · LP_RECEIVABLE` |
| `t10-transfer-evidence-88-91.png` | 上述 LP 兑换（88）+ 扫费：`POST /admin/house-transfers`（FEE_SWEEP，F_FEE → F_OPS 36 USDT）→ CFO 批 → 推腿 + 场景 16 的认损补缺（91） | 凭证页同一页出现 `LP_EXCHANGE_RECEIVABLE`（88）、`HOUSE_TRANSFER`（89）、`FEE_INCOME_CLOSE_SWAP` / `_WITHDRAW`（90 ×2）、`INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`（91） |
| `t10-transfer-evidence-coa-filter-options.png` | 凭证页「All accounts」下拉展开 | 含 `A.CLIENT_SHORTFALL`、`A.LP_RECEIVABLE` |

走查中遇到的事实（不是缺陷）：
- 看板新格在 **CFO 批准后**仍是空的——13,600 要等**卖出腿确认**（84 + 88 同一步）才挂上；spec §7 剧本那句「CFO 批后看板 Due from LP 显示 13,600 USDT」少了一步（卖出腿 ⚡ 确认），T11 写剧本时需补。
- 走查把 F_OPS 的 AED 余额推到了红线以下（看板上红字 `Below threshold`），这是两笔 50,000 AED 兑换的后果，与本任务代码无关。

## 5. 改动文件

后端：`wallet-balance-checker.service.ts`（+spec）、`reconciliation-query.service.ts`（+spec）、`flow-comparison.builder.ts`、`reconciliation.dto.ts`、`reconciliation-case.service.ts`（+spec）、`wallet-recon-run.service.ts`（+spec）、`audit-actions.constant.ts`（注释）。
管理台：`CaseBalanceTiles.tsx`、`CaseFlowTable.tsx`、`ReconciliationCasesDetailPage.tsx`、`ReconciliationRunsDetailPage.tsx`、`CompanyFundsDashboard.tsx`、`companyFundsFormat.ts`（+spec）、`ledger-account.constants.ts`、`caseConclusion.ts`（+spec）、`causeRegistry.ts`、`reconTypes.ts`；新 `utils/caseInternalCheck.ts`（+spec）、`utils/caseFlowRows.ts`（+spec）。
文档：`doc-final/TOOLING-DEBT.md`（一条）。

## 6. 收尾态

`bash scripts/stack.sh reset self`（0）→ `up`（0）→ `bash scripts/on-stack.sh self demo:all`（0；`花名册：35/35 符合预期`、`asserts: 5/5 PASS`）。栈停在这个态：案件 0 条。`doc-final/demo/data.md` 未被 `demo:all` 改写（`git status` 无此文件）。

重铺后 `reconciliation_dispositions` 仍有 30 行（本次 e2e 留下的，印证 TOOLING-DEBT 新条）；收尾时手工 `delete from reconciliation_dispositions` 清到 0（仅自栈库），好让下个任务的案件列表不带陈年计数。
