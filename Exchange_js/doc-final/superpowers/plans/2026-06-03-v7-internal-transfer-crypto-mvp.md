# V7 内部转账 Crypto MVP — 实现计划（Phase 0 + Phase 1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 V7 内部转账的地基（schema + 清理）与通用内部转账工作流底座，能手动 simulate 一笔 crypto 内部转账走完执行状态机并通过 Admin 页面观测。

**Architecture:** 新模块 `src/modules/funds-layer/`，三层架构（Domain L1 / Approval L2 / Workflow L3）。port 现有 `InternalFundsService` 的 CRYPTO 状态机与 `InternalTransactionsService` 的聚合逻辑，复用现有 Prisma 表（按 spec §4 加列）。先 mock 执行 + simulate 端点推进状态机。

**Tech Stack:** NestJS 10 · Prisma · SQLite · TigerBeetle · Jest · React (admin-web)

**Scope:** 本计划只覆盖 **Phase 0（脚手架与清理）+ Phase 1（通用内部转账工作流底座）**。Phase 2–5（A 类路径 / B 类+EOD / 费用归集 / 偿付义务）各自独立可交付，待本计划落地并验收后，每个 phase 单独成计划。设计依据：`doc-final/superpowers/specs/2026-06-03-v7-internal-transfer-crypto-mvp-design.md`。

**实现时的已知修正（相对 spec）：**
- spec §3 说"缺 OPS 则补"——经核对 `WalletRole` **已有 `F_OPS`**，FEE_COLLECT 的 `to` 用 `F_OPS`，**无需新增角色**。
- 钱包角色映射：`C_DEPOSIT → C_DEP`、`C_OUT → C_OUT`、`OPS → F_OPS`、`C_MAIN`/`F_LIQ` 同名。

**关键命令：**
- 测试单文件：`npx jest <path> -t "<name>"`
- 全量测试：`npm test`
- 编译：`npm run build`
- DB 重建：`npm run dev:rebuild`
- 端口：API 3500 / Admin 3501 / Client 3502

---

## 文件结构总览（Phase 0+1 产出）

```
prisma/schema.prisma                          # 改：InternalTransaction/OutstandingSettlement/ReimbursementObligation；删 FeeOccurrence
src/modules/funds-layer/
├── funds-layer.module.ts                              # 新：模块注册
├── constants/
│   ├── internal-transfer-paths.constant.ts            # 新：6 条 crypto 白名单
│   └── internal-transfer-paths.constant.spec.ts       # 新：白名单完整性测试
├── domain/
│   ├── funds-flow.service.ts                          # 新(port)：CRYPTO 执行状态机
│   ├── funds-flow.service.spec.ts
│   ├── internal-transfer.service.ts                   # 新(port)：聚合 + 幂等创建
│   └── internal-transfer.service.spec.ts
├── guards/
│   ├── whitelist.guard.ts                             # 新：白名单校验
│   └── whitelist.guard.spec.ts
├── accounting/
│   └── funds-accounting.service.ts                    # 新：A 类零 TB（B 类留 Phase 3）
├── adapters/
│   └── mock-custodian-execution.adapter.ts            # 新：mock 链上执行
├── workflow/
│   ├── internal-transfer-workflow.service.ts          # 新(L3)：通用内部转账工作流
│   └── internal-transfer-workflow.service.spec.ts
├── controllers/
│   ├── internal-transfer-admin.controller.ts          # 新：list/detail
│   └── funds-simulate.controller.ts                   # 新：DEV simulate 端点
└── dto/
    ├── internal-transfer-query.dto.ts
    └── simulate-funds-flow.dto.ts
src/common/events/domain-events.constants.ts   # 改：注册 fundsflow.* 事件
src/modules/audit-logging/constants/audit-actions.constant.ts  # 改：加 V7 actions/entityTypes/workflowTypes
src/modules/identity/access-control/rbac.catalog.ts            # 改：加 INTERNAL_TRANSFER_*；删 fee-occurrences 路由
src/app.module.ts                              # 改：注册 FundsLayerModule；移除 FeeOccurrencesModule
admin-web/src/pages/funds-layer/InternalTransferDetailPage.tsx # 新：funds flow 详情页
admin-web/src/App.tsx                          # 改：注册路由
```

---

# Phase 0 — 脚手架与清理

## Task 0.1: Prisma schema 变更 + migration

**Files:**
- Modify: `prisma/schema.prisma`（InternalTransaction 1545-1597、OutstandingSettlement 1904-1928、ReimbursementObligation 1638-1671）

- [ ] **Step 1: 给 InternalTransaction 加 5 个 V7 字段**

在 `model InternalTransaction` 的 `referenceNo String?`（1575 行）之后加：

```prisma
  pathLabel                  String?
  accountingClass            String?
  medium                     String?
  triggerSource              String?
  traceId                    String?
```

并在 `@@index([assetId])`（1595 行）之后加：

```prisma
  @@index([pathLabel])
  @@index([traceId])
```

- [ ] **Step 2: 给 OutstandingSettlement 加 settlementType**

在 `model OutstandingSettlement` 的 `note String?`（1913 行）之后加：

```prisma
  settlementType         String                      @default("EOD")
```

- [ ] **Step 3: ReimbursementObligation 解耦——删 feeOccurrence，加偿付字段**

删除这两行（1641、1658）：

```prisma
  feeOccurrenceId                 String               @unique
  feeOccurrence                   FeeOccurrence        @relation(fields: [feeOccurrenceId], references: [id], onDelete: Cascade)
```

在 `status String @default("OPEN")`（1642 行）之后加：

```prisma
  approvalCaseId                  String?              @unique
  reasonCategory                  String?
  owedToType                      String?
  owedToId                        String?
  owedToNo                        String?
  sourceType                      String?
  sourceId                        String?
  sourceNo                        String?
```

在索引区加：

```prisma
  @@index([approvalCaseId])
  @@index([reasonCategory, status])
```

