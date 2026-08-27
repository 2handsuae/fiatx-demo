# 业务缺口台账

> **只登记业务缺口**：某流程 / 某页面 / 某状态在演示里缺、讲不圆、显示错。
> 技术兜底（幂等 / 守卫 / 并发 / 迁移 / 测试框架 / 死码…）记 `PRODUCTION-NOTES.md`，**不在此处**。
> 一行四要素：是什么 ｜ 哪来的 ｜ 落点 / 状态。做完就勾掉。
> 2026-08-26 分流：加固类条目已迁 PRODUCTION-NOTES；分流前全文见 git 历史（db01f280）。

Last Updated: 2026-08-26

## 演示/测试环境卫生（2026-08-13 A1-A6 收官实跑发现，均为既存问题非本轮引入）

- 公司 AED 浮存未预铺：demo:all（含法币提现）跑完后 verify:coa 负余额断言必红 2 项（A.FIRM_ASSET / E.FIRM_OPS 被提现打穿零）｜ 2026-08-26 站1b-β 收尾闸实测定位，基线绿的测点是重铺后立即 ｜ 落点：demo:setup 给公司预铺法币浮存，或负余额断言按科目性质分层

> 来源统一：`superpowers/plans/2026-08-13-deposit-withdraw-a1a6-coa-cleanup.md` T11 收官验收。
> 这批是"跑一次干净验收"路上被绊到的坑，逐个记账，免得下次再花一轮排查。

- [x] **`db:biz:reset` 不重置 TigerBeetle → 重铺后 COA 恒等式必然破**（✅ 2026-08-26 Step 0 已解：`stack.sh reset [main|self]` → reset-stack.sh 补齐 TB 清理重建段，main 栈全链实跑验证、verify:coa 全绿）：reset 清 Prisma 行 + `tbAccountRegistry`，`db:biz:init` 再建时**客户级**科目（`CLIENT_PAYABLE`/`DEPOSIT_SUSPENSE`，按新客户 UUID）拿到全新 TB 账户余额归零，而**系统级**科目（`CLIENT_ASSET`/`FIRM_*`，四元组不含 ownerUuid）解析到**同一个** TB 账户、余额从上一轮累加。实测：重铺后再跑 demo，`CLIENT_ASSET` 是负债侧的 2 倍多。当前唯一干净做法＝`stack.sh down` → `rm -rf /tmp/exchange_js_wt_<名>` → `stack.sh up`。建议给 self 栈补一个等价于 `reset-main` 的入口（连 TB 数据文件一起清）｜来源: 2026-08-13 T11
- [ ] **全新栈跑 `demo:all` 缺提现地址前置**：`db:biz:init` 与 `demo:setup` 都不建 `withdrawal_addresses`，而 2026-07-11 上线的 trading-ready 闸要求客户有 active 法币提现地址 → 全新栈上 `demo:all` 必卡在第一笔充值（`Trading-ready gate hold`）。main 栈上那 8 条是历史手工建的。建议 `demo:setup` 补建（法币按客户 `C_VIBAN` 的 IBAN、虚拟币按 `T+sha256('DEMO'+'wd'+idx)[:33]`，即 `demo-lib.ts → runWithdraws` 实际使用的值）｜来源: 2026-08-13 T11
- [ ] **`scripts/verify-demo-data.ts` 已坏一个多月、且挂在 seed 的 post 钩子上会打断 `reset-main`**：`scanR1()`（第 47 行）读 `prisma.internalFund`，而 `InternalFund` 表早在 **2026-07-02 funds_orders 三合一**里就 DROP 了（全库只剩 `InternalFundAuditLog`），故必抛 `TypeError: Cannot read properties of undefined (reading 'findMany')`。它被 `db:seed:business` 的 post 钩子调用 → `reset-main.sh` 因 `set -euo pipefail` 在收尾前中断（数据其实已经铺完，只是不打印 "business reset complete"，容易被误判成重置失败）。修法二选一：把 R1 规则改读 `fundsOrder`（语义等价，父 FK 判 swap/withdraw 那段逻辑可直接沿用），或整个退役该脚本（`demo:all` 自带 end-state 断言，覆盖面更全）｜来源: 2026-08-13 main 栈重置实跑

## 技术债 — V4 充值

- [~] Admin PATCH deposit status 部分绕过 workflow：仅 SUCCESS 被 `DEPOSIT_APPROVE_WORKFLOW_ONLY` 守卫，FREEZE/CONFISCATE 可绕过记账与审计 ｜来源: 2026-07-03 V4 体检 ｜✅ **2026-07-17 CONFISCATE 部分已关**——`CONFISCATED` 已加入 `deposit-transactions.service.ts → updateStatus()` 的 `ACCOUNTING_TERMINALS` 工作流专用守卫（isAdminApi PATCH 到 CONFISCATED 抛 `DEPOSIT_APPROVE_WORKFLOW_ONLY`；executeConfiscation 非 ADMIN_API 路径不受影响，单测 `blocks ADMIN_API from directly reaching CONFISCATED` 锁定）。**剩 FREEZE 部分未关**（FREEZE 无 TB 记账、危害较小，但仍应统一治理化，留账）｜✅ **2026-07-28 终审 Fix 3 再关一批**——`deposit-transactions.controller.ts → updateStatus()` 的 `default` 分支加 controller 层 allowlist：`resume`（绕过 A2 MLRO 解冻审批）/`seized_done`/`returned_done`/`confiscate_settle`（直跳终态、让 pending 锁永不结算）四个 workflow-only action 直接 `BadRequestException`（code `DEPOSIT_ACTION_WORKFLOW_ONLY`）。**`freeze`/`return`/`seize`（三个 start 动作）仍未收窄**——裸 PATCH 仍可把 deposit 推进 `FROZEN`/`RETURNING`/`SEIZING` 但不建对应 legSeq 资金单、不 pending 锁账，留作后续任务（同一类问题，只是这次只挑了业主明确点名的四个终态/审批绕过项）
- [ ] KYT 超时转人工未做 ｜来源: roadmap V4
- [ ] 充值挂起（`DEPOSIT_HELD_NOT_TRADING_READY`）无自动重驱：客户补齐法币地址后，挂 COMPLIANCE_PENDING 的充值不会自动重跑 checkAutoApproval → 需 hook `ADDRESS_ACTIVATED` 重驱该客户挂起充值，否则要人工 ｜来源: 2026-07-11 Task 4b
- [ ] **DEPOSIT 累计限额（CUMULATIVE gateType B）仍未接**：本轮只接了 SINGLE 单笔下限，`transaction_limit_rules` 的 B 档（tradingTier×period 累计）尚未对 DEPOSIT operationType 消费 ｜来源: 2026-07-17 deposit-min 收口复核
- [ ] **BELOW_MIN 计次自动冻结未做**：同客户多次触发 below-min 挂起累计到阈值后自动转 FROZEN（防试探式小额充值绕限额）未实现，本轮只做单笔挂起+人工处置 ｜来源: 2026-07-16 deposit-min spec §8（deferred）
- [ ] **自动没收 cron 未做**：BELOW_MIN 挂起超时后自动发起没收（现只能 ops 手动点 Confiscate）未实现 ｜来源: 2026-07-16 deposit-min spec §8（deferred）
- [ ] **充值详情页通用 Actions 组在终态仍全显（pre-existing）**：`DepositTransactionDetail.tsx` 的通用 Approve/Freeze/Resume/Expire/Reject/Confiscate 组当前仅对 below-min 挂起 + 没收生命周期(CONFISCATING/CONFISCATED)隐藏；**SUCCESS/FROZEN/REJECTED 等其它终态仍全显 6 个按钮且可点**（点了会被后端状态机/治理守卫拒，非资金安全问题，纯 UX 误导）。根因=该组无"终态即隐藏"门控（D8 只加了 `!isBelowMinPending`，2026-07-17 没收轮补了 `!isConfiscationLifecycle`）。彻底修=按 deposit 是否终态统一门控通用组 ｜来源: 2026-07-17 没收异步 C5 实景截图发现（pre-existing，早于本分支）
- [ ] **CONFISCATING 结算耗尽重试后无手动重触发出口**：没收异步结算（`settleConfiscation`）失败自动重试 3 次仍失败则停 `CONFISCATING` + 记 `DEPOSIT_CONFISCATION_FAILED` 待人工介入（业主设计）。但资金单此时已 `CONFIRMED`（终态、不再发 `funds_order.status.changed`），且 `CONFISCATING` 状态机唯一出口是 `CONFISCATE_SETTLE`（由该事件驱动）、ADMIN_API PATCH 被 `ACCOUNTING_TERMINALS` 守卫挡 → **无 ops 可触达的重结算入口**。⚠️ 现实触发条件已收窄：`postPendingTransfer` 已幂等化（2026-07-17，赦免 `pending_transfer_already_posted`），故 leg1 成功/leg2 瞬时失败的 within-event 重试可自愈；仅"TB 持续宕机跨越全部 3 次重试"这一持续性故障才会真卡住（本地 TB demo 不可复现）。补法=加 admin `retry-confiscation-settle` 端点重调 `settleConfiscation`（幂等已就绪，安全可重入）｜来源: 2026-07-17 没收异步化对抗式复核 Finding 2
- [ ] **制裁没收（sanctions-confiscation）不在本轮范围**：本轮"没收"专指 BELOW_MIN 金额没收（T&C 手续费性质，OPS_OFFICER 单步审批）；FROZEN（制裁冻结）路径下的没收属 MLRO 合规域、走独立审批链（roadmap V4 ⚖️「制裁冻结完整闭环」P0），未随本轮触碰，FROZEN 状态机本身也未改动 ｜来源: 2026-07-16 deposit-min spec §8（deferred）
- [ ] **TR 适用判定未自动计算**：充值 PRD 定义 Travel Rule 适用 = 虚拟币 且 来源地址为 VASP 托管 且 单笔 ≥ 3,500 AED（三条件 AND，否则 NOT_REQUIRED）；现状仅条件①法币→NOT_REQUIRED 落地，条件②(hosted/unhosted VASP 分类，依赖 roadmap V3 地址打标)+③(3,500 阈值判定)**代码未自动计算** → crypto TR 结果当前由 demo 模拟端点注入 ｜来源: 2026-07-11 充值 PRD v2
- [ ] **充值自动侦测器未接**：链上 watcher / 银行 VIBAN webhook 未部署，`deposit-transactions.service.ts → detected()`（真实业务入口）当前**唯一**触发路径是客户申报入账信号 + 手动扫描（demo 脚手架，带 `simulationRisk*` 注入 + `QUICK_DEMO` 模式）；PRD happy path 按业务意图写"系统自动侦测"，落地待接真实侦测源 ｜来源: 2026-07-11 充值 PRD v2
- [ ] **充值审计事件改名 + 精简（8→6）**：PRD v2 定稿审计集去 `DEPOSIT_` 冗余前缀（workflowType 已标 DEPOSIT）+ 统一 `_APPLIED`→`_PASSED`（与展示词对齐）；并合并两对同刻冗余事件——`DEPOSIT_COMPLIANCE_STARTED`(并入 PAYIN_CONFIRMED) + `DEPOSIT_APPROVED`(并入 COMPLETED)；**并 GATE0→L1**（退役 `GATE0`/`Gate 0` 命名，统一 L1/L2/L3 口径：`DEPOSIT_GATE0_PASSED`→`L1_PASSED`、`runGate0()`→`runL1()`、日志 "Gate 0" 改 "L1"）。改 `audit-actions.constant.ts` + `deposit-workflow.service.ts`，须评估历史 `audit_log_events` 旧值兼容 ｜来源: 2026-07-11 充值 PRD v2（审计瘦身轮）+ 2026-07-12 三闸门命名统一


## 技术债 — 充值状态机·计划1 引擎（deposit-sumsub，2026-07-28）

