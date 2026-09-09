# 波一 · 清地基（纯减法 + 对账本）· Spec

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波一 ｜ 依据：体检 `checkups/2026-09-09-acts345-trading-domains.md`（所有删除项均有取数员复现命令）｜ 2026-09-09 立，未经脑暴——业主裁定纯减法无岔口，判点在本文写死。

## 0. 本波做 / 不做

**做**：删已取证的死码 ｜ 修失真注释 ｜ 文档同步到代码现实 ｜ BACKLOG 销账与订正。
**不做**（对照项目总纲 §2 + 战役总纲）：不新增任何行为或端点 ｜ 不动中文注释（业主裁定，decisions 2026-09-09）｜ 不碰报价单与单号（波二）｜ 不做共享抽离（波四）｜ 不修体检红项（波三）｜ 报价取消端点不动（波二定夺）｜ 不删「业主已裁定保留」项：swap leg resume 端点、admin swap create 403 stub。

## 1. 删码总纪律（每个执行任务的硬前提）

1. **删前在当前 HEAD 复现零引用**——体检是 `909340a8` 时点的快照，记录会腐烂；复现命令用体检附录里那条，且必须**加搜两种被逮过的假阴性形态**：模板串拼接（`${...}` 里的 URL/路由/键名）与字符串值形态（枚举值、事件名、`AuditActions[变量]` 动态键访问）。复现不出零引用 → 该项不删，回报主会话。
2. **仅被 spec 引用的项**（8 个审计码 + 3 个表列 + 3 个前端常量）：先读引用它的 spec——它断言的是生产从不发生的行为，属「断言假绿」。处理 = 把断言改指真实行为（真实写入码 / 真实字段）或删除该断言，然后删常量/列；**该 spec 文件改后必须整体跑绿**。这不是「为让测试通过修测试」（禁做清单）——被修的断言本来就断在不存在的行为上。
3. 删 admin 端点必须同步删 `rbac.catalog.ts` 登记行，并 grep `scripts/verify-rbac.ts`、`scripts/verify-act1.ts` 确认无判据引用该路由。
4. 动 schema 的删列走新增迁移（保证空库能建起；禁止 backfill/兼容层——项目总纲 §3），收尾过重铺闸。

## 2. 交付清单

### A. 后端死码（体检轴②清单，锚点见体检报告与取数员 B 归档）

