# 技术债与遗留事项台账

> **唯一登记处。** 凡在 spec/plan/会话里说出"以后做 / 推后 / Phase X 处理 / deferred"，必须同时在这里记一行，并链回出处。做完就勾掉。
>
> **分工**：功能性的"以后做"（工作流/用户能感知的能力）进 roadmap 的 ADVANCED/OPTIMIZED；技术性的"以后做"（死码/技术债/小修/待决策/文档漂移）进本文件。
>
> 一行四要素：**是什么 ｜ 哪来的 ｜ 落点/状态**。

Last Updated: 2026-07-28

---

## 死码清理（Phase C 统一清扫）

- [ ] 五公式旧对账链 provider 仍注册未删（BalanceRecon / MatchEngine / ClassifierService / InternalActionsService / LegProjection 等，模块注释自认 wallet-* 三件套才是 sole live path）｜来源: 2026-07-03 死码体检 ｜Phase C
- [ ] 证据包防御死分支：`complianceAlert / complianceIncident / journal / clearing / kytCase / travelRuleCase` 模型均不存在，audit-logs.service 仍带可选链查询（`?.findMany` 优雅降级不炸，但恒空）｜来源: 2026-07-03 死码清理（超清单范围未动）｜Phase C
- [ ] `reconciliation.constants.ts` 的 `L.TRADE_CLEARING` 常量（credit-net 旧引擎残留）｜来源: 2026-07-03 死码体检 ｜Phase C
- [ ] **`/admin/pricing/policies*` 幽灵路由 + `CUSTOMER_RATE_READ/WRITE` 死权限组**：`rbac.catalog.ts` 注册 4 条 `/admin/pricing/policies*` + `/admin/pricing/simulator/swap`（挂 `CUSTOMER_RATE_READ`），但 pricing-center 模块只剩 engine（`PricingEngineService`/providers/types，**无 controller**）——PricingCenter admin surface 删除后路由残留、无人服务；`CUSTOMER_RATE_READ/WRITE` 除 catalog 外全仓 0 引用；活的定价 admin 面是 fee-levels（swap/withdrawal-fee-levels）。应删 5 条 route def + 2 个死权限组 ｜来源: 2026-07-11 权限包细化（用户疑老菜单，代码证实幽灵）
- [x] ~~subledger-inputs.service + repo 两死方法 / governance-demo-seed / 10 个死权限常量 / REIMBURSEMENT_OBLIGATION 常量 / internalTransaction+outstanding 证据包死链~~ ｜已在 worktree 删除（−651 行，tsc/jest 全绿）待合 main

## 技术债 — V4 充值

- [ ] Deposit/资金单层无 `txHash` 唯一约束（仅信号层 `dedupeKey` 有）→ 同 txHash 可能产生多 Deposit ｜来源: 2026-07-03 V4 体检
- [ ] TB 记账失败无 repair surface：仅记 `DEPOSIT_ACCOUNTING_BLOCKED` 审计后卡住 ｜来源: roadmap V4 待实现
- [ ] `deposit.status.changed` 用 `emit` 非 `emitAsync`，异常不传播到调用方 ｜来源: roadmap V4 待实现
- [~] Admin PATCH deposit status 部分绕过 workflow：仅 SUCCESS 被 `DEPOSIT_APPROVE_WORKFLOW_ONLY` 守卫，FREEZE/CONFISCATE 可绕过记账与审计 ｜来源: 2026-07-03 V4 体检 ｜✅ **2026-07-17 CONFISCATE 部分已关**——`CONFISCATED` 已加入 `deposit-transactions.service.ts → updateStatus()` 的 `ACCOUNTING_TERMINALS` 工作流专用守卫（isAdminApi PATCH 到 CONFISCATED 抛 `DEPOSIT_APPROVE_WORKFLOW_ONLY`；executeConfiscation 非 ADMIN_API 路径不受影响，单测 `blocks ADMIN_API from directly reaching CONFISCATED` 锁定）。**剩 FREEZE 部分未关**（FREEZE 无 TB 记账、危害较小，但仍应统一治理化，留账）
- [ ] ERC-20 合约失败交易未过滤（合约执行失败仍建 Payin）｜来源: roadmap V4
- [ ] KYT 超时转人工未做 ｜来源: roadmap V4
- [ ] 区块重组自动回退未做（与"按链确认数配置"一起设计，该功能项在 roadmap V4 ADVANCED）｜来源: roadmap V4
- [ ] 充值挂起（`DEPOSIT_HELD_NOT_TRADING_READY`）无自动重驱：客户补齐法币地址后，挂 COMPLIANCE_PENDING 的充值不会自动重跑 checkAutoApproval → 需 hook `ADDRESS_ACTIVATED` 重驱该客户挂起充值，否则要人工 ｜来源: 2026-07-11 Task 4b
- [x] ~~**DEPOSIT 金额限额配置先行、执行未接**：`transaction_limit_rules` 接受 `operationType='DEPOSIT'` 行（配置台可建），但充值工作流尚不调 `TransactionLimitGateService.evaluate` → DEPOSIT 单笔/累计限额配了不生效~~ **已兑现（2026-07-17 deposit-min）**：`detected()` 出生时查 `TransactionLimitRulesService.getSingleRule('DEPOSIT', assetId)`，低于 min → `limitHoldReason='BELOW_MIN'` 挂起（复用 `DEPOSIT_HELD_NOT_TRADING_READY` 挂起模式）+ `checkAutoApproval()` L1 永久挂起 + PASS/没收两处置动作，见 truth/v4-deposit.md §5-§7。仅 SINGLE min 接入，**B 累计限额仍未接 DEPOSIT**（见下条待决策）｜来源: 2026-07-16 transaction-limits → 2026-07-17 收口
- [ ] **DEPOSIT 累计限额（CUMULATIVE gateType B）仍未接**：本轮只接了 SINGLE 单笔下限，`transaction_limit_rules` 的 B 档（tradingTier×period 累计）尚未对 DEPOSIT operationType 消费 ｜来源: 2026-07-17 deposit-min 收口复核
- [x] ~~**原路退回（return-to-source）未做**：PASS/没收是本轮仅有的两个处置动作，"退回客户原来源"（链上退 originator 地址 / 法币退原汇出账户）未实现——依赖真实出金能力（等于半个提现流程：出账渠道/链上转出/银行汇款），本轮不做~~ **已兑现（2026-07-28 计划2·A3）**：`onReturnApproved()` 填真逻辑——pending 锁单腿 + 建 legSeq=3 资金单（目的地=原发款方 `fromAddress`/`fromIban`）+ `MANUAL_CHECKING→RETURNING`；legSeq=3 资金单 CONFIRMED → `settleReturn()` post →`RETURNED`（3 重试）；FAILED/TIMEOUT → `onReturnLegFailed()` void+重建新 attempt 重试（上限 3）。详见 truth/v4-deposit.md §6.2 ｜来源: 2026-07-16 deposit-min spec §8（deferred）→ 2026-07-28 计划2·A3 收口
- [ ] **BELOW_MIN 计次自动冻结未做**：同客户多次触发 below-min 挂起累计到阈值后自动转 FROZEN（防试探式小额充值绕限额）未实现，本轮只做单笔挂起+人工处置 ｜来源: 2026-07-16 deposit-min spec §8（deferred）
- [ ] **自动没收 cron 未做**：BELOW_MIN 挂起超时后自动发起没收（现只能 ops 手动点 Confiscate）未实现 ｜来源: 2026-07-16 deposit-min spec §8（deferred）
- [ ] **充值详情页通用 Actions 组在终态仍全显（pre-existing）**：`DepositTransactionDetail.tsx` 的通用 Approve/Freeze/Resume/Expire/Reject/Confiscate 组当前仅对 below-min 挂起 + 没收生命周期(CONFISCATING/CONFISCATED)隐藏；**SUCCESS/FROZEN/REJECTED 等其它终态仍全显 6 个按钮且可点**（点了会被后端状态机/治理守卫拒，非资金安全问题，纯 UX 误导）。根因=该组无"终态即隐藏"门控（D8 只加了 `!isBelowMinPending`，2026-07-17 没收轮补了 `!isConfiscationLifecycle`）。彻底修=按 deposit 是否终态统一门控通用组 ｜来源: 2026-07-17 没收异步 C5 实景截图发现（pre-existing，早于本分支）
- [ ] **CONFISCATING 结算耗尽重试后无手动重触发出口**：没收异步结算（`settleConfiscation`）失败自动重试 3 次仍失败则停 `CONFISCATING` + 记 `DEPOSIT_CONFISCATION_FAILED` 待人工介入（业主设计）。但资金单此时已 `CONFIRMED`（终态、不再发 `funds_order.status.changed`），且 `CONFISCATING` 状态机唯一出口是 `CONFISCATE_SETTLE`（由该事件驱动）、ADMIN_API PATCH 被 `ACCOUNTING_TERMINALS` 守卫挡 → **无 ops 可触达的重结算入口**。⚠️ 现实触发条件已收窄：`postPendingTransfer` 已幂等化（2026-07-17，赦免 `pending_transfer_already_posted`），故 leg1 成功/leg2 瞬时失败的 within-event 重试可自愈；仅"TB 持续宕机跨越全部 3 次重试"这一持续性故障才会真卡住（本地 TB demo 不可复现）。补法=加 admin `retry-confiscation-settle` 端点重调 `settleConfiscation`（幂等已就绪，安全可重入）｜来源: 2026-07-17 没收异步化对抗式复核 Finding 2
- [ ] **制裁没收（sanctions-confiscation）不在本轮范围**：本轮"没收"专指 BELOW_MIN 金额没收（T&C 手续费性质，OPS_OFFICER 单步审批）；FROZEN（制裁冻结）路径下的没收属 MLRO 合规域、走独立审批链（roadmap V4 ⚖️「制裁冻结完整闭环」P0），未随本轮触碰，FROZEN 状态机本身也未改动 ｜来源: 2026-07-16 deposit-min spec §8（deferred）
- [ ] **TR 适用判定未自动计算**：充值 PRD 定义 Travel Rule 适用 = 虚拟币 且 来源地址为 VASP 托管 且 单笔 ≥ 3,500 AED（三条件 AND，否则 NOT_REQUIRED）；现状仅条件①法币→NOT_REQUIRED 落地，条件②(hosted/unhosted VASP 分类，依赖 roadmap V3 地址打标)+③(3,500 阈值判定)**代码未自动计算** → crypto TR 结果当前由 demo 模拟端点注入 ｜来源: 2026-07-11 充值 PRD v2
- [x] ~~🔴 TR 从 status 升级为独立"交换实体"表~~ ❌ **否决（2026-07-14）**：经两轮论证否决"独立 TR 交换表"——① **Sumsub 存 TR 交换真身**（system of record，可 API 查特定 TR 交易 / Dashboard 列 / on-hold 队列），我方本地只是镜像；② 无本地充值场景 A（预告）则每笔 TR 都 1:1 **订单锚定** → 订单字段（`travelRuleStatus`/`sumsubTxnId`/`counterpartyVasp`/`failReason`，前几个已有）+ workflow 流转即可，不必建表；③ 入站归属确认（对方先发 TR）可**无状态自动应答**（客户充值地址预注册到 Sumsub → 自动确认 + 从 applicant 带 PII），不需本地预告表；④ 场景 A 可塌成"无状态应答 + 钱到走场景 B"（Sumsub 当相关器，txHash 幂等防重复提交）。**目标架构** = 充值/提现订单字段 + 无状态入站归属应答器 + Sumsub 当真身/合规台（合规人员在 Sumsub Dashboard 处置，我方不自建审核台）。曾做完 9 task/12 commit 的分支 `claude/tr-exchange` + Lark PRD 已删。**新集成点**（真接 Sumsub 时）：建客户充值地址时同步注册到 Sumsub 绑 applicant。决策见 memory `tr-exchange-table-rejected` ｜来源: 2026-07-14 TR 交换表否决
- [ ] **充值自动侦测器未接**：链上 watcher / 银行 VIBAN webhook 未部署，`deposit-transactions.service.ts → detected()`（真实业务入口）当前**唯一**触发路径是客户申报入账信号 + 手动扫描（demo 脚手架，带 `simulationRisk*` 注入 + `QUICK_DEMO` 模式）；PRD happy path 按业务意图写"系统自动侦测"，落地待接真实侦测源 ｜来源: 2026-07-11 充值 PRD v2
- [ ] **充值审计事件改名 + 精简（8→6）**：PRD v2 定稿审计集去 `DEPOSIT_` 冗余前缀（workflowType 已标 DEPOSIT）+ 统一 `_APPLIED`→`_PASSED`（与展示词对齐）；并合并两对同刻冗余事件——`DEPOSIT_COMPLIANCE_STARTED`(并入 PAYIN_CONFIRMED) + `DEPOSIT_APPROVED`(并入 COMPLETED)；**并 GATE0→L1**（退役 `GATE0`/`Gate 0` 命名，统一 L1/L2/L3 口径：`DEPOSIT_GATE0_PASSED`→`L1_PASSED`、`runGate0()`→`runL1()`、日志 "Gate 0" 改 "L1"）。改 `audit-actions.constant.ts` + `deposit-workflow.service.ts`，须评估历史 `audit_log_events` 旧值兼容 ｜来源: 2026-07-11 充值 PRD v2（审计瘦身轮）+ 2026-07-12 三闸门命名统一

