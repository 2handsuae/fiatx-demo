# V7 内部转账流程 — Crypto MVP 设计

> 状态：设计已评审通过（pre-implementation）
> 日期：2026-06-03
> 范围：V7 内部转账 MVP，**本轮只做虚拟币（CRYPTO）**；法币（FIAT）连同 BANK_BOUNCE 偿付、per-VA spawn、CMA、FIAT 状态机另起一轮，待 Zand 答复后单独 brainstorm。
> 关联基线：`doc-final/reference/v7-funds-layer-baseline.md`、`doc-final/reference/roadmap.md`（V7 节）

---

## 0. 一句话定义

V7 把前面版本（V4 充值 / V5 提现 / V6 兑换）"账面已记、物理未动"的资金，在公司钱包之间做真实的链上移动；EOD 对 swap 产生的待交割头寸轧差结算，并归集收入型手续费。**所有内部转账都是真实链上交易，无纯账面划拨。本轮仅 crypto 路径。**

---

## 1. 核心设计决策（评审定稿）

| 维度 | 决策 |
|---|---|
| 旧代码处置 | **新模块 `funds-layer/` + port 已验证核心引擎**（双状态机、轧差逻辑），不从零重写 |
| Schema | **复用现有表**，按需加列，不建新表（保护 Outstanding FK 链） |
| 执行层 | **先 mock 后接真**，simulate 端点推进状态机（对齐 V4/V5） |
| 审批门 | **常规路径全自动 + 偿付义务带审批门** |
| 前端 | **垂直切片**，每 phase 配套 Admin 监控页 |
| 范围 | **纯 crypto**，法币完全另起一轮 |
| FeeOccurrence | **整表删除**（含 V5 payout captureFromPayout），属 Wave-8 遗留、V7 baseline 已 supersede |

---

## 2. 模块架构

`src/modules/funds-layer/`，严格三层架构。所有 service 操作现有 Prisma 表，是这些表的新 owner；旧 `asset-treasury/internal-*` 模块在对应路径迁移完成后移除。

```
funds-layer/
├── constants/
│   ├── internal-transfer-paths.constant.ts   # 6 条 crypto 白名单 + AccountingClass + Medium
│   └── funds-layer-events.constant.ts          # 域事件（注册到全局 domain-events.constants.ts）
├── domain/                          # L1 — 数据操作 + 实体不变量，写方法接 tx?: TransactionClient
│   ├── funds-flow.service.ts              # ← port InternalFundsService（CRYPTO 状态机，去掉 captureFromInternalFund）
│   ├── internal-transfer.service.ts       # ← port InternalTransactionsService（聚合 + 幂等创建）
│   ├── settlement-batch.service.ts        # ← port OutstandingSettlementsService（CRYPTO 轧差引擎）
│   └── reimbursement.service.ts           # ← port ReimbursementObligationsService（补状态机）
├── workflow/                        # L3 — 完整旅程，编排 domain + 写业务审计 + 订阅事件
│   ├── internal-transfer-workflow.service.ts   # 通用内部转账工作流（所有路径底座）
│   ├── deposit-aggregation-workflow.service.ts # 充值归集
│   ├── eod-settlement-workflow.service.ts       # EOD 兑换结算编排
│   ├── fee-collection-workflow.service.ts       # 手续费归集
│   └── reimbursement-workflow.service.ts        # 偿付义务
├── approval/                        # L2 — 仅偿付义务有审批门
│   └── reimbursement-approval.service.ts        # extends ApprovalHandlerBase（4 常量）
├── sweep/                           # Cron 适配器（@Cron 仅此处，找候选→直调 workflow）
│   ├── deposit-aggregation-sweep.service.ts
│   ├── eod-settlement-sweep.service.ts
│   └── fee-collection-sweep.service.ts
├── accounting/
│   └── funds-accounting.service.ts        # A 类零 TB / B 类 drain，调 AccountingService
├── adapters/
│   └── mock-custodian-execution.adapter.ts  # mock HexTrust 链上执行
├── guards/
│   └── whitelist.guard.ts                  # 白名单校验（非白名单立即拒绝）
├── controllers/
│   ├── internal-transfer-admin.controller.ts
│   ├── settlement-admin.controller.ts
│   ├── reimbursement-admin.controller.ts
│   └── funds-simulate.controller.ts        # DEV simulate 端点
└── dto/
```