> 来源统一：`superpowers/specs/2026-07-2x-deposit-state-machine-*`（KYT-only 架构，忽略 amlCase，靠规则折叠+自动重算）+ 12-task 实施计划。现状见 `truth/v4-deposit.md` §4.1/§4.2、`truth/sumsub-ingestion.md` §3。以下为本计划刻意延后到计划2 的功能块 + 落地中发现的欠账。

- [ ] **慢 case 自动重算未端到端验证**：KYT-only 架构的根基假设——客户/officer 处置慢 case 后，Sumsub 自动重算并补发 `applicantKytTxn*`（S4/S7 场景据此设计：ACTION_PENDING/MANUAL_CHECKING 补料或翻案后无需专门 action handler，靠重评 webhook 自动推进）——沙盒环境逼不出真实的"慢 case 重算"时序，Task 12 e2e（`test/deposit-sumsub-scenarios.e2e-spec.ts` S4/S7）只能用 fixture 直接喂第二个 webhook 断言，不是对真实 Sumsub 异步重算的端到端验证。上线前需拿真实 applicant 走一次真慢 case 验证 ｜来源: task-13-brief

## 技术债 — 充值仿真裁决按钮 + 小额充值流程改造（deposit-sumsub，2026-07-31）

> 来源统一：`superpowers/specs/2026-07-31-deposit-verdict-buttons-and-below-min-flow-design.md` + `superpowers/plans/2026-07-31-deposit-verdict-buttons-and-below-min-flow.md`（9-task 实施计划）。现状见 `truth/v4-deposit.md` §2/§4.5/§5/§10。8 个多步场景剧本（`fixtures/scenarios.ts`，已删）收敛为 9 个单步裁决按钮（`fixtures/verdict-buttons.ts`）；below-min 挂起从 `COMPLIANCE_PENDING` 内嵌判定拆成独立状态 `OPERATION_PENDING`；金额闸从 `checkAutoApproval()`/`applyKytApproved()` 各自入口下沉到 `approveDeposit()`（充值记账唯一出口）。

- [ ] **按钮 ⑨（SLA breach）与真实 SLA 定时器取证痕迹不一致**：⑨ 只是投一份 `applicantKytTxnRejected` + `SLA_BREACH` tag（与 ⑦"无处置 tag"走同一条 `applyKytRejected` 分支，落 `MANUAL_CHECK`/`DEPOSIT_MANUAL_CHECKING`），并不真的驱动 `DepositSlaService` 的 cron 扫描/`slaDeadline` 过期判定——旧场景模型（`S9_ONHOLD_SLA`）是真拨 `slaDeadline` 到过去、再触发 `checkSlaBreaches()` 走 `DEPOSIT_SLA_BREACHED` 系统审计；新按钮模型为换取"单步即完成"的仿真简洁性，代价是 operator 点 ⑨ 看到的审计/报文痕迹与真实 SLA 超时触发的痕迹不完全一致。业主已知情，暂不处理 ｜来源: 2026-07-31 Task 4 final-review triage Minor②
- [ ] **翻案（MANUAL_CHECKING→approved）/below-min 放行（waive）后，原命中证据被最新报文覆写，无历史留档**：`sumsubTxnDetailJson`/`sumsubVerdict`/`sumsubScore` 是单列"最新一次"存证（乙口径，后盖前，见 `truth/v4-deposit.md` §4.4 历史记录），一笔曾被 `rejected`（如命中 PEP/制裁 tag）过、后来翻案/补料通过的单，一旦收到新的 `approved` 裁决，旧的命中证据（`matchedRules`/`typedTags`/`score`）整份被覆盖——仅从当前状态/报文看不出这笔单历史上曾命中过什么规则，对事后合规复盘/审计取证不利。业主未给口径（要不要留历史版本、还是只留最新一份即可），暂不处理 ｜来源: 2026-07-31 Task 4/Task 9 code 走查
- [ ] **单缺 `sumsubApplicantId` 时 Gate 0 跳过提交，之后仿真按钮喂的 webhook 成静默孤儿**：`submitSumsubTxns()` 在 `customer.sumsubApplicantId` 为空时只 warn + 跳过（deposit 留 `COMPLIANCE_PENDING`，`sumsubTxnId` 恒空）；此时若 operator/demo 仍对这笔单点了仿真裁决按钮，`DepositDemoScenarioService.runVerdict()` 会现铸一个 txnId 走完整 ingest 链路，并把结果原样返回（`statusBefore`/`statusAfter` 字段齐全，HTTP 层 201 不报错）——但这次投递对生产链路而言毫无意义（这笔单从未真正提交过 Sumsub，webhook 找不到匹配的真实报送记录）。旧的 `runScenario`（已删）同样存在该缺口，非本轮新引入的回归 ｜来源: 2026-07-31 Task 4 final-review triage Minor③


## 技术债 — 充值前端（F1-F8，2026-07-29 落地，Task 8 真机渲染验证发现）

> 来源统一：`superpowers/plans/2026-07-29-deposit-frontend.md`（F1-F8）+ Task 8 渲染验证。现状见 `truth/v4-deposit.md` §10。

- [ ] **Internal Approvals 深链只到列表页（新，2026-07-30）**：详情页 "Internal Approvals" 块点击只跳审批列表 `/admin/governance/approvals`，无法深链到具体审批单——因 `findOneForAdmin` 的 `approvals[]` 投影只 pick `{approvalNo,actionType,status,createdAt}`（业主定"仅单头"），丢了审批 case `id`；审批详情路由/列表筛选又都按 `id`/不读 `approvalNo` query。修法：投影补回 `id`（`id` 是 case 主键、非 step，不违背"仅单头不含 step"），前端深链 `/admin/governance/approvals/<id>`｜来源: 2026-07-30 Sumsub 详情增强 Task 6 review
- [ ] **补料 CTA 降级（F5）**：`client-web/src/pages/Deposit.tsx` 的 `ACTION_PENDING` 详情只能渲染静态"Please contact support"文案，无法深链到 Sumsub 补料页——后端 deposit 相关 DTO 未暴露 Sumsub SDK token / verification link 字段（`DepositWorkflowService`/`deposit-transactions.service.ts` 均无此类端点），设计 spec §3.C 期望的"引导客户去补料"CTA 因此降级为纯文本。修法需后端新增一个签发 Sumsub WebSDK 短时 token（或 verification link）的端点，前端才能接上真正的补料入口 ｜来源: 2026-07-29 Task 5 实施时已知降级
- [ ] **RBAC 非超管验证未做（F6）**：`POST /admin/deposit-sumsub/demo/run-scenario` 已在 `rbac.catalog.ts` 登记 `TRADING_DEPOSIT_WRITE` 权限，但 Task 6 只用 SUPER_ADMIN token 验证过（该角色走 `access-control.service.ts` 的硬编码 bypass，天然绕过权限表检查），未验证一个只有 `TRADING_DEPOSIT_WRITE`（或没有该权限）的真实自定义角色调用该端点时，权限门是否真的生效（需要 `db:base:sync` + 重启后端才能让新 RBAC code 对非超管角色生效，Task 6 报告已提醒但未做）｜来源: 2026-07-29 Task 6 报告遗留
- [ ] **`linkedFundOrders` 的 `kind` 把没收/退回/上缴三条弧全部误标成同一个 `CONFISCATION`（Task 8 真机渲染发现的真 bug）**：`deposit-transactions.service.ts`（约 L201）`isConfiscation = fo.legSeq != null && fo.legSeq > 1` 只按"是否 legSeq>1"二分，把 legSeq=2（没收动腿）/legSeq=3（**计划2·A3 退回**动腿）/legSeq=4（**计划2·A4 上缴**动腿）全部归为 `kind: 'CONFISCATION'`；前端 `DepositTransactionDetail.tsx:543` 相应把三者的 "Linked Funds Orders" 卡片全部渲染成 `Fee · Confiscation`。Task 8 真机渲染验证时在一笔真实 SEIZE（政府上缴）流程里截图证实：legSeq=4 的资金单被标成"Fee · Confiscation"，对 operator 是误导性文案（这是政府移交，不是没收手续费）。**渲染层已把关的其它维度不受影响**（状态徽章/门控/Sumsub 引用区/演示面板均正确，只有这一处 kind 标签是历史遗留，早于本轮但被本轮新增的 legSeq=3/4 弧放大暴露）。修法：`LinkedFundOrder.kind` 类型 + 后端判定逻辑改按 legSeq 精确映射（2→CONFISCATION，3→RETURN，4→SEIZE），前端 `cap` 文案随之加 `RETURN`/`SEIZE` 两个新分支 ｜来源: 2026-07-29 Task 8 真机渲染验证发现，按硬约束未修（渲染暴露的真 bug，停手报告）

## 技术债 — V3 财务配置

- [ ] 资本注入流水缺 evidence 行（`FIRM_ASSET` 流水缺资本那笔）｜来源: V8 redesign 遗留

## 技术债 — V5 提现

- [ ] **提现报价审计未落地**：报价流程（`WithdrawQuoteService.createQuote/consumeQuote/cancelQuote`）零打点——常量 `WITHDRAW_PRICING_QUOTE_CREATED/_USED/_CANCELLED`（entityType `WITHDRAW_PRICING_QUOTE`）已定义但 `withdraw-quote.service.ts` 从不调用（grep 实证 0 命中，该文件无任何 audit 引用）；对比兑换 `SWAP_QUOTE_CREATED/USED/CANCELLED` 已在 `swap-quote.service.ts:249/319/364` 落地。应补打 QUOTE_CREATED/USED/CANCELLED（workflowType `WITHDRAW_QUOTE`），与兑换对齐 ｜来源: 2026-07-11 提现报价单文档 v2 §4.1.3
- [ ] 热钱包余额校验无：Payout 前不查 Outbound Wallet 余额，不足不显式失败 ｜来源: 2026-07-03 V5 体检
- [ ] 提现成功通知未接：SUCCESS 时不调 `NotificationsGateway`（基础设施在、workflow 没调）｜来源: 2026-07-03 V5 体检
- [ ] **STUCK 费腿 funds_order 可停 CONFIRMED 视图残留**：`onFeeLegConfirmed()` 的 TB settle 瞬时故障三级梯耗尽后，费腿 `funds_order.status` 永久停在 `CONFIRMED`（从未真正 FAIL 过），Linked Funds Orders 卡片视觉上像"一直在途"，无独立 STUCK 标记（信号只在 withdraw 的 `needsReview`+审计里）｜来源: 2026-08-04 Task 12 truth 核对
- [ ] **SUCCESS 后退汇无处理**：`onBounce()` 硬性要求 `PAYOUT_PENDING`，一笔已 `SUCCESS` 的提现若数日后被银行/链上退汇，本域没有对应入口，应走对账（recon）子系统匹配外部退汇流水而非 withdraw workflow 自身处理 ｜来源: 2026-08-04 Task 12 truth 核对
- [ ] **规则 A（tipping-off 防线）只在充值域落实，提现域有一模一样的洞未堵**：`withdraw-transactions.service.ts → toCustomerWithdrawView()`（约 L357-380）原样返回 `status: item.status`/`completedAt: item.completedAt`——一笔被 `adminFreeze` 打成 `FROZEN` 的提现，客户端 DevTools → Network 面板可直接读到裸 `'FROZEN'` 字符串（对照充值域 `deposit-transactions.service.ts → toCustomerDepositView()` 已有的 `CUSTOMER_STATUS_PASSTHROUGH` 白名单收敛 + `CUSTOMER_COMPLETED_STATUSES` completedAt 独立白名单，见 truth/v4-deposit.md §4.6）；`findAllForCustomer()`（约 L333-339）把客户传入的 `query.status` 直接转发进 `findAll()` 的 where 条件，无 customerScope 收窄——`GET /client/withdraw-transactions?status=FROZEN` 本身就是一个可用的冻结预言机（对照充值域 `findAll()` 在 `customerScope` 下已静默忽略原始 `status` 参数）；前端 `client-web/src/pages/Withdraw.tsx → HISTORY_STATUS_FILTERS`（约 L105-115）仍是裸 status 列表式筛选（`statuses: ['PENDING_APPROVAL','COMPLIANCE_PENDING','MANUAL_CHECKING','FROZEN','PAYOUT_PENDING']`），未跟进充值域已切换的 `bucket` 补集式设计（§4.6）。本条不是回归——提现域这套字段白名单本就早于充值域上线（Task 11 只做了字段裁剪，未含 status/completedAt 收敛），deposit-action-embed 分支只是把充值域这道防线补完，两域因此出现不对称：truth/v4-deposit.md 与代码注释里写的"规则 A"读起来像平台级不变量，实际只在充值域落实。仅登记，本分支未改提现代码 ｜来源: 2026-08-05 deposit-action-embed 分支终审 Important 3

