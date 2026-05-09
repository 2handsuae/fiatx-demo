# TigerBeetle Infrastructure Design

Date: 2026-05-10 | Scope: V3 Phase 0 | Status: APPROVED

---

## Overview

V3 财务配置的地基层：将 TigerBeetle (TB) 接入为余额 source of truth，Prisma 降级为人可读审计证据。本设计覆盖 TB 客户端接入、账户模型、AccountingService 薄适配器、Prisma 凭证层简化。

**依赖链：** 本层完成后，V3 的 8 个 MVP workflow 才能开始实现。V4–V7 所有交易记账依赖本层。

---

## Section 1: TB 基础层

### 1.1 开发环境

- **本地二进制** + 持久数据文件 `/tmp/exchange_js_branch/0_0.tigerbeetle`
- npm 包：`tigerbeetle-node`（锁定版本）
- 连接地址环境变量：`TB_ADDRESS=127.0.0.1:3001`

Dev 工具链集成：

```bash
dev:start   → tigerbeetle start --development --addresses=127.0.0.1:3001 /tmp/exchange_js_branch/0_0.tigerbeetle &
dev:stop    → kill tigerbeetle process
dev:rebuild → rm + tigerbeetle format --cluster=0 --replica=0 --replica-count=1 /tmp/exchange_js_branch/0_0.tigerbeetle
dev:reset   → 重建 TB 数据文件 + 清空 SQLite 业务数据 + 清空 tb_account_registry / tb_evidence_backlog
```

### 1.2 TigerBeetleService

NestJS injectable singleton，封装 `tigerbeetle-node` 客户端：

```
TigerBeetleService
├── onModuleInit()          → connect(address) + health check（失败则拒绝启动）
├── onModuleDestroy()       → client.destroy()
├── createAccounts([])      → client.createAccounts
├── createTransfers([])     → client.createTransfers
├── lookupAccounts([])      → client.lookupAccounts
└── lookupTransfers([])     → client.lookupTransfers
```

- 纯透传，不含业务逻辑，不做重试
- 单例共享，TB client 自动批处理并发请求

### 1.3 Ledger 映射

一个币种一个 ledger：

| 币种 | Ledger ID (u32) |
|------|-----------------|
| AED | 1 |
| USDT (TRON) | 2 |

新资产通过 Asset Listing workflow 上架时分配下一个 ledger ID，持久化在 `Asset.tbLedgerId`。

### 1.4 Account 字段映射

使用 TB 原生字段，不做结构化 ID 编码：

| 业务概念 | TB 字段 | 说明 |
|---------|---------|------|
| 账户 ID | `id` (u128) | 用 `id()` 时间序生成器（LSM tree 优化） |
| 账户类型 | `code` (u16) | Chart of Accounts 类型编码 |
| 币种 | `ledger` (u32) | 1=AED, 2=USDT |
| 关联 Prisma 记录 | `user_data_128` (u128) | 完整 UUID as BigInt（queryable） |
| 所有者类型 | `user_data_32` (u32) | 0=SYSTEM, 1=CUSTOMER, 2=LP |
| 余额约束 | `flags` (u16) | 负债类设 `debits_must_not_exceed_credits` |

### 1.5 Account Type Code 编码

| code | 类型 | 性质 | TB Flag |
|------|------|------|---------|
| 1 | BANK | 资产 | 无约束 |
| 2 | BANK_RESTRICTED | 资产 | 无约束 |
| 10 | CUSTODY | 资产 | 无约束 |
| 11 | CUSTODY_RESTRICTED | 资产 | 无约束 |
| 100 | CLIENT_CREDIT | 负债 | `debits_must_not_exceed_credits` |
| 200 | REVENUE_SWAP_FEE | 收入 | 无约束 |
| 201 | REVENUE_WITHDRAWAL_FEE | 收入 | 无约束 |
| 300 | EXPENSE_LP_COST | 费用 | 无约束 |
| 301 | EXPENSE_NETWORK_FEE | 费用 | 无约束 |
| 400 | RETAINED_EARNINGS | 权益 | 无约束 |

**注意：不设 CLIENT_HELD 账户。** TB 的两阶段转账（pending transfer）在 CLIENT_CREDIT 账户上原生追踪锁定金额（`debits_pending`），无需独立冻结账户。每客户每币种只需 1 个 TB 账户。

需要对账的账户加 `history` flag（启用 `get_account_balances` API）。

### 1.6 金额精度

按资产原生精度存最小单位整数：

| 资产 | decimals | 1.00 在 TB 中的值 |
|------|----------|-------------------|
| AED | 2 | 100 |
| USDT | 6 | 1_000_000 |