## 技术债 — 充值状态机·计划1 引擎（deposit-sumsub，2026-07-28）

> 来源统一：`superpowers/specs/2026-07-2x-deposit-state-machine-*`（KYT-only 架构，忽略 amlCase，靠规则折叠+自动重算）+ 12-task 实施计划。现状见 `truth/v4-deposit.md` §4.1/§4.2、`truth/sumsub-ingestion.md` §3。以下为本计划刻意延后到计划2 的功能块 + 落地中发现的欠账。

- [~] **计划2：RETURNING/CONFISCATING/SEIZING 三条动钱弧的结算+审批闭环**：`CONFISCATING→CONFISCATED`（没收）在计划1 尾声已异步两阶段落地；`RETURNING→RETURNED`（原路退回）已在 **2026-07-28 计划2·A3** 落地单腿 pending→post/void + 3 重试 self-heal（见 `truth/v4-deposit.md` §6.2）；仅 `FROZEN→SEIZING→SEIZED`（政府没收）+ 解冻回炉仍是审批正门已开、执行侧仍桩（`onSeizeApproved`/`onUnfreezeApproved`，见 `v4-deposit.md` §7），留 A4/A5 承接 ｜来源: task-13-brief 与计划2 的边界 → 2026-07-28 A3 部分收口
- [ ] **慢 case 自动重算未端到端验证**：KYT-only 架构的根基假设——客户/officer 处置慢 case 后，Sumsub 自动重算并补发 `applicantKytTxn*`（S4/S7 场景据此设计：ACTION_PENDING/MANUAL_CHECKING 补料或翻案后无需专门 action handler，靠重评 webhook 自动推进）——沙盒环境逼不出真实的"慢 case 重算"时序，Task 12 e2e（`test/deposit-sumsub-scenarios.e2e-spec.ts` S4/S7）只能用 fixture 直接喂第二个 webhook 断言，不是对真实 Sumsub 异步重算的端到端验证。上线前需拿真实 applicant 走一次真慢 case 验证 ｜来源: task-13-brief
- [ ] **`sumsub-txn-client.http.ts` 三处 minor**：① `resolveVerdict()` 在 `review.reviewResult` 和 `scoringResult.action` 都缺失时返回 `undefined`（无兜底/无告警，边缘场景）；② `submitTxn()` 的 counterparty 只设 `paymentMethod.accountId`，未设 `paymentMethod.type`（生产 crypto travelRule 场景需要补，当前沙盒未触发校验）；③ `deposit-kyt-verdict.handler.ts` 的 `SCENE_TAGS`/`DISPO_TAGS` 字面量集合与 `deposit-workflow.service.ts → applyKytVerdict()` 参数上手写的 `sceneTag`/`dispoTag` 联合类型两处手工同步，未共享一个类型/常量源 ｜来源: 2026-07-28 Task 13 code 走查
- [ ] **`prisma/schema.prisma` 新增字段列未对齐**：`DepositTransaction` 新增的 `sumsubFinanceTxnId`/`sumsubTravelRuleTxnId`/`manualReason`/`slaDeadline`/`slaBreached` 5 列缩进与同 model 其它列的列对齐格式不一致（`prisma format` 未跑），纯格式债 ｜来源: 2026-07-28 Task 13 code 走查
- [ ] **`scripts/stack-stop.sh` 孤儿进程清理相对/绝对路径不匹配，永不命中**：`cleanup_orphans_by_pattern "backend-orphan" "${APP_DIR}/dist/main"` 用绝对路径 pattern 做 `pgrep -f`，但 `stack-up.sh:114` 实际以相对路径 `["node","dist/main"]` 启动后端进程，命令行里不含 `${APP_DIR}` 前缀 → 该 orphan 清理分支永远 0 命中，无法杀残留 backend 进程。建议 `stack-up.sh` 改绝对路径启动，或 `stack-stop.sh` 的 pattern 改成只匹配 `dist/main`（相对）｜来源: 2026-07-28 Task 13 走查
- [ ] **payin→COMPLIANCE_PENDING 管道（STEP_1/funds_order 级联）无 e2e 覆盖**：Task 12 e2e 为避开 `detected()→funds_order→事件级联`（fire-and-forget `emit`，测试里会竞态），改为直接 Prisma 建一条 `status=COMPLIANCE_PENDING` 的 deposit + 手动调 `handleDepositStatusChanged()`，绕过了 PAYIN_PENDING→COMPLIANCE_PENDING 这段（payin 检测 + TB Step1 记账）。该段仍缺 e2e 直接覆盖 ｜来源: `test/deposit-sumsub-scenarios.e2e-spec.ts` 文件头注释 + task-13-brief
- [ ] **must-fix-before-applicant-registration-go-live：trading-ready 闸已两路统一，上线前需回归验证**：终审 I1 发现 `applyKytVerdict()`（新 KYT-only approve 路径）直接调 `approveDeposit()`，绕过了 `checkAutoApproval()`（老 mock kyt-check/tr-check 路径）唯一的 trading-ready（法币提现地址）闸——客户没设法币提现地址也能经 KYT approve 通过充值，违背 2026-07-11 上线的"未 trading-ready 就 hold"不变量。本次已修：抽共享私有 helper `assertTradingReadyOrHold()`（`deposit-workflow.service.ts`），`checkAutoApproval()` 与 `applyKytApproved()` 都先过这道闸，不通过则原地 hold（不改状态）+ 记 `DEPOSIT_HELD_NOT_TRADING_READY` 审计，消除两路门禁漂移。**applicant-registration 正式接真实 Sumsub webhook 上线前，需对这条闸单独做一次回归验证**（未设法币提现地址的客户，真实 approve webhook 打过来时仍应被 hold 在 COMPLIANCE_PENDING，不应被放过）｜来源: 2026-07-28 终审 I1，已修，见 `deposit-workflow.service.spec.ts` "I1: approved but customer has no active fiat withdrawal address" 用例
- [ ] **`findBySumsubTxnId` 查询列缺 DB unique index**：`deposit-transactions.service.ts → findBySumsubTxnId()` 用 `OR[{sumsubFinanceTxnId},{sumsubTravelRuleTxnId}]` 做 `findFirst()` 按 Sumsub txnId 反查 deposit，业务上靠"Sumsub txnId 全局唯一"这一假设撑着，但 `prisma/schema.prisma` 里这两列只是普通可空 `String?`，DB 层无 unique 约束硬化——一旦假设被打破（重复值/竞态写入），`findFirst` 可能悄悄解析到错误的 deposit，webhook 状态机会被错误驱动。建议补唯一索引（两列各自 `@@unique`，注意都可空，SQLite/大多数 DB 唯一索引允许多行 NULL 共存，不影响未提交场景）｜来源: 2026-07-28 终审
- [ ] **充值动钱弧 start 阶段缺事务包裹**：`onReturnApproved`（返回弧）与没收的 `startConfiscation` 都把「建资金单 + TB pending 锁 + updateStatus」三步裸序执行，无 `prisma.$transaction`、无失败补偿——对比 `withdraw-workflow.service.ts → createWithdrawal()` 用 `$transaction` 包资金单/记录创建 + TB pending 调用，失败时在 catch 里对已落地的 TB pending 做 `voidPendingTransferBestEffort` 补偿。若 pending 锁在建单后抛错，会留下孤儿 CREATED 资金单，且 `@OnEvent` 监听器无重试队列、无自动自愈路径（`onReturnApproved` 的"pending transfer throws→rethrows"单测只验证了 deposit 状态未跳、STARTED 审计未记，未验证资金单是否已孤儿落地）。应开专门任务统一治理（同时覆盖退回与没收两条弧），避免单点偏离造成不一致；关联现有条目「CONFISCATING 结算耗尽重试后无手动重触发出口」（同一 start 阶段裸序问题的下游症状）｜来源: 2026-07-28 A3 Minor review