## 技术债 — V6 兑换

- [ ] 无自动 FAILED 状态机：腿失败走自愈→STUCK(needsReview)+手动 resume，swap 留 PROCESSING，无终态失败（设计 deferred）｜来源: 2026-07-04 V6 体检
- [ ] Quote TTL 无 cron sweep：仅懒过期（查询时 markExpired）｜来源: 2026-07-04 V6 体检
- [ ] 兑换成功通知未接（SUCCESS 时不调 Notification）｜来源: 2026-07-04 V6 体检
- [ ] demo 播种铸号种子不一致：`client-web Deposit.tsx` 与 `demo-lib.ts` 用 `walletId` 作 `fakeChainTxHash/fakeBankRef` 种子，funds_order 收口后 canonical 种子是 `fundsOrderNo`（两侧各自成对、不影响匹配，仅种子来源未统一）｜来源: 2026-07-11 externalRef 收口
- [ ] **豁免位有效期**：poa/questionnaires 字段是否含提交时间戳待验；无时间戳则该档退回 tag + 我方管期限｜来源: 同上
- [ ] **兑换域规则清单与阈值**：另起规则目录文档，含排雷（含 rejected 计数 / 缺 .notRejected 的聚合规则会造成
      「被拒→加分→再被拒」死循环）｜来源: 同上 §7
> 注：swap 腿 InternalFund 命名债已并入下方「平账处置」的 funds-orders 域 RBAC 命名债条目，不重复登记。


## 技术债 — V8 对账

- [ ] 🐛 **`reObservedCount` 恒为 0**：line item 每 run delete-then-insert，`foundByRunId` distinct 恒 1 → 观察历史"复观察次数"永远 0；正确修法需 `reconciliation_cases` 加专用计数列（`upsertCaseForWallet` existing 分支 +1）；代码已加 KNOWN LIMITATION 注释（`reconciliation-query.service.ts`）｜来源: 2026-07-04 V8 体检（Round3 遗留）
- [ ] **资本注入 evidence 待核**：CAPITAL_INJECTION seed transfer 在，FIRM_ASSET 流水是否有对应 evidence/account_flow 行待确认（roadmap 记为欠，agent 称已有——需查 seed 是否走 writeEvidence）｜来源: 2026-07-04 V8 体检
- [ ] **canonical-minor 展示层 re-pairing 未传 decimals**：`reconciliation-query.service.ts` `buildFlowComparison()` 的 `matchFlows` 调用暂传 `decimals: 0`（identity 换算，保持 Case 详情流水比对页现状不变），TODO 标记待 Task B 补该 case 资产 `asset.decimals`｜来源: 2026-07-04 canonical-minor Task A（Task B 收口）
- [ ] **对账 Cases 列表页 Δ 显示的是原始「分」整数、未按 decimals 分→元**：`ReconciliationCasesListPage.tsx:297` 直接 `{kase.deltaAmount}` 渲染（仅用 `Number()` 判正负/零），USDT case 会把 3000000 分显示成 "3000000"。修法需后端 `listCases` 返回 `decimals`（同 getCase：按 assetCode 查 asset 表）+ 前端列表按行 `formatAmount(delta, decimals)`。同族的 DemoCompare 页 `AmountCell`（manifest 口径答案键，属另一比对面，暂不动）｜来源: 2026-07-04 canon2 T4 冰山排查（T4 只改两详情页，列表页超范围）
- [ ] 🎯 **业务层（充值/提现/兑换/资金单/报价/手续费）存储 元→分 整层迁移**（乙的第二步）：当前 `funds_orders.amount` 及整个业务层仍存「元」，与"内部全分"原则不符；recon 读入边界（matcher Pass3 `wallet-flow-matcher.service.ts` + push 回执 `receipt-lookup.service.ts` 档2）为此做 funds_order 元→分 换算。整层搬分后**可撤除这两处边界换算**（改为分比分直取）。blast radius 巨大（quote/withdraw/deposit/swap 建单+校验+展示全链），须单独排期迁移+回填+双跑校验｜来源: 2026-07-04 canon2 scale 审计 + 业主"内部全分"原则（spec `2026-07-04-recon-engine-canonical-minor-design.md` §6）

## 技术债 — V1 审计底座

- [ ] 🔴 **通知 send/retry = STUB**：`core/notifications/` 只有 WebSocket `NotificationsGateway`，无 email/webhook/失败重试实现——roadmap 标 Notification send/retry ✅ MVP 为过度声明；这是 V4-V6 各版本"通知未接"的根因（本体没做，不是没调）｜来源: 2026-07-04 V1 体检

## 技术债 — 审计日志重构 · 第一批之后仍欠的账（2026-08-25）

> 本节由 Task 11（端到端验收）登记，对应设计稿 `doc-final/superpowers/specs/2026-08-25-audit-log-redesign-design.md`。前 7 条是设计稿 §16 明确划出本批范围外、业主已认可延后的项；第 8-9 条是 Task 11 实测过程中新发现、之前所有任务与 progress.md 均未记录的缺口。

- [x] ~~**三个交易域（充值/提现/兑换）的日志梳理**~~ 已拆三条按域登记（见「演示装备」节，随各域 Phase 4 回收执行；域内容=动作码定义、`subjects` 填充、拒绝路径接入｜设计稿 §16）
- [ ] **交易域词表瘦身（496 → 实际在用量级，约 59）**：现有 496 个历史动作码里只有约 59 个在用，V1 完成后词表精简是交易域批次的活｜设计稿 §16
- [ ] 🔴 **`audit_log_subjects` 子表覆盖面远小于设计前提，45 码里只有 ~7 码真正在用子表**：设计稿 §5.1 的立论前提是"一对 primarySubjectType+primarySubjectNo 装不下多主体，需要子表"，但 Task 11 端到端实测（真实 API 驱动 admin 停用/恢复/角色定义创建等流程）坐实：只有横切的 6 个 `APPROVAL_*` 码（经 `approvals.service.ts`）与 `AUDIT_LOG_QUERIED`（且仅当查询带 `ownerCustomerNo` 参数时）会调用 `persistSubjects` 写子表；其余 IAM（`ADMIN_INVITE_*`/`ADMIN_FIRST_LOGIN_*`/`ADMIN_ROLE_CHANGE_*`/`ADMIN_SUSPENSION_*`/`ADMIN_REACTIVATION_*`/`ADMIN_PASSWORD_RESET_*`/`ADMIN_MFA_RESET_*`/`ADMIN_ACCOUNT_LOCK_*`，共 25 码）与 CONFIG（`ROLE_DEFINITION_*`/`APPROVAL_POLICY_CHANGE_*`，共 8 码）、以及 `AUDIT_EVIDENCE_EXPORT_*`（3 码）在各自的 workflow service 里 `recordByActor`/`recordSystem` 调用**从不传 `subjects:` 数组**——只设置主表扁平字段。实测复现：`admin-suspension-workflow.service.ts` 让 `ADM2501010008` 挂了 4 条事件（`ADMIN_SUSPENSION_REQUESTED`/`APPLIED`、`ADMIN_REACTIVATION_REQUESTED`/`APPLIED`）的 `primarySubjectNo`，但 `SELECT COUNT(*) FROM audit_log_subjects WHERE subjectNo='ADM2501010008'` = 0，`GET /admin/audit-logs?subjectNo=ADM2501010008` 实测返回 `total:0`（必须改用 `primarySubjectNo=` 才能查到同样 4 条）。**验收标准 #6"按依据查得到"字面上仍算通过**（该标准原文限定的是"按审批单号"，approvals.service.ts 那 7 个码确实覆盖了），但设计稿 §5.1 举的例子（"充值单"为 PRIMARY、审批单只是其中一个 INSTRUMENT）说明子表原意是覆盖**所有** V1 主体，不是只覆盖审批单号——按这个更完整的意图，"某个 admin 用户/某条角色定义从生到死被谁碰过"这条监管索档能力目前并不成立。修法：把这 36 个码所在的 8 个 workflow service 补上 `subjects:` 数组（多数只需 1-2 行，模式已有 `approvals.service.ts` 可抄）｜Task 11 端到端验收实测新发现，无历史来源
- [ ] **Q4"按客户查全部"目前唯一的数据来源是查询动作自证**：`verify:audit` 的 Q4 判据（`M>0`）能通过，靠的是 `GET /admin/audit-logs?ownerCustomerNo=X` 这个查询动作自己把 `AUDIT_LOG_QUERIED` 记成 `OWNER=CUSTOMER`，即"查询这个动作本身构成了它所验证的证据"。这不是 `verify-audit.ts` 脚本的缺陷（脚本按 brief 逐字实现，且经变异测试证明能正确识别数据缺陷），而是**V1 治理域现实中没有任何其它场景会把 CUSTOMER 设为某条治理事件的 OWNER**（V1 域本身不直接操作客户实体，客户只会通过"查询时按客户号过滤"这一条路径进子表）。换言之，Q4 目前只证明了"查询行为自身可追溯"，不能证明"客户被牵连在其他 V1 治理动作里时可追溯"——因为 V1 域里后一种场景目前不存在，等三个交易域（充值/提现/兑换，这些才会有 `ownerCustomerNo` 意义下的客户关联事件）接入 `subjects` 后，Q4 式的验证才有更丰富的场景可测｜Task 11 端到端验收实测新发现，无历史来源
- [ ] **20 个领域服务的审计打点仍未上收到编排层（非仅交易域）**：分布 `trading`(5) / `identity`(7) / `governance`(2) / `asset-treasury`(3) / `clearing-settle`(2) / `counterparty`(1)。这些文件写的 55 个动作码经交叉比对 **V1 命中为 0**（比对已用变异验证证伪「恒零」：喂 workflow 文件命中 3/3/5），全部属业主 2026-08-25 裁定的「其他的不用管」。**上收的前置条件是这些域先有编排层**——实测 12/25 个文件所在域 workflow 数为 0，`identity/` 的 10 个 workflow 全属 `users/`+`access-control/`（V1 IAM 簇）。典型：`customers.service.ts` 的 3 处审计在 `create/update/remove` 纯 CRUD 里、只被 `customers.controller.ts` 调用，模块内唯一 workflow 是管「客户限制」的，无处可搬。⚠️ 上一轮曾有实现者为让守则测试变绿而把领域服务改名成 `*-workflow.service.ts`（审计调用原地未动），已重置——**改名不等于上收** ｜来源: 2026-08-26 Task 10 范围重定
- [ ] **`sourcePlatform` 词表失控（10 个值，4 个语义重叠）且无枚举约束**：实测 `SYSTEM`(143) / `ADMIN_API`(111) / `CLIENT_API`(7) / `CUSTOMER_API`(6) / `CUSTOMER_AUTH_API`(4) / `APPLICATION`(3) / `ADMIN_AUTH_API`(3) / `SCRIPT`(3) / `CRON`(2) / `ADMIN_INVITATION_API`(2) / `ADMIN`(2)。其中 `ADMIN` / `ADMIN_API` / `ADMIN_AUTH_API` / `ADMIN_INVITATION_API` 四者语义重叠，字段类型是裸 `string`（`audit-log.dto.ts:254`），无枚举、无写入校验。应定枚举 + 收敛取值 + 加机器校验 ｜来源: 2026-08-26 Task 10 收敛顺带实测

