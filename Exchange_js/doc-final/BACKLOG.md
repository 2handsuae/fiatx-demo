# 技术债与遗留事项台账

> **唯一登记处。** 凡在 spec/plan/会话里说出"以后做 / 推后 / Phase X 处理 / deferred"，必须同时在这里记一行，并链回出处。做完就勾掉。
>
> **分工**：功能性的"以后做"（工作流/用户能感知的能力）进 roadmap 的 ADVANCED/OPTIMIZED；技术性的"以后做"（死码/技术债/小修/待决策/文档漂移）进本文件。
>
> 一行四要素：**是什么 ｜ 哪来的 ｜ 落点/状态**。

Last Updated: 2026-07-03

---

## 死码清理（Phase C 统一清扫）

- [ ] 五公式旧对账链 provider 仍注册未删（BalanceRecon / MatchEngine / ClassifierService / InternalActionsService / LegProjection 等，模块注释自认 wallet-* 三件套才是 sole live path）｜来源: 2026-07-03 死码体检 ｜Phase C
- [ ] 证据包防御死分支：`complianceAlert / complianceIncident / journal / clearing / kytCase / travelRuleCase` 模型均不存在，audit-logs.service 仍带可选链查询（`?.findMany` 优雅降级不炸，但恒空）｜来源: 2026-07-03 死码清理（超清单范围未动）｜Phase C
- [ ] `reconciliation.constants.ts` 的 `L.TRADE_CLEARING` 常量（credit-net 旧引擎残留）｜来源: 2026-07-03 死码体检 ｜Phase C
- [x] ~~subledger-inputs.service + repo 两死方法 / governance-demo-seed / 10 个死权限常量 / REIMBURSEMENT_OBLIGATION 常量 / internalTransaction+outstanding 证据包死链~~ ｜已在 worktree 删除（−651 行，tsc/jest 全绿）待合 main

## 技术债 — V4 充值

- [ ] Deposit/资金单层无 `txHash` 唯一约束（仅信号层 `dedupeKey` 有）→ 同 txHash 可能产生多 Deposit ｜来源: 2026-07-03 V4 体检
- [ ] TB 记账失败无 repair surface：仅记 `DEPOSIT_ACCOUNTING_BLOCKED` 审计后卡住 ｜来源: roadmap V4 待实现
- [ ] `deposit.status.changed` 用 `emit` 非 `emitAsync`，异常不传播到调用方 ｜来源: roadmap V4 待实现
- [ ] Admin PATCH deposit status 部分绕过 workflow：仅 SUCCESS 被 `DEPOSIT_APPROVE_WORKFLOW_ONLY` 守卫，FREEZE/CONFISCATE 可绕过记账与审计 ｜来源: 2026-07-03 V4 体检
- [ ] ERC-20 合约失败交易未过滤（合约执行失败仍建 Payin）｜来源: roadmap V4
- [ ] KYT 超时转人工未做 ｜来源: roadmap V4
- [ ] 区块重组自动回退未做（与"按链确认数配置"一起设计，该功能项在 roadmap V4 ADVANCED）｜来源: roadmap V4

## 技术债 — V3 财务配置

- [ ] TB 账户创建失败无 backlog 重试（仅转账凭证 `TbEvidenceBacklog` 有）｜来源: 2026-07-03 V3 体检
- [ ] `contractAddress` 字段 schema/DTO 残留（前端已移除）｜来源: 2026-07-03 V3 体检
- [ ] 资本注入流水缺 evidence 行（`FIRM_ASSET` 流水缺资本那笔）｜来源: V8 redesign 遗留

## 技术债 — V5 提现

- [ ] Sumsub KYT/TR 真实集成未做：仅模拟端点；`archivePostKyt()` 明确注释为 stub，待替换真实 PATCH /kyt/txns 调用 ｜来源: 2026-07-03 V5 体检
- [ ] 热钱包余额校验无：Payout 前不查 Outbound Wallet 余额，不足不显式失败 ｜来源: 2026-07-03 V5 体检
- [ ] 提现成功通知未接：SUCCESS 时不调 `NotificationsGateway`（基础设施在、workflow 没调）｜来源: 2026-07-03 V5 体检
- [ ] TB 记账失败 repair surface 偏薄：靠 `assertWithdrawSettled()` fail-closed 卡在 PAYOUT_PENDING 等人工，无专用修复 UI/端点 ｜来源: 2026-07-03 V5 体检
- [ ] 前后端 FROZEN 漂移：前端 `Withdraw.tsx` tipping-off 过滤引用 FROZEN，但后端 withdraw 枚举无此态（映射本身正常）｜来源: 2026-07-03 V5 体检
- [ ] 模拟端点缺 `simulate/payout-confirmed`：只有 kyt-phase1/2 + travel-rule，payout 确认改走 funds_order advance（非缺失，记录以免误判）｜来源: 2026-07-03 V5 体检

## 技术债 — V6 兑换