---

## 3. 词汇模型 — Crypto 白名单（6 条）

`whitelist.guard.ts` 据此校验；非白名单 from-to 立即拒绝、不创建 funds flow。

```ts
export enum TransferPath {
  AGGREGATE    = 'AGGREGATE',     // 充值归集: 客户充值地址 → Main
  FUND_OUT     = 'FUND_OUT',      // 出金预归集: Main → Outbound
  FUND_RETURN  = 'FUND_RETURN',   // 出金退回: Outbound → Main
  INTERNAL_OUT = 'INTERNAL_OUT',  // 兑换卖出交割: Main → Liquidity
  INTERNAL_IN  = 'INTERNAL_IN',   // 兑换买入交割: Liquidity → Main
  FEE_COLLECT  = 'FEE_COLLECT',   // 手续费归集: pool(Main) → Ops
}

export enum AccountingClass { A = 'A', B = 'B' }   // A=零 TB / B=drain TRADE_CLEARING|FEE_RECEIVABLE
export enum TransferMedium { CHAIN = 'CHAIN' }      // 本轮恒为 CHAIN；BANK 随法币推后

export const TRANSFER_PATH_WHITELIST = {
  AGGREGATE:    { from: 'C_DEPOSIT', to: 'C_MAIN', class: 'A', medium: 'CHAIN', trigger: ['CRON','THRESHOLD'] },
  FUND_OUT:     { from: 'C_MAIN',    to: 'C_OUT',  class: 'A', medium: 'CHAIN', trigger: ['WITHDRAW'] },
  FUND_RETURN:  { from: 'C_OUT',     to: 'C_MAIN', class: 'A', medium: 'CHAIN', trigger: ['WITHDRAW'] },
  INTERNAL_OUT: { from: 'C_MAIN',    to: 'F_LIQ',  class: 'B', medium: 'CHAIN', trigger: ['EOD'], drain: 'TRADE_CLEARING' },
  INTERNAL_IN:  { from: 'F_LIQ',     to: 'C_MAIN', class: 'B', medium: 'CHAIN', trigger: ['EOD'], drain: 'TRADE_CLEARING' },
  FEE_COLLECT:  { from: 'C_MAIN',    to: 'OPS',    class: 'B', medium: 'CHAIN', trigger: ['CRON'], drain: 'FEE_RECEIVABLE' },
};
```

- 旧 `type`(DEP_TO_MASTER…) / `purpose`(DEPOSIT_COLLECTION…) / `initiationMode` 字段保留 legacy 只读，新逻辑只认 `pathLabel`。
- 钱包角色实现前核对真实 `WalletRole` 枚举；`C_DEPOSIT`/`C_OUT`/`OPS` 映射到真实角色名（缺 `OPS` 则补）。
- crypto INTERNAL-OUT/IN 仅 `C_MAIN ↔ F_LIQ`，**无 CMA、无集中账户歧义、无 per-VA spawn**。

---

## 4. 数据模型与 Schema 变更

### 4.1 现有表 → baseline 5 层模型映射（不重建关系）

| baseline 概念层 | 现有表 | V7 角色 |
|---|---|---|
| 执行层 funds flow | `InternalFund` | 一笔链上 tx；CRYPTO 双状态机已完整 ✅ |
| 资金单 transfer order | `InternalTransaction` | **通用内部转账工作流根主体**；pathLabel 挂这里 |
| 编排层 Transaction（结算单） | `OutstandingSettlement`(+`Item`) | 仅 EOD + 费用归集；轧差 N:1 ✅ |
| 交割义务 | `Outstanding` | V6 建、V7 消费；`closedByInternalFundId` 已就位 ✅ |
| 偿付义务 | `ReimbursementObligation` | 解耦改造（见 4.4） |

链条：`OutstandingSettlement → Item → InternalTransaction → InternalFund`，已跑通。
A 类走 `InternalTransaction → InternalFund`（无 Settlement 父）；B 类多一层 Settlement 编排。

### 4.2 InternalTransaction — 加 5 个 V7 字段