| 组 | 项 | 处置 |
|---|---|---|
| A1 零调用导出 18 个 | pricing-center 6 个 type/常量 + `SwapSimulatorDto`/`AdminPricingQuoteQueryDto`、`SwapSide`、`SwapQuoteComputationResult`、withdraw DTO 三枚举（`ComplianceStatus`/`KytStatus`/`TravelRuleStatus`）、`SumsubVerificationSubstatus`、同名双定义两组（`SwapFeeItemCode`/`WithdrawalFeeItemCode`——**pricing-center 那半删，fee-level 那半是各自 types 的活口径，删前按纪律 1 复核**） | 删 |
| A2 死审计码 15 个（全零） | `DEPOSIT_{RETURN,SEIZE,UNFREEZE}_APPROVAL_REQUESTED`、`WITHDRAW_{UNFREEZE,SANCTION_REFUND}_APPROVAL_REQUESTED`、`WITHDRAW_APPROVAL_{GRANTED,DECLINED}`、`WITHDRAW_SANCTION_REFUNDED`、`DEPOSIT/WITHDRAW_AWAITUSER_EMPTY_ACTIONS`、`DEPOSIT_ACCOUNTING_BLOCKED`、`DEPOSIT_COMPLIANCE_STARTED`、`DEPOSIT_CONFISCATION_FAILED`、`DEPOSIT_CONFISCATION_UNLOCK_FAILED`（:236-238 注释自认待清，注释一并删）、`DEPOSIT_GATE0_PASSED`、`DEPOSIT_LEG_CLEAR_FAILED`、`DEPOSIT_PAYIN_{CONFIRMED,FAILED}` | 从旧 `AuditActions` 扁平对象删（V4/V5/V6 分域名册不含这些旧名，不动） |
| A3 仅 spec 引用审计码 8 个 | `DEPOSIT_COMPLETED`、`DEPOSIT_HELD_BELOW_MIN`、`DEPOSIT_HELD_NOT_TRADING_READY`、`DEPOSIT_MANUAL_APPROVED`、`DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT`、`WITHDRAW_LOCK_RELEASED`、`WITHDRAW_MANUAL_APPROVED`、`WITHDRAW_REFUNDED_BY_TAG` | 按纪律 2 逐个处理（改断言→删常量；发现断言经 mock 自舔的，标注给评审） |
| A4 死表列 | 全零 6：`DepositTransaction.{travelRuleCheckedAt,aggregatedAt,aggregatedTransferId,sumsubExternalActionId}`、`WithdrawalFeeLevel.updatedByUserId`、`SwapFeeLevel.updatedByUserId` ｜ 仅 spec 3：`DepositTransaction.travelRuleTransferId`、`SwapTransaction.{failureCode,riskDecisionRef}`（按纪律 2）｜ 只写不读 2：`InboundTransferSignal.{lastScannedAt,supplementRequestedByUserId}`（删列 + 删写入点）。**保留**：`WithdrawTransaction.pricingQuoteId`——它是 relation 的外键背衬，读走 include，不是死列 | 删列走迁移 |
| A5 零消费端点 2 条 | `GET deposit-transactions/export`（脚手架期占位）、`GET client/withdraw-transactions/:id`（旧路，客户端走 my/:withdrawNo） | 删（含 rbac.catalog 登记，纪律 3） |
| A6 孤儿 spec | `withdraw-transactions/withdraw-fee-income.service.spec.ts`（607 行）——**不是死码**：测的是 WithdrawWorkflowService 费腿记账行为，只是文件名指向不存在的 service | **改名不删**：`withdraw-workflow.fee-income.spec.ts`（跑绿确认无路径耦合） |
| A7 唯一 TODO | `sumsub-ingestion.service.ts:279`（Wave 9 dead-events 告警）| 判定：属通知本体（战役不做清单）→ TODO 改一行指 BACKLOG I1，不留裸 TODO |

### B. 前端死码

| 项 | 处置 |
|---|---|
| `depositActionMap.ts` 的 `getPayinSimActionsForStatus`/`getPayinStatusBadgeClass` | 删 |
| `ALL_{DEPOSIT,SWAP,WITHDRAW}_STATUSES` 三常量（仅各自 spec 引用） | 按纪律 2：spec 若拿它做穷举对照（有真实价值）则改为文件内局部常量；纯自舔则连断言删 |
| client `/wallet` 路由 + `WalletManagement.tsx`（260 行）+ `AuthGuard.tsx:103` 黑名单里的 `'/wallet'` 项 | 删（判定依据：旧版钱包地址页，侧栏 Wallet 已改指提现地址簿、充值地址在充值页流程内展示，内容有替代、入口已失，演示看不到的不留） |
| `DepositTransactionDetail.tsx` 渲染不存在的 `data.confirmations`（:99,:601）与恒空 `sumsubActionId`（:117,:669，配对死列 A4 一起清） | 删展示位（FundsOrderDetail 的 7 个链上字段**本波不动**——「删展示还是模拟器补值」是波五判点） |

### C. 失真注释修正（只改注释，不改代码）

- 已逮 4 条必修：`swap-workflow.service.ts:1101-1119`（四个行号引用全漂移——**修法统一为引用函数名/锚点注释，不再写裸行号**，本波所有改到的注释同规矩）；`deposit-workflow.service.ts:2174/2443/2700` 三处「stub（A3/A4/A5 落地前）」改为如实描述已落地行为；`swap-workflow.service.ts:624`「Task 7 打桩」；`swap-kyt-verdict.handler.ts:33-42`「只定契约+打桩」。
- 顺修 1 条：`withdraw-transactions.service.ts:855`「目前零调用方」→ 已有 `setSlaDeadlineByNo` 调用。
- 全量核对：取数员 E 归档的 402 条带日期/任务号注释（scratchpad `checkup-E-backlog.md` 附录），按同判据过一遍——**判据 = 注释对行为/行号/文件的事实性描述与代码一致**；带日期的业主裁定语境、设计理由**不是清理对象**（那是决策留痕），只修「说的和代码不一样」的。改注释不改代码；发现注释揭示真 bug 的，登 BACKLOG 不顺手修。