## 技术债 — V2 客户合规

- [ ] **Tier Upgrade ⛔ 缺客户端 UI**：后端全建（createFromCra→Level2→MLRO+SMO 审批），缺客户材料提交前端（真实卡点，roadmap 已标 BLOCKED）｜来源: 2026-07-04 V2 体检
- [ ] **Corporate/机构客户 stub**：CorporateProfile/UboProfile 表+关系连但无业务逻辑，onboarding 两处显式 disabled；机构客户全 ADVANCED ｜来源: 2026-07-04 V2 体检
- [ ] **Material Refresh 状态名不符**：代码 NUDGE_ONLY/CLEARED vs roadmap NUDGE/RESOLVED（文档订正即可）｜来源: 2026-07-04 V2 体检


## 技术债 — 客户生命周期轴 + 限制账（2026-08-15 设计定稿，2026-08-16 落地）

> 来源统一：`superpowers/specs/2026-08-15-customer-lifecycle-restrictions-design.md` §8 待决表。

- [ ] **Q1 制裁客户的订单级折叠未做**：本轮贴 `scope=ALL` 便签只把在途单打成 `FROZEN`，客户面靠服务端脱敏白名单收敛成 `COMPLIANCE_PENDING`；设计稿讨论过的「收单后一律挂 `PROCESSING`、连状态变化都不产生」的订单级折叠没做。与「提现域 tipping-off 未对齐」同源，一并排期 ｜来源: 2026-08-15 设计稿 §8 Q1
- [ ] **Q2 销户流程只落了轴上位置 + 三条断言**：`OFFBOARDED` 是 `lifecycle` 终态，`CustomerAccessService.assertOffboardable()` 只实现三条不变量（`OFFBOARD_BLOCKED_BY_SANCTION` / `_BY_BALANCE` / `_BY_INFLIGHT`）。真正的销户流程——余额清退、材料归档留存期、审批链、客户侧发起入口——全部未做；管理台 Offboard 按钮当前是 disabled 占位 ｜来源: 2026-08-15 设计稿 §8 Q2
- [ ] **Q3 `expirePendingApprovals()` 全仓无 @Cron 调用方，`timeoutHours` 是展示字段**：两个新增审批策略照现有范式写了 `timeoutHours: 48`，但平台层压根没人扫超时，48h 到点不会发生任何事。平台级缺陷，不限于本模块（`WITHDRAW_UNFREEZE` 等既有策略同病）｜来源: 2026-08-15 设计稿 §8 Q3

## 技术债 — 制裁命中分主体（sanction-subject-split，2026-08-20 落地）

> Sumsub 交易标签 `SANCTION` 退役拆成 `SANCTION_APPLICANT`（我方客户本人被制裁）/`SANCTION_COUNTERPARTY`（对手方被制裁）；充值/提现命中 `SANCTION_APPLICANT` 先冻人再冻单，命中 `SANCTION_COUNTERPARTY` 只冻单；兑换域新增 `FROZEN` 终态与之对齐；限制便签 `SANCTION` 因由改客户级归一（同一客户永远只有最早一张 OPEN）。以下九条均为执行过程中实证发现，来源均标 2026-08-20 制裁分主体批次。

- [ ] **`runGate0` 冻单零审计**：`deposit-workflow.service.ts → runGate0()` 命中限制账（`customerAccessService.resolve().blocked.has('DEPOSIT')`）直接 `updateStatus(FREEZE)`，只有 `logger.warn`，全程无 `auditLogsService` 调用——无论是否存在并发竞态都不写。与同一文件的 `onCustomerRestrictionOpened()`（批量冻单广播，本批已补审计）和提现域对应的 `assertCustomerComplianceOrFreeze()`（三处调用点均写 `WITHDRAW_FROZEN`）不对称，是充值域独有的缺口。**非本批引入**，实证发现于本批 ｜来源: 2026-08-20 制裁分主体批次
- [ ] **`customer-restriction-workflow.service.ts` 的私有 `audit()` 方法有同款 requestId 缺陷**：`CustomerRestrictionsService.open()`/`release()` 已在本批补上 `requestId` 拼 `randomUUID()`（防同一客户第二条同 action 事件被幂等键静默去重），但 `CustomerRestrictionWorkflowService`（admin 手工贴/撕便签的审批编排层）内的私有 `audit()`（被 `openRestriction()`/`auditRelease()` 调用）没有同款修复——admin 手工路径的第二条审计轨迹仍可能被静默吞掉。Task 11 只调查、未改 ｜来源: 2026-08-20 制裁分主体批次
- [ ] **对手方恰好是我的客户（交叉场景）——本批不考虑**：一笔交易的对手方地址如果恰好也是本平台的客户，`SANCTION_COUNTERPARTY` 命中理论上应该同时触发对该"对手方客户"的复核，当前实现只处置发起方，不追溯对手方身份 ｜来源: 2026-08-20 制裁分主体批次
- [ ] **兑换 `PROCESSING` 在途单碰冻人广播仍走 `needsReview` 旗，运营分不出"技术卡单"与"人被冻结"**：`onCustomerRestrictionOpened()` 对处于 `PROCESSING`（腿已开跑）的兑换单只调用 `assertSwapCustomerAccessOrHalt()` 停腿 + 打 `needsReview`，与腿失败自愈耗尽的 STUCK 单共用同一面旗子、混在同一个卡单堆里，旁边挂的还是同一个 Resume 按钮——运营在列表页无法区分"这单是技术卡住待人工重试"还是"这个人被制裁冻结了，Resume 是错误动作" ｜来源: 2026-08-20 制裁分主体批次

## 技术债 — 第三批 SLA（三域，2026-08-21 落地）

> 两个字段 `slaDeadline`/`slaBreached`（充值/提现各四格配置表，兑换一格）；deadline 在状态机收口处（`updateStatus`/`markStatus`/`create`/`insertRecord`）统一设，SLA 与 onHold 解绑，硬破线推状态、软破线只标记。现状见 `truth/v4-deposit.md` §4.7、`truth/v5-withdraw.md` §4.7、`truth/v6-swap.md` §3.8。以下十一条均为执行过程中实证发现，来源均标 2026-08-21 SLA 批次（后五条为终审 + Task 10 审查补登记）。

- [ ] **列表页「仅看已超时」是前端过滤，只对当前页生效**：三域 `{Deposit,Withdraw,Swap}TransactionList.tsx` 的「仅看已超时」复选框均在 `useMemo` 里对当前页 `items` 客户端过滤（`formatSlaRemaining(...).tone === 'breached'`），后端列表查询无对应的 `slaBreached`/`slaBreachedOnly` 参数——勾选后只在当前分页内筛选，翻页/换页大小会丢失筛选效果，与既有 `needsReviewOnly` 同款局限（三域列表页均有——充值列表页 `DepositTransactionList.tsx:242` 的注释就自述"与下方 needsReviewOnly 同类局限"）。代码注释已自述该限制（"Backend has no slaBreached query filter yet; apply client-side over the current page only"）｜来源: 2026-08-21 SLA 批次
- [ ] **软破线后 `slaBreached` 会一直为 true 直到状态变化**：`markSlaBreached(id)`/等价方法只做单字段更新，`resolveSlaFields()` 是唯一能把它归 `false` 的路径，只在下一次状态迁移时触发。若运营处理了软破线单但没有推动状态（例如只加了备注、或问题本身要等外部条件成熟），红标不会自动消——UI 上看起来"一直超时"，即便运营已经在处理｜来源: 2026-08-21 SLA 批次
- [ ] **时长是硬编码常量，无 admin 配置界面**：`DEPOSIT_SLA_MINUTES_BY_STATUS`/`WITHDRAW_SLA_MINUTES_BY_STATUS`/`SWAP_SLA_MINUTES_BY_STATUS` 均是各自 service 文件里的 TS 字面量常量，改时长需改代码重新部署；三域此前各有一套不同的可配置性历史（兑换曾经有 `SWAP_COMPLIANCE_TIMEOUT_MS` env 覆盖，本批已删除该开关，统一成与另外两域同款的纯代码常量），现状是**三域一致地**没有任何 env/DB 层面的运行时可配置项。BACKLOG 旧条目「60 秒合规超时未经真实 Sumsub 延迟校准」的具体诉求②（"改成可配置项"）实质上仍未完成，只是数字来源换成了业主裁定的业务口径而非未标定的技术猜测 ｜来源: 2026-08-21 SLA 批次
- [ ] **`formatSlaRemaining` 对不足 1 分钟显示 `"0m"` 而非 `"<1m"`**：`admin-web/src/utils/slaDisplay.ts` 的分级逻辑（`days>0`/`hours>0`/否则 `${minutes}m`）在剩余时间落在 0-59 秒区间时 `totalMinutes=Math.floor(ms/60_000)=0`，直接显示 `"0m"`——对运营而言"0m"容易误读成"已经到期"（虽然 tone 仍是 `normal` 不是 `breached`），比显示 `"<1m"` 更容易造成误判 ｜来源: 2026-08-21 SLA 批次
- [ ] **兑换 resubmit 分支给重提的单子近乎零宽限（唯一没遵守"计的是在这个状态待了多久"的地方）**：`swap-sla.service.ts:73-78`——`sumsubTxnIdOut` 为空时补提交一次然后 `continue`，**不动 `slaDeadline`**（此刻它已经是过去时刻）。下一轮 sweep（30 秒后）看到 `sumsubTxnIdOut` 已有值，直接判超时拒单——Sumsub 实际只拿到 30 秒而不是 5 分钟。旧的 `createdAt` 口径下形态相同，**不是本批引入的回归**；但本批刚立了"deadline 计的是在这个状态待了多久"的模型，这个分支是三域里唯一没遵守它的地方。修法一行：补提交成功后顺手把 `slaDeadline` 往后推一个完整窗口（`resolveSlaFields(COMPLIANCE_PENDING)` 或等价写法）｜来源: 2026-08-21 SLA 批次
- [ ] **SLA 倒计时不会自己走，要靠运营切页/刷新**：三域列表页 + 详情页共六个页面都没有 `setInterval`/轮询，`formatSlaRemaining()` 只在每次 render 求值一次——一格显示 `"4m"` 的单子十分钟后还写着 `"4m"`，直到运营切页或手动刷新才更新（破线红标同理，翻红要等下一次 render）。设计稿（`doc-final/superpowers/specs/2026-08-21-sla-design.md` §4.2:178）写的是"状态卡内显示倒计时"。纯观感问题，不影响后端判定 ｜来源: 2026-08-21 SLA 批次


### 真欠账

**闸门与测试基建**