```prisma
pathLabel       String?   // TransferPath 枚举（白名单校验依据）
accountingClass String?   // 'A' | 'B'
medium          String?   // 'CHAIN'（本轮恒为 CHAIN）
triggerSource   String?   // 'CRON' | 'THRESHOLD' | 'WITHDRAW' | 'EOD'
traceId         String?   // 审计序列穿透（现表无此列）
@@index([pathLabel])
@@index([traceId])
```
幂等复用现有 `@@unique([sourceType, sourceId, type])`，不新增 idempotencyKey 列。

### 4.3 OutstandingSettlement — 加 1 字段

```prisma
settlementType  String  @default("EOD")   // 'EOD' | 'FEE_COLLECT'
```
两个 B 类 cron 共用 Settlement 引擎，靠此字段区分。幂等复用现有 `requestId @unique`。

### 4.4 ReimbursementObligation — 解耦改造

**删** `feeOccurrenceId`（及 feeOccurrence 关系），**加**：

```prisma
approvalCaseId   String?   @unique   // 偿付义务审批门（V1 引擎）
reasonCategory   String?             // 本轮仅 'WITHDRAW_RETURN'（BANK_BOUNCE 随法币推后）
owedToType       String?             // 'CUSTOMER'
owedToId         String?
owedToNo         String?
sourceType       String?             // 'WITHDRAW'
sourceId         String?
sourceNo         String?
@@index([approvalCaseId])
@@index([reasonCategory, status])
```
状态机：`OPEN → PENDING_APPROVAL → APPROVED → REIMBURSED / REJECTED`。

### 4.5 FeeOccurrence — 整表删除

捕获的是 baseline 明令"不做"的成本费（`NETWORK_GAS`/`CUSTODY_FEE`/`BANK_TRANSFER_FEE`，且金额伪随机生成），属 Wave-8 遗留。删除爆炸半径：

1. `InternalFundsService.captureFromInternalFund` 调用 — port 时不搬
2. **V5 `PayoutsService.captureFromPayout`** — 移除（停止捕获伪随机成本，对齐 baseline）
3. `ReimbursementObligation.feeOccurrenceId` 强耦合 — 删字段
4. `app.module` 注册 + `FeeOccurrencesModule` + rbac 4 路由 + audit resolver `FEE_OCCURRENCE` 映射 — 移除
5. `wave8-treasury-demo.util` 清理逻辑 — 清

> 区分：手续费归集 drain 的是 **FEE_RECEIVABLE TB 账户（code 120，收入型 fee）**，与 FeeOccurrence 表无关。删表不影响费用归集。
> Zand per-tx 银行费（外部交易）的记录需求由 **Payout 表 `bankFeeRef`/`bankFee` 字段**承接（V8 对账证据），与 FeeOccurrence 无关，本轮不做（法币）。

### 4.6 不动的表

`InternalFund` / `Outstanding` / `OutstandingSettlementItem` —— 不加字段，直接复用。

### 4.7 Migration 安全

全部加列（nullable）+ ReimbursementObligation 删 feeOccurrenceId + 删 FeeOccurrence 表。无改名、无业务数据搬迁。在 `dev:rebuild` 下验证。

---

## 5. 分阶段实现（Phase 0–5，纯 crypto）

每 phase 标注：触发源 / 后端 / 前端 / 验收 / 依赖。

### Phase 0 — 脚手架与清理

- **后端**：建 `funds-layer/` 骨架；白名单 + 事件常量（注册全局）；Prisma migration（4.2/4.3/4.4）；**删 FeeOccurrence**（4.5）；核对 WalletRole 补 OPS；新增 audit actions / entity types / RBAC 常量。
- **前端**：无。
- **验收**：`dev:rebuild` 通过；`npm run build` 编译通过；现有 V1–V6 测试全绿。
- **依赖**：无。

### Phase 1 — 通用内部转账工作流（底座）⭐