进出 TB 时按 `Asset.decimals` 换算。跨币种兑换通过 linked transfers，精度差异不构成障碍。

### 1.7 跨币种兑换（Linked Transfers）

AED → USDT 兑换在一个 batch 中提交两笔 linked transfer：

```
Transfer #1 (flags=linked): Customer_AED_CLIENT_CREDIT --debit--> LP_AED (ledger=1)
Transfer #2 (flags=0):      LP_USDT --debit--> Customer_USDT_CLIENT_CREDIT (ledger=2)
```

两笔原子成功或原子失败。手续费可作为第三笔 linked transfer。

---

## Section 2: AccountingService 适配器

### 2.1 调用链

```
Workflow（业务编排）
  → AccountingEventExecutionService（事件→模板解析→账户 ID 解析→金额计算）
    → AccountingService（TB 写账 + Prisma 证据）
      ├→ TigerBeetleService（原始 TB 客户端）
      └→ TbEvidenceService（Prisma 平表证据写入）
```

### 2.2 完整接口

```typescript
// ── 账户生命周期 ──

createAccounts(params: CreateTbAccountParams[]): Promise<void>
// 1. 调 TigerBeetleService.createAccounts()
// 2. 写 Prisma TbAccountRegistry 记录

// ── 单笔转账 ──

executeTransfer(params: {
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  evidence: EvidenceParams;
  tx?: Prisma.TransactionClient;
}): Promise<{ tbTransferId: bigint }>
// TB 写账 → 成功后写 TbTransferEvidence

// ── 跨币种原子转账（兑换）──

executeLinkedTransfers(transfers: ExecuteTransferParams[]): Promise<{ tbTransferIds: bigint[] }>
// 自动给前 N-1 笔加 linked flag

// ── 两阶段转账 ──

executePendingTransfer(params: {
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  timeout?: number;
  evidence: EvidenceParams;
  tx?: Prisma.TransactionClient;
}): Promise<{ tbTransferId: bigint }>

postPendingTransfer(params: {
  pendingTbTransferId: bigint;
  amount?: bigint;            // 部分确认金额；省略则全额
  evidence: EvidenceParams;
  tx?: Prisma.TransactionClient;
}): Promise<{ tbTransferId: bigint }>

voidPendingTransfer(params: {
  pendingTbTransferId: bigint;
  evidence: EvidenceParams;
  tx?: Prisma.TransactionClient;
}): Promise<{ tbTransferId: bigint }>

// ── 冲正 ──

executeCorrectingTransfer(params: {
  originalTbTransferId: bigint;
  evidence: EvidenceParams;
  tx?: Prisma.TransactionClient;
}): Promise<{ tbTransferId: bigint }>
// 查原始 transfer 的 debit/credit，反向创建补偿 transfer

// ── 批量转账（日终结算用）──

executeBatchTransfers(transfers: ExecuteTransferParams[]): Promise<{
  results: Array<{ tbTransferId: bigint } | { error: string }>;
}>

// ── 余额查询 ──

lookupBalance(tbAccountId: bigint): Promise<{
  debitsPosted: bigint;
  creditsPosted: bigint;
  debitsPending: bigint;
  creditsPending: bigint;
}>

getCustomerAvailableBalance(customerUuid: string, assetCode: string): Promise<{
  available: bigint;    // credits_posted - debits_posted - debits_pending
  held: bigint;         // debits_pending
  total: bigint;        // credits_posted - debits_posted
}>

// ── 账户解析 ──

resolveTbAccountId(params: {
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid?: string;
}): Promise<bigint>
// 查 TbAccountRegistry

// ── 对账 ──

reconcileAccount(tbAccountId: bigint): Promise<{
  tbBalance: { debitsPosted: bigint; creditsPosted: bigint };
  evidenceBalance: { totalDebit: bigint; totalCredit: bigint };
  discrepancy: boolean;
}>
```

### 2.3 EvidenceParams 类型

```typescript
interface EvidenceParams {
  sourceType: string;     // 'DEPOSIT' | 'WITHDRAWAL' | 'SWAP' | 'INTERNAL_TX' | ...
  sourceNo: string;       // depositNo, swapNo, internalTxNo...
  eventCode: string;      // 来自 events.manifest
  traceId: string;
  debitCode: string;      // 人可读 COA code, e.g. 'L.CLIENT_CREDIT'
  creditCode: string;     // e.g. 'A.CUSTODY'
  assetCode: string;      // AED | USDT
  memo?: string;
}
```

### 2.4 TbAccountRegistry Prisma 模型