- [ ] **Gate 0 的 `FROZEN` 分支不写审计，与本批新增的挂起分支不对称**：`runGate0()` 的执法级分支（`releasePolicy === 'MLRO_APPROVAL'`）只有 `logger.warn` + `updateStatus(FREEZE)`，无 `auditLogsService` 调用；而本批新增的 `holdAtGate0()` 走 `recordStateTransitionAudit()`、放行分支写 `DEPOSIT_GATE0_PASSED`——三条分支里**只有冻结这条没有审计**。**非本批引入**（既有缺口已登记在上方「制裁命中分主体」节的「`runGate0` 冻单零审计」条），但本批把不对称放得更明显了，一并在此交叉引用，归审计专项那一轮统一清 ｜来源: 2026-08-22 第四批 B4
- [ ] 🔴 **行政级挂起的单没有任何入账路径，`waiveLimitHold` 承诺的「重走合规」是空的（待业主拍板）**：`holdAtGate0()` 那条分支**刻意不送 Sumsub**（注释说「与紧邻的 FROZEN 分支同形状」）。但那个类比**只对 `FROZEN` 成立**——`FROZEN` 的出口 `resume` 回 `COMPLIANCE_PENDING`，会重新武装 Gate 0；而 `OPERATION_PENDING` **没有回 `COMPLIANCE_PENDING` 的边**，`runGate0` 只在进入 `COMPLIANCE_PENDING` 时触发。于是：运营看到「Account suspended」、停用解除后点 **Release Hold** → `clearLimitHold` 跑 → `checkAutoApproval` 读到 `sumsubVerdict === null` **提前 return** → 单子停在 `OPERATION_PENDING`、无挂起、无 KYT 案；此时 waive 再点会抛（挂起已清）、`initiateConfiscation` 硬钉 `BELOW_MIN`、详情页没有 Approve 按钮（全仓唯一的 `Approve` 字串是 demo 模拟 fixture）——**实际只剩「原路退回汇款人」一条出路**，否则钱无限期压在 `DEPOSIT_SUSPENSE`、客户面看到一笔永远「处理中」的单。**三个候选解法**：①挂起分支也送 Sumsub（挂起时就起 KYT 案，waive 后自动续跑）；②补 `OPERATION_PENDING --resume--> COMPLIANCE_PENDING` 边（waive 走它，重新武装 Gate 0）；③维持现状但把文案说清。**本批不改行为**，只做了如实化：`waiveLimitHold` 的 JSDoc（此前明确承诺「re-runs checkAutoApproval so the deposit proceeds through the normal L2 compliance gates」，是假话）与 admin 详情页 Release Hold 的按钮文案 / confirm / notice / 按钮下方提示已全部订正 ｜来源: 2026-08-22 终审 Important I1
- [ ] **`CAPABILITY_RESTRICTED` 挂起原因区分不出 SANCTION 与 ADMIN_SUSPENSION，客户面一律藏**：`holdReasonOf()` 只按**哪一格 FAIL** 映射原因，拿不到便签的 `cause`；而客户面的可见性判据是「`limitHoldReason` 非空即整单不可见」，于是行政级挂起在**挂着的时候**对客户是零记录（退回落地才清、才可见，见 `truth/v4-deposit.md` §4.8）。保守是刻意的——tipping-off 的代价不对称（藏错了客户少看见一条记录，露错了是刑事风险）。要精确区分需让 `holdReasonOf()` 带上 `cause`，并给客户面定一套「哪些 cause 可见」的白名单 ｜来源: 2026-08-22 第四批 B4
- [ ] **`client-web/src/pages/Withdraw.tsx` 的 tab 仍存组件 state**：`Deposit.tsx` 与本批改造的 `Swap.tsx` 都已把 tab 放进 URL 查询参数（`useSearchParams`），提现页还是 `useState`。今天没有可见症状——提现**没有**「列表 → 详情 → `navigate(-1)` 回列表」这条往返（详情页返回落点判据虽然同款，但提现列表 tab 与详情页不构成同一循环）；一旦将来补上同款往返，这条就会立刻表现为「从 History 点进详情，返回后站在下单表单」｜来源: 2026-08-22 第四批 D3
- [ ] **`directionOf()` 把提现两条腿都判成 `OUT`**：`funds-order.service.ts` 对 `withdrawTransactionId` 非空恒判 `OUT`，不按 `legSeq` 分叉——但费腿（legSeq=2）是 `FIRM_ASSET → INCOME_WITHDRAW_FEE` 的**纯内部划账**，按语义应是 `INTERNAL`（对照充值：`legSeq > 1` 一律判 `INTERNAL`）。**功能上无影响**：`getTransitionMap` 里 `INTERNAL` 落到的也是 OUT 那张表，两者当前等价。是命名/语义债，不是 bug ｜来源: 2026-08-22 第四批 A4/E1


## 技术债 — 平账处置（推单）

- [ ] **swap 腿推单未支持**：通用推单按钮（`/admin/funds-orders/:no/push/sync|manual`）明确排除 swap 腿——`advanceByNo`/编排服务见 `swapTransactionId` 非空即拒（现有先卖后买顺序守卫防线），且回填 effectiveDate 需再穿透 swap 4 腿两阶段记账链（工作量≈deposit+withdraw 之和）。swap 腿卡单本期走 **Swap 详情页 `advanceLeg` 专用推进**（带顺序守卫），但该路径**暂无 effectiveDate 回填** → 推完历史那天快照修不平 ｜来源: 2026-07-03 推单 plan 落地发现（spec §2/§8）｜下期：swap workflow 记账链穿透 effectiveDate + 推单接 swap 腿
- [ ] **funds-orders 域 RBAC 权限 + 审计实体仍用 rename 前旧名 `INTERNAL_FUND`**：Round 2 表 `internal_funds`→`funds_orders`（2026-07-02）后，权限 `INTERNAL_FUND_READ`（rbac.catalog.ts:44/581-586 整个 funds-orders 域唯一权限）+ 审计实体 `AuditEntityTypes.INTERNAL_FUND`（audit-actions.constant.ts:58，Spec#4 短名）均未跟随重命名 → 域叫 funds order、门禁/实体叫 internal fund，不一致。应统一改 `FUNDS_ORDER_READ` / 新增 `FUNDS_ORDER_DISPOSE` + 审计实体 `FUNDS_ORDER`（rbac catalog union 类型 + 全部 route + AuditEntityTypes + 引用点 + db:base:sync；审计实体改名要评估历史 audit_log_events 旧值兼容）｜来源: 2026-07-03 用户审阅推单 BACKLOG 发现 ｜下期 RBAC 轮同做
- [ ] **权限包目录三动词标准化 + 铺满 9 空域（本轮只出文档，代码待实现）**：定《权限与审计规范》以 View/Manage/Act 三动词为标准；现 `ACTION_BUCKET_CATALOG` 15 域仅 6 域有 bucket，`customer/compliance/trading/recon/pricing/config/gov_registry/counterparty/clearing` 9 域为空壳 → 自定义角色 UI 勾不到交易等能力；且缺 `funds`（资金单）域。代码活：按三动词补全各域 bucket + 新增 funds 域（含上条 FUNDS_ORDER_VIEW/ACT 拆分）+ Act 档对齐 SoD。中央规范以 `rbac.catalog.ts` 为唯一真相源、文档镜像防漂移 ｜来源: 2026-07-11 权限包集中化 brainstorm（甲·三动词，本轮文档 only）

## 技术债 — 费率等级治理（2026-07-11 V3 PRD 需求；核心谓词已落代码，剩余项见下）

> 来源统一：`doc-final/superpowers/`（拟）+ 飞书《交易费率等级治理》V3（docx `KoqidVBVMoPIBoxOVVKltxn6g9c`）。现状已在代码（2026-07-13 后）：`isDefault`(EVERYONE) + `requiredTagsJson`/`validFrom`/`validTo` 谓词（TAG/WINDOW 受众，`matchesAudience()`）、cheapest 取最低费、configHash 冲突门、OPS_OFFICER 48h 审批；binding 表已退役（見下条，非仍在用）。以下为 V3 剩余需求。

- [ ] **报价落"资格快照"**：现 quote 仅存 `policyRef=LEVEL:code`；V3 要求成交时落 命中集合 + 选中级 + 选中理由(最低费) + 客户此刻标签快照（可解释/可申诉）｜来源: 2026-07-11 费率 V3 §4.4/§5.5
- [ ] **⚠待定：受众（requiredTags/window）变更口径**：现变更流只覆盖 `tiersJson`（configHash 保护费率本身）；受众字段变更是否也走 configHash + 审批链未定 ｜来源: 2026-07-11 费率 V3 §4.2
- [ ] **费率变更 30 日历日生效闸 + 通知客户**：现即改即生效；与提现/兑换 backlog 的 30 日闸同源（MC II.A.7/8），费率治理统一落 ｜来源: 2026-07-11 费率 V3 §1.2
- [ ] **待决策：cheapest 只减免不加价**：命中集合取最低费 → 更贵的级永不胜出；若将来要"VIP 必走 VIP（即便更贵）"或高风险客户加附加费，须改**优先级选级引擎**（V3 明确不做，留此账）｜来源: 2026-07-11 费率 V3 §5.5


## 待决策（等业主拍板）

- [ ] **金额闸门矩阵**：tier 限额 + 大额审批 20 万 + TR 阈值 3,500 三线合一后再统一接入 L1（避免接完旧表又改）｜来源: 限额重设计 + TR 调研（roadmap V3 ADVANCED）
- [ ] **客户 TB 账户创建策略**：补事件驱动异步创建 or 认可懒加载 + 补文档 ｜来源: 2026-07-03 V3 体检
- [ ] **资金单合并可行性**：payin/payout/internalfund 状态机近同构，可评估进一步合并 ｜来源: Round 2 遗留
- [ ] **单笔金额级冻结原语（交易风控 L3 前置依赖）**：已终态充值/兑换订单命中行为监测（L3）需冻结"对应金额"，现仅有客户级整体冻结（V2 冻结流），无 TB 层单笔金额锁定/冻结子账户原语；交易风控 L3 落地前须先建（提现无此需求——钱已出只管人）。设计见 `superpowers/specs/2026-07-12-transaction-risk-gates-design.md` §5/§7 ｜来源: 2026-07-12 交易风控三闸门 spec（业主定 deferred，不纳入本 spec）


## 疑似幽灵按钮（红色，需查证）

- [ ] `CustodianWalletDetail.tsx:182` 用 `INTERNAL_COLLECTIONS_RECONCILE` 权限控制按钮，指向已删端点 ｜来源: 2026-07-03 死码体检
- [~] Wave8OpsDashboardPage 首页调已删 `/admin/reimbursement-obligations`（404 空转）｜已生成修复卡片 task_c9112015


## 文档漂移（随 roadmap 全量重排处理）

- [~] roadmap **V3/V4 已按三层新格式重排 + truth 外置**（2026-07-03）；V1/V2/V5-V9 待同款处理

## 交付 / 可移植 Docker（2026-07-04 本会话新增）

- [ ] **`scripts/stack.sh up`(self) 端口连锁失败**：admin/client 端口被上次会话遗留 vite 占着时，`ensure_port_free` 在 `set -euo pipefail` 下返回非零 → **整脚本中止、永不走到重建/重启 backend**（即便 backend 端口本身空闲）；与 CLAUDE.md「每次 up 自愈 .env / 重建后端」描述不符，导致实现者被迫手起 `node dist/main`。规避：`lsof -ti:<端口段>|xargs kill` 释放残留再 up。修法：`ensure_port_free` 命中占用改为 kill 残留后继续、或各服务独立处理不整体 `set -e` 退出 ｜来源: 2026-07-12 费率受众 worktree 执行（C + 验收两轮实现者各撞一次）

- [ ] **`scripts/on-stack.sh self <script>` 跑 `ts-node` 脚本时 `node_modules/.bin` 不在 PATH → `ts-node: command not found`**：经包装器跑 ts-node 类脚本（如 demo-lib/单脚本）时报错。规避 = 直接 `DATABASE_URL=... TB_ADDRESS=... npx ts-node -r tsconfig-paths/register scripts/<x>.ts`。修法：包装器把 `node_modules/.bin` 前置进 PATH（或统一用 `npx`）｜来源: 2026-07-16 transaction-limits（费率受众 worktree 亦曾遇，与本节上一条 stack.sh self 同源工具债）


## demo / 对账脚本（canon2 收尾）