- **触发源**：手动 API（DEV）/ 后续路径调用。
- **后端**：port `funds-flow.service`（CRYPTO 8 态，去 captureFromInternalFund）+ `internal-transfer.service`（聚合/幂等）；`whitelist.guard`（非白名单拒绝）；`funds-accounting`（A 类零 TB）；`internal-transfer-workflow`（创建→白名单→mock 执行→simulate→A 类记账→COMPLETED；失败→FAILED+repair）；`mock-custodian-execution.adapter` + `funds-simulate.controller`（sign/broadcast/confirm/fail）；traceId 创建时生成穿透全链。
- **前端**：`internal-transfer-admin.controller` + Admin funds flow 详情页（资金单 Hero + 执行 leg 时间线 + 路径标签 + Manual Simulation 区 simulate 控件）。
- **验收**：手动 crypto AGGREGATE → simulate 走完 CREATED→…→CONFIRMED→CLEAR → COMPLETED；非白名单被拒；审计 traceId 完整；非法转换被拒。
- **依赖**：Phase 0。

### Phase 2 — A 类路径接入

- **触发源**：Cron sweep（充值归集）/ V5 提现工作流（FUND_OUT/RETURN）。
- **后端**：`deposit-aggregation-sweep`（@Cron 扫充值地址余额≥阈值→直调 workflow；dust 跳过；单笔超阈值实时入口）；`deposit-aggregation-workflow`（pathLabel=AGGREGATE）；**V5 接入**：提现 Payout 广播前触发 FUND_OUT、提现取消/失败触发 FUND_RETURN（在 V5 withdraw workflow 加 hook 调通用工作流，不在 V5 内写 funds 表）；幂等复用 `@@unique([sourceType,sourceId,type])`。
- **前端**：复用 Phase 1 列表/详情页（按 pathLabel 筛选 AGGREGATE / FUND_OUT / FUND_RETURN）；本轮不单做归集监控页。
- **验收**：cron 自动归集超阈值地址、dust 跳过、重跑幂等；V5 提现触发 FUND_OUT 且 parentEntity 指回提现单。
- **依赖**：Phase 1。

#### Phase 2 实现决策（2026-06-03 评审定稿）

- **可归集余额来源**：按 C_DEP 钱包汇总**未归集的已完成充值**（`DepositTransaction.status=SUCCESS` 且未标记 aggregated 的 gross `amount` 之和）。**不依赖 `Wallet.mockBalance`**（V3 死字段，全代码只读不写，永远反映不了真实余额），**不依赖 `SafeguardingPolicy`**（Wave-8 配置，与待删 orchestrator 同源）。
- **幂等**：`DepositTransaction` 加 `aggregatedAt` / `aggregatedTransferId` 字段；归集后标记，下次只扫未归集的；AGGREGATE transfer 的 `sourceType='DEPOSIT_AGGREGATION'`、`sourceId=walletId:anchorDepositId`（批次锚点）保证 `@@unique` 不冲突且可重跑。
- **阈值**：funds-layer 硬编码常量 `AGGREGATION_THRESHOLD` / `DUST_THRESHOLD`（配置化是 ADVANCED）。
- **旧 orchestrator 处置**：用 V7 工作流重做后，**删除** `src/orchestrators/internal-collection-workflow.orchestrator.ts` + `workflows.module.ts` 中的 provider + `asset-treasury/internal-transaction-workflow` 下调用它的 controller（internal-collection-wallets / internal-transaction-workflow）。`SafeguardingPolicy` / `safeguarding-reconciliation`（另一独立模块）不在删除范围。
- **FUND_OUT**：在 withdraw workflow `initiatePayoutPhase()` 创建 payout 后触发 `INTERNAL_OUT`→ 修正：`FUND_OUT`（C_MAIN→C_OUT，amount=`netAmount`），`sourceType='WITHDRAW'`、`sourceId=withdrawId`。非阻塞 mock 跟踪转账（真实"先归集后广播"的硬序由真实 custodian 轮次补）。
- **FUND_RETURN**：现状无 `PAYOUT_FAILED` 事件、V5 失败分支未建，**无自动触发路径**。本轮以**命名 repair / admin 触发面**交付（对已 FUND_OUT 但不再推进的提现，管理员触发 C_OUT→C_MAIN 退回，全程审计）。自动触发待 V5 失败分支建成后接入。

### Phase 3 — B 类记账 + EOD 兑换结算 ⭐