### D. 文档同步（modules 层 + 剧本）

| 文档 | 改什么 |
|---|---|
| `modules/v4-deposit.md` | :63 「31 码封闭」→ 47 码（注明数字=V4 名册键数）；:70 PATCH 侧门描述改「端点已物理删除（00b0eb83）」；:85 删「三弧误标客户流水」行（判定见体检轴③#4——客户流水只读 CLIENT_PAYABLE，三弧不出现；管理台侧病根留 BACKLOG D6） |
| `modules/v5-withdraw.md` | :64 25→30 码；:71 `getWithdrawStatusView` 标注 client-web 前端归属 |
| `modules/v6-swap.md` | :61 18→22 码；:66 `resolveBestLevel()` 归属改 `swap-quote.service.ts` |
| `modules/funds-orders.md` | :55 `directionOf()` 归属改 `funds-order.service.ts`；:62 「权限包仍用旧名 INTERNAL_FUND_*」删「权限包」半句（rbac.catalog 零匹配，代码层残留半句留着） |
| `demo/script.md` | :139 第七幕缺口段码数 31/25/18 → 47/30/22 |
| 各文档 Last Verified 日期随改随更 | — |
| ⚠️ A2/A3 删码若使名册键数变化，上述码数以**删后实数**为准，执行末尾统一复数 | — |

### E. BACKLOG 对账

- 销账（移「本轮销账」节附证据）：D7「充值详情页终态全显 6 按钮」（9b391f19 已删，体检复现零命中）；I7 条目拆分——①兑换过度点亮已修（2026-08-24 业主裁定注释在案）销，②充值/提现 ⑧On hold 粗粒度保留原位。
- 订正行文：D11 划掉「条件③阈值未计算」半句（`TR_THRESHOLD_BY_CURRENCY` 已实现），保留条件② VASP 自报缺口；F3 把「常量已定义未调用」改为「`WITHDRAW_PRICING_QUOTE_*` 常量不存在、提现报价全生命周期零审计」（缺口本体归波二实施）。

## 3. 执行模型

Subagent-driven（每任务带项目总纲 §0–§5 要点）：执行与任务级评审 → `sonnet`；纯批量扫描核对（C 组全量注释）→ `sonnet`（计数可 `haiku`）；终审 → 主会话 Fable，终审必问「每条清单项的处置在哪个 commit」+ 抽查复现三条删除项的删前证据。任务粒度按 A/B/C/D/E 分组拆，A4（动 schema）与 A5（动 rbac）单独成任务。

## 4. 收尾闸（对照 `rules/delivery-checklist.md`，本波触发项）

1. 随手闸：三道 tsc + **jest 全量**（删码面广，不按目录圈定——B 批判例：目录圈定照不到防漂移闸）
2. 重铺闸（A4 动 schema）：`bash scripts/stack.sh reset main` → `on-stack.sh main demo:all`，判据对照 `demo/baseline.md` 全绿
3. ⑤ 前端改动（B 组）：preview 渲染 + 截图（充值详情页、client 侧栏与路由）
4. 交付物：净减行数 ｜ 每删除项的「删前零引用复现记录」（评审材料）｜ 文档改动 diff ｜ 承接记录写入波二 spec 骨架（波二骨架本波收尾时立）
5. 合并后：重启后端 + `npm run db:base:sync`（动了 rbac.catalog）

## 5. 已定事实 / 风险

- 全部删除项证据锚点在体检报告及 scratchpad 取数员 A/B/D/E 归档；执行时以 HEAD 复现为准，体检只是线索。
- 已知假阴性判例（模板串 URL / 值形态 UUID）已写进纪律 1——本波删除类操作对假阴性最敏感，评审重点盯这条。
- 风险最低组先行（C/D/E 纯文本），A4/A5 殿后，重铺闸一次收尾。