- [ ] **demo:all 充值 5/6 + `demo-lib.ts` 未建 trading-ready 法币地址**（PRE-EXISTING，非金额限额 feature 引入）：交易起始前置门落地后（61337fb2），demo 客户在充值前需先有 ACTIVE 法币提现地址，但 `scripts/demo-lib.ts` 从未跟进创建（其末次改动 4c27f1ff 早于该门）；main 栈 DB 仅因人工种过 4 个地址才过。**全新 DB 跑 demo:all，充值会挂 COMPLIANCE_PENDING**。即便种了地址，demo:all 仍稳定在 **7/8（充值 5/6）**——有一笔充值因与金额限额无关的充值流原因始终不 SUCCESS（提现 5/5 + 兑换 3/3 + COA 4/4 全过；本轮金额限额门未拒任何单）。需单独 demo-setup 修复（`demo-lib.ts` 播种 trading-ready 法币地址）+ 排查第 6 笔充值卡因 ｜来源: 2026-07-16 transaction-limits 回归跑
- [ ] **`demo:all` 提现 5/6 的另一成因＝`demo:in-transit` 故意留的在途单**（PRE-EXISTING，非回归）：`demo-in-transit.ts` 的用途就是造"真实卡在半路"的在途单（法币 AED，金额区间 `[500,999]`，止于 `PAYOUT_PENDING`），供对账演示用；一旦跑过，该单永久留库，`demo:all` 的「全部 demo 提现须 SUCCESS」断言就会稳定挂掉（main 栈现存 `WD2607221329`，AED 500，2026-07-22 创建）。这与上一条「充值 5/6」是**两个不同成因**。修法＝断言排除带 `DEMO_STUCK_WD_REF_PREFIX` 的在途单，或 demo:all 前先跑一次 `recon:demo`。**实测机制**（2026-07-28）：`recon:demo` 的 self-clean 会连带清掉该 in-transit fixture（日志 `self-clean: ... fundsOrders=1`）——同一库上 demo:all 先跑是 **7/8**（提现 5/6），跑完 recon:demo 后再跑即回 **8/8**。故 demo:all 的通过与否取决于此前有没有人跑过 demo:in-transit 而尚未跑 recon:demo，**结果不稳定、不宜直接当验收信号** ｜来源: 2026-07-28 合并 feat/transaction-limits 回归跑
- [ ] **`recon-demo.ts` MANIFEST_PATH 写死 main tmp**：默认 `/tmp/exchange_js_main/recon-demo-manifest.json`（可 `RECON_DEMO_MANIFEST_PATH` 覆盖）；self 栈跑 `recon:demo:break` 时 manifest 落 main 栈 tmp、非本 worktree tmp。不影响评分（verifyManifest 读内存 manifest 对象、不回读文件），仅文件落点跨栈。修法：默认按 `DATABASE_URL` 派生 tmp 目录，或 on-stack 包装器注入 `RECON_DEMO_MANIFEST_PATH` ｜来源: 2026-07-04 canon2 T5 code-review（M2）


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
- [ ] **INTERNAL_BREAK run 详情误显示空表**：预门破时 `walletCount=0`/空表 → UI 显示成空/像干净(危险)；应专门呈现恒等破裂明细(按币种 资产合计/负债合计/差额) + "逐钱包未执行"提示；数据已被预门 breaks[] + 审计捕获，缺前端呈现 ｜来源: spec §1.4

**治理闸**

- [ ] **aging + SLA + 超期升级未做**：Case 止于 OPEN 仅自愈；应按账龄计时、超 SLA 升级 MLRO/CFO。in-transit 若结算信号永久丢失(webhook 漏)且无人推则**永不自愈=死结**，aging 是防死结的闸 ｜来源: spec §5/§6
- [ ] **对账复核签核未做**：应干净 run 自动认证 + 人工平账动作走复核签核(maker-checker 推≠批，可按 severity 分级)；复核挂"人工干预动作"、非挂"run 变 pass"。与「平账处置」推单读权限门控债协同(那条=权限粒度、本条=两人复核)｜来源: spec §6
- [ ] **真差异(BREAK)处置闭环未做**：7 平账动作只做推单，补单/冲正/冲销/豁免/偿付 deferred；SOFT_FLAG 里"真两侧对冲错"的调账同 deferred(matcher 调优部分不算)；Finance 人工核实→结案 deferred ｜来源: spec §9

**⚠ 待决策（等业主拍板）**

- [ ] 法币轨道是否即时到账（决定非营业日走 HELD 等账单 vs 结转收盘判 MATCHED）｜来源: spec §10
- [ ] aging SLA 阈值（法币 ≥1 银行日 / 链按确认窗口）具体数值 ｜来源: spec §10
- [ ] 人工平账 maker-checker 是否按 severity 分级审批人（v1 可扁平：一律一道复核）｜来源: spec §10
- [ ] **INTERNAL_BREAK 全链本期不做**：内部恒等检测+中止代码已在（`wallet-recon-run.service.ts → computeInternalIdentity()` 预门），但事故界面（见上「INTERNAL_BREAK run 详情误显示空表」）/ 实时告警 / 收敛冻结 / 受控更正 workflow / 恒等左移 全部 defer；**对账 PRD 显式不体现 INTERNAL_BREAK 作为 run 结果**（run 结论只留 对平 / 有差异两态）｜来源: 2026-07-12 PRD 重写 Q3
- [ ] **人工腿推单 + BREAK/异常处置 = 本期非目标**：本期只交付**同步腿推单**（外部回执验证、免审批）；人工强推腿（`push/manual` + `ManualPushDto`，代码已在）、真差异/异常处置本期不作为交付/验收范围 ｜来源: 2026-07-12 PRD 重写 Q1
- [ ] **新增 CFO 角色**：PRD 加 `CFO`（财务负责人，差异升级 / 财务终审接收方，相关处置动作多为后续）；可经自定义角色造，代码 `rbac.catalog.ts` `RBAC_ROLE_DEFINITIONS` 待注册 ｜来源: 2026-07-12 PRD 重写 Q2
- [ ] **状态机收窄后 `onPayinFailed` 在 `COMPLIANCE_PENDING` 之后触发只 warn、未落审计(2026-08-02)**：`onPayinFailed` 守卫已从黑名单反转成白名单（只有 `PAYIN_PENDING` 才 `FAIL`），非 `PAYIN_PENDING` 状态收到 payin 失败事件（如未来建模的链上重组场景）目前只记一条 `logger.warn`，不落 `AuditLogsService` 审计。本轮先堵住会抛错的口子，落审计是下一步 ｜来源: 2026-08-02 充值状态机收窄，业主定稿 brief §七（登记待办，非本轮实现）
- [ ] **`demo:deposit`/`demo:withdraw` 在全新 worktree 上必炸(缺提现地址种子,2026-08-04)**：`scripts/demo-lib.ts` 的 `ensureSetup()`/`demo-setup.ts` 从不注册 `withdrawalAddress` 行，但「交易起始前置门」（2026-07-11 落 main）要求 deposit 的 `assertTradingReadyOrHold` 查 `hasActiveFiatWithdrawalAddress`、withdraw 的 `createWithdrawal` 查 `withdrawalAddress`（iban/address 精确匹配）才放行——全新 worktree 跑 `db:biz:init` + `demo:setup` 后直接 `demo:deposit` 会卡在 "not trading-ready" 15s 超时，`demo:withdraw` 会直接 400 `WITHDRAWAL_ADDRESS_NOT_REGISTERED`。Task 5 验收本轮手工插入匹配 `viban.iban`/确定性 crypto 地址的 `withdrawalAddress` 行绕过（未落代码，重开 worktree 需重插）。应在 `demo-lib.ts` 的 `ensureSetup()`（或单独一步）里为每个 demo 客户注册一条 ACTIVE `BANK` 地址（iban=其 C_VIBAN 钱包 iban）+ 有 crypto 提现计划的客户注册匹配 `WITHDRAW_PLAN` 里确定性地址的 crypto 地址行 ｜来源: 2026-08-04 Task 5 (withdraw-sumsub) 验收 demo:withdraw 实跑

- [ ] **账本报表层四张视图待落地(2026-08-13，设计已定稿业主缓做)**：spec 见 `superpowers/specs/2026-08-13-ledger-reports-design.md`（暂扣构成日报/收入分类日报/在途冻结登记簿/VARA 收盘快照 + 通用快照表 + 对账 cron 前置步 + `LEDGER_REPORT_READ/WRITE` 权限）。业主 2026-08-13 拍板本轮只做 COA 更新（plan `superpowers/plans/2026-08-13-coa-v2-rollout.md`），报表层整体缓做；其中 B2 依赖 COA v2 先落、B4 依赖下条迪拜 COB 修正 ｜来源: 2026-08-13 账务深化脑暴，业主二次收窄
- [ ] **业务日期按 UTC 切、非迪拜 COB(2026-08-13，财务硬需求)**：`src/modules/accounting/tigerbeetle/utils/business-date.util.ts:2` 的 `toBusinessDate` = `toISOString().slice(0,10)`（UTC 日历日 = 迪拜凌晨 4 点切日），迪拜时间 1 月 5 日 02:00 的交易记成 1 月 4 日的账。业务方邮件明确要求"固定迪拜 close-of-business 截止、对前一日收盘位"。须定义迪拜 COB 时点并改切日逻辑，影响 effectiveDate 盖章与对账截止过滤（`effective-cutoff.ts`）；历史 effectiveDate 存量口径切换需评估。不依赖 COA v2，可单独先修 ｜来源: 2026-08-13 COA v2 设计对话中代码实证（spec §7）