## 技术债 — V3 财务配置

- [ ] TB 账户创建失败无 backlog 重试（仅转账凭证 `TbEvidenceBacklog` 有）｜来源: 2026-07-03 V3 体检
- [ ] `contractAddress` 字段 schema/DTO 残留（前端已移除）｜来源: 2026-07-03 V3 体检
- [ ] **Asset `min/maxDeposit/WithdrawAmount` 4 列待 drop**：单笔上下限已由 `transaction_limit_rules` SINGLE 行接管，资产表单 4 输入框已撤、schema 列现无人配无人读（弃用残留），留待未来迁移 drop ｜来源: 2026-07-16 transaction-limits
- [ ] 资本注入流水缺 evidence 行（`FIRM_ASSET` 流水缺资本那笔）｜来源: V8 redesign 遗留
- [ ] 法币就绪查询 where-clause 三处重复（`WithdrawalAddressService.hasActiveFiatWithdrawalAddress`/`countActiveFiatAddresses` + `onboarding.service.ts` 内联 `assertTradingReady`）→ 未来抽 cycle-free 共享查询层 ｜来源: 2026-07-11 交易起始前置门 Task 2 质量审

## 技术债 — V5 提现

- [ ] **提现报价审计未落地**：报价流程（`WithdrawQuoteService.createQuote/consumeQuote/cancelQuote`）零打点——常量 `WITHDRAW_PRICING_QUOTE_CREATED/_USED/_CANCELLED`（entityType `WITHDRAW_PRICING_QUOTE`）已定义但 `withdraw-quote.service.ts` 从不调用（grep 实证 0 命中，该文件无任何 audit 引用）；对比兑换 `SWAP_QUOTE_CREATED/USED/CANCELLED` 已在 `swap-quote.service.ts:249/319/364` 落地。应补打 QUOTE_CREATED/USED/CANCELLED（workflowType `WITHDRAW_QUOTE`），与兑换对齐 ｜来源: 2026-07-11 提现报价单文档 v2 §4.1.3
- [ ] Sumsub KYT/TR 真实集成未做：仅模拟端点；`archivePostKyt()` 明确注释为 stub，待替换真实 PATCH /kyt/txns 调用 ｜来源: 2026-07-03 V5 体检
- [ ] 热钱包余额校验无：Payout 前不查 Outbound Wallet 余额，不足不显式失败 ｜来源: 2026-07-03 V5 体检
- [ ] 提现成功通知未接：SUCCESS 时不调 `NotificationsGateway`（基础设施在、workflow 没调）｜来源: 2026-07-03 V5 体检
- [ ] TB 记账失败 repair surface 偏薄：靠 `assertWithdrawSettled()` fail-closed 卡在 PAYOUT_PENDING 等人工，无专用修复 UI/端点 ｜来源: 2026-07-03 V5 体检
- [ ] 前后端 FROZEN 漂移：前端 `Withdraw.tsx` tipping-off 过滤引用 FROZEN，但后端 withdraw 枚举无此态（映射本身正常）｜来源: 2026-07-03 V5 体检
- [ ] 模拟端点缺 `simulate/payout-confirmed`：只有 kyt-phase1/2 + travel-rule，payout 确认改走 funds_order advance（非缺失，记录以免误判）｜来源: 2026-07-03 V5 体检
- [ ] 在途提现守卫（deactivate 的 `ADDRESS_HAS_INFLIGHT_WITHDRAWAL`）靠 `toIban/toAddress` 字符串匹配，`Withdraw.tsx` 手输地址模式下会漏配（无 addressNo FK 关联提现与地址）→ 假阴性可绕过守卫；正解需给 WithdrawTransaction 加 addressNo/addressId FK ｜来源: 2026-07-11 Task 6 spec 审
- [ ] **旧 "L3: Post-Tx Archive" 命名与交易风控 L3 撞名**：`withdraw-workflow.service.ts:1237/1368` 的 `archivePostKyt()` 注释标 `// L3: Post-Tx Archive`；交易风控 spec（2026-07-12）把 **L3 定义为「行为监测」**，此 txHash 归档实为 L3 的数据上游（喂 Sumsub TM），落地时改名（如 "Post-Tx txHash 归档"），勿再叫 L3 ｜来源: 2026-07-12 交易风控三闸门 spec §1

## 技术债 — V6 兑换