- [ ] **Step 4: 生成 migration（先不删 FeeOccurrence，Task 0.2 一起）**

> 注意：本步会因 FeeOccurrence 仍被引用而暂不可单独迁移；与 Task 0.2 合并执行。先只改 schema 文本，迁移在 0.2 末尾统一跑。仅运行格式校验：

Run: `npx prisma format`
Expected: schema 格式化无语法错误（FeeOccurrence/ReimbursementObligation 关系暂时不一致是预期的，下一步删表后解决）。

---

## Task 0.2: 删除 FeeOccurrence 整表 + 5 处引用

**Files:**
- Modify: `prisma/schema.prisma`（删 model FeeOccurrence 1599-1636 + Asset/Wallet 侧反向关系）
- Modify: `src/modules/asset-treasury/internal-funds/internal-funds.service.ts`（删 captureFromInternalFund 调用 + 注入）
- Modify: `src/modules/asset-treasury/internal-funds/internal-funds.module.ts`（删 FeeOccurrencesModule import）
- Modify: `src/modules/asset-treasury/payouts/payouts.service.ts`（删 captureFromPayout + feeOccurrences 读取）
- Modify: `src/modules/asset-treasury/payouts/payouts.module.ts`（删 FeeOccurrencesModule import）
- Modify: `src/app.module.ts`（删 FeeOccurrencesModule 注册）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（删 4 条 fee-occurrences 路由 465-468）
- Modify: `src/modules/audit-logging/audit-logs.service.ts`（删 FEE_OCCURRENCE resolver 映射 306）
- Modify: `src/modules/asset-treasury/demo/wave8-treasury-demo.util.ts`（删 feeOccurrence 清理 73-95）
- Delete: `src/modules/asset-treasury/fee-occurrences/`（整目录）

- [ ] **Step 1: 删除 FeeOccurrence model 及其反向关系**

删除 `prisma/schema.prisma` 中 `model FeeOccurrence { ... }`（1599-1636）整块。然后在 `model Asset`、`model Wallet`、`model ReimbursementObligation` 中删除所有指向 `FeeOccurrence` 的关系字段（搜索 `FeeOccurrence` 关键字逐一删除：`grep -n "FeeOccurrence" prisma/schema.prisma`）。

- [ ] **Step 2: 删除 fee-occurrences 模块目录**

Run: `git rm -r src/modules/asset-treasury/fee-occurrences`
Expected: 目录被删除。

- [ ] **Step 3: 从 internal-funds.service.ts 移除 captureFromInternalFund**

移除 import `FeeOccurrencesService`（约 18 行）、构造函数注入 `feeOccurrencesService`（129 行）、`sumFeeOccurrenceAmounts` 方法（174-180）、`updateStatus` 中 CONFIRMED 分支的 fee capture 块（549-571）、`findOneForAdmin` 末尾 feeOccurrences 读取（712-723，改为直接返回 `item`）。

> 这段逻辑 Phase 1 port 时本就不搬，此处先让旧模块编译通过。

- [ ] **Step 4: 从 payouts.service.ts 移除 fee capture**

移除 import + 注入 `feeOccurrencesService`（76 行）、`captureFromPayout` 调用（486 块）、`findOneForAdmin` 中 linkedFeeOccurrences 读取（253-282，改为不返回 feeOccurrences 字段）。

- [ ] **Step 5: 移除两个 module 的 FeeOccurrencesModule import + app.module 注册 + rbac 路由 + audit resolver + demo util**

- `internal-funds.module.ts:9`、`payouts.module.ts:12`：删 `FeeOccurrencesModule`
- `app.module.ts:94`：删 `FeeOccurrencesModule`
- `rbac.catalog.ts:465-468`：删 4 条 route
- `audit-logs.service.ts:306`：删 `FEE_OCCURRENCE: { model: 'feeOccurrence', field: 'feeNo' },`
- `wave8-treasury-demo.util.ts:73-95`：删 feeOccurrence 相关清理块及 `feeOccurrence?` 类型字段（13 行）

- [ ] **Step 6: 重建 DB + 编译验证**

Run: `npm run dev:rebuild && npm run build`
Expected: migration 成功创建（含 0.1 的字段变更 + 删 FeeOccurrence 表）；TypeScript 编译 0 错误。

- [ ] **Step 7: 跑现有测试，确认无回归**

Run: `npm test`
Expected: 全绿。若 `internal-funds.service.spec.ts` / `payouts.service.spec.ts` / `fee-occurrences.service.spec.ts` 引用了被删逻辑，删除/调整对应断言（如 `captureFromInternalFund` mock 与断言）。`fee-occurrences.service.spec.ts` 随目录删除。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(v7-phase0): schema fields + delete FeeOccurrence (Wave-8 legacy)

- InternalTransaction: +pathLabel/accountingClass/medium/triggerSource/traceId
- OutstandingSettlement: +settlementType
- ReimbursementObligation: decouple from FeeOccurrence, add owedTo/source/approval
- Remove FeeOccurrence table + module + V5 payout capture + rbac/audit refs"
```

---

## Task 0.3: funds-layer 模块骨架 + 白名单常量

**Files:**
- Create: `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`
- Test: `src/modules/funds-layer/constants/internal-transfer-paths.constant.spec.ts`
- Create: `src/modules/funds-layer/funds-layer.module.ts`
- Modify: `src/app.module.ts`（注册 FundsLayerModule）

- [ ] **Step 1: 写白名单完整性的失败测试**

`src/modules/funds-layer/constants/internal-transfer-paths.constant.spec.ts`：

```typescript
import {
  TransferPath,
  AccountingClass,
  TRANSFER_PATH_WHITELIST,
  resolvePathPolicy,
} from './internal-transfer-paths.constant';