- [ ] **FAILED/REVERSED 死枚举**：`SwapTransactionStatus` 定义 FAILED/REVERSED 但全代码无 `markStatus` 设置（只调 SUCCESS）→ 不可达；控制器只有 advance/resume，**无 reverse 端点**（roadmap 曾标 ✅2026-06-26 整笔冲正实为过度声明）。需求要么补 reverse+FAILED 状态机，要么删死枚举 ｜来源: 2026-07-04 V6 体检
- [ ] 无自动 FAILED 状态机：腿失败走自愈→STUCK(needsReview)+手动 resume，swap 留 PROCESSING，无终态失败（设计 deferred）｜来源: 2026-07-04 V6 体检
- [ ] Sumsub TM 真实集成未做（大额兑换合规）｜来源: 2026-07-04 V6 体检
- [ ] Quote TTL 无 cron sweep：仅懒过期（查询时 markExpired）｜来源: 2026-07-04 V6 体检
- [ ] 兑换成功通知未接（SUCCESS 时不调 Notification）｜来源: 2026-07-04 V6 体检
- [ ] TB 记账失败无专用 repair surface（仅 resume 重试，无修复 UI/端点）｜来源: 2026-07-04 V6 体检
- [ ] 架构命名漂移：roadmap 写"SwapSettlementService"该类不存在，实为 SwapWorkflowService+SwapLegAccounting+SwapTransactionsService（文档订正即可，非代码债）｜来源: 2026-07-04 V6 体检
> 注：swap 腿 InternalFund 命名债已并入下方「平账处置」的 funds-orders 域 RBAC 命名债条目，不重复登记。

## 技术债 — 平账处置（推单）

- [ ] **swap 腿推单未支持**：通用推单按钮（`/admin/funds-orders/:no/push/sync|manual`）明确排除 swap 腿——`advanceByNo`/编排服务见 `swapTransactionId` 非空即拒（现有先卖后买顺序守卫防线），且回填 effectiveDate 需再穿透 swap 4 腿两阶段记账链（工作量≈deposit+withdraw 之和）。swap 腿卡单本期走 **Swap 详情页 `advanceLeg` 专用推进**（带顺序守卫），但该路径**暂无 effectiveDate 回填** → 推完历史那天快照修不平 ｜来源: 2026-07-03 推单 plan 落地发现（spec §2/§8）｜下期：swap workflow 记账链穿透 effectiveDate + 推单接 swap 腿
- [ ] **推单/sim-advance 端点用 INTERNAL_FUND_READ 读权限门控变更操作**：/admin/funds-orders/:no/push/sync|manual + :no/advance 都是变更/动钱操作却挂 _READ → 读权限 operator 也能推单结算。应新增**写/处置权限**统一门控三端点（需 db:base:sync + 重启）｜来源: 2026-07-03 推单 T3 code-review M-2 ｜下期专门 RBAC 轮（与下条命名债一并做）
- [ ] **funds-orders 域 RBAC 权限 + 审计实体仍用 rename 前旧名 `INTERNAL_FUND`**：Round 2 表 `internal_funds`→`funds_orders`（2026-07-02）后，权限 `INTERNAL_FUND_READ`（rbac.catalog.ts:44/581-586 整个 funds-orders 域唯一权限）+ 审计实体 `AuditEntityTypes.INTERNAL_FUND`（audit-actions.constant.ts:58，Spec#4 短名）均未跟随重命名 → 域叫 funds order、门禁/实体叫 internal fund，不一致。应统一改 `FUNDS_ORDER_READ` / 新增 `FUNDS_ORDER_DISPOSE` + 审计实体 `FUNDS_ORDER`（rbac catalog union 类型 + 全部 route + AuditEntityTypes + 引用点 + db:base:sync；审计实体改名要评估历史 audit_log_events 旧值兼容）｜来源: 2026-07-03 用户审阅推单 BACKLOG 发现 ｜下期 RBAC 轮同做
- [ ] **缺"真实卡单"demo 场景演完整 heal 闭环**：推单机制全证（状态驱动+回填生效日+审计+重对账触发+穿透链三层），但「推真实卡单→记账→重对账吸收→case AUTO_HEALED」端到端未在 demo 演出——recon:demo 6 充值/5 提现全 SUCCESS、scenario-1 是挂已 SUCCESS deposit 的状态壳，推之不产生新记账（onPayinConfirmed 见非 PAYIN_PENDING 正确跳过）。需新增 demo 场景：充值走到 PAYIN_PENDING 就停、造真实在途单，端到端演 delta→0 自愈（代码正确性已追码核实，此为可演示性/测试债）｜来源: 2026-07-03 推单 T5 e2e Option B ｜用户选"先合并 demo 另起"，下期独立小活

## 待决策（等业主拍板）

- [ ] **限额执行接入 vs 明示退役**：表和审批管道已建，执行侧零消费 ｜来源: 2026-07-03 V3 体检
- [ ] **金额闸门矩阵**：tier 限额 + 大额审批 20 万 + TR 阈值 3,500 三线合一后再统一接入 L1（避免接完旧表又改）｜来源: 限额重设计 + TR 调研（roadmap V3 ADVANCED）
- [ ] **客户 TB 账户创建策略**：补事件驱动异步创建 or 认可懒加载 + 补文档 ｜来源: 2026-07-03 V3 体检
- [ ] **InternalFundAuditLog 有读无写**：Round 2 后零写入方，详情页审计列表永远空——补写状态变更 or 改读中央审计日志 ｜来源: 2026-07-03 死码 D6 改判（勿删表，有活读取链）
- [ ] **资金单合并可行性**：payin/payout/internalfund 状态机近同构，可评估进一步合并 ｜来源: Round 2 遗留

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

> 注：外部合规派生的欠账（VARA/FATF 条款驱动，非本 repo 可核）不入本文件——它们活在 roadmap 的 ⚖️ ADVANCED 条目里。BACKLOG 只记能对着本仓库代码/文件自证的账。