- [ ] **FAILED/REVERSED 死枚举**：`SwapTransactionStatus` 定义 FAILED/REVERSED 但全代码无 `markStatus` 设置（只调 SUCCESS）→ 不可达；控制器只有 advance/resume，**无 reverse 端点**（roadmap 曾标 ✅2026-06-26 整笔冲正实为过度声明）。需求要么补 reverse+FAILED 状态机，要么删死枚举 ｜来源: 2026-07-04 V6 体检
- [ ] 无自动 FAILED 状态机：腿失败走自愈→STUCK(needsReview)+手动 resume，swap 留 PROCESSING，无终态失败（设计 deferred）｜来源: 2026-07-04 V6 体检
- [ ] Sumsub TM 真实集成未做（大额兑换合规）｜来源: 2026-07-04 V6 体检
- [ ] Quote TTL 无 cron sweep：仅懒过期（查询时 markExpired）｜来源: 2026-07-04 V6 体检
- [ ] 兑换成功通知未接（SUCCESS 时不调 Notification）｜来源: 2026-07-04 V6 体检
- [ ] TB 记账失败无专用 repair surface（仅 resume 重试，无修复 UI/端点）｜来源: 2026-07-04 V6 体检
- [ ] 架构命名漂移：roadmap 写"SwapSettlementService"该类不存在，实为 SwapWorkflowService+SwapLegAccounting+SwapTransactionsService（文档订正即可，非代码债）｜来源: 2026-07-04 V6 体检
- [x] ~~swap 腿 `${swapNo}:${legSeq}:${attempt}:pending` 合成 externalRef（非真实穿越号，与 `isExternalCrossing:true` 自相矛盾，对账 Pass1 永配不上真实外部行）~~ ｜已修：externalRef 生成/回写收口归 funds_order，postLeg→enrichForPost 补真实铸号（2026-07-11，spec/plan `2026-07-11-funds-order-externalref-consolidation`）
- [ ] demo 播种铸号种子不一致：`client-web Deposit.tsx` 与 `demo-lib.ts` 用 `walletId` 作 `fakeChainTxHash/fakeBankRef` 种子，funds_order 收口后 canonical 种子是 `fundsOrderNo`（两侧各自成对、不影响匹配，仅种子来源未统一）｜来源: 2026-07-11 externalRef 收口
> 注：swap 腿 InternalFund 命名债已并入下方「平账处置」的 funds-orders 域 RBAC 命名债条目，不重复登记。

## 技术债 — V8 对账

- [ ] 🐛 **`reObservedCount` 恒为 0**：line item 每 run delete-then-insert，`foundByRunId` distinct 恒 1 → 观察历史"复观察次数"永远 0；正确修法需 `reconciliation_cases` 加专用计数列（`upsertCaseForWallet` existing 分支 +1）；代码已加 KNOWN LIMITATION 注释（`reconciliation-query.service.ts`）｜来源: 2026-07-04 V8 体检（Round3 遗留）
- [ ] **Reimbursement 三处残留未清**（表已 drop）：`schema.prisma` `reconciliation_case.reimbursementObligationId` 孤立外键列 + `reset-business-data.ts:45` 引用 + `permissions.ts:110` `REIMBURSEMENT_OBLIGATIONS_READ` 孤儿权限（53f711c 清死权限时漏网）｜来源: 2026-07-04 V8 体检
- [ ] **FIRM Treasury snapshot 历史残留**：旧 Run 历史数据余额标记行误入交易下钻（Phase B 后新 run 不产生，历史数据未清）｜来源: 2026-07-04 V8 体检（Round3 遗留）
- [ ] **资本注入 evidence 待核**：CAPITAL_INJECTION seed transfer 在，FIRM_ASSET 流水是否有对应 evidence/account_flow 行待确认（roadmap 记为欠，agent 称已有——需查 seed 是否走 writeEvidence）｜来源: 2026-07-04 V8 体检
- [ ] **资金单合并可行性评估**：payin/payout/internalfund 状态机近同构（已从待决策移来核实——Round 2 已合表 funds_orders，权限已统一 FUNDS_ORDERS_*，此项其实已完成大半，剩 InternalFund 枚举命名债）｜来源: 2026-07-04 V8 体检复核
- [ ] **canonical-minor 展示层 re-pairing 未传 decimals**：`reconciliation-query.service.ts` `buildFlowComparison()` 的 `matchFlows` 调用暂传 `decimals: 0`（identity 换算，保持 Case 详情流水比对页现状不变），TODO 标记待 Task B 补该 case 资产 `asset.decimals`｜来源: 2026-07-04 canonical-minor Task A（Task B 收口）
- [ ] **对账 Cases 列表页 Δ 显示的是原始「分」整数、未按 decimals 分→元**：`ReconciliationCasesListPage.tsx:297` 直接 `{kase.deltaAmount}` 渲染（仅用 `Number()` 判正负/零），USDT case 会把 3000000 分显示成 "3000000"。修法需后端 `listCases` 返回 `decimals`（同 getCase：按 assetCode 查 asset 表）+ 前端列表按行 `formatAmount(delta, decimals)`。同族的 DemoCompare 页 `AmountCell`（manifest 口径答案键，属另一比对面，暂不动）｜来源: 2026-07-04 canon2 T4 冰山排查（T4 只改两详情页，列表页超范围）
- [ ] 🎯 **业务层（充值/提现/兑换/资金单/报价/手续费）存储 元→分 整层迁移**（乙的第二步）：当前 `funds_orders.amount` 及整个业务层仍存「元」，与"内部全分"原则不符；recon 读入边界（matcher Pass3 `wallet-flow-matcher.service.ts` + push 回执 `receipt-lookup.service.ts` 档2）为此做 funds_order 元→分 换算。整层搬分后**可撤除这两处边界换算**（改为分比分直取）。blast radius 巨大（quote/withdraw/deposit/swap 建单+校验+展示全链），须单独排期迁移+回填+双跑校验｜来源: 2026-07-04 canon2 scale 审计 + 业主"内部全分"原则（spec `2026-07-04-recon-engine-canonical-minor-design.md` §6）
- [ ] **`formatAmount(raw, decimals)` 三处重复**：`ReconciliationCasesDetailPage.tsx` + `ReconciliationRunsDetailPage.tsx` 各有一份 bigint-safe 版（字符串插点），`ReconciliationExternalBalancesPage.tsx` 另有一个 `fmtAmount` float 版（`Number()/10^d`，大额/6 位币种有精度风险）。应抽到共享 util、统一到 bigint-safe 版并三处引用｜来源: 2026-07-04 canon2 T4 Minor
- [ ] **金额精度断言（`.toFixed(0)` 元→分取整）跨 matcher + receipt-lookup 横切**：`wallet-flow-matcher.service.ts` `toMinor` 与 `receipt-lookup.service.ts` `orderMinor` 都用 `Prisma.Decimal.mul(10^decimals).toFixed(0)` 把 funds_order 元→分，靠 `.toFixed(0)` 舍入。两处口径必须始终一致（否则同一单在途认领与推单回执会错配）；元→分整层迁移后此横切消失。当前无守卫两处不漂移的测试｜来源: 2026-07-04 canon2 T3 M2
- [ ] **`receipt-lookup.service.ts:77` `extMinor` 的 `String(a)` 死兜底分支**：`l.amount` 恒为 Prisma.Decimal（有 `.toFixed`），三元 `a?.toFixed ? a.toFixed(0) : String(a)` 的 else 永不命中。可删掉与匹配器 `extMinor = BigInt(d.toFixed(0))` 对齐（T3 M1）｜来源: 2026-07-04 canon2 T3 双审
- [x] ~~**demo:in-transit heal 检测被历史 POSTED 流水在 Pass2 抢配**~~：**已修（2026-07-04 canon2 T6）**。demo 客户钱包跨轮复用，每次 --verify 推单 POST 留一条 `WITHDRAW_NET_POST` 分流水；reset 清不掉（父 withdraw 已删，flow 成孤儿）。固定金额时历史同额同向 POSTED 流水在 matcher Pass2（金额+方向+60min 模糊）抢配本轮外部镜像行 → 卡腿认不成在途 → 落 BREAK。修法：`demo-in-transit.ts` 建单前查该客户钱包已存在的 `WITHDRAW_NET_POST` 净额集合，挑一个不在集合里的 amount（避让历史）｜来源: 2026-07-04 canon2 T6 heal e2e 排查
- [x] ~~**demo:in-transit --verify 推单后重对账早于异步 POST 落库（竞态）**~~：**已修（2026-07-04 canon2 T6）**。`syncPush` 只把腿驱到 CLEARED 就返回，真正净额 POST 由 `withdraw-workflow` 的 `@OnEvent(onPayoutLegConfirmed)` 异步 handler 完成；紧接着 recon 会读到旧余额 → delta≠0 误判。修法：`runVerify` step 4 先 `waitFor` 该腿 `WITHDRAW_NET_POST` 落库再 recon｜来源: 2026-07-04 canon2 T6 heal e2e 排查