- **触发源**：Cron 日终。
- **后端**：`funds-accounting` 扩展 **B 类 drain** `TRADE_CLEARING ↔ CUSTODY`（调 AccountingService + JournalRef）；port `settlement-batch.service`（CRYPTO 轧差：groupByAsset→净额→resolveExecutionDirection，仅 C_MAIN↔F_LIQ 分支），settlementType=EOD；`eod-settlement-workflow`（轧差→创建 Settlement→spawn INTERNAL-OUT/IN→消费 Outstanding 标 SETTLED→幂等重跑）；`eod-settlement-sweep`（@Cron）。
- **前端**：Admin settlement 页（批次列表/详情：轧差明细 + 关联 transfer + Outstanding 消费快照）。
- **验收**：把 V6 堆积 Outstanding 跑一轮 EOD → 按资产轧净额 → 生成 INTERNAL-IN/OUT → simulate 确认 → Outstanding 全 SETTLED；TB TRADE_CLEARING 正确 drain；重跑幂等。
- **依赖**：Phase 1。

### Phase 4 — 手续费归集

- **触发源**：Cron 定期。
- **后端**：B 类 drain 扩展 `FEE_RECEIVABLE ↔ CUSTODY`；`fee-collection-workflow`（扫 FEE_RECEIVABLE 余额 → Settlement(settlementType=FEE_COLLECT) → spawn FEE-COLLECT transfer，Main→Ops）；`fee-collection-sweep`（@Cron）。
- **前端**：复用 settlement 页（settlementType 筛选）。
- **验收**：累积 FEE_RECEIVABLE 被归集到 Ops；TB drain 正确；归集量 = FEE_RECEIVABLE 余额。
- **依赖**：Phase 3。

### Phase 5 — 偿付义务 → **已移出 V7，并入 V8 对账（决策 2026-06-03）**

~~原计划：仅 WITHDRAW_RETURN + 审批门。~~ **不再作为 V7 phase 交付。**

**理由**：偿付义务是「纠正动作」，其主要发现源是对账（detective control）；crypto MVP 真正能 event-driven 触发的偿付场景很窄（仅延迟提现失败的客户债权侧，且 V5 失败分支尚未建）。`ReimbursementObligation` 实体 + 状态机 + 审批门由 **V8 差异处理工作流**统一拥有，两类触发源（对账差异 / event-driven 失败）共用同一出口。

**对 V7 已交付的影响**：无返工。Phase 0 对 `ReimbursementObligation` 的解耦（owedTo/sourceType/approvalCaseId 字段）是为 V8 预备，复用；Phase 2 的 FUND_RETURN（提现退回资金侧 Outbound→Main）留在 V7 funds-layer，不动。详见 `doc-final/reference/roadmap.md` V7/V8 节。

> **V7 crypto MVP 最终范围 = Phase 0–4**（地基 / 通用转账 / 充值归集+FUND_OUT/RETURN / EOD 结算 / 手续费归集）。Phase 5 撤销。

### 阶段依赖图

```
Phase 0 (地基)
  └→ Phase 1 (通用底座) ⭐
       ├→ Phase 2 (A类路径)
       └→ Phase 3 (B类+EOD) ⭐
            └→ Phase 4 (费用归集)

Phase 5 (偿付义务) → 撤销，并入 V8 对账
```

---

## 6. 横切关注点

### 6.1 域事件（注册到 `domain-events.constants.ts`）

| 事件 | emit 方 | 订阅 workflow | 用途 |
|---|---|---|---|
| `fundsflow.status.changed` | funds-flow domain | internal-transfer-workflow、eod-settlement-workflow | 执行 leg 推进 → 聚合/记账/Outstanding 关闭 |
| `internaltransfer.completed` | internal-transfer domain | 按需 | 资金单终态通知 |

> 现 `internal-fund.status.changed` 驱动 outstanding-settlement 关闭的模型保留，port 后改名 `fundsflow.status.changed`，两侧在 funds-layer 内同步改。EOD 的 Outstanding LOCKED→CLOSED 仍走事件订阅（已验证逻辑）。
> 仅 domain/adapter emit；仅 workflow `@OnEvent`。

### 6.2 审计覆盖（全程 `AuditLogsService`，DI 注入）