describe('TRANSFER_PATH_WHITELIST', () => {
  it('defines exactly the 6 crypto paths', () => {
    expect(Object.keys(TRANSFER_PATH_WHITELIST).sort()).toEqual(
      [
        'AGGREGATE',
        'FEE_COLLECT',
        'FUND_OUT',
        'FUND_RETURN',
        'INTERNAL_IN',
        'INTERNAL_OUT',
      ].sort(),
    );
  });

  it('every path uses CHAIN medium and a real WalletRole', () => {
    const validRoles = ['C_DEP', 'C_OUT', 'C_MAIN', 'F_LIQ', 'F_OPS'];
    for (const policy of Object.values(TRANSFER_PATH_WHITELIST)) {
      expect(policy.medium).toBe('CHAIN');
      expect(validRoles).toContain(policy.from);
      expect(validRoles).toContain(policy.to);
    }
  });

  it('B-class paths declare a drain account, A-class do not', () => {
    expect(TRANSFER_PATH_WHITELIST[TransferPath.INTERNAL_OUT].class).toBe(AccountingClass.B);
    expect(TRANSFER_PATH_WHITELIST[TransferPath.INTERNAL_OUT].drain).toBe('TRADE_CLEARING');
    expect(TRANSFER_PATH_WHITELIST[TransferPath.FEE_COLLECT].drain).toBe('FEE_RECEIVABLE');
    expect(TRANSFER_PATH_WHITELIST[TransferPath.AGGREGATE].class).toBe(AccountingClass.A);
    expect(TRANSFER_PATH_WHITELIST[TransferPath.AGGREGATE].drain).toBeUndefined();
  });

  it('resolvePathPolicy returns policy for a known from→to role pair', () => {
    expect(resolvePathPolicy('C_DEP', 'C_MAIN')?.path).toBe(TransferPath.AGGREGATE);
    expect(resolvePathPolicy('C_MAIN', 'C_OUT')?.path).toBe(TransferPath.FUND_OUT);
  });

  it('resolvePathPolicy returns null for non-whitelisted pair', () => {
    expect(resolvePathPolicy('C_DEP', 'F_LIQ')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest src/modules/funds-layer/constants/internal-transfer-paths.constant.spec.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现白名单常量**

`src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`：

```typescript
export enum TransferPath {
  AGGREGATE = 'AGGREGATE',
  FUND_OUT = 'FUND_OUT',
  FUND_RETURN = 'FUND_RETURN',
  INTERNAL_OUT = 'INTERNAL_OUT',
  INTERNAL_IN = 'INTERNAL_IN',
  FEE_COLLECT = 'FEE_COLLECT',
}

export enum AccountingClass {
  A = 'A',
  B = 'B',
}

export enum TransferMedium {
  CHAIN = 'CHAIN',
}

export type DrainAccount = 'TRADE_CLEARING' | 'FEE_RECEIVABLE';

export interface TransferPathPolicy {
  path: TransferPath;
  from: string; // WalletRole
  to: string; // WalletRole
  class: AccountingClass;
  medium: TransferMedium;
  trigger: string[];
  drain?: DrainAccount;
}

export const TRANSFER_PATH_WHITELIST: Record<TransferPath, TransferPathPolicy> = {
  [TransferPath.AGGREGATE]: {
    path: TransferPath.AGGREGATE,
    from: 'C_DEP', to: 'C_MAIN',
    class: AccountingClass.A, medium: TransferMedium.CHAIN,
    trigger: ['CRON', 'THRESHOLD'],
  },
  [TransferPath.FUND_OUT]: {
    path: TransferPath.FUND_OUT,
    from: 'C_MAIN', to: 'C_OUT',
    class: AccountingClass.A, medium: TransferMedium.CHAIN,
    trigger: ['WITHDRAW'],
  },
  [TransferPath.FUND_RETURN]: {
    path: TransferPath.FUND_RETURN,
    from: 'C_OUT', to: 'C_MAIN',
    class: AccountingClass.A, medium: TransferMedium.CHAIN,
    trigger: ['WITHDRAW'],
  },
  [TransferPath.INTERNAL_OUT]: {
    path: TransferPath.INTERNAL_OUT,
    from: 'C_MAIN', to: 'F_LIQ',
    class: AccountingClass.B, medium: TransferMedium.CHAIN,
    trigger: ['EOD'], drain: 'TRADE_CLEARING',
  },
  [TransferPath.INTERNAL_IN]: {
    path: TransferPath.INTERNAL_IN,
    from: 'F_LIQ', to: 'C_MAIN',
    class: AccountingClass.B, medium: TransferMedium.CHAIN,
    trigger: ['EOD'], drain: 'TRADE_CLEARING',
  },
  [TransferPath.FEE_COLLECT]: {
    path: TransferPath.FEE_COLLECT,
    from: 'C_MAIN', to: 'F_OPS',
    class: AccountingClass.B, medium: TransferMedium.CHAIN,
    trigger: ['CRON'], drain: 'FEE_RECEIVABLE',
  },
};

export function resolvePathPolicy(
  fromRole: string,
  toRole: string,
): TransferPathPolicy | null {
  return (
    Object.values(TRANSFER_PATH_WHITELIST).find(
      (p) => p.from === fromRole && p.to === toRole,
    ) ?? null
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/modules/funds-layer/constants/internal-transfer-paths.constant.spec.ts`
Expected: PASS（5 个用例全绿）。

- [ ] **Step 5: 建模块骨架并注册**

`src/modules/funds-layer/funds-layer.module.ts`：

```typescript
import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class FundsLayerModule {}
```

在 `src/app.module.ts` 的 imports 数组加入 `FundsLayerModule`（与其它模块并列）。

- [ ] **Step 6: 注册域事件常量**

在 `src/common/events/domain-events.constants.ts` 的 `DOMAIN_EVENTS` 对象末尾（最后一个条目后）加：

```typescript
  // ── Funds Layer (V7) ──
  FUNDSFLOW_STATUS_CHANGED: {
    name: 'fundsflow.status.changed',
    emitter: 'FundsFlowService',
    subscribers: ['InternalTransferWorkflowService', 'EodSettlementWorkflowService'],
    payload: '{ fundsFlowId: string, internalTransferId: string, oldStatus: string, newStatus: string, operatorId?: string }',
  },
  INTERNALTRANSFER_COMPLETED: {
    name: 'internaltransfer.completed',
    emitter: 'InternalTransferService',
    subscribers: [],
    payload: '{ internalTransferId: string, pathLabel: string }',
  },
```

- [ ] **Step 7: 注册审计常量**

在 `src/modules/audit-logging/constants/audit-actions.constant.ts`：
- `AuditEntityTypes`（42 行块）加：`INTERNAL_TRANSFER: 'INTERNAL_TRANSFER',`
- `AuditBusinessWorkflowTypes`（119 行块）加：`INTERNAL_TRANSFER: 'INTERNAL_TRANSFER',`
- `AuditActions`（184 行块）加：

```typescript
  INTERNAL_TRANSFER_REQUESTED: 'INTERNAL_TRANSFER_REQUESTED',
  TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',
  TRANSFER_FAILED: 'TRANSFER_FAILED',
  TRANSFER_WHITELIST_REJECTED: 'TRANSFER_WHITELIST_REJECTED',
```

- [ ] **Step 8: 注册 RBAC 权限**

在 `src/modules/identity/access-control/rbac.catalog.ts` 加路由（参考既有 `route(...)` 写法，权限名 `INTERNAL_TRANSFER_READ` / `INTERNAL_TRANSFER_WRITE`）：

```typescript
  route('GET', '/admin/funds-layer/transfers', 'List internal transfers', ['INTERNAL_TRANSFER_READ']),
  route('GET', '/admin/funds-layer/transfers/:internalTxNo', 'Get internal transfer detail', ['INTERNAL_TRANSFER_READ']),
  route('POST', '/admin/funds-layer/transfers/:internalTxNo/simulate', 'Simulate funds flow step (DEV)', ['INTERNAL_TRANSFER_WRITE']),
```

- [ ] **Step 9: 编译 + 全量测试**

Run: `npm run build && npm test`
Expected: 编译 0 错误；测试全绿。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(v7-phase0): funds-layer module skeleton + whitelist + events/audit/rbac constants"
```

---

# Phase 1 — 通用内部转账工作流（底座）

> port 来源：`src/modules/asset-treasury/internal-funds/internal-funds.service.ts`（执行状态机）、`internal-transactions/internal-transactions.service.ts`（聚合）。port 原则：复制结构 → 改用现有表 → **删 FIAT_TRANSITIONS、删 captureFromInternalFund、事件改名 `fundsflow.status.changed`**。

## Task 1.1: FundsFlowService（domain L1，CRYPTO 状态机）

**Files:**
- Create: `src/modules/funds-layer/domain/funds-flow.service.ts`
- Test: `src/modules/funds-layer/domain/funds-flow.service.spec.ts`

- [ ] **Step 1: 写失败测试——CRYPTO 状态机合法/非法转换**

`funds-flow.service.spec.ts`（用现有 `internal-funds.service.spec.ts` 为模板，仅保留 crypto 用例）：

```typescript
import { Test } from '@nestjs/testing';
import { FundsFlowService } from './funds-flow.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

describe('FundsFlowService (crypto state machine)', () => {
  let service: FundsFlowService;
  const tx: any = {
    internalFund: { findUnique: jest.fn(), update: jest.fn() },
    internalFundAuditLog: { create: jest.fn() },
  };
  const prisma: any = { $transaction: (fn: any) => fn(tx) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        FundsFlowService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AuditLogsService, useValue: { recordByActor: jest.fn() } },
      ],
    }).compile();
    service = mod.get(FundsFlowService);
  });

  it('rejects an illegal transition (CONFIRM from CREATED)', async () => {
    tx.internalFund.findUnique.mockResolvedValue({
      id: 'f1', internalFundNo: 'IFD-1', status: 'CREATED',
      asset: { type: 'CRYPTO' }, statusHistory: null,
      internalTransaction: { id: 't1', internalTxNo: 'ITX-1' },
    });
    await expect(
      service.updateStatus('f1', { action: 'CONFIRM' } as any, 'SYSTEM'),
    ).rejects.toThrow(/Invalid action/);
  });

  it('advances SIGNING on SIGN from CREATED', async () => {
    tx.internalFund.findUnique.mockResolvedValue({
      id: 'f1', internalFundNo: 'IFD-1', status: 'CREATED',
      asset: { type: 'CRYPTO' }, statusHistory: null,
      internalTransaction: { id: 't1', internalTxNo: 'ITX-1' },
    });
    tx.internalFund.update.mockImplementation(({ data }: any) => ({ id: 'f1', ...data }));
    const res = await service.updateStatus('f1', { action: 'SIGN' } as any, 'SYSTEM');
    expect(res.status).toBe('SIGNING');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest src/modules/funds-layer/domain/funds-flow.service.spec.ts`
Expected: FAIL（FundsFlowService 不存在）。

- [ ] **Step 3: port 实现**

复制 `internal-funds.service.ts` → `funds-flow.service.ts`，做以下改动：
1. 类名 `InternalFundsService` → `FundsFlowService`。
2. **删除** `FIAT_TRANSITIONS` 常量与 `getTransitionMap` 中的 FIAT 分支——`getTransitionMap` 直接返回 `CRYPTO_TRANSITIONS`（保留方法签名以兼容）。
3. **删除** 构造函数中 `feeOccurrencesService` 注入、`sumFeeOccurrenceAmounts`、`buildCryptoFeePlaceholders`、`updateStatus` 中 CONFIRMED 的 fee capture 块（549-571）。
4. **删除** `createMock` 方法（演示用，新模块不需要）。
5. 事件名：`this.eventEmitter.emit('internal-fund.status.changed', ...)` → `'fundsflow.status.changed'`，payload 字段改 `{ fundsFlowId, internalTransferId, oldStatus, newStatus, operatorId }`（键名对齐 domain-events 注册）。
6. 保留 `createFromInternalTransaction`、`updateStatus`、`autoClearConfirmedFunds`、`syncStatusFromFunds` 调用关系（`internalTransactionsService` 注入改为 `InternalTransferService`，见 Task 1.2；本 Task 先用接口占位、Task 1.2 完成后接通）。
7. 表仍是 `internalFund` / `internalTransaction`（复用现有表）。

> 为让本 Task 独立通过，先把对 `InternalTransferService.syncStatusFromFunds` 的调用留为可注入依赖（构造函数注入），测试里 mock 掉。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/modules/funds-layer/domain/funds-flow.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/domain/funds-flow.service.ts src/modules/funds-layer/domain/funds-flow.service.spec.ts
git commit -m "feat(v7-phase1): port FundsFlowService (crypto-only state machine)"
```

---

## Task 1.2: InternalTransferService（domain L1，聚合 + 幂等创建）

**Files:**
- Create: `src/modules/funds-layer/domain/internal-transfer.service.ts`
- Test: `src/modules/funds-layer/domain/internal-transfer.service.spec.ts`

- [ ] **Step 1: 写失败测试——创建带 pathLabel/traceId 的 transfer + 幂等**

```typescript
import { Test } from '@nestjs/testing';
import { InternalTransferService } from './internal-transfer.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { TransferPath, AccountingClass } from '../constants/internal-transfer-paths.constant';

describe('InternalTransferService', () => {
  let service: InternalTransferService;
  const tx: any = { internalTransaction: { create: jest.fn(), findUnique: jest.fn() } };
  const prisma: any = { $transaction: (fn: any) => fn(tx) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        InternalTransferService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { recordByActor: jest.fn() } },
      ],
    }).compile();
    service = mod.get(InternalTransferService);
  });

  it('creates a transfer carrying pathLabel/accountingClass/medium/traceId', async () => {
    tx.internalTransaction.create.mockImplementation(({ data }: any) => ({ id: 't1', ...data }));
    const res = await service.createTransfer({
      path: TransferPath.AGGREGATE,
      accountingClass: AccountingClass.A,
      medium: 'CHAIN',
      triggerSource: 'CRON',
      sourceType: 'DEPOSIT_SWEEP', sourceId: 'w1', sourceNo: null,
      ownerType: 'PLATFORM', ownerId: 'PLATFORM', ownerNo: 'PLATFORM',
      assetId: 'a1', amount: '1.5' as any,
      fromWalletId: 'w1', toWalletId: 'w2',
    } as any, 'SYSTEM');
    expect(res.pathLabel).toBe('AGGREGATE');
    expect(res.accountingClass).toBe('A');
    expect(res.medium).toBe('CHAIN');
    expect(typeof res.traceId).toBe('string');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest src/modules/funds-layer/domain/internal-transfer.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: port 实现**

复制 `internal-transactions.service.ts` → `internal-transfer.service.ts`，改动：
1. 类名 → `InternalTransferService`。
2. 新增 `createTransfer(input, operatorId, tx?)`：写 `pathLabel`/`accountingClass`/`medium`/`triggerSource`/`traceId`（用 `randomUUID()` from `node:crypto` 生成 traceId），其余沿用 `createWithUniqueNo` 的幂等 No 生成逻辑。`type` 字段写入 `pathLabel` 值（兼容旧非空约束）。
3. 保留 `syncStatusFromFunds`、`findAllForAdmin`、`findOneForAdmin`（findAll/findOne 的 where 过滤改用 `pathLabel`）。
4. **删除** 旧的 `createFromDepositSuccess`、`approveManualReview`、`rejectManualReview`、`syncApprovalProjection`（V7 审批走偿付义务 Phase 5，通用路径无审批）。
5. 审计 action 用 `AuditActions.INTERNAL_TRANSFER_REQUESTED`，entityType `AuditEntityTypes.INTERNAL_TRANSFER`，workflowType `INTERNAL_TRANSFER`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest src/modules/funds-layer/domain/internal-transfer.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: 接通 FundsFlowService 对 syncStatusFromFunds 的调用**

把 Task 1.1 中 FundsFlowService 注入的占位依赖换成真实 `InternalTransferService`，运行 `npx jest src/modules/funds-layer/domain/funds-flow.service.spec.ts` 确认仍 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/domain/internal-transfer.service.ts src/modules/funds-layer/domain/internal-transfer.service.spec.ts src/modules/funds-layer/domain/funds-flow.service.ts
git commit -m "feat(v7-phase1): port InternalTransferService + wire funds-flow aggregation"
```

---

## Task 1.3: WhitelistGuard（白名单校验）

**Files:**
- Create: `src/modules/funds-layer/guards/whitelist.guard.ts`
- Test: `src/modules/funds-layer/guards/whitelist.guard.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { WhitelistGuard } from './whitelist.guard';
import { TransferPath } from '../constants/internal-transfer-paths.constant';
import { BadRequestException } from '@nestjs/common';

describe('WhitelistGuard', () => {
  const guard = new WhitelistGuard();

  it('returns the policy for a whitelisted from→to pair', () => {
    const policy = guard.assertWhitelisted('C_DEP', 'C_MAIN');
    expect(policy.path).toBe(TransferPath.AGGREGATE);
  });

  it('throws for a non-whitelisted pair', () => {
    expect(() => guard.assertWhitelisted('C_DEP', 'F_LIQ')).toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/funds-layer/guards/whitelist.guard.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  TransferPathPolicy,
  resolvePathPolicy,
} from '../constants/internal-transfer-paths.constant';

@Injectable()
export class WhitelistGuard {
  assertWhitelisted(fromRole: string, toRole: string): TransferPathPolicy {
    const policy = resolvePathPolicy(fromRole, toRole);
    if (!policy) {
      throw new BadRequestException({
        code: 'TRANSFER_NOT_WHITELISTED',
        message: `from=${fromRole} to=${toRole} is not a whitelisted internal transfer path`,
      });
    }
    return policy;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest src/modules/funds-layer/guards/whitelist.guard.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/guards/
git commit -m "feat(v7-phase1): whitelist guard rejecting non-whitelisted from→to pairs"
```

---

## Task 1.4: FundsAccountingService（A 类零 TB）

**Files:**
- Create: `src/modules/funds-layer/accounting/funds-accounting.service.ts`

- [ ] **Step 1: 实现 A 类（零 TB）+ B 类占位**

A 类不动 TB，仅返回标记；B 类抛"未实现"（留 Phase 3）。无独立单测（行为在 workflow 测试覆盖），编译验证即可。

```typescript
import { Injectable, NotImplementedException } from '@nestjs/common';
import { AccountingClass } from '../constants/internal-transfer-paths.constant';

@Injectable()
export class FundsAccountingService {
  /**
   * A 类：客户资产在公司钱包间搬位置，TB 托管余额不变 → 不产生 TB transfer。
   * B 类：drain TRADE_CLEARING / FEE_RECEIVABLE ↔ CUSTODY（Phase 3 实现）。
   */
  async applyAccounting(input: {
    accountingClass: AccountingClass;
    internalTransferId: string;
  }): Promise<{ tbApplied: boolean }> {
    if (input.accountingClass === AccountingClass.A) {
      return { tbApplied: false };
    }
    throw new NotImplementedException({
      code: 'B_CLASS_ACCOUNTING_PENDING',
      message: 'B-class drain accounting is implemented in Phase 3',
    });
  }
}
```

- [ ] **Step 2: 编译验证**

Run: `npm run build`
Expected: 0 错误。

- [ ] **Step 3: Commit**

```bash
git add src/modules/funds-layer/accounting/
git commit -m "feat(v7-phase1): A-class zero-TB accounting (B-class deferred to Phase 3)"
```

---

## Task 1.5: MockCustodianExecutionAdapter

**Files:**
- Create: `src/modules/funds-layer/adapters/mock-custodian-execution.adapter.ts`

- [ ] **Step 1: 实现 mock 链上执行（生成假 txHash）**

```typescript
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

@Injectable()
export class MockCustodianExecutionAdapter {
  /** mock：返回一个确定性的假 txHash，真实 HexTrust 对接在后续轮次替换 */
  async broadcast(internalFundNo: string): Promise<{ txHash: string }> {
    return { txHash: `0xmock${internalFundNo}${randomUUID().slice(0, 8)}` };
  }
}
```

- [ ] **Step 2: 编译验证 + Commit**

Run: `npm run build`

```bash
git add src/modules/funds-layer/adapters/
git commit -m "feat(v7-phase1): mock custodian execution adapter"
```

---

## Task 1.6: InternalTransferWorkflowService（L3 通用工作流）

**Files:**
- Create: `src/modules/funds-layer/workflow/internal-transfer-workflow.service.ts`
- Test: `src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试——initiate 走白名单 + 创建 transfer + funds flow + A 类记账**

```typescript
import { Test } from '@nestjs/testing';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('InternalTransferWorkflowService', () => {
  let service: InternalTransferWorkflowService;
  const internalTransfer = { createTransfer: jest.fn() };
  const fundsFlow = { createFromInternalTransaction: jest.fn() };
  const accounting = { applyAccounting: jest.fn() };
  const audit = { recordByActor: jest.fn(), recordSystem: jest.fn() };
  const prisma: any = { $transaction: (fn: any) => fn({}) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        InternalTransferWorkflowService,
        { provide: InternalTransferService, useValue: internalTransfer },
        { provide: FundsFlowService, useValue: fundsFlow },
        { provide: WhitelistGuard, useValue: new WhitelistGuard() },
        { provide: FundsAccountingService, useValue: accounting },
        { provide: AuditLogsService, useValue: audit },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(InternalTransferWorkflowService);
  });

  it('rejects a non-whitelisted from→to before creating anything', async () => {
    await expect(
      service.initiate({
        fromRole: 'C_DEP', toRole: 'F_LIQ',
        sourceType: 'DEPOSIT_SWEEP', sourceId: 'w1',
        ownerType: 'PLATFORM', ownerId: 'PLATFORM',
        assetId: 'a1', amount: '1.0',
        fromWalletId: 'w1', toWalletId: 'w2',
        triggerSource: 'CRON',
      } as any, 'SYSTEM'),
    ).rejects.toThrow(/not a whitelisted/);
    expect(internalTransfer.createTransfer).not.toHaveBeenCalled();
  });

  it('creates transfer + funds flow + applies A-class accounting for AGGREGATE', async () => {
    internalTransfer.createTransfer.mockResolvedValue({ id: 't1', internalTxNo: 'ITX-1', accountingClass: 'A' });
    fundsFlow.createFromInternalTransaction.mockResolvedValue({ id: 'f1', internalFundNo: 'IFD-1' });
    accounting.applyAccounting.mockResolvedValue({ tbApplied: false });
    const res = await service.initiate({
      fromRole: 'C_DEP', toRole: 'C_MAIN',
      sourceType: 'DEPOSIT_SWEEP', sourceId: 'w1',
      ownerType: 'PLATFORM', ownerId: 'PLATFORM',
      assetId: 'a1', amount: '1.0',
      fromWalletId: 'w1', toWalletId: 'w2',
      triggerSource: 'CRON',
    } as any, 'SYSTEM');
    expect(internalTransfer.createTransfer).toHaveBeenCalled();
    expect(fundsFlow.createFromInternalTransaction).toHaveBeenCalled();
    expect(res.internalTxNo).toBe('ITX-1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 L3 工作流**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';

export interface InitiateTransferInput {
  fromRole: string;
  toRole: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo?: string | null;
  assetId: string;
  amount: string;
  fromWalletId: string;
  toWalletId: string;
  triggerSource: string;
}

@Injectable()
export class InternalTransferWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly whitelist: WhitelistGuard,
    private readonly accounting: FundsAccountingService,
    private readonly audit: AuditLogsService,
  ) {}

  async initiate(input: InitiateTransferInput, operatorId = 'SYSTEM') {
    // 1. 白名单校验（拒绝先于任何写入）
    const policy = this.whitelist.assertWhitelisted(input.fromRole, input.toRole);

    return (this.prisma as any).$transaction(async (tx: Prisma.TransactionClient) => {
      // 2. 创建资金单（domain 写表 + 审计 REQUESTED + traceId）
      const transfer = await this.transfers.createTransfer(
        {
          path: policy.path,
          accountingClass: policy.class,
          medium: policy.medium,
          triggerSource: input.triggerSource,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceNo: input.sourceNo ?? null,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          ownerNo: input.ownerNo ?? null,
          assetId: input.assetId,
          amount: new Prisma.Decimal(input.amount),
          feeAmount: new Prisma.Decimal(0),
          netAmount: new Prisma.Decimal(input.amount),
          fromWalletId: input.fromWalletId,
          toWalletId: input.toWalletId,
        } as any,
        operatorId,
        tx,
      );

      // 3. 创建执行 leg（funds flow，CREATED 态）
      await this.fundsFlow.createFromInternalTransaction(
        { internalTransactionId: transfer.id },
        operatorId,
        tx,
      );

      // 4. A 类零 TB（B 类 Phase 3）
      await this.accounting.applyAccounting({
        accountingClass: policy.class,
        internalTransferId: transfer.id,
      });

      return transfer;
    });
  }

  // 终态记账/审计在 fundsflow.status.changed 订阅里推进（Step 4 加）
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts`
Expected: PASS（2 用例）。

- [ ] **Step 5: 加 @OnEvent 订阅——funds flow 终态推进**

在 workflow 加：

```typescript
import { OnEvent } from '@nestjs/event-emitter';
// ...
  @OnEvent('fundsflow.status.changed')
  async onFundsFlowStatusChanged(event: {
    fundsFlowId: string;
    internalTransferId: string;
    oldStatus: string;
    newStatus: string;
    operatorId?: string;
  }) {
    if (event.newStatus === 'CLEAR') {
      await this.audit.recordSystem({
        action: AuditActions.TRANSFER_COMPLETED,
        entityType: AuditEntityTypes.INTERNAL_TRANSFER,
        entityId: event.internalTransferId,
        workflowType: 'INTERNAL_TRANSFER',
        reason: 'Funds flow cleared',
      } as any);
    }
    if (['FAILED', 'TIMEOUT'].includes(event.newStatus)) {
      await this.audit.recordSystem({
        action: AuditActions.TRANSFER_FAILED,
        entityType: AuditEntityTypes.INTERNAL_TRANSFER,
        entityId: event.internalTransferId,
        workflowType: 'INTERNAL_TRANSFER',
        reason: `Funds flow ${event.newStatus}`,
      } as any);
    }
  }
```

> 若 `recordSystem` 的真实签名不同，按 `audit-logs.service.ts` 实际签名调整字段（参考 V5 withdraw workflow 的 recordSystem 调用）。

- [ ] **Step 6: 运行确认仍通过 + Commit**

Run: `npx jest src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts`

```bash
git add src/modules/funds-layer/workflow/
git commit -m "feat(v7-phase1): universal internal-transfer workflow (whitelist→transfer→funds flow→A-class)"
```

---

## Task 1.7: Controllers（admin list/detail + simulate）+ 模块接线

**Files:**
- Create: `src/modules/funds-layer/dto/internal-transfer-query.dto.ts`
- Create: `src/modules/funds-layer/dto/simulate-funds-flow.dto.ts`
- Create: `src/modules/funds-layer/controllers/internal-transfer-admin.controller.ts`
- Create: `src/modules/funds-layer/controllers/funds-simulate.controller.ts`
- Modify: `src/modules/funds-layer/funds-layer.module.ts`

- [ ] **Step 1: DTO**

`simulate-funds-flow.dto.ts`：

```typescript
import { IsIn, IsOptional, IsString } from 'class-validator';

export class SimulateFundsFlowDto {
  @IsString()
  fundsFlowId!: string;

  @IsIn(['SIGN', 'BROADCAST', 'SEEN_IN_MEMPOOL', 'CONFIRM', 'CLEAR', 'FAIL', 'DROP', 'TIMEOUT', 'CANCEL'])
  action!: string;

  @IsOptional() @IsString()
  reason?: string;
}
```

`internal-transfer-query.dto.ts`（参考 `internal-transactions/dto/internal-transaction.dto.ts` 的 query DTO，字段：`skip/take/status/pathLabel/sourceNo/ownerNo/assetId/internalTxNo/startDate/endDate`）。

- [ ] **Step 2: Admin 查询 controller**

```typescript
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { InternalTransferQueryDto } from '../dto/internal-transfer-query.dto';
// 复用现有 admin JWT/RBAC guard（参考 internal-transactions.controller.ts 的 @UseGuards）

@Controller('admin/funds-layer/transfers')
export class InternalTransferAdminController {
  constructor(private readonly transfers: InternalTransferService) {}

  @Get()
  list(@Query() query: InternalTransferQueryDto) {
    return this.transfers.findAllForAdmin(query);
  }

  @Get(':internalTxNo')
  detail(@Param('internalTxNo') internalTxNo: string) {
    return this.transfers.findOneByNoForAdmin(internalTxNo);
  }
}
```

> 在 InternalTransferService 加 `findOneByNoForAdmin(internalTxNo)`（按业务键查，符合"业务键优先"规则），内部 where `{ internalTxNo }`。

- [ ] **Step 3: Simulate controller（DEV）**

```typescript
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { FundsFlowService } from '../domain/funds-flow.service';
import { SimulateFundsFlowDto } from '../dto/simulate-funds-flow.dto';

@Controller('admin/funds-layer/transfers')
export class FundsSimulateController {
  constructor(private readonly fundsFlow: FundsFlowService) {}

  @Post(':internalTxNo/simulate')
  simulate(
    @Param('internalTxNo') _internalTxNo: string,
    @Body() dto: SimulateFundsFlowDto,
  ) {
    return this.fundsFlow.updateStatus(dto.fundsFlowId, { action: dto.action, reason: dto.reason } as any, 'ADMIN');
  }
}
```

- [ ] **Step 4: 模块接线**

`funds-layer.module.ts` 填入 providers（FundsFlowService、InternalTransferService、WhitelistGuard、FundsAccountingService、MockCustodianExecutionAdapter、InternalTransferWorkflowService）、controllers（两个）、imports（PrismaModule、AuditLogsModule/对应模块、EventEmitterModule 若需）、exports（InternalTransferWorkflowService 供 Phase 2 V5 接入）。参考 `internal-funds.module.ts` 的依赖清单。

- [ ] **Step 5: 编译 + 全量测试 + 端到端手测**

Run: `npm run build && npm test`
Expected: 0 错误、全绿。

Run（手动验收，需 `npm run dev:start`）：
```bash
# 1. 直接造一笔 AGGREGATE transfer 需经 workflow——此处用 DB seed 或临时脚本创建一条 CREATED funds flow，
#    然后 simulate 逐步推进：
curl -X POST http://localhost:3500/admin/funds-layer/transfers/ITX-XXX/simulate \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"fundsFlowId":"<id>","action":"SIGN"}'
# 重复 BROADCAST→SEEN_IN_MEMPOOL→CONFIRM→CLEAR
```
Expected: funds flow 状态依次推进至 CLEAR；transfer 聚合为 SUCCESS；`GET /admin/funds-layer/transfers/ITX-XXX` 返回完整状态历史与 traceId。

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/
git commit -m "feat(v7-phase1): admin list/detail + simulate controllers + module wiring"
```

---

## Task 1.8: Admin funds flow 详情页（前端）

**Files:**
- Create: `admin-web/src/pages/funds-layer/InternalTransferDetailPage.tsx`
- Create: `admin-web/src/pages/funds-layer/InternalTransferListPage.tsx`
- Modify: `admin-web/src/App.tsx`（注册路由，静态段先于动态段）

- [ ] **Step 1: 列表页**

参考现有 `admin-web` 中 internal-transactions 列表页（或 DepositTransaction 列表）。用 `adminFetch` 调 `GET /admin/funds-layer/transfers`；列：`internalTxNo`、`pathLabel`（accent strip）、`status`、`asset.code`、`amount`、`createdAt`；行 `cursor-pointer` 跳详情。**禁止裸 id 在 No/Code 之前**。

- [ ] **Step 2: 详情页（遵循 frontend-admin.md 两栏布局）**

- 主体信息梯度：Hero（`internalTxNo` amber mono + STATUS/PATH/ASSET 带 label）→ Core Context（from/to wallet 角色、amount、traceId）→ Process/Timeline（funds flow 状态历史时间线）→ Technical（JSON）。
- 侧栏：ACTIONS（Manual Simulation 区——simulate 按钮，DEV）+ IDENTITY SUMMARY（3-5 行：pathLabel、status badge、asset.code）+ LIFECYCLE（createdAt/completedAt/updatedAt mono）。
- 用 `adm-*` 设计 token；simulate 控件放显式 `Manual Simulation` 区（禁止放 list header）。
- 在 `frontend-admin.md` 的 Per-entity Sidebar Fields 表登记 `InternalTransfer` 行。

- [ ] **Step 3: 路由注册**

`App.tsx`：先注册 `/funds-layer/transfers`（列表）再 `/funds-layer/transfers/:internalTxNo`（详情），静态段先于动态段。

- [ ] **Step 4: 前端构建 + 手测**

Run: `cd admin-web && npm run build`
Expected: 构建成功。

手测（`npm run dev:start`，访问 http://localhost:3501）：进列表 → 点一条 → 详情页展示状态时间线 → 点 simulate 推进一步 → 刷新看到状态前进。

- [ ] **Step 5: 在规则文档登记 sidebar 字段 + Commit**

更新 `doc-final/rules/frontend-admin.md` 的 Per-entity Sidebar Fields 表加 `InternalTransfer` 行。

```bash
git add admin-web/ doc-final/rules/frontend-admin.md
git commit -m "feat(v7-phase1): admin internal-transfer list + detail page with simulate"
```

---

## Phase 0+1 验收清单（合并演示）

- [ ] `npm run dev:rebuild && npm run build && npm test` 全绿
- [ ] FeeOccurrence 表与模块已彻底移除，V1–V6 测试无回归
- [ ] 手动创建一笔 crypto AGGREGATE transfer → simulate 走完 CREATED→SIGNING→BROADCASTED→CONFIRMING→CONFIRMED→CLEAR → transfer 聚合 SUCCESS
- [ ] 非白名单 from→to（如 C_DEP→F_LIQ）被 `TRANSFER_NOT_WHITELISTED` 拒绝，无记录创建
- [ ] 审计链 traceId 贯穿 REQUESTED→COMPLETED
- [ ] Admin 详情页展示状态时间线 + 路径标签 + traceId，simulate 控件可推进

---

## 后续 Phase（独立成计划）

每个待本计划落地验收后单独写计划，依赖关系见 spec §5：
- **Phase 2** — A 类路径接入（充值归集 cron sweep + V5 提现触发 FUND_OUT/RETURN）
- **Phase 3** — B 类 drain 记账 + EOD 兑换结算编排（port 轧差引擎，Outstanding 消费）
- **Phase 4** — 手续费归集（drain FEE_RECEIVABLE）
- **Phase 5** — 偿付义务（WITHDRAW_RETURN + 审批门）

Phase 2/3/5 依赖 Phase 1 的 `InternalTransferWorkflowService.initiate`（已 export）；Phase 4 依赖 Phase 3 的 B 类记账与 Settlement 引擎。