## 技术债 — V1 审计底座

- [ ] 🔴 **通知 send/retry = STUB**：`core/notifications/` 只有 WebSocket `NotificationsGateway`，无 email/webhook/失败重试实现——roadmap 标 Notification send/retry ✅ MVP 为过度声明；这是 V4-V6 各版本"通知未接"的根因（本体没做，不是没调）｜来源: 2026-07-04 V1 体检
- [ ] 🔴 **subjectNos 合约漂移 + 幻影字段**：`rules/audit-logging.md` Query Contract 要求 detail 返回 `subjectNos[]`，但代码 `mapEvent()` 不返回、DTO 无字段、query 无 subjectNo 过滤（表 2026-05-19 已删）；代码仍有 `item.subjectNos` 幻影访问恒 undefined。需二选一：改文档承认已删 or 补 subjectNos 返回｜来源: 2026-07-04 V1 体检（与 2026-07-03 体检重复项收口）
- [ ] **audit-retention-job.ts 死脚本**：`scripts/audit-retention-job.ts:33-45` 仍 select/access 已删列 `module`/`triggerType`，脚本会坏/返 undefined｜来源: 2026-07-04 V1 体检
- [ ] **SUPER_ADMIN 硬编码 bypass**：`access-control.service.ts` 对 SUPER_ADMIN 跳过 SoD + 直给全权限；roadmap 定性演示角色，**上线前须移除此 bypass**｜来源: 2026-07-04 V1 体检
- [ ] traceId 共享待核：首登 `ADMIN_LOGIN_SUCCESS`(authTraceId) 与 `MFA_LOGIN_VERIFIED`(loginTraceId) 是否共享同一 traceId 存疑（roadmap 称共享，agent 存疑）｜来源: 2026-07-04 V1 体检

## 技术债 — V2 客户合规

- [ ] 🔴 **冻结/解冻无统一 workflow + 无 MLRO 解冻门**：冻结散在多处自动触发（material BLOCKING / tier upgrade / CRA 制裁），无独立 freeze workflow、无解冻审批门（`UNFREEZE` 常量定义未用）、无 freeze/unfreeze API（DTO 有 handler 无）；roadmap 要求的"手动先审批后冻结 + 解冻统一 MLRO 审批"未实现 ｜来源: 2026-07-04 V2 体检
- [ ] **Tier Upgrade ⛔ 缺客户端 UI**：后端全建（createFromCra→Level2→MLRO+SMO 审批），缺客户材料提交前端（真实卡点，roadmap 已标 BLOCKED）｜来源: 2026-07-04 V2 体检
- [ ] **Corporate/机构客户 stub**：CorporateProfile/UboProfile 表+关系连但无业务逻辑，onboarding 两处显式 disabled；机构客户全 ADVANCED ｜来源: 2026-07-04 V2 体检
- [ ] **Material Refresh 状态名不符**：代码 NUDGE_ONLY/CLEARED vs roadmap NUDGE/RESOLVED（文档订正即可）｜来源: 2026-07-04 V2 体检

## 技术债 — 平账处置（推单）

- [ ] **swap 腿推单未支持**：通用推单按钮（`/admin/funds-orders/:no/push/sync|manual`）明确排除 swap 腿——`advanceByNo`/编排服务见 `swapTransactionId` 非空即拒（现有先卖后买顺序守卫防线），且回填 effectiveDate 需再穿透 swap 4 腿两阶段记账链（工作量≈deposit+withdraw 之和）。swap 腿卡单本期走 **Swap 详情页 `advanceLeg` 专用推进**（带顺序守卫），但该路径**暂无 effectiveDate 回填** → 推完历史那天快照修不平 ｜来源: 2026-07-03 推单 plan 落地发现（spec §2/§8）｜下期：swap workflow 记账链穿透 effectiveDate + 推单接 swap 腿
- [ ] **推单/sim-advance 端点用 INTERNAL_FUND_READ 读权限门控变更操作**：/admin/funds-orders/:no/push/sync|manual + :no/advance 都是变更/动钱操作却挂 _READ → 读权限 operator 也能推单结算。应新增**写/处置权限**统一门控三端点（需 db:base:sync + 重启）｜来源: 2026-07-03 推单 T3 code-review M-2 ｜下期专门 RBAC 轮（与下条命名债一并做）
- [ ] **funds-orders 域 RBAC 权限 + 审计实体仍用 rename 前旧名 `INTERNAL_FUND`**：Round 2 表 `internal_funds`→`funds_orders`（2026-07-02）后，权限 `INTERNAL_FUND_READ`（rbac.catalog.ts:44/581-586 整个 funds-orders 域唯一权限）+ 审计实体 `AuditEntityTypes.INTERNAL_FUND`（audit-actions.constant.ts:58，Spec#4 短名）均未跟随重命名 → 域叫 funds order、门禁/实体叫 internal fund，不一致。应统一改 `FUNDS_ORDER_READ` / 新增 `FUNDS_ORDER_DISPOSE` + 审计实体 `FUNDS_ORDER`（rbac catalog union 类型 + 全部 route + AuditEntityTypes + 引用点 + db:base:sync；审计实体改名要评估历史 audit_log_events 旧值兼容）｜来源: 2026-07-03 用户审阅推单 BACKLOG 发现 ｜下期 RBAC 轮同做
- [ ] **权限包目录三动词标准化 + 铺满 9 空域（本轮只出文档，代码待实现）**：定《权限与审计规范》以 View/Manage/Act 三动词为标准；现 `ACTION_BUCKET_CATALOG` 15 域仅 6 域有 bucket，`customer/compliance/trading/recon/pricing/config/gov_registry/counterparty/clearing` 9 域为空壳 → 自定义角色 UI 勾不到交易等能力；且缺 `funds`（资金单）域。代码活：按三动词补全各域 bucket + 新增 funds 域（含上条 FUNDS_ORDER_VIEW/ACT 拆分）+ Act 档对齐 SoD。中央规范以 `rbac.catalog.ts` 为唯一真相源、文档镜像防漂移 ｜来源: 2026-07-11 权限包集中化 brainstorm（甲·三动词，本轮文档 only）
- [x] ~~**缺"真实卡单"demo 场景演完整 heal 闭环**~~：**已兑现（2026-07-04 canon2 T6）**。`demo:in-transit --verify`（真实卡提现，非状态壳）端到端实证：DETECTION 落 IN_TRANSIT 残差 0 → 推单 sync CLEARED → 等净额 POST 落库 → 重对账 **delta=0**、卡腿脱离 IN_TRANSIT（连跑无 reset 3 次幂等 PASS）。case 自愈到 RESOLVED/AUTO_HEALED 需钱包零异常达 MATCHED（复用 demo 钱包有历史内部单腿 → SOFT_FLAG），该路径由单测 `wallet-recon-run.service.spec.ts`（"breaks in run A then recovers in run B → RESOLVED/AUTO_HEALED"）证明｜来源: 2026-07-03 推单 T5 → 2026-07-04 canon2 T6 收口

## 技术债 — 费率等级治理（2026-07-11 V3 PRD 需求；核心谓词已落代码，剩余项见下）

> 来源统一：`doc-final/superpowers/`（拟）+ 飞书《交易费率等级治理》V3（docx `KoqidVBVMoPIBoxOVVKltxn6g9c`）。现状已在代码（2026-07-13 后）：`isDefault`(EVERYONE) + `requiredTagsJson`/`validFrom`/`validTo` 谓词（TAG/WINDOW 受众，`matchesAudience()`）、cheapest 取最低费、configHash 冲突门、OPS_OFFICER 48h 审批；binding 表已退役（見下条，非仍在用）。以下为 V3 剩余需求。

