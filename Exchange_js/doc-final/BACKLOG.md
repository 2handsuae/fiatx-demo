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
- [x] ~~**缺"真实卡单"demo 场景演完整 heal 闭环**~~：**已兑现（2026-07-04 canon2 T6）**。`demo:in-transit --verify`（真实卡提现，非状态壳）端到端实证：DETECTION 落 IN_TRANSIT 残差 0 → 推单 sync CLEARED → 等净额 POST 落库 → 重对账 **delta=0**、卡腿脱离 IN_TRANSIT（连跑无 reset 3 次幂等 PASS）。case 自愈到 RESOLVED/AUTO_HEALED 需钱包零异常达 MATCHED（复用 demo 钱包有历史内部单腿 → SOFT_FLAG），该路径由单测 `wallet-recon-run.service.spec.ts`（"breaks in run A then recovers in run B → RESOLVED/AUTO_HEALED"）证明｜来源: 2026-07-03 推单 T5 → 2026-07-04 canon2 T6 收口

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

## 交付 / 可移植 Docker（2026-07-04 本会话新增）

- [ ] **launch.json 治理（待决策）**：`.claude/launch.json` 全机器专属绝对路径 + 预览工具自动重生成 stale 配置（settle-opt/claude-admin 反复回填）；已经 `.gitattributes` export-ignore 不进交付包，但仍被 git 跟踪。待决策：gitignore 停止跟踪、交预览工具本地生成 ｜来源: 2026-07-04 可移植 Docker
- [ ] **Docker `tb-format` 非幂等**：重跑演示需先 `docker compose down -v` 清账本端数据卷（否则 format 撞已存在文件报错）；可给 format 加 if-missing 守卫做到重跑免 down -v ｜来源: 2026-07-04 Docker 交付
- [ ] **Docker Desktop Mac 4.42+ io_uring 风险留账**：新版 Mac 版可能 VM 级封 io_uring，`seccomp=unconfined` 也救不回 → 退 OrbStack（已写进 `READ-ME-FIRST.md`，此处备查）｜来源: 2026-07-04 Docker 交付
- [ ] **泄露 dev `.env` 仍在 git 历史**：`.env` 已 `git rm --cached`（合 c80ce5e）+ 本地换新 MFA key 作废旧值；旧值仍留在历史（用户选不重写历史，属 demo key）。若确认该 key 曾用于任何真实用途，需重评是否 filter-repo 抹历史 ｜来源: 2026-07-04 一级审计
## demo / 对账脚本（canon2 收尾）

- [ ] **`recon-demo.ts` MANIFEST_PATH 写死 main tmp**：默认 `/tmp/exchange_js_main/recon-demo-manifest.json`（可 `RECON_DEMO_MANIFEST_PATH` 覆盖）；self 栈跑 `recon:demo:break` 时 manifest 落 main 栈 tmp、非本 worktree tmp。不影响评分（verifyManifest 读内存 manifest 对象、不回读文件），仅文件落点跨栈。修法：默认按 `DATABASE_URL` 派生 tmp 目录，或 on-stack 包装器注入 `RECON_DEMO_MANIFEST_PATH` ｜来源: 2026-07-04 canon2 T5 code-review（M2）

## 账本流水（2026-07-10 本会话新增）

- [ ] **账本流水未排除 pending（「落账才进流水」，本期业主跳过）**：投影器 `account-flow-projector.persist()` 当前对 pending/lock 阶段的转账**也**写流水行（现存 4 条 `transferType=PENDING` 流水行）。目标口径=流水只体现**已落账 posted**：pending 阶段不进流水、`VOID_PENDING` 永不生成，凭证表照旧记 pending。落地=`persist` 在 post 那刻才写流水行（pending 跳过 persist）+ 一次性清历史 pending 流水行。业主 2026-07-10 明确本期跳过 ｜来源: 2026-07-10 账务三列表细化 brainstorm（spec `superpowers/specs/2026-07-10-ledger-lists-refinement-design.md` §6）

> 注：外部合规派生的欠账（VARA/FATF 条款驱动，非本 repo 可核）不入本文件——它们活在 roadmap 的 ⚖️ ADVANCED 条目里。BACKLOG 只记能对着本仓库代码/文件自证的账。