- [ ] **客户列表的「限制」筛选只作用于当前页(2026-08-16，设计已知取舍)**：`CustomerManagement.tsx` 的 Restrictions 列与 `Restricted/Unrestricted/Sanction only` 筛选，数据来自当页 20 行各拉一次 `GET /admin/customers/:customerNo/restrictions`（服务端列表 `GET /customers` 没有限制聚合字段，也没有批量端点）。因此筛选是**客户端**过滤，只筛当前页；翻页会得到"每页筛出的条数不一"的观感，footer 已明写 `(restriction filter applies to this page)`。真做法二选一：① `GET /customers` 的返回体加 `openRestrictionCount` / `hasSanction` 两个聚合字段并支持 `restriction=` 服务端筛选；② 加一个批量摘要端点 `POST /admin/customers/restrictions/summary` 收 customerNo 数组。demo 规模（8 客户）下当前实现够用，登记为账 ｜来源: 2026-08-16 客户生命周期轴+限制账 Task 12
- [ ] **六个 admin 页仍读已删的 `customer.complianceStatus`，客户级合规信号退化成 N/A(2026-08-16)**：三轴收敛后 `CustomerMain.complianceStatus` 列已删，但 `DepositTransactionDetail.tsx:401`、`WithdrawTransactionDetail.tsx:345`、`SwapTransactionDetail.tsx:284`（三张交易详情的**合规 L1「客户级」层**）与 `RiskAssessmentDetailPage.tsx:390`、`MaterialHoldingDetailPage.tsx:339/503`、`RefreshCycleDetailPage.tsx:350`（三张详情页的"客户被冻结"徽章）仍读该字段。降级是温和的——`getComplianceLayerStyle(undefined)` 返回灰底 `N/A`、徽章条件不成立直接不渲染，**不报错、不白屏**，但这些位置从此永远显示"没信号"，等于悄悄少了一层合规提示。新模型下这个信号的正确来源是限制账（"这个客户身上有没有开着的便签"），admin 侧可以连 SILENT 一起看（不涉 tipping-off）。要做的是：六个页面各自的后端 `customer` include 补一个限制摘要（`openRestrictionCount` / `hasSanction`，或直接复用 `CustomerAccessService.resolve()`），前端把 L1 层与徽章改读它。本轮 Task 12 只负责客户详情/列表两页，这六页无任务归属，故登记 ｜来源: 2026-08-16 Task 12 收尾时全仓 grep 发现
- [ ] **材料请求与限制便签共用同一套 RBAC 权限组，粒度耦合**：`/admin/customers/:customerNo/material-requests`（GET/POST）与 `/admin/material-requests/by-order/:orderDomain/:orderRef` 三条路由复用了既有的 `CUSTOMER_RESTRICTION_READ` / `CUSTOMER_RESTRICTION_WRITE` 组，没有新开 `MATERIAL_REQUEST_READ/WRITE`。当下无实际影响——`CUSTOMER_RESTRICTION_*` 三个组在 `RBAC_ROLE_GROUP_BINDINGS` 里**未绑给任何具名角色**，只有 SUPER_ADMIN 走特判拿到全部权限码（这是 customer-restrictions 端点原有的空档，材料请求只是原样继承）。但一旦有人给某角色绑 `CUSTOMER_RESTRICTION_READ`（比如只想放开「查限制便签」给 ops），会连带放开材料请求全量历史的读权限，反之亦然——这两件事业务上并非总是同一批人该看。要拆就得同时改 `PermissionGroup` 联合类型 + `rbac.catalog.ts` + `RBAC_ROLE_GROUP_BINDINGS` ｜来源: 2026-08-18 材料请求账 Task 6 评审
- [ ] **兑换域 V7/V8 demo 按钮没有模拟"客户先交材料"前置步，真按会 500(2026-08-18)**：`SwapDemoScenarioService.runApplicantActionScenario`（`applicantActionReviewed` 分支，即 admin 面板的 ⑦认证通过/⑧认证不通过两个按钮）直接对一条仍是 `PENDING_SUBMISSION` 的材料请求投递 GREEN/RED 复核 webhook。生产流程要求客户先经客户端 `POST client/me/material-requests/:no/submit`（`markSubmitted`）把行推到 `SUBMITTED`，材料请求状态机才允许 `REVIEW_GREEN`/`REVIEW_RED_FINAL` 这两条转移边；demo 按钮跳过了这一步，`MaterialRequestsService.markReviewed` 会在 `nextMaterialRequestStatus` 里直接抛 `BadRequestException: Invalid material request action REVIEW_GREEN from PENDING_SUBMISSION`，整条 ingestion 记录进 FAILED（三次重试后 DEAD）。2026-08-18 修复 restrictionNo 卡死 bug 时在 e2e 测试里发现（`test/swap-sumsub-scenarios.e2e-spec.ts` ⑦⑧），为不越界改动生产代码，改成在测试里显式调用 `MaterialRequestsService.markSubmitted()` 模拟客户提交，绕过了这个坑，但 `demo-scenario.service.ts` 本身未修——运营真在 admin 模拟面板上单独点 ⑦/⑧（不经过客户端提交）会直接 500。修法：`runApplicantActionScenario` 在投递复核 webhook 前，对 `live[0]` 存在且仍 `PENDING_SUBMISSION` 时先调一次 `materialRequests.markSubmitted()`，模拟客户端提交 ｜来源: 2026-08-18 修复兑换域软线拒 restrictionNo 永久卡死时 e2e 验收发现
- [ ] **充值/提现域 awaitUser 现在会顺带开一张 WITHDRAW+SWAP 客户级便签，且 admin 模拟面板没有复核按钮能撕掉它(2026-08-18)**：`DepositApplicantActionsService`/`WithdrawApplicantActionsService.syncApplicantActions` 走 `issuer.register({ restrict: true, ... })` 未指定 scope，落 `PENDING_DOCUMENT` 因由的默认 scopes（`['WITHDRAW','SWAP']`，见 `restriction-cause.constant.ts`）——旧的 `deposit_applicant_actions`/`withdraw_applicant_actions` 子表设计从不碰 `customer_restrictions`，这是材料请求账带来的全新客户级联动，真实业务上说得通（材料没审过就该限制 WITHDRAW/SWAP），但有两个连带问题：① 命中既有的 `WithdrawWorkflowService.assertCustomerComplianceOrFreeze`（"A4 客户级合规闸"，`withdraw-workflow.service.ts:123`，payout-phase 检查点）——若客户在这笔提现本身还等着 Sumsub 复核期间就到了 payout-phase，会把**这笔提现自己**冻结（`test/withdraw-sumsub-scenarios.e2e-spec.ts` 的"补料完整弧"/"多条 action" 两条用例已实测复现，须在提交材料后额外调 `MaterialRequestReviewService.applyReview` 完成复核 GREEN 才能走到 PAYOUT_PENDING）；② 充值/提现两域的 admin 模拟面板都没有像 swap 域 V7_ACTION_GREEN/V8_ACTION_RED 那样的"认证复核"按钮可以喂 `applicantActionReviewed` 走完解锁弧——运营真在这两域模拟面板上单独走 awaitUser 场景，会把客户的 WITHDRAW/SWAP 能力卡死到只能手工 SQL 或等真实 Sumsub webhook 才能解开，没有 UI 入口。修法：`deposit-sumsub`/`withdraw-sumsub` 两域各补一个 V11/V12 级"认证复核 GREEN/RED"按钮（镜像 swap 域的 `verdict-buttons.ts` V7/V8 + `demo-scenario.service.ts` 的 `applicantActionReviewed` 分支）｜来源: 2026-08-18 修 deposit/withdraw sumsub e2e 编译错误时验收发现
- [ ] **材料账 `externalActionId` 全表 `@unique`，但 verdict-buttons demo fixture 对同一按钮固定复用同一个字面量，两次点击会 P2002(2026-08-18)**：`verdict-buttons.ts`（充值/提现/兑换三域）对 `V2_AWAIT_USER`/`V10_AWAIT_USER_MULTI` 等按钮写死同一个 `externalActionId` 字面量（如 `EXT-SOF-0001`、`EXT-MULTI-0001..3`），旧的 `deposit_applicant_actions`/`withdraw_applicant_actions` 子表按 `(depositTransactionId/withdrawTransactionId, seq)` 去重，互不冲突；材料账（`material_requests.externalActionId`）改成全表 `@unique`（不按客户/单号分段）之后，**任何两笔不同的订单**（不论同客户还是不同客户）只要先后点了同一个按钮，第二次 `issuer.register()` 会在 DB 唯一约束上直接 P2002，且不会被重试（`material-requests.service.ts` 的 `create()` 只重试 `requestNo` 撞号，`externalActionId` 撞号原样抛出）——这不只是 e2e 的问题，admin 的真实模拟面板上，操作员对同一客户（或不同客户）的两笔不同订单先后点"② Awaiting user"就会复现 500。`test/deposit-sumsub-verdicts.e2e-spec.ts`/`test/withdraw-sumsub-scenarios.e2e-spec.ts` 已在 `beforeEach` 里清空本 suite 自己登记的材料请求行绕过，未改生产代码。修法二选一：① fixture 改成按调用动态生成 `externalActionId`（更贴近真实 Sumsub 行为，每条 action 天生唯一）；② `syncApplicantActions`/`issue()` 遇到 P2002 时识别并转成对客户更友好的错误（治标不治本）｜来源: 2026-08-18 修 deposit/withdraw sumsub e2e 时验收发现
- [ ] **材料到期 cron 的扫描筛选值与 `customerMaterialHolding.status` 实际写入值对不上，`REFRESH_IN_PROGRESS` 之后的 holding 永远不再被任何一次扫描捡到(既有缺陷，非本轮引入)**：`material-freshness-cron.service.ts:31`（`scanHoldingsForStageTransitions()`）的筛选是 `status: { in: ['FRESH', 'NOTIFIED', 'URGENT', 'BLOCKING'] }`，但全仓 grep `customerMaterialHolding.update/create` 证实该字段实际只会被写成四个值：`FRESH`（`material-refresh.service.ts:323/452/555`、`admin-material-management.controller.ts:222`）、`REFRESH_IN_PROGRESS`（`material-refresh.service.ts:108/499`）、`EXPIRED`（`material-refresh.service.ts:168/200`）、`MISSING`（`material-refresh.service.ts:452`）——`NOTIFIED`/`URGENT`/`BLOCKING` 从未出现在任何写入点，它们是 `computeStage()`（`policy/compute-stage.ts`）的返回值，是 **cycle 的 `stage` 字段**取值，不是 holding.status 的取值。后果：holding 一旦被 `enterNotifiedStage()` 置成 `REFRESH_IN_PROGRESS`（T-30 就会发生），就**永远不再出现在任何一次 cron 扫描的候选集**里——`escalateToUrgent()`/`enterBlockingStage()` 这两个自动升档动作，生产环境里除了 admin 后台手动 `simulate-stage` 之外可能从未被自动触发过。连带：`handleSumsubDocMonitoringFire()` 也会被自己的 `if (holding.activeRefreshCycleId) continue` 挡住——T-30 建过 cycle 后这个条件恒真，Sumsub 主动上报证件过期同样叫不醒它。**已核实是既有缺陷**：`git show 71483d0d:...material-freshness-cron.service.ts` 基线上就是这个筛选条件（`git log 71483d0d..HEAD -- .../material-freshness-cron.service.ts` 零提交），本分支（材料请求账 Task 11）对该文件零改动；holding.status 实际取值只有那四个也已现场 grep 核实，非猜测。修法二选一，需先确认设计意图：① 筛选改成 `['FRESH', 'REFRESH_IN_PROGRESS']`（cron 应该关心的是"还没到终态"的 holding，不该按 cycle 的 stage 词汇筛 holding 表）；② 让 `holding.status` 真的跟着 stage 走（`enterNotifiedStage`/`escalateToUrgent`/`enterBlockingStage` 各自把 holding.status 同步写成 `NOTIFIED`/`URGENT`/`BLOCKING`，筛选条件不用改，但要评估这四个新状态值对其它读 `holding.status` 的地方——如 admin 列表页/客户端 profile-banners——是否会产生连带展示影响）｜来源: 2026-08-18 材料请求账 Task 11 评审核实（既存缺陷，登记不改代码）
- [ ] **Swap/Withdraw 页 `PendingActionBanner` 与 `RestrictionBanner` 对同一条挂限制的材料请求各显示一张卡，重复(2026-08-18 Task 14 真机截图发现)**：`PendingActionBanner.tsx`（本轮改读 `/client/me/material-requests`，按 G6 显示「挂了限制的」∪「没绑单的」）与 `RestrictionBanner.tsx`（读 `/client/me/restrictions`，显示所有 `visibility=DISCLOSED` 的 OPEN 限制便签，含 `PENDING_DOCUMENT`/`MATERIAL_EXPIRED` 因由）两个组件都挂在 Swap.tsx/Withdraw.tsx 顶部，对**同一张**挂了限制的材料请求各自渲染一张卡（真机截图实测：demo_alice 挂 `Source of Wealth`/`Liveness` 两条 BLOCKING 材料请求时，Withdraw 页顶部先出现 PendingActionBanner 的两张卡，紧接着 RestrictionBanner 又各出一张「DOCUMENT REQUIRED」卡，共四张卡描述两件事）。CustomerProfile.tsx 一侧的同类重复（`ProfileBannerStack` vs 旧 `PendingActionBanner`）已在本轮直接摘掉 Profile 页的 `<PendingActionBanner />`（该页material request 覆盖已在 Task 11 并入 `ProfileBannerStack`）；但 Swap/Withdraw 页没有 `ProfileBannerStack`，`PendingActionBanner` 仍是这两页材料请求的唯一入口，不能照样摘掉。`RestrictionBanner.tsx` 文件头注释明确写着"本组件只做一件事……禁止在这里补任何……推导逻辑"，本轮未touch该文件。修法待定，需要业主拍板：①`RestrictionBanner` 增加"跳过 cause∈{PENDING_DOCUMENT,MATERIAL_EXPIRED} 且已被材料请求覆盖"的过滤（对称于 Task 11 给 `profile-banners.service.ts` 加的 `claimedRestrictionNos` 去重，但这次要挪到 client 组件或后端 `/client/me/restrictions` 端点)；②或反过来让 `PendingActionBanner` 只处理未绑限制的提醒行，把"挂了限制"的展示职责完全交给 `RestrictionBanner` ｜来源: 2026-08-18 材料请求账 Task 14 真机截图验收发现
- [ ] **被 `REJECTED` 的材料请求，其便签长期挂着无人清理，无 SLA 提醒（设计稿 §9 Q3）**：材料请求行走到 `REJECTED`（RED·FINAL）是终态，但它挂着的便签（`restrictionNo` 指向的 `customer_restrictions` 行）不会跟着自动撕——两种 RED 都不撕便签是本设计刻意的（`MaterialRequestReviewService.applyReview()`：只有 GREEN 才 `autoRelease()`），但 FINAL 与 RETRY 不同：RETRY 客户还能再交、有机会转 GREEN 自动解开；FINAL 是死路，客户唯一的解法是靠运营再下发一次新的材料请求（走 `restrict:true` 挂到同一张便签或开新的），或运营手工去限制账页面撕票——现设计没有任何 SLA/看板提醒运营"这张便签背后的材料请求已经死路一条，光等客户自己不会有下文"。本轮不做，登记 BACKLOG ｜来源: 设计稿 `doc-final/superpowers/specs/2026-08-17-material-request-ledger-design.md` §9 Q3