- [x] ~~**受众谓词引擎**：现状仅 `isDefault` + binding 表两种受众；V3 要求 level 挂 `{ requiredTags: string[], window?: [validFrom,validTo] }`，成交时 `(窗未设∨now∈窗)∧(requiredTags⊆客户标签)` 判命中。含 WINDOW（限时活动，超窗自动失效）+ TAG（VIP/新客/白名单）两型新增~~ **已兑现（2026-07-12，worktree-fee-audience）**：两 level 表加 `requiredTagsJson`/`validFrom`/`validTo`，共享 `matchesAudience()` 判定 util（TDD），`resolveBestLevel` 改走该谓词（两域）｜来源: 2026-07-11 费率 V3 §3.4/§5.2
- [x] ~~**客户标签求值器 `effectiveTags(customerId, now)`**（依赖《客户管理》，未建）：返回 静态标签 ∪ 派生标签，供费率成交时消费。费率域只声明"要什么标签"，不定义"客户带什么标签"~~ **已兑现（2026-07-12，worktree-fee-audience）**：`CustomerTagService.effectiveTags()` 已建，返回 静态标签(explicit) ∪ 派生标签 ｜来源: 2026-07-11 费率 V3 §5.3
- [x] ~~**派生标签读时算（免定时器）**：如 `NEW_CUSTOMER = (now−起算日)≤newCustomerDays`（起算日=onboarding 完成/首次可交易日）；铁律=时间/行为衍生标签一律读时现算、**禁 cron 落标签再清**（防 staleness 错价）；到期通知走一次性定时、与价格判定解耦~~ **已兑现（2026-07-12，worktree-fee-audience）**：`NEW_CUSTOMER`/`VIP` 已在 `effectiveTags()` 内现算（读时判定，无 cron 落标签），无到期通知子项 ｜来源: 2026-07-11 费率 V3 §5.3
- [x] ~~**binding 表退役 + 迁移**~~：**已兑现（2026-07-13）**。删 `withdrawal_fee_level_bindings`/`swap_fee_level_bindings`（两表两域对称，drop 迁移 `20260713174411_drop_fee_level_bindings`）+ 4 个 binding service/workflow 文件 + 两 controller 的 bind/unbind/list-bindings 路由 + module providers/exports + 审计常量（`*_FEE_LEVEL_BINDING` 实体/工作流类型、`LEVEL_BOUND/UNBOUND` 治理动作）+ rbac catalog 6 条 binding 路由 + 前端两 fee-level 详情页「Customer Bindings」面板/「Bind Customer」弹窗。worktree DB 实测 binding 表本就 0 行，**无数据需迁移**（"指定客户"此前从未真正用过 binding，已直接由客户标签白名单表达，见 B1-B4）；main DB 未受影响（binding 表暂留，随下次合并一并清）｜来源: 2026-07-11 费率 V3 §5.4 → 2026-07-13 Task C 收口
- [ ] **报价落"资格快照"**：现 quote 仅存 `policyRef=LEVEL:code`；V3 要求成交时落 命中集合 + 选中级 + 选中理由(最低费) + 客户此刻标签快照（可解释/可申诉）｜来源: 2026-07-11 费率 V3 §4.4/§5.5
- [ ] **⚠待定：受众（requiredTags/window）变更口径**：现变更流只覆盖 `tiersJson`（configHash 保护费率本身）；受众字段变更是否也走 configHash + 审批链未定 ｜来源: 2026-07-11 费率 V3 §4.2
- [ ] **费率变更 30 日历日生效闸 + 通知客户**：现即改即生效；与提现/兑换 backlog 的 30 日闸同源（MC II.A.7/8），费率治理统一落 ｜来源: 2026-07-11 费率 V3 §1.2
- [ ] **待决策：cheapest 只减免不加价**：命中集合取最低费 → 更贵的级永不胜出；若将来要"VIP 必走 VIP（即便更贵）"或高风险客户加附加费，须改**优先级选级引擎**（V3 明确不做，留此账）｜来源: 2026-07-11 费率 V3 §5.5

## 待决策（等业主拍板）

- [x] ~~**限额执行接入 vs 明示退役**：表和审批管道已建，执行侧零消费~~ **已了结（2026-07-16 transaction-limits）**：旧 `governance/transaction-limits` 模块 + `TransactionLimitPolicy`/`TransactionLimitChangeRequest` 两表退役（migration `20260716092727_drop_transaction_limit_policies`）；新 `transaction_limit_rules`（A 单笔 / B 等级累计 / D1 大额审批 三 gateType）L1 接入提现 + 兑换（A/B 建单前拦截、D1 读规则行）｜来源: 2026-07-03 V3 体检 → 2026-07-16 执行
- [ ] **金额闸门矩阵**：tier 限额 + 大额审批 20 万 + TR 阈值 3,500 三线合一后再统一接入 L1（避免接完旧表又改）｜来源: 限额重设计 + TR 调研（roadmap V3 ADVANCED）
- [ ] **客户 TB 账户创建策略**：补事件驱动异步创建 or 认可懒加载 + 补文档 ｜来源: 2026-07-03 V3 体检
- [ ] **InternalFundAuditLog 有读无写**：Round 2 后零写入方，详情页审计列表永远空——补写状态变更 or 改读中央审计日志 ｜来源: 2026-07-03 死码 D6 改判（勿删表，有活读取链）
- [ ] **资金单合并可行性**：payin/payout/internalfund 状态机近同构，可评估进一步合并 ｜来源: Round 2 遗留
- [ ] **单笔金额级冻结原语（交易风控 L3 前置依赖）**：已终态充值/兑换订单命中行为监测（L3）需冻结"对应金额"，现仅有客户级整体冻结（V2 冻结流），无 TB 层单笔金额锁定/冻结子账户原语；交易风控 L3 落地前须先建（提现无此需求——钱已出只管人）。设计见 `superpowers/specs/2026-07-12-transaction-risk-gates-design.md` §5/§7 ｜来源: 2026-07-12 交易风控三闸门 spec（业主定 deferred，不纳入本 spec）

## 疑似幽灵按钮（红色，需查证）

- [ ] `CustodianWalletDetail.tsx:182` 用 `INTERNAL_COLLECTIONS_RECONCILE` 权限控制按钮，指向已删端点 ｜来源: 2026-07-03 死码体检
- [~] Wave8OpsDashboardPage 首页调已删 `/admin/reimbursement-obligations`（404 空转）｜已生成修复卡片 task_c9112015

## 文档漂移（随 roadmap 全量重排处理）

- [~] roadmap **V3/V4 已按三层新格式重排 + truth 外置**（2026-07-03）；V1/V2/V5-V9 待同款处理
- [ ] `frontend-admin.md` AuditLog sidebar 字段表仍列 `triggerType` 幽灵字段（后端已删该列）｜来源: 2026-07-03 体检 ｜已生成卡片 task_6d29bd5c
- [ ] `audit-logging.md` Query Contract 要求 detail 返回 `subjectNos[]`，但 `audit_log_subject_nos` 表 2026-05-19 已删 ｜来源: 2026-07-03 体检
- [x] ~~roadmap V8 节 recon:gen 已退役但文档仍提~~（已随重构收口）

## 安全守卫（已生成卡片，跟踪落地）

- [ ] 提现后端补提现地址 ACTIVE 校验（绕过前端可用任意地址提现）｜卡片 task_20678a2c ｜来源: 2026-07-03 V3 体检
- [ ] 充值"已记账不可直转终态"守卫（回退分录未实现前，拦住对已入暂扣充值的拒绝）｜卡片 task_16af8187 ｜来源: 2026-07-03 V4 体检
- [ ] **`DepositTransactionsController` 兄弟 admin 端点缺 `assertAdmin` 授权洞（PRE-EXISTING，早于 deposit-min）**：`AdminPermissionGuard.canActivate` 对非 ADMIN token 直接 `return true`（NO-OP），控制器需各 admin 路由自己调 `assertAdmin(req)` 才真拦。`GET /deposit-transactions`(findAll)、`GET /deposit-transactions/export`、`PATCH /deposit-transactions/:id/status`(updateStatus) 三个端点均缺此调用 → **今天客户 token 即可列出/导出全部客户的充值、乱推状态机**（越权读他人数据 + 篡改）。本轮仅修了新增的 `POST :id/waive-limit`（已加 assertAdmin）；这三个同源兄弟洞属既存债，需一次 DepositTransactionsController 全量硬化补齐（对齐 `withdraw-transactions.controller.ts` 每路由 assertAdmin 模式）｜来源: 2026-07-16 D5 review

## 交付 / 可移植 Docker（2026-07-04 本会话新增）

- [ ] **`scripts/stack.sh up`(self) 端口连锁失败**：admin/client 端口被上次会话遗留 vite 占着时，`ensure_port_free` 在 `set -euo pipefail` 下返回非零 → **整脚本中止、永不走到重建/重启 backend**（即便 backend 端口本身空闲）；与 CLAUDE.md「每次 up 自愈 .env / 重建后端」描述不符，导致实现者被迫手起 `node dist/main`。规避：`lsof -ti:<端口段>|xargs kill` 释放残留再 up。修法：`ensure_port_free` 命中占用改为 kill 残留后继续、或各服务独立处理不整体 `set -e` 退出 ｜来源: 2026-07-12 费率受众 worktree 执行（C + 验收两轮实现者各撞一次）