```prisma
model TbAccountRegistry {
  tbAccountId BigInt   @id
  code        Int
  ledger      Int
  ownerType   String
  ownerUuid   String?
  ownerNo     String?
  assetCode   String
  status      String   @default("ACTIVE")
  description String?
  flags       Int      @default(0)
  createdAt   DateTime @default(now())

  @@unique([code, ledger, ownerType, ownerUuid])
}
```

### 2.5 COA Code → TB Code 映射

```typescript
const COA_TO_TB_CODE: Record<string, number> = {
  'A.BANK': 1,
  'A.BANK_RESTRICTED': 2,
  'A.CUSTODY': 10,
  'A.CUSTODY_RESTRICTED': 11,
  'L.CLIENT_CREDIT': 100,
  'R.SWAP_FEE': 200,
  'R.WITHDRAW_FEE': 201,
  'E.LP_COST': 300,
  'E.NETWORK_FEE': 301,
  'Q.RETAINED_EARNINGS': 400,
};
```

Asset Code → TB Ledger 映射从 `Asset.tbLedgerId` 动态读取。

### 2.6 错误处理

| 场景 | 行为 |
|------|------|
| TB 连不上 | 应用启动失败 |
| TB transfer 被拒（余额不足等） | 抛 `AccountingTransferError`，workflow 失败 |
| `id_already_failed` | 自动换新 ID 重试一次 |
| TB 成功 + Prisma evidence 写失败 | 不回滚 TB；写入 `TbEvidenceBacklog` 待补录 |
| 重复 transfer ID | TB 天然幂等 |

### 2.7 AccountingEventExecutionService 重构

保留作为事件→转账的翻译层，职责变更：

```
execute(eventCode, frozenContext):
  1. 解析 AcctEvent（现有逻辑）
  2. 解析模板 → 确定 debit/credit COA codes + 金额公式
  3. 【新增】COA code → TB account type code（via COA_TO_TB_CODE）
  4. 【新增】从 frozenContext 解析 ownerUuid + assetCode
  5. 【新增】调 AccountingService.resolveTbAccountId() 获取 TB account ID
  6. 【新增】Decimal 金额 → bigint（× 10^decimals）
  7. 评估条件行（conditionExpr），跳过金额为 0 的行
  8. 组装 transfer pairs
  9. 调 AccountingService.executeTransfer() / executeLinkedTransfers()
```

---

## Section 3: Prisma 凭证层简化

### 3.1 核心变更：Journal + JournalLine → TbTransferEvidence

TB transfer 本身已是完整的借贷记录（debit_account, credit_account, amount, timestamp, immutable）。不再需要 Prisma 侧的双式记账头表/行表。

新建单层平表 `TbTransferEvidence`，每个 TB transfer 对应一行人可读证据：

```prisma
model TbTransferEvidence {
  tbTransferId BigInt   @id
  sourceType   String
  sourceNo     String
  eventCode    String
  debitCode    String               // 人可读 COA, e.g. 'L.CLIENT_CREDIT'
  creditCode   String               // e.g. 'A.CUSTODY'
  amount       Decimal
  assetCode    String
  traceId      String
  memo         String?
  pendingId    BigInt?              // 如果是 post/void，关联的 pending transfer
  transferType String  @default("POSTED")  // POSTED | PENDING | POST_PENDING | VOID_PENDING | CORRECTING
  createdAt    DateTime @default(now())

  @@index([sourceType, sourceNo])
  @@index([traceId])
  @@index([eventCode])
  @@index([assetCode])
  @@index([createdAt])
}
```

### 3.2 TbEvidenceBacklog 补录队列

```prisma
model TbEvidenceBacklog {
  id            String   @id @default(uuid())
  tbTransferId  BigInt   @unique
  transferData  String                    // JSON: transfer 参数快照
  evidenceData  String                    // JSON: 待写入的证据数据
  errorMessage  String
  retryCount    Int      @default(0)
  status        String   @default("PENDING")  // PENDING | RESOLVED | FAILED
  createdAt     DateTime @default(now())
  resolvedAt    DateTime?
}
```

### 3.3 Asset 模型变更

```diff
model Asset {
  ...
+ tbLedgerId    Int?     @unique    // TB ledger ID（上架时分配）
  // decimals 字段已存在，用于 TB 金额精度换算
}
```

### 3.4 TbEvidenceService

轻量服务，替代原 JournalsService（1100 行 → ~200 行）：

```
TbEvidenceService
├── writeEvidence(params: EvidenceParams & { tbTransferId: bigint }, tx?)
│   → 写 TbTransferEvidence 行
│   → 失败时写入 TbEvidenceBacklog，不抛异常
├── writeToBacklog(params)
│   → 写入补录队列
├── findBySource(sourceType, sourceNo)
│   → 按业务实体查证据
├── findByTraceId(traceId)
│   → 按 trace 查关联证据组
├── findAll(filters, pagination)
│   → Admin UI 列表查询
└── findOne(tbTransferId)
    → 单条查询
```