<!-- 2026-08-23 第五批「admin 三域页面模块级前端统一」登记 -->
- [ ] **三域 Owner 按客户号搜索全是坏的（实证）**：三个列表页输入框都写 `Owner No`，但充值/提现发 `ownerNo`（后端 QueryDto 只有 `ownerId`）→ `main.ts` 的 `ValidationPipe({whitelist:true})` **静默丢弃** → **输什么都返回全量**；兑换把客户号塞进 `ownerId` → 拿客户号比 UUID → **恒 0 行**。实测 `30/30/0`、`83/83/0`、`59/59/0`。修法：三个 QueryDto 加 `ownerNo`，service 穿 `customer: { customerNo }` 关系过滤（**充值表没有 ownerNo 冗余列**，三域要一致只能走关系）；⚠️ 三域 `findAllForCustomer` 都是 `{ ...query, ownerId: customerId }` 的 spread，必须 AND 语义 + 显式剥掉，否则客户传别人客户号能跨客户读单 ｜来源: 2026-08-23 第五批设计期实证（本批「严格只做前端」故未修）
- [ ] **充值/提现详情页看不到资金腿重试次数**：后端三域都做了重试三级梯，但只有兑换前端把 `attempt` 显示出来（充值/提现详情页 `attempt` 零出现）。统一关联资金单模块（把兑换的 `LegAttemptRow` 与共享 `LinkedRelationCard` 合一）之前，需先确认充值/提现详情响应带不带 `attempt` ｜来源: 2026-08-23 第五批（业主裁定乙：本批不动）
- [ ] **「按键 × 按状态」置灰精度**（两条同族，合并登记）：① 兑换 ①Approved 在 SUCCESS/REJECTED 上确是真 no-op 却没被灰（8 键里 1 个过度点亮）；② 充值/提现的 ⑧ On hold 在非 `COMPLIANCE_PENDING` 上是纯 no-op（后端 `decideVerdictLanding` 有 `verdict==='onHold' && status!==COMPLIANCE_PENDING → IGNORE`）却仍可点。两者方向都安全（不误灰），修法都需要引入「按键 × 按状态」矩阵 ｜来源: 2026-08-23 第五批 Task 7 审查
- [ ] **兑换列表列顺序与充值/提现不同**：兑换是 `Swap No, Owner, Sell, Buy, Rate, Spread, Status, Stage, SLA, Review, Created`（Owner 第 2、Status 第 7），充值/提现是 `单号, Status, Amount, Type, Owner, SLA, Review, Created`（Status 第 2、Owner 第 5）。本批只统一了筛选控件与 Review 列，**列顺序不在范围内** ｜来源: 2026-08-23 第五批终验
- [ ] **资产类型筛选的交互手感三域不一致**：充值/提现写在 `fetchItems` 里（改下拉**要点 Search 才生效**），兑换写在 `visibleItems` memo 里（**即时生效**）。都是页内过滤、都合本批规格，但同一控件手感不同。兑换那种更好，统一需把充值/提现也搬进 memo ｜来源: 2026-08-23 第五批 Task 8 审查
- [ ] **三域 SLA 徽章与 `Simulate SLA Timeout` 用裸 Tailwind 色**（`text-red-600`/`bg-amber-50` 等），违反 `rules/frontend-admin.md` 的「只用 adm-* token」。三域 3/3 一致，**只改一域会把既有技术债变成新漂移**，要改就独立一轮三域一把改 ｜来源: 2026-08-23 第五批
- [ ] **三域 `fetchData` 里的原生 `alert()`** —— 同上，3/3 一致，属既有债不属漂移 ｜来源: 2026-08-23 第五批
- [ ] **兑换时间线 `operator` 恒为 `'SYSTEM'` 字面量**（`swap-transactions.service.ts` 的 statusHistory 写入点硬编码），时间线永远看不到是谁操作的 ｜来源: 2026-08-23 第五批 Task 3
- [ ] **`tags: string[]` 三域 Sumsub DTO 都声明、全 admin-web 零渲染**（后端 `parseDetail` 确实在填）｜来源: 2026-08-23 第五批 Task 2 审查
- [ ] **另 12 个列表页有同款「页脚重影」**：`Pagination`（`components/common/Pagination.tsx`）默认形态**自己就是一整条页脚**（`border-t bg-adm-panel px-6 py-3` + 自带 `Showing X to Y of Z entries`），全仓 28 个消费者里有 13 个在它外面又套了一条手写页脚 → 超过一页时**两条边框叠一起、两个 Showing 并排**。2026-08-23 第五批已给三个交易列表页收口（新增 `components/common/ListFooter.tsx` + 给 `Pagination` 加 `bare` 开关，默认行为对其余 25 个调用方逐字不变），**剩余 12 个页面照旧**：EvidenceExports / RoleChangeRequests / RiskAssessmentList / RefreshCycles / CustomerManagement / SumsubEvents / MaterialManagement / FundsOrderList / WithdrawalAddressList / CustodianWalletList / PolicyChangeRequests / Approvals。迁移只需换成 `<ListFooter>` ｜来源: 2026-08-23 第五批终审
- [ ] **详情页顶部横幅有三个承载物**：共享件 `NeedsReviewBanner`（红条，第五批抽出）/ 手写绿色 notice 条 / 充值独有的手写琥珀 CONFISCATING 条。绿条**兑换那份已分叉**：`bg-adm-green/10 + py-2 + 缺 shrink-0`，充值/提现是 `/5 + py-2.5 + shrink-0` —— 与红条被抽件前的病**一模一样**，红条修了绿条没碰 ｜来源: 2026-08-23 第五批终审
- [ ] **`Simulate SLA Timeout` 是六个页面里唯一绕过 `adminButtonClass` 的按钮**：三份手写、裸 Tailwind 调色板（`border-amber-300 text-amber-700 hover:bg-amber-50`）而非 `adm-*` 令牌，字号 `text-sm` 比全站按钮 `text-[11px]` 大一档、`py-2` 比 `py-1.5` 高。`adminButtonStyles.ts` 的 `repair` 变体正是为它这种琥珀警示按钮准备的 ｜来源: 2026-08-23 第五批终审
- [ ] **⚡ Simulation 面板 markup 仍是三份手写**：充值/提现两份做域名归一化后 diff **只差 1 行**（按钮数组名），其余 33 行逐字重复。今天零视觉差异，但这正是 L2 闸门格子当初分叉出三套排版的前一阶段状态 ｜来源: 2026-08-23 第五批终审
- [ ] **列表页 error 态位置三域不同**：充值/提现是表**上方**红色通条（表格数据仍在），兑换是表**体内** `<td colSpan=11>`（**整表内容被顶掉**）｜来源: 2026-08-23 第五批终审
- [ ] **侧栏 Terminal 提示三域三样**：充值**整块没有**、提现在 SLA 组**之前**（`text-[11px]`）、兑换在 Lifecycle 组**之后**（`text-[10px]`）。且兑换那个裸 `<p>` 放在 Lifecycle 之后会让 `SidebarGroup` 的 `last:border-b-0` 失效 → **多出一条本不该有的分隔线** ｜来源: 2026-08-23 第五批终审
- [ ] **兑换 `Internal Approvals` 空态是手写 div**，充值/提现用共享 `LinkedRelationEmpty`（后者在消息上方还有一行 cap 微标签）→ 同一张卡的空态，另两域有小标题、兑换没有 ｜来源: 2026-08-23 第五批终审
- [ ] **三页各手写一份逐字相同的「本单已进终态/处置态」`<p>`**（第五批 Task 7 引入，className 与文案全同）—— 同职责内联三份，正是本批立规矩要消灭的形状 ｜来源: 2026-08-23 第五批终审
- [ ] 🔴 **`scripts/stack.sh` 从不跑迁移 —— 每次改 schema，跑着的栈都会悄悄留在旧库上**：`grep -c 'migrate\|prisma' scripts/stack.sh` = **0**。`stack.sh up` 会自愈 `.env`、切 node20、重建后端，但**不迁移**。2026-08-24 实测后果：main 栈的库停在 `20260817020000_drop_legacy_action_stores`，第四批的 `20260822010000_batch4_needs_review_and_l1` 从没应用过 → `l1Snapshot` / `needsReview` 列根本不存在，业主在 admin 上看不到 L1 闸门，误以为"第四批没合进 main"（代码其实早在 main 上，merge `6236d9b9`）。**这是个会反复咬人的坑**：只要有人改 schema 又没手动 `prisma migrate deploy`，跑着的栈就与代码脱节，且没有任何报错提示。修法二选一：① `stack.sh up` 里加一步 `prisma migrate deploy`（幂等，已应用的迁移不会重跑）；② 加一步 `prisma migrate status` 检查，有待应用迁移就 fail-closed 并打印提示。⚠️ 顺带：`npm run runtime:diagnose` 号称"诊断迁移漂移"，但它不在 `stack.sh` 的路径上，没人会主动跑 ｜来源: 2026-08-24 业主问"为什么 gate1 那些没有在 main"时查出

## 演示装备（2026-08-26 批次三实测盘点）

- [ ] **充值域审计日志切新词表**：充值域仍写旧审计合同 → 重铺后新词表下查不到充值链、第七幕追溯断在充值 ｜ 批次三实测 verify:audit 5 项挂的三分之一 ｜ 随 V4 模块 Phase 4 回收一并切
- [ ] **提现域审计日志切新词表**：同上，断在提现 ｜ 同上 ｜ 随 V5 模块 Phase 4 回收一并切
- [ ] **兑换域审计日志切新词表**：同上，断在兑换 ｜ 同上 ｜ 随 V6 模块 Phase 4 回收一并切（三条合起来取代原「重铺后审计新词表零写入」单条与「三域日志梳理」合并条——三域全切完，重铺后 demo:all 天生写新合同，第七幕不再冷场）
- [ ] **审批流与审计检索无专属验收用例**：test-cases 里 V1 只有 TC-09（RBAC），maker/checker 审批链、SoD 拒绝、审计按单号/旅程检索均无用例——第一幕/第七幕的验收没有依据 ｜ 2026-08-26 V1 模块文档改写时发现 ｜ 待补 TC-10（审批+审计）
- [ ] **客户与合规无专属验收用例**：TC-01~09 无客户/开户/限制/持续尽调篇——第二幕验收没有依据 ｜ 2026-08-26 V2 模块文档改写时发现 ｜ 待补 TC-11（客户）
- [ ] **一期客户流程重做（接真 Sumsub 申请人侧）**：入驻流程 / 定期风评（CRA）/ 高风险升级案已于站6 整体拆除（业主 2026-08-27 方案2：演示零损失、免去"翻新旧的再推倒"双份工）。重做落点：申请人侧 Sumsub 集成（建充值地址时同步注册 applicant 绑定已是既定集成点）、开户 happy path、AML 命中走限制账、EDD 走审批。重建时直接在新审计合同上出生（词表/子表/旅程号第一天就对）；摄取分发器的 unrouted 警告处即重新开路的位置 ｜ 来源: 站6 业主拍板