| Phase | 关键 action（UPPER_SNAKE） | workflowType |
|---|---|---|
| 1 | `INTERNAL_TRANSFER_REQUESTED` / `INTERNAL_TRANSFER_<FROM>_TO_<TO>` / `TRANSFER_COMPLETED` / `TRANSFER_FAILED` / `TRANSFER_WHITELIST_REJECTED`（自动 deny 必审计） | `INTERNAL_TRANSFER` |
| 2 | `AGGREGATION_SWEPT` / `AGGREGATION_DUST_SKIPPED` | `INTERNAL_TRANSFER` |
| 3 | `EOD_SETTLEMENT_REQUESTED` / `SETTLEMENT_NETTED` / `OUTSTANDING_SETTLED` | `EOD_SETTLEMENT` |
| 4 | `FEE_COLLECTION_REQUESTED` / `FEE_DRAINED` | `FEE_COLLECTION` |
| 5 | `REIMBURSEMENT_REQUESTED` / `APPROVAL_GRANTED/DECLINED` / `REIMBURSEMENT_PAID` | `REIMBURSEMENT` |

traceId 创建时 `randomUUID()` 落库、子动作继承；跨实体子动作 metadata 带 `{ parentEntityType, parentEntityId, parentEntityNo }`，序列查询用 `WHERE traceId`。

### 6.3 幂等键（全复用现有约束，不新增列）

| 流程 | 机制 |
|---|---|
| 充值归集 sweep | `@@unique([sourceType,sourceId,type])`，sourceType=DEPOSIT_SWEEP、sourceId=walletId+window |
| FUND_OUT/RETURN | sourceType=WITHDRAW、sourceId=withdrawId |
| EOD 结算 | `requestId @unique` + Outstanding 已 SETTLED 跳过 |
| 费用归集 | `requestId` + FEE_RECEIVABLE 余额 0 跳过 |
| 偿付义务 | sourceType+sourceId 唯一 |

### 6.4 Repair Surface（比正常路径更窄，记录 actor/reason/result，禁手工 SQL）

| Repair | 场景 | 动作 |
|---|---|---|
| `retryFundsFlow` | mock/链上失败后 FAILED | 重发一笔 funds flow（不复用旧 leg） |
| `resyncSettlement` | Settlement 卡 PROCESSING | 复用 `syncSettlement()` 从 funds 终态反推 |
| `replayAggregation` | sweep 漏扫 | 指定候选键重跑（幂等兜底） |

### 6.5 TB 记账失败（B 类专属）

accounting 同步调用、失败则 workflow 失败、实体状态不前进。B 类 drain 调 AccountingService 后才标 COMPLETED；TB 失败 → transfer 停在 pre-accounting 态 → 进 repair surface。每条 B 类 TB transfer 落 Prisma JournalRef。

### 6.6 RBAC

新增 `INTERNAL_TRANSFER_READ/WRITE`、`SETTLEMENT_READ/WRITE`、`REIMBURSEMENT_READ/WRITE/APPROVE`；偿付义务审批走 maker-checker，SoD 在 approval handler 声明；删 FeeOccurrence 后旧 4 条 rbac 路由一并移除。

---

## 7. 不变量速查（记账闭环，crypto）

- TB 账户：`CUSTODY(10)` | `CLIENT_CREDIT(100)` `CLIENT_AUDIT(101)` `TRADE_CLEARING(110)` `FEE_RECEIVABLE(120)`。
- 核心不变量：`TRADE_CLEARING(币) = Outstanding(币) + FEE_RECEIVABLE(币 swap 部分)`。
- A 类零 TB；B 类 drain `TRADE_CLEARING/FEE_RECEIVABLE ↔ CUSTODY`。
- EOD 结算量 = `|TRADE_CLEARING|`；fee 归集量 = `FEE_RECEIVABLE`。

---

## 8. 明确排除（本轮不做）

- **所有法币路径**：法币归集、INTERNAL-OUT/IN 的 FIAT 侧、per-VA spawn、CMA/集中账户、FIAT 状态机、Zand 银行指令适配。
- **BANK_BOUNCE 偿付义务**（法币银行冲正追偿）。
- **真实 HexTrust API 对接**（本轮 mock + simulate）。
- baseline ADVANCED 项：LP 调拨、阈值配置变更、偿付义务完整版、异常处置、储备金注资、公司自有流动性调拨、跨网络再平衡。
- Zand per-tx 银行费记录（Payout `bankFee` 字段）——属法币/对账范畴，随法币轮次。

法币轮次的前置：baseline §6 Zand 问题 #1-3/#9 有答复（CMA 能否出金/归集、集中账户定义）。