- [ ] **`scripts/on-stack.sh self <script>` 跑 `ts-node` 脚本时 `node_modules/.bin` 不在 PATH → `ts-node: command not found`**：经包装器跑 ts-node 类脚本（如 demo-lib/单脚本）时报错。规避 = 直接 `DATABASE_URL=... TB_ADDRESS=... npx ts-node -r tsconfig-paths/register scripts/<x>.ts`。修法：包装器把 `node_modules/.bin` 前置进 PATH（或统一用 `npx`）｜来源: 2026-07-16 transaction-limits（费率受众 worktree 亦曾遇，与本节上一条 stack.sh self 同源工具债）

- [ ] **launch.json 治理（待决策）**：`.claude/launch.json` 全机器专属绝对路径 + 预览工具自动重生成 stale 配置（settle-opt/claude-admin 反复回填）；已经 `.gitattributes` export-ignore 不进交付包，但仍被 git 跟踪。待决策：gitignore 停止跟踪、交预览工具本地生成 ｜来源: 2026-07-04 可移植 Docker
- [ ] **Docker `tb-format` 非幂等**：重跑演示需先 `docker compose down -v` 清账本端数据卷（否则 format 撞已存在文件报错）；可给 format 加 if-missing 守卫做到重跑免 down -v ｜来源: 2026-07-04 Docker 交付
- [ ] **Docker Desktop Mac 4.42+ io_uring 风险留账**：新版 Mac 版可能 VM 级封 io_uring，`seccomp=unconfined` 也救不回 → 退 OrbStack（已写进 `READ-ME-FIRST.md`，此处备查）｜来源: 2026-07-04 Docker 交付
- [ ] **泄露 dev `.env` 仍在 git 历史**：`.env` 已 `git rm --cached`（合 c80ce5e）+ 本地换新 MFA key 作废旧值；旧值仍留在历史（用户选不重写历史，属 demo key）。若确认该 key 曾用于任何真实用途，需重评是否 filter-repo 抹历史 ｜来源: 2026-07-04 一级审计
## demo / 对账脚本（canon2 收尾）

- [ ] **demo:all 充值 5/6 + `demo-lib.ts` 未建 trading-ready 法币地址**（PRE-EXISTING，非金额限额 feature 引入）：交易起始前置门落地后（61337fb2），demo 客户在充值前需先有 ACTIVE 法币提现地址，但 `scripts/demo-lib.ts` 从未跟进创建（其末次改动 4c27f1ff 早于该门）；main 栈 DB 仅因人工种过 4 个地址才过。**全新 DB 跑 demo:all，充值会挂 COMPLIANCE_PENDING**。即便种了地址，demo:all 仍稳定在 **7/8（充值 5/6）**——有一笔充值因与金额限额无关的充值流原因始终不 SUCCESS（提现 5/5 + 兑换 3/3 + COA 4/4 全过；本轮金额限额门未拒任何单）。需单独 demo-setup 修复（`demo-lib.ts` 播种 trading-ready 法币地址）+ 排查第 6 笔充值卡因 ｜来源: 2026-07-16 transaction-limits 回归跑
- [x] ~~**`on-stack.sh` 不把 `node_modules/.bin` 放进 PATH → 所有 ts-node 脚本必挂**~~ —— **已修（2026-07-28）**：`scripts/on-stack.sh` 用 `exec env ... bash -c "${clean}"` 直接执行 npm script 体，绕过了 npm 注入 `node_modules/.bin` 到 PATH 的机制；而 `ts-node` 只装在本地 `node_modules/.bin`（全局 node 18/20 均无），故 `on-stack.sh main demo:all` / `verify:coa` / `recon:demo` / `db:base:sync` 一律 `ts-node: command not found`。修法＝`exec env` 里前置 `PATH="${APP_DIR}/node_modules/.bin:${PATH}"`；已用不含 `node_modules/.bin` 的干净 PATH 复测 `verify:coa`（ALL INVARIANTS PASS）+ `recon:demo --mode=pass`（status=PASS，参数透传正常）｜来源: 2026-07-28 合并 feat/transaction-limits 回归跑
- [ ] **`demo:all` 提现 5/6 的另一成因＝`demo:in-transit` 故意留的在途单**（PRE-EXISTING，非回归）：`demo-in-transit.ts` 的用途就是造"真实卡在半路"的在途单（法币 AED，金额区间 `[500,999]`，止于 `PAYOUT_PENDING`），供对账演示用；一旦跑过，该单永久留库，`demo:all` 的「全部 demo 提现须 SUCCESS」断言就会稳定挂掉（main 栈现存 `WD2607221329`，AED 500，2026-07-22 创建）。这与上一条「充值 5/6」是**两个不同成因**。修法＝断言排除带 `DEMO_STUCK_WD_REF_PREFIX` 的在途单，或 demo:all 前先跑一次 `recon:demo`。**实测机制**（2026-07-28）：`recon:demo` 的 self-clean 会连带清掉该 in-transit fixture（日志 `self-clean: ... fundsOrders=1`）——同一库上 demo:all 先跑是 **7/8**（提现 5/6），跑完 recon:demo 后再跑即回 **8/8**。故 demo:all 的通过与否取决于此前有没有人跑过 demo:in-transit 而尚未跑 recon:demo，**结果不稳定、不宜直接当验收信号** ｜来源: 2026-07-28 合并 feat/transaction-limits 回归跑
- [ ] **`recon-demo.ts` MANIFEST_PATH 写死 main tmp**：默认 `/tmp/exchange_js_main/recon-demo-manifest.json`（可 `RECON_DEMO_MANIFEST_PATH` 覆盖）；self 栈跑 `recon:demo:break` 时 manifest 落 main 栈 tmp、非本 worktree tmp。不影响评分（verifyManifest 读内存 manifest 对象、不回读文件），仅文件落点跨栈。修法：默认按 `DATABASE_URL` 派生 tmp 目录，或 on-stack 包装器注入 `RECON_DEMO_MANIFEST_PATH` ｜来源: 2026-07-04 canon2 T5 code-review（M2）

## 账本流水（2026-07-10 本会话新增）

- [x] ~~**账本流水未排除 pending（「落账才进流水」）**~~ —— **撤销（2026-07-12）**：业主改定 **pending 也进流水**为正确口径——挂起（pending）阶段即落一行流水（`transferType=PENDING`），落账后同一行转 POSTED，流水实时反映「在途 / 锁定」的进出。原「流水只体现 posted、pending 不进」的排除需求**作废**；投影器 `account-flow-projector.persist()` 现行为（pending＋posted 都投影）即为**目标态**，无需改。已同步飞书账本 PRD §5.3「流水怎么展示」 ｜来源: 2026-07-12 账本 PRD §5.3 校正（推翻 2026-07-10 §6 的排除口径）

- [ ] **提现 eventCode 去阶段化（向 swap 看齐）**：提现两步腿现发 `WITHDRAW_LOCK_NET` → `WITHDRAW_NET_POST`（`tb-evidence.service.ts → enrichForPost()` 落账时把 eventCode 从 LOCK 改成 POST），把阶段塞进了 event 名。目标口径（账本 PRD 附录 B 已采用）＝**一笔分录一个稳定 event、阶段交给 `transferType`（PENDING/POSTED/VOIDED）**，如 swap 的 `SWAP_SELL_CLIENT` 全程不变。落地＝提现净额/费腿 eventCode 合并为 `WITHDRAW_NET` / `WITHDRAW_FEE`（去掉 LOCK/POST/VOID 后缀），`enrichForPost` 不再改 eventCode。deposit/swap 已是干净模型、无需改。业主 2026-07-12 定（甲：PRD 写应然、代码待对齐）｜来源: 2026-07-12 账本 PRD 附录 B（对应模块 8 · G2）

## 对账（2026-07-06 V8 遗漏审计）

- [ ] **对账钱包枚举由 external_balances 驱动、缺外部快照的客户钱包静默漏对** — `wallet-recon-run.service.ts` 的 run 钱包遍历以 external_balances 行为键；某客户钱包当天缺外部快照即被**静默跳过**、不进对账也不报异常，"full list" 完整性靠外部数据源自觉而非内部账户名册驱动。修法：以内部客户钱包名册为枚举源、外部缺行标 MISSING_EXTERNAL 而非跳过 ｜来源: 2026-07-06 V8 遗漏审计（对抗核验读代码逮到）