### 3.5 废弃清单

**整体删除的 Prisma 模型：**
- `Journal`
- `JournalLine`
- `WalletBalanceSnapshot`
- `WalletBalanceEntry`

**整体删除的 Service：**
- `JournalsService`（1100 行）
- `JournalLinesService`
- `JournalHeaderTemplatesService`
- `JournalLineTemplatesService`

**删除的脚本/seed：**
- `scripts/rebuild-wallet-balances.ts`
- `seedWalletBalanceSnapshotBaseline()` seed 函数

**注意：** Journal/JournalLine 的 Prisma 模型定义保留在 schema 中但标记 deprecated，待数据迁移完成后再物理删除。现有测试中引用这些模型的用例需要重写。

### 3.6 迁移目标（调用方改走新路径）

| 现有调用方 | 当前行为 | 迁移为 |
|-----------|---------|--------|
| `AccountingEventExecutionService` | 调 `journalsService.executeResolvedEvent()` | 调 `AccountingService.executeTransfer()` |
| `WithdrawTransactionsService.createWithdraw()` | 调 `getCustomerLiabilityBalance()` 检查余额 | 调 `AccountingService.getCustomerAvailableBalance()` |
| `WithdrawTransactionsService` | 直接调 `journalsService.createJournal()` | 调 `AccountingService.executeTransfer()` |
| `SwapWorkflowOrchestrator.executeSwap()` | 调 `getCustomerLiabilityBalance()` 检查余额 | 调 `AccountingService.getCustomerAvailableBalance()` |
| `TreasuryService.getCustomerAssets()` | 聚合 `journalLine` 算余额 | 查 TB（TbAccountRegistry + lookupAccounts） |
| `SafeguardingReconciliationService` | 读 `journalLine` 做 liability snapshot | 改读 `TbTransferEvidence` + TB 余额 |
| `JournalLinesService.getCustomerBalanceHistory()` | 从 journal lines 算 running balance | 改读 `TbTransferEvidence` 做历史流水视图 |

### 3.7 余额查询路由

| 查询场景 | 旧路径 | 新路径 |
|---------|--------|--------|
| 客户可用余额 | Prisma 聚合 journal_lines | `AccountingService.getCustomerAvailableBalance()` → TB |
| 账户流水历史 | Prisma Journal + JournalLine | `TbEvidenceService.findBySource()` / `findByTraceId()` |
| 对账 | 无 | `AccountingService.reconcileAccount()` → TB vs Prisma 证据 |
| Admin 凭证查看 | `JournalsService.findAll()` | `TbEvidenceService.findAll()` |

### 3.8 Seed 流程新增

base seed 中，在创建系统钱包之后新增：

1. 创建 TB 数据文件（dev:rebuild 已处理）
2. 为每个已上架资产的每种系统账户类型调 `AccountingService.createAccounts()`
3. 写入 `TbAccountRegistry` 记录

---

## 与现有代码的关系总结

| 组件 | 状态 | 说明 |
|------|------|------|
| `TigerBeetleService` | **新建** | 纯 TB 客户端封装 |
| `AccountingService` | **新建** | 薄适配器：TB + evidence |
| `TbEvidenceService` | **新建** | 轻量 evidence 写入/查询 |
| `TbAccountRegistry` | **新建** | TB 账户 ↔ 业务实体映射 |
| `TbTransferEvidence` | **新建** | 人可读转账证据平表 |
| `TbEvidenceBacklog` | **新建** | 证据补录队列 |
| `AccountingEventExecutionService` | **保留重构** | 改调 AccountingService |
| `AcctConfigService` | **保留** | 事件定义校验 |
| `CoaService` | **保留** | Chart of Accounts CRUD |
| `Wallet` 模型 | **不动** | 业务概念，不是 TB 账户 |
| `Asset` 模型 | **微改** | 加 `tbLedgerId` 字段 |
| `JournalsService` | **删除** | 1100 行 → TbEvidenceService ~200 行 |
| `JournalLinesService` | **删除** | 功能合并到 TbEvidenceService |
| `JournalHeaderTemplatesService` | **删除** | 模板解析迁入 AccountingEventExecutionService |
| `JournalLineTemplatesService` | **删除** | 同上 |
| `Journal` 模型 | **废弃** | 标记 deprecated，后续物理删除 |
| `JournalLine` 模型 | **废弃** | 同上 |
| `WalletBalanceSnapshot` 模型 | **废弃** | TB 是余额 truth |
| `WalletBalanceEntry` 模型 | **废弃** | 同上 |