## 对账应然设计 gap（2026-07-12 target design）

> 来源统一：spec `superpowers/specs/2026-07-12-reconciliation-flow-target-design.md`（对账标准 6 步 × 平台落地）§8 gap 表 + §9 留空。检测主干（恒等预门 / 前 4 桶 / 逐钱包快照 / 在途推单+自愈 / 审计留痕）已对齐应然；以下为差距。VARA 派生欠账（重大差异通报 / ≥8 年留存 / 月账单）按台账规矩不入本文件，见 roadmap ⚖️ ADVANCED。

**工程正确性**

- [ ] **外部账单摄入生产管道未做**：银行/HexTrust/链账单的拉取+清洗入库无生产实现，`external_balances`/`external_statement_lines` 仅 demo 脚本注入、引擎只读 ｜来源: spec §2.2/§9
- [ ] **外部未清洗成 canonical 同构模型**：外部存独立表、匹配时才取公共字段归一；应清洗成与 `account_flow` 同字段/同单位(分)/同方向语义的 canonical 流水模型（字段清单见 spec §2.3）｜来源: spec §2.2 决策2
- [ ] **流水 match tag 结转未做**：行项每 run delete-then-insert 全量重配、无持久行状态；应 Reconciled 冻结踢出、只对未决+新增。上文「reObservedCount 恒为 0」是无持久行状态的同源症状。⚠ **落地时字段名用 `reconciliationStatus`（Reconciliation Status，业主定名），枚举 `Open / Reconciled / In-transit / Exception`**（PRD §5.2 已定，勿再叫 tag / UNRECONCILED / OPEN_EXCEPTION）｜来源: spec §0.5/§3.2 + 2026-07-13 PRD 命名
- [ ] **余额字段用法未约束**：内部 `balanceAfter` 回填补账后不自动重算 → 陈旧；对账内部数字应从账本现算(TB/Σflows)、balanceAfter 仅交叉校验(断言 ==Σ流水)；外部收盘余额可直用 + 逐笔余额查账单缺行 ｜来源: spec §2.5
- [ ] **effectiveDate 语义待核**：应 date(价值日) + 独立 createdAt(datetime) 两字段两用途；需核 `effectiveDate` 是否 date-only、截止边界卡点是否用 createdAt ｜来源: spec §2.4

**防假 break**

- [ ] **数据完整性闸 + HELD 态未做**：无"数据到齐才对"闸、无 `HELD`(待外部数据)态；即时轨道周末结算 / 账单延迟会被误判假 BREAK（结算轴 ≠ 上报轴）。与 2026-07-06「external_balances 驱动静默漏对」同源（该条=现状症状、HELD=应然解）：应以内部钱包名册枚举、缺外部数据标 HELD 而非跳过/硬对 ｜来源: spec §2.6
- [ ] **恒等校验未左移**：仅日 run 预门 + 手动 `verify:coa` 脚本；应 CI / 每次记账后断言镜像恒等，从源头拦（日 run 是最后一道网、非唯一）｜来源: spec §1.3
- [ ] **INTERNAL_BREAK run 详情误显示空表**：预门破时 `walletCount=0`/空表 → UI 显示成空/像干净(危险)；应专门呈现恒等破裂明细(按币种 资产合计/负债合计/差额) + "逐钱包未执行"提示；数据已被预门 breaks[] + 审计捕获，缺前端呈现 ｜来源: spec §1.4

**治理闸**

- [ ] **aging + SLA + 超期升级未做**：Case 止于 OPEN 仅自愈；应按账龄计时、超 SLA 升级 MLRO/CFO。in-transit 若结算信号永久丢失(webhook 漏)且无人推则**永不自愈=死结**，aging 是防死结的闸 ｜来源: spec §5/§6
- [ ] **对账复核签核未做**：应干净 run 自动认证 + 人工平账动作走复核签核(maker-checker 推≠批，可按 severity 分级)；复核挂"人工干预动作"、非挂"run 变 pass"。与「平账处置」推单读权限门控债协同(那条=权限粒度、本条=两人复核)｜来源: spec §6
- [ ] **真差异(BREAK)处置闭环未做**：7 平账动作只做推单，补单/冲正/冲销/豁免/偿付 deferred；SOFT_FLAG 里"真两侧对冲错"的调账同 deferred(matcher 调优部分不算)；Finance 人工核实→结案 deferred ｜来源: spec §9

**⚠ 待决策（等业主拍板）**

- [ ] 法币轨道是否即时到账（决定非营业日走 HELD 等账单 vs 结转收盘判 MATCHED）｜来源: spec §10
- [ ] aging SLA 阈值（法币 ≥1 银行日 / 链按确认窗口）具体数值 ｜来源: spec §10
- [ ] 人工平账 maker-checker 是否按 severity 分级审批人（v1 可扁平：一律一道复核）｜来源: spec §10
- [ ] 恒等左移落点（CI 断言 / 每次记账后同步断言 / 高频轻量 cron）｜来源: spec §10

**对账 PRD 重写范围决策（2026-07-12 业主拍板，doc WOaEds8s）**

> 本期对账聚焦「正常业务会出现的问题」＝时间差（在途）：检测 + 自愈 + 同步腿推单。所有"异常/真差异"侧本期不做。以下为据此决策产生的 defer / 代码改名账。

- [ ] **INTERNAL_BREAK 全链本期不做**：内部恒等检测+中止代码已在（`wallet-recon-run.service.ts → computeInternalIdentity()` 预门），但事故界面（见上「INTERNAL_BREAK run 详情误显示空表」）/ 实时告警 / 收敛冻结 / 受控更正 workflow / 恒等左移 全部 defer；**对账 PRD 显式不体现 INTERNAL_BREAK 作为 run 结果**（run 结论只留 对平 / 有差异两态）｜来源: 2026-07-12 PRD 重写 Q3
- [ ] **五桶命名 SOFT_FLAG→COMPENSATING 代码改名**：PRD 已改用专业名 `COMPENSATING`（抵销错误）；代码仍 `SOFT_FLAG`（`engine/v2/bucket-classifier.ts` `ReconBucket`、`dto/reconciliation.dto.ts` `ReconWalletBucket`+`ReconCaseQueryDto.bucket` `@IsIn`、`reconciliation_cases.bucket` 列值、前端徽章）。`HELD→AWAITING`（待外部数据）未进码、随 HELD 落地直接用新名 ｜来源: 2026-07-12 PRD 重写 Q4
- [ ] **人工腿推单 + BREAK/异常处置 = 本期非目标**：本期只交付**同步腿推单**（外部回执验证、免审批）；人工强推腿（`push/manual` + `ManualPushDto`，代码已在）、真差异/异常处置本期不作为交付/验收范围 ｜来源: 2026-07-12 PRD 重写 Q1
- [ ] **新增 CFO 角色**：PRD 加 `CFO`（财务负责人，差异升级 / 财务终审接收方，相关处置动作多为后续）；可经自定义角色造，代码 `rbac.catalog.ts` `RBAC_ROLE_DEFINITIONS` 待注册 ｜来源: 2026-07-12 PRD 重写 Q2
- [ ] **Run 结果字段枚举待重命名**：`reconciliation_runs.invariantStatus`（PASS/FAIL）语义像生命周期状态、且外部 break 也写 FAIL（与"内部恒等"名不符）；PRD 拟结论字段用 `RECONCILED / EXCEPTIONS_FOUND`（对平 / 有差异）。代码字段名+值待随之调（与 `status` RUNNING/COMPLETED/FAILED 两轴分清）｜来源: 2026-07-12 PRD 重写 Q5
- [ ] **流水匹配去掉第二轮"无据模糊配对"（业主拍板·甲）**：PRD §4 步骤3 只保留 精确对号（externalRef 相等）+ 认在途（配非终态资金单）两轮；代码 `wallet-flow-matcher.service.ts` 仍有 **Pass2 金额+方向+时间窗（默认 60min）模糊匹配** → 无参考号即凭"金额凑巧一样"下配平结论，有假配平掩盖真差异风险。应移除 Pass2（或降级为"疑似待人复核"、不直接算 MATCHED）。⚠ 移除前评估法币无号入金的覆盖影响（应落到孤儿→开 case，可接受）｜来源: 2026-07-13 PRD §4 细化，业主选甲

> 注：外部合规派生的欠账（VARA/FATF 条款驱动，非本 repo 可核）不入本文件——它们活在 roadmap 的 ⚖️ ADVANCED 条目里。BACKLOG 只记能对着本仓库代码/文件自证的账。
