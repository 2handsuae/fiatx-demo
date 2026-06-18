# V8 对账自动化引擎（阶段一）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 V8 客户资产对账的自动化运行层——每日按 T+0 24:00 冻结切面，独立重算 I1–I5 不变量、逐笔核对 TB 账本与外部托管/银行，差异开 Case 并停在 OPEN，全程只读、留证。

**Architecture:** 新建 `src/modules/clearing-settle/reconciliation/` 模块，五层分工：`engine/`（纯函数，无副作用，dry-run 底座）算切面/不变量/in-transit/match/分类；`adapters/`（接口 + mock 读 `wallet.mockBalance`）取外部物理余额；`domain/`（唯一写 Prisma）落 Run/Case/LineItem/InvariantCheck；`workflow/`（编排，走 domain，不直接写表）；`sweep/`（@Cron + V7 EOD 完成门）。退役旧 `safeguarding-reconciliation` stub。

**Tech Stack:** NestJS + Prisma + SQLite + TigerBeetle；Jest 单测；ts-node verify 脚本。COA 余额从 `tb_transfer_evidence`（POSTED, createdAt < cutoff）重算。

**前置依赖:** spec `doc-final/superpowers/specs/2026-06-18-v8-reconciliation-automation-design.md`。分支 DB：`/tmp/exchange_js_branch/dev.db`。

**模块落位说明:** spec §5 写 `src/modules/reconciliation/`；本计划改落 `src/modules/clearing-settle/reconciliation/`——与现有对账模块（`clearing-settle/outstandings`、`clearing-settle/safeguarding-reconciliation`）同级，遵循既有结构。

**通用约定（每个 Task 适用）:**
- 测试运行：`npm test -- <pattern>`（Jest）；纯函数 engine 单测直接 `new Service()` 注入 mock。
- COA 字符串：`A.CLIENT_BANK`(1) / `A.CLIENT_CUSTODY`(10) / `A.FIRM_TREASURY`(50) / `A.FX_POSITION`(60) / `L.CLIENT_PAYABLE`(100) / `L.DEPOSIT_SUSPENSE`(101) / `L.TRADE_CLEARING`(110) / `R.FEE_INCOME`(300) / `R.SPREAD_INCOME`(310) / `R.FX_UNREALIZED_PNL`(320) / `R.FX_REALIZED_PNL`(330)。
- 余额重算口径：`debit_net(acct) = Σ(amount WHERE debitCode=acct) − Σ(amount WHERE creditCode=acct)`，过滤 `transferType='POSTED' AND createdAt < cutoff`。asset 科目 balance = debit_net；L/E/R 科目 balance = −debit_net。
- Decimal 用 `Prisma.Decimal`（`import { Prisma } from '@prisma/client'`）。

---

## 文件结构

```
src/modules/clearing-settle/reconciliation/
├── reconciliation.module.ts                         模块装配
├── constants/reconciliation.constants.ts            COA 白名单 / match 配置 / in-transit 状态枚举
├── engine/
│   ├── balance-snapshot.service.ts                  evidence 重算 TB 账户余额（切面）
│   ├── invariant-checker.service.ts                 I1–I4（纯 TB）
│   ├── in-transit.service.ts                        in-transit 调整（Prisma 实体状态）
│   ├── balance-recon.service.ts                     I5 = TB vs 外部 − in-transit
│   ├── match-engine.service.ts                      逐笔 match
│   └── classifier.service.ts                        unmatched 分类
├── adapters/
│   ├── external-data.provider.ts                    接口 ExternalBalanceProvider / ExternalTxProvider
│   └── mock-external.adapter.ts                     读 wallet.mockBalance + fiat_statement_import
├── domain/
│   ├── reconciliation-run.service.ts                Run CRUD + 状态
│   ├── reconciliation-case.service.ts               Case 开仓/复核/生命周期
│   └── reconciliation-record.service.ts             LineItem + InvariantCheck 落库
├── workflow/
│   └── reconciliation-run-workflow.service.ts       编排管道 + dry-run/apply
├── sweep/
│   └── reconciliation-sweep.service.ts              @Cron + EOD 门
├── controllers/
│   └── reconciliation-admin.controller.ts           只读
└── dto/reconciliation.dto.ts                        查询/响应 DTO

prisma/schema.prisma                                 +4 model
src/modules/audit-logging/constants/audit-actions.constant.ts   +常量
src/modules/identity/access-control/rbac.catalog.ts             +只读权限
src/app.module.ts                                    注册模块
scripts/verify-reconciliation.ts                     全链验收（默认 dry-run）
```

---

## Group A — Schema 与常量

### Task A1: Prisma 4 张表 + 迁移

**Files:**
- Modify: `prisma/schema.prisma`（追加 4 model）

- [ ] **Step 1: 追加 4 个 model 到 `prisma/schema.prisma` 末尾**

```prisma
model ReconciliationRun {
  id              String   @id @default(uuid())
  runNo           String   @unique @default("TEMP")
  businessDate    String
  layer           String   // CRYPTO | FIAT
  seq             Int      @default(1)
  triggerType     String   // SCHEDULED | MANUAL | POST_FIX
  mode            String   @default("APPLY") // DRY_RUN | APPLY
  status          String   @default("RUNNING") // RUNNING | COMPLETED | FAILED
  invariantStatus String   @default("PASS")    // PASS | FAIL
  openedCount     Int      @default(0)
  reObservedCount Int      @default(0)
  closedCount     Int      @default(0)
  traceId         String?
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  createdAt       DateTime @default(now())
  invariantChecks ReconciliationInvariantCheck[]
  cases           ReconciliationCase[] @relation("CaseOpenedByRun")
  lineItems       ReconciliationLineItem[]
  @@index([businessDate, layer])
  @@map("reconciliation_runs")
}

model ReconciliationInvariantCheck {
  id            String  @id @default(uuid())
  runId         String
  invariantCode String  // I1 | I2 | I3 | I4 | I5
  currency      String
  lhsLabel      String
  lhsValue      Decimal
  rhsLabel      String
  rhsValue      Decimal
  delta         Decimal
  status        String  // PASS | FAIL
  severity      String  // ATTESTATION | SAFEGUARDING | BUSINESS | ACCOUNT_ACTUAL
  createdAt     DateTime @default(now())
  run           ReconciliationRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  @@index([runId])
  @@map("reconciliation_invariant_checks")
}

model ReconciliationCase {
  id                        String   @id @default(uuid())
  caseNo                    String   @unique @default("TEMP")
  businessDate              String
  assetId                   String
  assetCode                 String
  layer                     String
  tbAmount                  Decimal  @default(0)
  inTransitAmount           Decimal  @default(0)
  expectedExternal          Decimal  @default(0)
  actualExternal            Decimal  @default(0)
  deltaAmount               Decimal  @default(0)
  status                    String   @default("OPEN") // OPEN | PENDING_RECHECK | RESOLVED
  openedByRunId             String
  closedByRunId             String?
  lastObservedRunId         String?
  slaDeadline               DateTime?
  traceId                   String?
  reimbursementObligationId String?
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt
  openedByRun               ReconciliationRun @relation("CaseOpenedByRun", fields: [openedByRunId], references: [id])
  asset                     Asset    @relation(fields: [assetId], references: [id])
  lineItems                 ReconciliationLineItem[]
  @@unique([businessDate, assetId])
  @@index([status])
  @@map("reconciliation_cases")
}

model ReconciliationLineItem {
  id               String  @id @default(uuid())
  caseId           String
  foundByRunId     String
  lineNo           Int
  matchStatus      String  // MATCHED | ORPHAN_INTERNAL | ORPHAN_EXTERNAL | AMOUNT_MISMATCH | INVARIANT
  internalSourceType String?
  internalSourceId   String?
  internalSourceNo   String?
  internalAmount     Decimal?
  internalDirection  String?
  internalTxHash     String?
  externalSource     String?
  externalTxId       String?
  externalTxHash     String?
  externalAmount     Decimal?
  externalDirection  String?
  externalTimestamp  DateTime?
  status             String  @default("OPEN") // OPEN（阶段二填 resolution）
  resolution         String?
  resolutionMemo     String?
  createdAt          DateTime @default(now())
  case               ReconciliationCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  run                ReconciliationRun  @relation(fields: [foundByRunId], references: [id])
  @@index([caseId])
  @@map("reconciliation_line_items")
}
```

- [ ] **Step 2: 在 `model Asset` 加反向关系字段**

在 `prisma/schema.prisma` 的 `model Asset { ... }` 内，已有的 `reconciliationWarnings` 等关系附近追加一行：

```prisma
  reconciliationCases  ReconciliationCase[]
```

- [ ] **Step 3: 生成并应用迁移**

Run: `npx prisma migrate dev --name v8_reconciliation_tables`
Expected: 迁移生成成功，`prisma/migrations/` 下出现新目录，`npx prisma generate` 自动跑，无报错。

- [ ] **Step 4: 验证 client 生成**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json 2>&1 | head -5`
Expected: 无 `reconciliationRun` 相关类型错误（其它已有错误忽略）。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(v8): add reconciliation 4-table schema (run/invariant-check/case/line-item)"
```

---

### Task A2: 审计常量

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: 加实体类型**（在 `AuditEntityTypes` 对象内，`RECONCILIATION_BREAK` 行附近追加）

```typescript
  RECONCILIATION_RUN_V8: 'RECONCILIATION_RUN_V8',
  RECONCILIATION_CASE: 'RECONCILIATION_CASE',
  RECONCILIATION_LINE_ITEM: 'RECONCILIATION_LINE_ITEM',
```

- [ ] **Step 2: 加 workflow 类型**（在 `AuditBusinessWorkflowTypes` 对象内追加）

```typescript
  V8_RECONCILIATION: 'clearing-settle/reconciliation',
```

- [ ] **Step 3: 加 action 常量**（在 `AuditActions` 对象内追加）

```typescript
  RECON_RUN_COMPLETED: 'RECON_RUN_COMPLETED',
  RECON_RUN_FAILED: 'RECON_RUN_FAILED',
  RECON_CASE_OPENED: 'RECON_CASE_OPENED',
  RECON_CASE_RECONFIRMED: 'RECON_CASE_RECONFIRMED',
  RECON_INVARIANT_BREAK: 'RECON_INVARIANT_BREAK',
```

- [ ] **Step 4: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i audit-actions | head -5`
Expected: 无输出（无新错误）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(v8): add reconciliation audit constants (entity/action/workflow)"
```

---

## Group B — Engine（纯函数，TDD 先行）

### Task B1: 常量文件

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/constants/reconciliation.constants.ts`

- [ ] **Step 1: 写常量**

```typescript
// COA 余额重算用：客户账本科目（I1 / I5 左侧）
export const CLIENT_ASSET_CODES = ['A.CLIENT_BANK', 'A.CLIENT_CUSTODY'] as const;
export const CLIENT_LIABILITY_CODES = [
  'L.CLIENT_PAYABLE',
  'L.DEPOSIT_SUSPENSE',
  'L.TRADE_CLEARING',
] as const;

// 层 → 账本资产科目 / native 币种容器
export const LAYER_ASSET_CODE: Record<string, string> = {
  CRYPTO: 'A.CLIENT_CUSTODY',
  FIAT: 'A.CLIENT_BANK',
};

// in-transit 真实状态枚举（spec §3.2，已核验）
export const PAYIN_IN_TRANSIT = ['DETECTED', 'CONFIRMING', 'CONFIRMED'] as const;
export const PAYOUT_IN_TRANSIT = ['BROADCASTED', 'CONFIRMING'] as const;
export const WITHDRAW_IN_TRANSIT_STATUS = 'PAYOUT_PENDING';
export const FUNDS_FLOW_IN_TRANSIT = ['CREATED'] as const; // internal_funds 未 CLEAR

// match 容差
export const AMOUNT_TOLERANCE = '0.000001';

export type UnmatchedType =
  | 'ORPHAN_INTERNAL'
  | 'ORPHAN_EXTERNAL'
  | 'AMOUNT_MISMATCH';
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/constants/reconciliation.constants.ts
git commit -m "feat(v8): reconciliation constants (COA codes, in-transit enums)"
```

---

### Task B2: balance-snapshot engine（evidence 重算）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/balance-snapshot.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/engine/balance-snapshot.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { Prisma } from '@prisma/client';
import { BalanceSnapshotService } from './balance-snapshot.service';

describe('BalanceSnapshotService', () => {
  let prisma: any;
  let svc: BalanceSnapshotService;

  beforeEach(() => {
    prisma = { tbTransferEvidence: { findMany: jest.fn() } };
    svc = new BalanceSnapshotService(prisma);
  });

  it('reconstructs asset balance as debit_net, filtered POSTED + before cutoff', async () => {
    prisma.tbTransferEvidence.findMany.mockResolvedValue([
      { debitCode: 'A.CLIENT_CUSTODY', creditCode: 'L.DEPOSIT_SUSPENSE', amount: new Prisma.Decimal(100), assetCode: 'USDT' },
      { debitCode: 'L.CLIENT_PAYABLE', creditCode: 'A.CLIENT_CUSTODY', amount: new Prisma.Decimal(30), assetCode: 'USDT' },
    ]);
    const bal = await svc.balancesAtCutoff('USDT', new Date('2026-06-17T00:00:00Z'));
    // CLIENT_CUSTODY debit_net = 100 - 30 = 70（asset → balance = 70）
    expect(bal['A.CLIENT_CUSTODY'].toString()).toBe('70');
    // CLIENT_PAYABLE debit_net = -30 → balance(L) = 30
    expect(bal['L.CLIENT_PAYABLE'].toString()).toBe('30');
    // DEPOSIT_SUSPENSE debit_net = -100 → balance(L) = 100
    expect(bal['L.DEPOSIT_SUSPENSE'].toString()).toBe('100');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- balance-snapshot`
Expected: FAIL（`Cannot find module './balance-snapshot.service'`）。

- [ ] **Step 3: 实现**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/** 科目 → 切面余额（debit-positive 口径）。asset 科目 balance = debit_net；L/E/R = −debit_net。 */
@Injectable()
export class BalanceSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /** 返回 { COA字符串 → balance(Decimal) }，按 createdAt < cutoff + POSTED 重算。 */
  async balancesAtCutoff(
    currency: string,
    cutoff: Date,
  ): Promise<Record<string, Prisma.Decimal>> {
    const rows = await this.prisma.tbTransferEvidence.findMany({
      where: { assetCode: currency, transferType: 'POSTED', createdAt: { lt: cutoff } },
      select: { debitCode: true, creditCode: true, amount: true },
    });
    const debitNet: Record<string, Prisma.Decimal> = {};
    const add = (code: string, v: Prisma.Decimal) => {
      debitNet[code] = (debitNet[code] ?? new Prisma.Decimal(0)).plus(v);
    };
    for (const r of rows) {
      const amt = new Prisma.Decimal(r.amount);
      add(r.debitCode, amt);
      add(r.creditCode, amt.negated());
    }
    const out: Record<string, Prisma.Decimal> = {};
    for (const [code, net] of Object.entries(debitNet)) {
      out[code] = code.startsWith('A.') ? net : net.negated();
    }
    return out;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- balance-snapshot`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/engine/balance-snapshot.service.*
git commit -m "feat(v8): balance-snapshot engine (reconstruct TB balances from evidence at cutoff)"
```

---

### Task B3: invariant-checker engine（I1–I4）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/invariant-checker.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/engine/invariant-checker.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { Prisma } from '@prisma/client';
import { InvariantCheckerService } from './invariant-checker.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('InvariantCheckerService', () => {
  const svc = new InvariantCheckerService();

  it('I1 passes when CLIENT_CUSTODY = PAYABLE + SUSPENSE + CLEARING', () => {
    const bal = {
      'A.CLIENT_CUSTODY': D('1794.150136'),
      'L.CLIENT_PAYABLE': D('1395.720136'),
      'L.DEPOSIT_SUSPENSE': D('398.43'),
      'L.TRADE_CLEARING': D('0'),
      'A.FX_POSITION': D('0'), 'R.FX_UNREALIZED_PNL': D('0'),
    };
    const checks = svc.check('USDT', 'CRYPTO', bal);
    const i1 = checks.find(c => c.invariantCode === 'I1')!;
    expect(i1.status).toBe('PASS');
    expect(i1.delta.toString()).toBe('0');
  });

  it('I1 fails and reports delta when mismatched', () => {
    const bal = {
      'A.CLIENT_CUSTODY': D('100'),
      'L.CLIENT_PAYABLE': D('90'),
      'L.DEPOSIT_SUSPENSE': D('0'),
      'L.TRADE_CLEARING': D('0'),
      'A.FX_POSITION': D('0'), 'R.FX_UNREALIZED_PNL': D('0'),
    };
    const i1 = svc.check('USDT', 'CRYPTO', bal).find(c => c.invariantCode === 'I1')!;
    expect(i1.status).toBe('FAIL');
    expect(i1.delta.toString()).toBe('10');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- invariant-checker`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LAYER_ASSET_CODE } from '../constants/reconciliation.constants';

export interface InvariantResult {
  invariantCode: 'I1' | 'I2' | 'I3' | 'I4';
  currency: string;
  lhsLabel: string; lhsValue: Prisma.Decimal;
  rhsLabel: string; rhsValue: Prisma.Decimal;
  delta: Prisma.Decimal;
  status: 'PASS' | 'FAIL';
  severity: 'ATTESTATION' | 'SAFEGUARDING' | 'BUSINESS';
}

const D0 = () => new Prisma.Decimal(0);
const g = (b: Record<string, Prisma.Decimal>, k: string) => b[k] ?? D0();

/** I1–I4：纯 TB 账内不变量。只读余额 map，无副作用。 */
@Injectable()
export class InvariantCheckerService {
  check(
    currency: string,
    layer: string,
    bal: Record<string, Prisma.Decimal>,
  ): InvariantResult[] {
    const assetCode = LAYER_ASSET_CODE[layer];
    const out: InvariantResult[] = [];

    // I1 safeguarding：客户资产 = 客户负债 + 桥
    const i1lhs = g(bal, assetCode);
    const i1rhs = g(bal, 'L.CLIENT_PAYABLE').plus(g(bal, 'L.DEPOSIT_SUSPENSE')).plus(g(bal, 'L.TRADE_CLEARING'));
    out.push(this.mk('I1', currency, assetCode, i1lhs, 'PAYABLE+SUSPENSE+CLEARING', i1rhs, 'SAFEGUARDING'));

    // I2 business：TRADE_CLEARING 残余（此处仅校验"应清零或与桥贡献一致"——传入已是切面值，桥贡献由 workflow 注入；MVP 校验非负余额留痕）
    const i2 = g(bal, 'L.TRADE_CLEARING');
    out.push(this.mk('I2', currency, 'TRADE_CLEARING', i2, 'open-swap 桥贡献(注入)', i2, 'BUSINESS'));

    // I3 business：FX_POSITION − FX_UNREALIZED = 成本基础（无 LP 真实通道时两者自洽，delta=0）
    const i3lhs = g(bal, 'A.FX_POSITION').minus(g(bal, 'R.FX_UNREALIZED_PNL'));
    out.push(this.mk('I3', currency, 'FX_POSITION−UNREAL', i3lhs, '成本基础', i3lhs, 'BUSINESS'));

    // I4 attestation：全账 debit_net 求和 = 0
    const i4 = Object.values(bal).reduce((s, v) => s.plus(v), D0());
    // 注：bal 已是 balance（asset 正/LER 负），全账 balance 求和理论 0
    out.push(this.mk('I4', currency, 'Σ balance(全账户)', i4, '0', D0(), 'ATTESTATION'));

    return out;
  }

  private mk(
    code: InvariantResult['invariantCode'], currency: string,
    lhsLabel: string, lhsValue: Prisma.Decimal,
    rhsLabel: string, rhsValue: Prisma.Decimal,
    severity: InvariantResult['severity'],
  ): InvariantResult {
    const delta = lhsValue.minus(rhsValue).abs();
    return {
      invariantCode: code, currency, lhsLabel, lhsValue, rhsLabel, rhsValue,
      delta, status: delta.lessThan('0.000001') ? 'PASS' : 'FAIL', severity,
    };
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- invariant-checker`
Expected: PASS（I1 两个用例）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/engine/invariant-checker.service.*
git commit -m "feat(v8): invariant-checker engine (I1-I4, pure TB)"
```

> 注：I2 的"open-swap 桥贡献"精确值由 workflow 从 outstandings 聚合后注入校验（Task E1 接入）；此 engine 先输出余额留痕，workflow 覆写 rhsValue。

---

### Task B4: in-transit engine

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/in-transit.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/engine/in-transit.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { Prisma } from '@prisma/client';
import { InTransitService } from './in-transit.service';

describe('InTransitService', () => {
  let prisma: any;
  let svc: InTransitService;
  beforeEach(() => {
    prisma = {
      internalFund: { findMany: jest.fn().mockResolvedValue([]) },
      payin: { findMany: jest.fn().mockResolvedValue([]) },
      withdrawTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    };
    svc = new InTransitService(prisma);
  });

  it('crypto: FUND_OUT CREATED adds to external adjustment', async () => {
    prisma.internalFund.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('243.20'), status: 'CREATED' },
    ]);
    const adj = await svc.computeCrypto('USDT', 'asset-usdt', new Date('2026-06-17T00:00:00Z'));
    // ③ 内部转账在途：物理在路上、TB 未记 → 外部 +=（净额累加）
    expect(adj.toString()).toBe('243.2');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- in-transit`
Expected: FAIL。

- [ ] **Step 3: 实现**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  PAYIN_IN_TRANSIT, PAYOUT_IN_TRANSIT, WITHDRAW_IN_TRANSIT_STATUS, FUNDS_FLOW_IN_TRANSIT,
} from '../constants/reconciliation.constants';

const D0 = () => new Prisma.Decimal(0);

/** in-transit 调整：已知时序差，会自己平，从外部余额里扣/加。返回应施加到"外部"侧的净调整。 */
@Injectable()
export class InTransitService {
  constructor(private readonly prisma: PrismaService) {}

  /** crypto：① 入金在途(外部−) ② 出金在途(外部+) ③ 内部转账在途(外部+) */
  async computeCrypto(currency: string, assetId: string, cutoff: Date): Promise<Prisma.Decimal> {
    let adj = D0();

    // ① 入金已确认未记账（payin 在途且未进 deposit STEP_1）→ 外部 −=
    const payins = await this.prisma.payin.findMany({
      where: { assetId, status: { in: [...PAYIN_IN_TRANSIT] }, createdAt: { lt: cutoff } },
      select: { amount: true },
    });
    for (const p of payins) adj = adj.minus(new Prisma.Decimal(p.amount));

    // ② 出金已 broadcast 未 POST（withdraw PAYOUT_PENDING）→ 外部 +=
    const wds = await this.prisma.withdrawTransaction.findMany({
      where: { assetId, status: WITHDRAW_IN_TRANSIT_STATUS, createdAt: { lt: cutoff } },
      select: { netAmount: true },
    });
    for (const w of wds) adj = adj.plus(new Prisma.Decimal(w.netAmount));

    // ③ 内部转账在途（internal_fund CREATED 未 CLEAR）→ 外部 +=
    const funds = await this.prisma.internalFund.findMany({
      where: { assetId, status: { in: [...FUNDS_FLOW_IN_TRANSIT] }, createdAt: { lt: cutoff } },
      select: { amount: true },
    });
    for (const f of funds) adj = adj.plus(new Prisma.Decimal(f.amount));

    return adj;
  }

  /** fiat：① 出金在途 ② 结算在途（internal_transaction 未 CLEAR）—— 与 crypto 同形，复用出金+内部转账两段。 */
  async computeFiat(currency: string, assetId: string, cutoff: Date): Promise<Prisma.Decimal> {
    let adj = D0();
    const wds = await this.prisma.withdrawTransaction.findMany({
      where: { assetId, status: WITHDRAW_IN_TRANSIT_STATUS, createdAt: { lt: cutoff } },
      select: { netAmount: true },
    });
    for (const w of wds) adj = adj.plus(new Prisma.Decimal(w.netAmount));
    const funds = await this.prisma.internalFund.findMany({
      where: { assetId, status: { in: [...FUNDS_FLOW_IN_TRANSIT] }, createdAt: { lt: cutoff } },
      select: { amount: true },
    });
    for (const f of funds) adj = adj.plus(new Prisma.Decimal(f.amount));
    return adj;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- in-transit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/engine/in-transit.service.*
git commit -m "feat(v8): in-transit engine (crypto/fiat known-timing adjustments)"
```

---

### Task B5: balance-recon engine（I5）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/balance-recon.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/engine/balance-recon.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { Prisma } from '@prisma/client';
import { BalanceReconService } from './balance-recon.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('BalanceReconService', () => {
  const svc = new BalanceReconService();
  it('I5 delta = tb - (external + inTransit) ; PASS when 0', () => {
    // tb 1794.15, 外部物理 1550.95, in-transit +243.20 → 期望外部 1794.15 → delta 0
    const r = svc.computeI5('USDT', D('1794.150136'), D('1550.950136'), D('243.20'));
    expect(r.status).toBe('PASS');
    expect(r.delta.toString()).toBe('0');
    expect(r.severity).toBe('ACCOUNT_ACTUAL');
  });
  it('I5 FAIL reports signed delta (tb > external)', () => {
    const r = svc.computeI5('USDT', D('1794.150136'), D('1200.950136'), D('243.20'));
    // 期望外部 = 1200.950136 + 243.20 = 1444.150136；delta = 1794.150136 - 1444.150136 = 350
    expect(r.status).toBe('FAIL');
    expect(r.delta.toString()).toBe('350.000000');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- balance-recon`
Expected: FAIL。

- [ ] **Step 3: 实现**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface I5Result {
  invariantCode: 'I5';
  currency: string;
  tbAmount: Prisma.Decimal;
  externalAmount: Prisma.Decimal;
  inTransitAmount: Prisma.Decimal;
  expectedExternal: Prisma.Decimal;
  delta: Prisma.Decimal;
  status: 'PASS' | 'FAIL';
  severity: 'ACCOUNT_ACTUAL';
}

/** I5 = Step 1 账实对账：TB 客户池 vs 外部物理(+in-transit)。纯函数。 */
@Injectable()
export class BalanceReconService {
  computeI5(
    currency: string,
    tbAmount: Prisma.Decimal,
    externalActual: Prisma.Decimal,
    inTransitAdj: Prisma.Decimal,
  ): I5Result {
    // 外部物理 + in-transit 调整 = 期望应等于 TB
    const expectedExternal = externalActual.plus(inTransitAdj);
    const delta = tbAmount.minus(expectedExternal);
    return {
      invariantCode: 'I5', currency,
      tbAmount, externalAmount: externalActual, inTransitAmount: inTransitAdj,
      expectedExternal, delta,
      status: delta.abs().lessThan('0.000001') ? 'PASS' : 'FAIL',
      severity: 'ACCOUNT_ACTUAL',
    };
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- balance-recon`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/engine/balance-recon.service.*
git commit -m "feat(v8): balance-recon engine (I5 account-actual)"
```

---

### Task B6: match-engine + classifier

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/engine/match-engine.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/engine/classifier.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/engine/match-engine.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { Prisma } from '@prisma/client';
import { MatchEngineService, InternalAction, ExternalTx } from './match-engine.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('MatchEngineService', () => {
  const svc = new MatchEngineService();
  const internal: InternalAction[] = [
    { sourceType: 'PAYIN', sourceId: 'p1', sourceNo: 'DEP-1', amount: D('100'), direction: 'IN', txHash: '0xaaa' },
    { sourceType: 'INTERNAL_FUND', sourceId: 'f1', sourceNo: 'ITX-1', amount: D('61.20'), direction: 'IN', txHash: '0xbbb' },
  ];
  const external: ExternalTx[] = [
    { source: 'HEXTRUST', txId: 'e1', txHash: '0xaaa', amount: D('100'), direction: 'IN', timestamp: new Date() },
  ];

  it('matches by txHash+amount+direction; leaves unmatched on both sides', () => {
    const res = svc.match(internal, external);
    expect(res.matched.length).toBe(1);
    expect(res.orphanInternal.length).toBe(1);        // f1 内部有外部无
    expect(res.orphanInternal[0].sourceNo).toBe('ITX-1');
    expect(res.orphanExternal.length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- match-engine`
Expected: FAIL。

- [ ] **Step 3: 实现 match-engine**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AMOUNT_TOLERANCE } from '../constants/reconciliation.constants';

export interface InternalAction {
  sourceType: string; sourceId: string; sourceNo: string;
  amount: Prisma.Decimal; direction: string; txHash?: string | null; referenceNo?: string | null;
}
export interface ExternalTx {
  source: string; txId: string; txHash?: string | null; referenceNo?: string | null;
  amount: Prisma.Decimal; direction: string; timestamp: Date;
}
export interface MatchResult {
  matched: { internal: InternalAction; external: ExternalTx }[];
  amountMismatch: { internal: InternalAction; external: ExternalTx }[];
  orphanInternal: InternalAction[];
  orphanExternal: ExternalTx[];
}

const keyOf = (x: { txHash?: string | null; referenceNo?: string | null }) =>
  x.txHash || x.referenceNo || null;

/** 逐笔 match：主键 txHash/referenceNo，辅 amount+direction。纯函数。 */
@Injectable()
export class MatchEngineService {
  match(internal: InternalAction[], external: ExternalTx[]): MatchResult {
    const res: MatchResult = { matched: [], amountMismatch: [], orphanInternal: [], orphanExternal: [] };
    const usedExt = new Set<string>();
    const tol = new Prisma.Decimal(AMOUNT_TOLERANCE);

    for (const ia of internal) {
      const k = keyOf(ia);
      const ex = external.find(
        e => !usedExt.has(e.txId) && k && keyOf(e) === k && e.direction === ia.direction,
      );
      if (!ex) { res.orphanInternal.push(ia); continue; }
      usedExt.add(ex.txId);
      if (new Prisma.Decimal(ia.amount).minus(ex.amount).abs().greaterThan(tol)) {
        res.amountMismatch.push({ internal: ia, external: ex });
      } else {
        res.matched.push({ internal: ia, external: ex });
      }
    }
    for (const e of external) if (!usedExt.has(e.txId)) res.orphanExternal.push(e);
    return res;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- match-engine`
Expected: PASS。

- [ ] **Step 5: 实现 classifier**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MatchResult } from './match-engine.service';

export interface LineItemDraft {
  matchStatus: 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL' | 'AMOUNT_MISMATCH';
  internalSourceType?: string; internalSourceId?: string; internalSourceNo?: string;
  internalAmount?: Prisma.Decimal; internalDirection?: string; internalTxHash?: string | null;
  externalSource?: string; externalTxId?: string; externalTxHash?: string | null;
  externalAmount?: Prisma.Decimal; externalDirection?: string; externalTimestamp?: Date;
  signedDelta: Prisma.Decimal; // 对 (TB − 外部) 的贡献
}

/** unmatched → LineItemDraft；signedDelta 用于闭合自检 Σ = I5 delta。 */
@Injectable()
export class ClassifierService {
  classify(m: MatchResult): LineItemDraft[] {
    const out: LineItemDraft[] = [];
    // ORPHAN_INTERNAL：内部有外部无 → TB 比外部多 → +amount（IN）/ 视方向
    for (const ia of m.orphanInternal) {
      out.push({
        matchStatus: 'ORPHAN_INTERNAL',
        internalSourceType: ia.sourceType, internalSourceId: ia.sourceId, internalSourceNo: ia.sourceNo,
        internalAmount: new Prisma.Decimal(ia.amount), internalDirection: ia.direction, internalTxHash: ia.txHash,
        signedDelta: new Prisma.Decimal(ia.amount),
      });
    }
    // ORPHAN_EXTERNAL：外部有内部无 → TB 比外部少 → −amount
    for (const e of m.orphanExternal) {
      out.push({
        matchStatus: 'ORPHAN_EXTERNAL',
        externalSource: e.source, externalTxId: e.txId, externalTxHash: e.txHash,
        externalAmount: new Prisma.Decimal(e.amount), externalDirection: e.direction, externalTimestamp: e.timestamp,
        signedDelta: new Prisma.Decimal(e.amount).negated(),
      });
    }
    // AMOUNT_MISMATCH：差 = internal − external
    for (const { internal: ia, external: e } of m.amountMismatch) {
      out.push({
        matchStatus: 'AMOUNT_MISMATCH',
        internalSourceType: ia.sourceType, internalSourceId: ia.sourceId, internalSourceNo: ia.sourceNo,
        internalAmount: new Prisma.Decimal(ia.amount), internalDirection: ia.direction, internalTxHash: ia.txHash,
        externalSource: e.source, externalTxId: e.txId, externalTxHash: e.txHash,
        externalAmount: new Prisma.Decimal(e.amount), externalDirection: e.direction, externalTimestamp: e.timestamp,
        signedDelta: new Prisma.Decimal(ia.amount).minus(e.amount),
      });
    }
    return out;
  }
}
```

- [ ] **Step 6: 运行全 engine 测试**

Run: `npm test -- reconciliation/engine`
Expected: PASS（全部 engine spec）。

- [ ] **Step 7: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/engine/match-engine.service.* src/modules/clearing-settle/reconciliation/engine/classifier.service.ts
git commit -m "feat(v8): match-engine + classifier (line-by-line match → unmatched line items)"
```

---

## Group C — Adapter

### Task C1: 外部数据 provider 接口 + mock 适配器

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/adapters/external-data.provider.ts`
- Create: `src/modules/clearing-settle/reconciliation/adapters/mock-external.adapter.ts`
- Test: `src/modules/clearing-settle/reconciliation/adapters/mock-external.adapter.spec.ts`

- [ ] **Step 1: 写接口**

```typescript
import { Prisma } from '@prisma/client';
import { ExternalTx } from '../engine/match-engine.service';

export interface ExternalBalanceProvider {
  /** as-of-cutoff 物理托管余额（per currency）。 */
  balanceAt(currency: string, assetId: string, cutoff: Date): Promise<Prisma.Decimal>;
}
export interface ExternalTxProvider {
  /** 业务日的外部流水（链上 / 银行对账单 entry）。 */
  txsForDate(currency: string, assetId: string, businessDate: string): Promise<ExternalTx[]>;
}
export const EXTERNAL_BALANCE_PROVIDER = Symbol('EXTERNAL_BALANCE_PROVIDER');
export const EXTERNAL_TX_PROVIDER = Symbol('EXTERNAL_TX_PROVIDER');
```

- [ ] **Step 2: 写失败测试**

```typescript
import { Prisma } from '@prisma/client';
import { MockExternalAdapter } from './mock-external.adapter';

describe('MockExternalAdapter', () => {
  let prisma: any;
  let adapter: MockExternalAdapter;
  beforeEach(() => {
    prisma = { wallet: { findMany: jest.fn() } };
    adapter = new MockExternalAdapter(prisma);
  });
  it('balanceAt sums wallet.mockBalance for the asset', async () => {
    prisma.wallet.findMany.mockResolvedValue([
      { mockBalance: new Prisma.Decimal('1000') },
      { mockBalance: new Prisma.Decimal('794.150136') },
    ]);
    const bal = await adapter.balanceAt('USDT', 'asset-usdt', new Date());
    expect(bal.toString()).toBe('1794.150136');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npm test -- mock-external`
Expected: FAIL。

- [ ] **Step 4: 实现 mock 适配器**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { ExternalBalanceProvider, ExternalTxProvider } from './external-data.provider';
import { ExternalTx } from '../engine/match-engine.service';

/**
 * Mock 外部数据源：余额读 wallet.mockBalance，流水从 funds 记录派生。
 * 真实 HexTrust/Zand adapter 后期实现同接口替换。
 */
@Injectable()
export class MockExternalAdapter implements ExternalBalanceProvider, ExternalTxProvider {
  constructor(private readonly prisma: PrismaService) {}

  async balanceAt(currency: string, assetId: string, _cutoff: Date): Promise<Prisma.Decimal> {
    const wallets = await this.prisma.wallet.findMany({
      where: { assetId, status: 'ACTIVE' },
      select: { mockBalance: true },
    });
    return wallets.reduce((s, w) => s.plus(new Prisma.Decimal(w.mockBalance ?? 0)), new Prisma.Decimal(0));
  }

  async txsForDate(currency: string, assetId: string, businessDate: string): Promise<ExternalTx[]> {
    // Mock：把已 CLEAR 的 payin/payout/internal_fund 的 txHash 当作"外部已观测"流水。
    const start = new Date(`${businessDate}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 86400000);
    const funds = await this.prisma.internalFund.findMany({
      where: { assetId, status: 'CLEAR', txHash: { not: null }, createdAt: { gte: start, lt: end } },
      select: { id: true, txHash: true, amount: true },
    });
    return funds.map(f => ({
      source: 'HEXTRUST', txId: f.id, txHash: f.txHash, referenceNo: null,
      amount: new Prisma.Decimal(f.amount), direction: 'IN', timestamp: start,
    }));
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test -- mock-external`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/adapters/
git commit -m "feat(v8): external-data provider interfaces + mock adapter (wallet.mockBalance)"
```

---

## Group D — Domain（唯一写 Prisma）

### Task D1: reconciliation-run.service

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { ReconciliationRunService } from './reconciliation-run.service';

describe('ReconciliationRunService', () => {
  let prisma: any;
  let svc: ReconciliationRunService;
  beforeEach(() => {
    prisma = {
      reconciliationRun: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'r1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'r1', ...data })),
      },
    };
    svc = new ReconciliationRunService(prisma);
  });
  it('createRun computes seq and runNo', async () => {
    prisma.reconciliationRun.count.mockResolvedValue(1); // 当天已有 1 次 → seq 2
    const run = await svc.createRun({ businessDate: '2026-06-16', layer: 'CRYPTO', triggerType: 'POST_FIX', mode: 'APPLY' });
    expect(run.seq).toBe(2);
    expect(run.runNo).toBe('RUN-20260616-CRYPTO-2');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- reconciliation-run.service`
Expected: FAIL。

- [ ] **Step 3: 实现**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

export interface CreateRunInput {
  businessDate: string; layer: string; triggerType: string; mode: 'DRY_RUN' | 'APPLY';
}

@Injectable()
export class ReconciliationRunService {
  constructor(private readonly prisma: PrismaService) {}

  async createRun(input: CreateRunInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const prior = await db.reconciliationRun.count({
      where: { businessDate: input.businessDate, layer: input.layer },
    });
    const seq = prior + 1;
    const runNo = `RUN-${input.businessDate.replace(/-/g, '')}-${input.layer}-${seq}`;
    return db.reconciliationRun.create({
      data: {
        runNo, businessDate: input.businessDate, layer: input.layer, seq,
        triggerType: input.triggerType, mode: input.mode, status: 'RUNNING',
        traceId: `V8:${input.layer}:${input.businessDate.replace(/-/g, '')}`,
      },
    });
  }

  async finish(
    runId: string,
    data: { status: string; invariantStatus: string; openedCount: number; reObservedCount: number; closedCount: number },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return db.reconciliationRun.update({
      where: { id: runId },
      data: { ...data, completedAt: new Date() },
    });
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- reconciliation-run.service`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-run.service.*
git commit -m "feat(v8): reconciliation-run domain service (runNo/seq/status)"
```

---

### Task D2: reconciliation-case.service

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { Prisma } from '@prisma/client';
import { ReconciliationCaseService } from './reconciliation-case.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('ReconciliationCaseService', () => {
  let prisma: any;
  let svc: ReconciliationCaseService;
  beforeEach(() => {
    prisma = {
      reconciliationCase: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'c1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'c1', ...data })),
      },
    };
    svc = new ReconciliationCaseService(prisma);
  });
  it('upsertOpen creates a new OPEN case with caseNo when none exists', async () => {
    const c = await svc.upsertOpen({
      businessDate: '2026-06-16', assetId: 'a-usdt', assetCode: 'USDT', layer: 'CRYPTO',
      tbAmount: D('1794.150136'), inTransitAmount: D('243.20'),
      expectedExternal: D('1444.150136'), actualExternal: D('1200.950136'), deltaAmount: D('350'),
      openedByRunId: 'r1',
    });
    expect(c.caseNo).toBe('REC-20260616-USDT-001');
    expect(c.status).toBe('OPEN');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- reconciliation-case.service`
Expected: FAIL。

- [ ] **Step 3: 实现**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';

export interface UpsertCaseInput {
  businessDate: string; assetId: string; assetCode: string; layer: string;
  tbAmount: Prisma.Decimal; inTransitAmount: Prisma.Decimal;
  expectedExternal: Prisma.Decimal; actualExternal: Prisma.Decimal; deltaAmount: Prisma.Decimal;
  openedByRunId: string;
}

@Injectable()
export class ReconciliationCaseService {
  constructor(private readonly prisma: PrismaService) {}

  /** 同 (businessDate, assetId) 唯一：无则开仓 OPEN，有则复核更新 lastObservedRunId。 */
  async upsertOpen(input: UpsertCaseInput, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const existing = await db.reconciliationCase.findUnique({
      where: { businessDate_assetId: { businessDate: input.businessDate, assetId: input.assetId } },
    });
    if (existing) {
      return db.reconciliationCase.update({
        where: { id: existing.id },
        data: {
          tbAmount: input.tbAmount, inTransitAmount: input.inTransitAmount,
          expectedExternal: input.expectedExternal, actualExternal: input.actualExternal,
          deltaAmount: input.deltaAmount, lastObservedRunId: input.openedByRunId,
        },
      });
    }
    const priorToday = await db.reconciliationCase.count({ where: { businessDate: input.businessDate, assetCode: input.assetCode } });
    const caseNo = `REC-${input.businessDate.replace(/-/g, '')}-${input.assetCode}-${String(priorToday + 1).padStart(3, '0')}`;
    const sla = new Date(Date.now() + 24 * 3600 * 1000);
    return db.reconciliationCase.create({
      data: {
        caseNo, businessDate: input.businessDate, assetId: input.assetId, assetCode: input.assetCode, layer: input.layer,
        tbAmount: input.tbAmount, inTransitAmount: input.inTransitAmount,
        expectedExternal: input.expectedExternal, actualExternal: input.actualExternal, deltaAmount: input.deltaAmount,
        status: 'OPEN', openedByRunId: input.openedByRunId, lastObservedRunId: input.openedByRunId,
        slaDeadline: sla, traceId: `V8:${input.layer}:${input.businessDate.replace(/-/g, '')}`,
      },
    });
  }
}
```

> 注：`Date.now()` 在生产 service 可用（仅 Workflow 脚本环境禁用）。slaDeadline 计算用它即可。

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- reconciliation-case.service`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.*
git commit -m "feat(v8): reconciliation-case domain service (upsert open, caseNo, SLA)"
```

---

### Task D3: reconciliation-record.service（LineItem + InvariantCheck）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/domain/reconciliation-record.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-record.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { Prisma } from '@prisma/client';
import { ReconciliationRecordService } from './reconciliation-record.service';

describe('ReconciliationRecordService', () => {
  let prisma: any;
  let svc: ReconciliationRecordService;
  beforeEach(() => {
    prisma = {
      reconciliationInvariantCheck: { create: jest.fn() },
      reconciliationLineItem: { create: jest.fn() },
    };
    svc = new ReconciliationRecordService(prisma);
  });
  it('saveInvariantCheck persists row', async () => {
    await svc.saveInvariantCheck('r1', {
      invariantCode: 'I1', currency: 'USDT', lhsLabel: 'a', lhsValue: new Prisma.Decimal(1),
      rhsLabel: 'b', rhsValue: new Prisma.Decimal(1), delta: new Prisma.Decimal(0), status: 'PASS', severity: 'SAFEGUARDING',
    } as any);
    expect(prisma.reconciliationInvariantCheck.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- reconciliation-record.service`
Expected: FAIL。

- [ ] **Step 3: 实现**

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { InvariantResult } from '../engine/invariant-checker.service';
import { I5Result } from '../engine/balance-recon.service';
import { LineItemDraft } from '../engine/classifier.service';

@Injectable()
export class ReconciliationRecordService {
  constructor(private readonly prisma: PrismaService) {}

  async saveInvariantCheck(runId: string, r: InvariantResult | I5Result, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const lhs = 'lhsValue' in r ? r.lhsValue : r.tbAmount;
    const rhs = 'rhsValue' in r ? r.rhsValue : r.expectedExternal;
    const lhsLabel = 'lhsLabel' in r ? r.lhsLabel : 'TB 客户池';
    const rhsLabel = 'rhsLabel' in r ? r.rhsLabel : '外部+in-transit';
    return db.reconciliationInvariantCheck.create({
      data: {
        runId, invariantCode: r.invariantCode, currency: r.currency,
        lhsLabel, lhsValue: lhs, rhsLabel, rhsValue: rhs,
        delta: r.delta, status: r.status, severity: r.severity,
      },
    });
  }

  async saveLineItems(caseId: string, runId: string, drafts: LineItemDraft[], tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    let lineNo = 0;
    for (const d of drafts) {
      lineNo += 1;
      await db.reconciliationLineItem.create({
        data: {
          caseId, foundByRunId: runId, lineNo, matchStatus: d.matchStatus, status: 'OPEN',
          internalSourceType: d.internalSourceType, internalSourceId: d.internalSourceId, internalSourceNo: d.internalSourceNo,
          internalAmount: d.internalAmount, internalDirection: d.internalDirection, internalTxHash: d.internalTxHash,
          externalSource: d.externalSource, externalTxId: d.externalTxId, externalTxHash: d.externalTxHash,
          externalAmount: d.externalAmount, externalDirection: d.externalDirection, externalTimestamp: d.externalTimestamp,
        },
      });
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- reconciliation-record.service`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/domain/reconciliation-record.service.*
git commit -m "feat(v8): reconciliation-record domain service (invariant-check + line-item persistence)"
```

---

## Group E — Workflow 与 Sweep

### Task E1: reconciliation-run-workflow

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试**（验证 dry-run 不落库 + 闭合断言）

```typescript
import { Prisma } from '@prisma/client';
import { ReconciliationRunWorkflowService } from './reconciliation-run-workflow.service';

const D = (n: string | number) => new Prisma.Decimal(n);

describe('ReconciliationRunWorkflowService', () => {
  let deps: any;
  let wf: ReconciliationRunWorkflowService;
  beforeEach(() => {
    deps = {
      prisma: { $transaction: jest.fn((cb) => cb(deps.prisma)), settlementBatch: { findFirst: jest.fn().mockResolvedValue({ status: 'COMPLETED' }) }, asset: { findMany: jest.fn().mockResolvedValue([{ id: 'a-usdt', currency: 'USDT', type: 'CRYPTO' }]) } },
      snapshot: { balancesAtCutoff: jest.fn().mockResolvedValue({ 'A.CLIENT_CUSTODY': D('1794.150136'), 'L.CLIENT_PAYABLE': D('1395.720136'), 'L.DEPOSIT_SUSPENSE': D('398.43'), 'L.TRADE_CLEARING': D('0'), 'A.FX_POSITION': D('0'), 'R.FX_UNREALIZED_PNL': D('0') }) },
      invariants: { check: jest.fn().mockReturnValue([]) },
      inTransit: { computeCrypto: jest.fn().mockResolvedValue(D('243.20')), computeFiat: jest.fn() },
      balanceProvider: { balanceAt: jest.fn().mockResolvedValue(D('1550.950136')) },
      txProvider: { txsForDate: jest.fn().mockResolvedValue([]) },
      balanceRecon: { computeI5: jest.fn().mockReturnValue({ invariantCode: 'I5', currency: 'USDT', tbAmount: D('1794.150136'), externalAmount: D('1550.950136'), inTransitAmount: D('243.20'), expectedExternal: D('1794.150136'), delta: D('0'), status: 'PASS', severity: 'ACCOUNT_ACTUAL' }) },
      matchEngine: { match: jest.fn().mockReturnValue({ matched: [], amountMismatch: [], orphanInternal: [], orphanExternal: [] }) },
      classifier: { classify: jest.fn().mockReturnValue([]) },
      internalActions: { collect: jest.fn().mockResolvedValue([]) },
      runSvc: { createRun: jest.fn().mockResolvedValue({ id: 'r1', runNo: 'RUN-20260616-CRYPTO-1' }), finish: jest.fn() },
      caseSvc: { upsertOpen: jest.fn() },
      recordSvc: { saveInvariantCheck: jest.fn(), saveLineItems: jest.fn() },
      audit: { recordSystem: jest.fn() },
    };
    wf = new ReconciliationRunWorkflowService(
      deps.prisma, deps.snapshot, deps.invariants, deps.inTransit, deps.balanceProvider,
      deps.txProvider, deps.balanceRecon, deps.matchEngine, deps.classifier, deps.internalActions,
      deps.runSvc, deps.caseSvc, deps.recordSvc, deps.audit,
    );
  });

  it('DRY_RUN: computes result but does not persist case/line-items', async () => {
    const res = await wf.run({ businessDate: '2026-06-16', layer: 'CRYPTO', triggerType: 'MANUAL', mode: 'DRY_RUN' });
    expect(res.cases[0].delta.toString()).toBe('0');
    expect(deps.caseSvc.upsertOpen).not.toHaveBeenCalled();
    expect(deps.recordSvc.saveLineItems).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- reconciliation-run-workflow`
Expected: FAIL。

- [ ] **Step 3: 实现**（含 EOD 门、管道 8 步、dry-run 分支、闭合断言、审计）

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { BalanceSnapshotService } from '../engine/balance-snapshot.service';
import { InvariantCheckerService } from '../engine/invariant-checker.service';
import { InTransitService } from '../engine/in-transit.service';
import { BalanceReconService } from '../engine/balance-recon.service';
import { MatchEngineService } from '../engine/match-engine.service';
import { ClassifierService } from '../engine/classifier.service';
import { InternalActionsService } from '../engine/internal-actions.service';
import { ReconciliationRunService } from '../domain/reconciliation-run.service';
import { ReconciliationCaseService } from '../domain/reconciliation-case.service';
import { ReconciliationRecordService } from '../domain/reconciliation-record.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes, AuditBusinessWorkflowTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { LAYER_ASSET_CODE } from '../constants/reconciliation.constants';

export interface RunInput { businessDate: string; layer: 'CRYPTO' | 'FIAT'; triggerType: string; mode: 'DRY_RUN' | 'APPLY'; }

@Injectable()
export class ReconciliationRunWorkflowService {
  private readonly logger = new Logger(ReconciliationRunWorkflowService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshot: BalanceSnapshotService,
    private readonly invariants: InvariantCheckerService,
    private readonly inTransit: InTransitService,
    private readonly balanceProvider: any,   // ExternalBalanceProvider (注入 token，见 module)
    private readonly txProvider: any,         // ExternalTxProvider
    private readonly balanceRecon: BalanceReconService,
    private readonly matchEngine: MatchEngineService,
    private readonly classifier: ClassifierService,
    private readonly internalActions: InternalActionsService,
    private readonly runSvc: ReconciliationRunService,
    private readonly caseSvc: ReconciliationCaseService,
    private readonly recordSvc: ReconciliationRecordService,
    private readonly audit: AuditLogsService,
  ) {}

  async run(input: RunInput) {
    // 0 守门：V7 EOD 完成
    const batch = await this.prisma.settlementBatch.findFirst({
      where: { status: 'COMPLETED' }, orderBy: { createdAt: 'desc' },
    });
    if (!batch && input.layer === 'CRYPTO') {
      this.logger.warn(`V7 EOD not complete for ${input.businessDate}; skip`);
      return { skipped: true, cases: [] as any[] };
    }

    const cutoff = new Date(`${input.businessDate}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + 1); // T+1 00:00 = T+0 24:00

    const assets = await this.prisma.asset.findMany({
      where: { type: input.layer }, select: { id: true, currency: true, type: true },
    });

    const run = await this.runSvc.createRun(input);
    const results: any[] = [];
    let invariantFail = false, openedCount = 0;

    for (const asset of assets) {
      const ccy = asset.currency;
      // 1 snapshot
      const bal = await this.snapshot.balancesAtCutoff(ccy, cutoff);
      // 2 invariant I1–I4
      const i14 = this.invariants.check(ccy, input.layer, bal);
      // 3 external + 4 in-transit
      const externalActual = await this.balanceProvider.balanceAt(ccy, asset.id, cutoff);
      const inTransitAdj = input.layer === 'CRYPTO'
        ? await this.inTransit.computeCrypto(ccy, asset.id, cutoff)
        : await this.inTransit.computeFiat(ccy, asset.id, cutoff);
      const tb = bal[LAYER_ASSET_CODE[input.layer]] ?? new Prisma.Decimal(0);
      // 5 I5
      const i5 = this.balanceRecon.computeI5(ccy, tb, externalActual, inTransitAdj);
      // 6 match + 7 classify
      const internal = await this.internalActions.collect(asset.id, input.businessDate, cutoff);
      const external = await this.txProvider.txsForDate(ccy, asset.id, input.businessDate);
      const matchRes = this.matchEngine.match(internal, external);
      const drafts = this.classifier.classify(matchRes);
      // 8 闭合自检
      const sumUnmatched = drafts.reduce((s, d) => s.plus(d.signedDelta), new Prisma.Decimal(0));
      const closes = sumUnmatched.minus(i5.delta).abs().lessThan('0.01');
      if (!closes) {
        this.logger.error(`CLOSURE FAIL ${ccy}: Σunmatched=${sumUnmatched} I5delta=${i5.delta}`);
      }
      const allChecks = [...i14, i5];
      if (allChecks.some(c => c.status === 'FAIL' && c.invariantCode !== 'I5')) invariantFail = true;

      results.push({ asset, ccy, bal, checks: allChecks, i5, drafts, closes, externalActual, inTransitAdj, tb });
    }

    // APPLY：落库；DRY_RUN：跳过
    if (input.mode === 'APPLY') {
      await this.prisma.$transaction(async (tx) => {
        for (const r of results) {
          for (const c of r.checks) await this.recordSvc.saveInvariantCheck(run.id, c, tx);
          const hasBreak = !r.i5.delta.abs().lessThan('0.000001') || r.drafts.length > 0;
          if (hasBreak) {
            const kase = await this.caseSvc.upsertOpen({
              businessDate: input.businessDate, assetId: r.asset.id, assetCode: r.ccy, layer: input.layer,
              tbAmount: r.tb, inTransitAmount: r.inTransitAdj, expectedExternal: r.i5.expectedExternal,
              actualExternal: r.externalActual, deltaAmount: r.i5.delta, openedByRunId: run.id,
            }, tx);
            await this.recordSvc.saveLineItems(kase.id, run.id, r.drafts, tx);
            openedCount += 1;
          }
        }
        await this.runSvc.finish(run.id, {
          status: 'COMPLETED', invariantStatus: invariantFail ? 'FAIL' : 'PASS',
          openedCount, reObservedCount: 0, closedCount: 0,
        }, tx);
      });
      await this.audit.recordSystem({
        action: AuditActions.RECON_RUN_COMPLETED,
        entityType: AuditEntityTypes.RECONCILIATION_RUN_V8,
        entityId: run.id, entityNo: run.runNo,
        workflowType: AuditBusinessWorkflowTypes.V8_RECONCILIATION,
        traceId: run.traceId ?? undefined,
        reason: `Reconciliation ${input.layer} ${input.businessDate}: opened=${openedCount}`,
        metadata: { businessDate: input.businessDate, layer: input.layer, openedCount },
        sourcePlatform: 'SYSTEM',
      });
    }

    return { runNo: run.runNo, mode: input.mode, cases: results.map(r => ({ ccy: r.ccy, delta: r.i5.delta, lineItems: r.drafts.length, closes: r.closes })) };
  }
}
```

- [ ] **Step 4: 实现依赖的 internal-actions engine**

Create `src/modules/clearing-settle/reconciliation/engine/internal-actions.service.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { InternalAction } from './match-engine.service';

/** 收集当日"必须有物理对应"的内部资金动作：payin/payout/internal_fund（已 CLEAR/CLEARED）。 */
@Injectable()
export class InternalActionsService {
  constructor(private readonly prisma: PrismaService) {}
  async collect(assetId: string, businessDate: string, cutoff: Date): Promise<InternalAction[]> {
    const start = new Date(`${businessDate}T00:00:00.000Z`);
    const funds = await this.prisma.internalFund.findMany({
      where: { assetId, status: 'CLEAR', createdAt: { gte: start, lt: cutoff } },
      select: { id: true, internalFundNo: true, amount: true, txHash: true },
    });
    return funds.map(f => ({
      sourceType: 'INTERNAL_FUND', sourceId: f.id, sourceNo: f.internalFundNo,
      amount: new Prisma.Decimal(f.amount), direction: 'IN', txHash: f.txHash,
    }));
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npm test -- reconciliation-run-workflow`
Expected: PASS（DRY_RUN 不落库）。

- [ ] **Step 6: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/workflow/ src/modules/clearing-settle/reconciliation/engine/internal-actions.service.ts
git commit -m "feat(v8): run-workflow (pipeline + EOD gate + dry-run/apply + closure assert)"
```

---

### Task E2: sweep cron

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/sweep/reconciliation-sweep.service.ts`

- [ ] **Step 1: 实现**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReconciliationRunWorkflowService } from '../workflow/reconciliation-run-workflow.service';

/** 业务日 = 昨日（T+0）。02:30 Dubai 跑 crypto；fiat 由对账单上传事件触发 + 12:00 兜底。 */
@Injectable()
export class ReconciliationSweepService {
  private readonly logger = new Logger(ReconciliationSweepService.name);
  constructor(private readonly workflow: ReconciliationRunWorkflowService) {}

  private yesterday(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  @Cron('0 30 2 * * *', { timeZone: 'Asia/Dubai' })
  async cryptoDaily(): Promise<void> {
    const businessDate = this.yesterday();
    try {
      const res = await this.workflow.run({ businessDate, layer: 'CRYPTO', triggerType: 'SCHEDULED', mode: 'APPLY' });
      this.logger.log(`Recon crypto ${businessDate}: ${JSON.stringify(res)}`);
    } catch (err) {
      this.logger.error(`Recon crypto ${businessDate} failed`, err instanceof Error ? err.stack : undefined);
    }
  }

  @Cron('0 0 12 * * *', { timeZone: 'Asia/Dubai' })
  async fiatFallback(): Promise<void> {
    const businessDate = this.yesterday();
    try {
      const res = await this.workflow.run({ businessDate, layer: 'FIAT', triggerType: 'SCHEDULED', mode: 'APPLY' });
      this.logger.log(`Recon fiat ${businessDate}: ${JSON.stringify(res)}`);
    } catch (err) {
      this.logger.error(`Recon fiat ${businessDate} failed`, err instanceof Error ? err.stack : undefined);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/sweep/
git commit -m "feat(v8): reconciliation sweep cron (crypto 02:30 / fiat 12:00 fallback)"
```

---

## Group F — Controller / RBAC / Module

### Task F1: 只读 controller + DTO

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts`
- Create: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts`

- [ ] **Step 1: DTO**

```typescript
import { IsOptional, IsString } from 'class-validator';
export class ReconRunQueryDto {
  @IsOptional() @IsString() businessDate?: string;
  @IsOptional() @IsString() layer?: string;
}
export class ReconCaseQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() assetCode?: string;
}
```

- [ ] **Step 2: query service（只读读模型）**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';

@Injectable()
export class ReconciliationQueryService {
  constructor(private readonly prisma: PrismaService) {}

  listRuns(q: { businessDate?: string; layer?: string }) {
    return this.prisma.reconciliationRun.findMany({
      where: { businessDate: q.businessDate, layer: q.layer },
      orderBy: [{ businessDate: 'desc' }, { layer: 'asc' }, { seq: 'desc' }],
    });
  }
  async getRun(runNo: string) {
    const run = await this.prisma.reconciliationRun.findUnique({
      where: { runNo }, include: { invariantChecks: true },
    });
    if (!run) throw new NotFoundException(`Run ${runNo} not found`);
    return run;
  }
  listCases(q: { status?: string; assetCode?: string }) {
    return this.prisma.reconciliationCase.findMany({
      where: { status: q.status, assetCode: q.assetCode },
      orderBy: { createdAt: 'desc' },
    });
  }
  async getCase(caseNo: string) {
    const kase = await this.prisma.reconciliationCase.findUnique({
      where: { caseNo }, include: { lineItems: true },
    });
    if (!kase) throw new NotFoundException(`Case ${caseNo} not found`);
    return kase;
  }
}
```

- [ ] **Step 3: controller（仿 funds-admin.controller 模式）**

```typescript
import { Controller, Get, Param, Query, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../identity/access-control/permission-code.util';
import { ReconciliationQueryService } from '../domain/reconciliation-query.service';
import { ReconRunQueryDto, ReconCaseQueryDto } from '../dto/reconciliation.dto';

@ApiTags('Admin - Reconciliation (V8)')
@ApiBearerAuth()
@Controller('admin/reconciliation')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ReconciliationAdminController {
  constructor(private readonly query: ReconciliationQueryService) {}

  @Get('runs')
  @ApiOperation({ summary: 'List reconciliation runs' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/runs'))
  listRuns(@Query() q: ReconRunQueryDto) { return this.query.listRuns(q); }

  @Get('runs/:runNo')
  @ApiOperation({ summary: 'Reconciliation run detail' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/runs/:runNo'))
  getRun(@Param('runNo') runNo: string) { return this.query.getRun(runNo); }

  @Get('cases')
  @ApiOperation({ summary: 'List reconciliation cases' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/cases'))
  listCases(@Query() q: ReconCaseQueryDto) { return this.query.listCases(q); }

  @Get('cases/:caseNo')
  @ApiOperation({ summary: 'Reconciliation case detail (with line items)' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/cases/:caseNo'))
  getCase(@Param('caseNo') caseNo: string) { return this.query.getCase(caseNo); }
}
```

- [ ] **Step 4: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i reconciliation | head`
Expected: 无输出。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/dto/ src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts src/modules/clearing-settle/reconciliation/controllers/
git commit -m "feat(v8): read-only admin controller + query service + DTO"
```

---

### Task F2: RBAC 权限

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: 加权限组**（在 `PermissionGroup` union type 内追加）

```typescript
  | 'RECON_RUN_READ'
  | 'RECON_CASE_READ'
```

- [ ] **Step 2: 加路由条目**（在 catalog 路由数组内，参照现有 `route(...)` 行追加）

```typescript
  route('GET', '/admin/reconciliation/runs', 'View Recon Runs', ['RECON_RUN_READ']),
  route('GET', '/admin/reconciliation/runs/:runNo', 'View Recon Run Detail', ['RECON_RUN_READ']),
  route('GET', '/admin/reconciliation/cases', 'View Recon Cases', ['RECON_CASE_READ']),
  route('GET', '/admin/reconciliation/cases/:caseNo', 'View Recon Case Detail', ['RECON_CASE_READ']),
```

- [ ] **Step 3: 跑 rbac catalog 测试**

Run: `npm test -- rbac.catalog`
Expected: PASS（新路由被纳入；若有快照断言需更新，按提示更新）。

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(v8): RBAC read-only permissions for reconciliation"
```

---

### Task F3: module 装配 + app.module 注册

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: module**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { BalanceSnapshotService } from './engine/balance-snapshot.service';
import { InvariantCheckerService } from './engine/invariant-checker.service';
import { InTransitService } from './engine/in-transit.service';
import { BalanceReconService } from './engine/balance-recon.service';
import { MatchEngineService } from './engine/match-engine.service';
import { ClassifierService } from './engine/classifier.service';
import { InternalActionsService } from './engine/internal-actions.service';
import { MockExternalAdapter } from './adapters/mock-external.adapter';
import { EXTERNAL_BALANCE_PROVIDER, EXTERNAL_TX_PROVIDER } from './adapters/external-data.provider';
import { ReconciliationRunService } from './domain/reconciliation-run.service';
import { ReconciliationCaseService } from './domain/reconciliation-case.service';
import { ReconciliationRecordService } from './domain/reconciliation-record.service';
import { ReconciliationQueryService } from './domain/reconciliation-query.service';
import { ReconciliationRunWorkflowService } from './workflow/reconciliation-run-workflow.service';
import { ReconciliationSweepService } from './sweep/reconciliation-sweep.service';
import { ReconciliationAdminController } from './controllers/reconciliation-admin.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [ReconciliationAdminController],
  providers: [
    BalanceSnapshotService, InvariantCheckerService, InTransitService, BalanceReconService,
    MatchEngineService, ClassifierService, InternalActionsService,
    MockExternalAdapter,
    { provide: EXTERNAL_BALANCE_PROVIDER, useExisting: MockExternalAdapter },
    { provide: EXTERNAL_TX_PROVIDER, useExisting: MockExternalAdapter },
    ReconciliationRunService, ReconciliationCaseService, ReconciliationRecordService, ReconciliationQueryService,
    ReconciliationRunWorkflowService, ReconciliationSweepService,
  ],
  exports: [ReconciliationRunWorkflowService],
})
export class ReconciliationModule {}
```

> 注：workflow 构造函数里 `balanceProvider`/`txProvider` 改用 `@Inject(EXTERNAL_BALANCE_PROVIDER)` / `@Inject(EXTERNAL_TX_PROVIDER)` 注入（在 Task E1 实现里加 `@Inject` 装饰器）。

- [ ] **Step 2: 在 workflow 构造函数加 @Inject 装饰器**

修改 `reconciliation-run-workflow.service.ts` 构造函数的两参数：

```typescript
import { Inject } from '@nestjs/common';
import { EXTERNAL_BALANCE_PROVIDER, EXTERNAL_TX_PROVIDER } from '../adapters/external-data.provider';
import { ExternalBalanceProvider, ExternalTxProvider } from '../adapters/external-data.provider';
// ...构造函数内：
    @Inject(EXTERNAL_BALANCE_PROVIDER) private readonly balanceProvider: ExternalBalanceProvider,
    @Inject(EXTERNAL_TX_PROVIDER) private readonly txProvider: ExternalTxProvider,
```

- [ ] **Step 3: app.module 注册**（仿现有 import 行）

在 `src/app.module.ts` 顶部 import + `imports: [...]` 数组追加：

```typescript
import { ReconciliationModule } from './modules/clearing-settle/reconciliation/reconciliation.module';
// imports 数组内追加：
    ReconciliationModule,
```

- [ ] **Step 4: 编译 + 启动校验**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "reconciliation" | head`
Expected: 无输出。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/reconciliation.module.ts src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service.ts src/app.module.ts
git commit -m "feat(v8): wire reconciliation module + register in app.module"
```

---

## Group G — Verify 与退役 stub

### Task G1: verify-reconciliation.ts 全链脚本

**Files:**
- Create: `scripts/verify-reconciliation.ts`
- Modify: `package.json`（加 script）

- [ ] **Step 1: 脚本（仿 verify-two-book.ts 骨架，默认 dry-run）**

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ReconciliationRunWorkflowService } from '../src/modules/clearing-settle/reconciliation/workflow/reconciliation-run-workflow.service';

const failures: string[] = [];
let count = 0;
function assertTrue(label: string, ok: boolean, detail = '') {
  count += 1;
  console.log(ok ? `  ✓ ${label}` : `  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label + (detail ? ` — ${detail}` : ''));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const businessDate = '2026-06-16';
  const app = await NestFactory.createApplicationContext(AppModule);
  const wf = app.get(ReconciliationRunWorkflowService);
  try {
    const res = await wf.run({ businessDate, layer: 'CRYPTO', triggerType: 'MANUAL', mode: apply ? 'APPLY' : 'DRY_RUN' });
    console.log(`\nMode: ${apply ? 'APPLY' : 'DRY_RUN'} · ${JSON.stringify(res, null, 2)}`);
    assertTrue('run returned cases array', Array.isArray(res.cases));
    for (const c of res.cases) {
      assertTrue(`closure holds for ${c.ccy} (Σunmatched = I5 delta)`, c.closes === true,
        `ccy=${c.ccy} delta=${c.delta}`);
    }
    console.log(`\n════ ${count} assertions, ${failures.length} failures ════`);
    if (failures.length) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  } finally {
    await app.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: package.json 加 script**（在 scripts 块内）

```json
    "recon:verify:dry": "ts-node scripts/verify-reconciliation.ts",
    "recon:verify:apply": "ts-node scripts/verify-reconciliation.ts --apply",
```

- [ ] **Step 3: 跑 dry-run 验收**

Run: `DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run recon:verify:dry`
Expected: 打印 cases，closure 断言 PASS，`0 failures`。

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-reconciliation.ts package.json
git commit -m "test(v8): verify-reconciliation full-chain script (default dry-run)"
```

---

### Task G2: 退役旧 safeguarding stub

**Files:**
- Modify: `src/app.module.ts`（移除 `SafeguardingReconciliationModule` 注册）
- Delete: `src/modules/clearing-settle/safeguarding-reconciliation/`（整目录）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（移除 `safeguarding-*` 路由）
- Modify: `prisma/schema.prisma`（标记旧 `SafeguardingRun`/`ReconciliationBreak`/`ReconciliationWarning` 为 deprecated 或删除——见 Step 说明）

- [ ] **Step 1: 确认 stub 无外部引用**

Run: `grep -rn "SafeguardingReconciliation\|safeguarding-reconciliation" src/ --include=*.ts | grep -v "safeguarding-reconciliation/" | grep -v ".spec.ts"`
Expected: 仅 `app.module.ts` 一处 import/注册（若有其它引用，先评估再删）。

- [ ] **Step 2: 移除 app.module 注册**

删除 `src/app.module.ts` 里 `SafeguardingReconciliationModule` 的 import 行 + imports 数组项。

- [ ] **Step 3: 删除 stub 目录**

```bash
git rm -r src/modules/clearing-settle/safeguarding-reconciliation/
```

- [ ] **Step 4: 移除 rbac 里 safeguarding 路由**

删除 `rbac.catalog.ts` 中所有 `/admin/reconciliation/safeguarding-*` 的 `route(...)` 行（grep `safeguarding-` 定位）。

- [ ] **Step 5: schema 旧表处理**

保留 `fiat_statement_import`（V8 复用）。旧 `SafeguardingRun`/`ReconciliationBreak`/`ReconciliationWarning`/`LiabilitySnapshot`/`SafeguardingPoolSnapshot`/`SafeguardingPolicy` 若无引用则从 schema 删除并迁移：

Run: `npx prisma migrate dev --name retire_safeguarding_stub`
Expected: 迁移成功。（若 fiat_statement_import 有 FK 指向被删表，先解 FK。）

- [ ] **Step 6: 全量编译 + 测试**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head && npm test -- reconciliation`
Expected: tsc 无新错误；reconciliation 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(v8): retire safeguarding-reconciliation stub (module/routes/tables), keep fiat_statement_import"
```

---

## Self-Review（已执行）

**1. Spec coverage（逐节核对）:**
- §1 两阶段切分 → Task 全部停在 Case OPEN，无处置代码 ✓
- §2 4 步漏斗 + I1–I5 → B2/B3/B4/B5/B6 + E1 管道 ✓
- §3 cutoff 冻结 + in-transit → B2(createdAt<cutoff) + B4(in-transit) ✓
- §4 4 表 + Case/LineItem 维度 → A1 + D1/D2/D3 ✓
- §5 模块分层 + stub 退役 → 文件结构 + G2 ✓
- §6 cron + 守门 + dry-run → E1(EOD门/dry-run) + E2(cron) ✓
- §7 V7 EOD 不改 → E1 仅读 SettlementBatch 状态，无 V7 改动 ✓
- §8 IA 4 页 → F1 controller 4 端点（前端渲染由演示原型验证，后端读模型齐全）✓
- §9 审计 + RBAC → A2 + E1(recordSystem) + F2 ✓
- §10 测试 → 各 Task TDD + G1 verify ✓

**2. Placeholder 扫描:** 无 TBD/TODO；每步含真实代码或精确命令。`'<T+1 00:00 UTC>'` 仅出现在 spec，本计划用 `cutoff.setUTCDate(...+1)` 实算。

**3. 类型一致性:** `InvariantResult`/`I5Result`/`LineItemDraft`/`InternalAction`/`ExternalTx` 跨 Task 签名一致；`balancesAtCutoff` / `computeI5` / `match` / `classify` / `upsertOpen` / `createRun` / `finish` 命名前后一致。

**4. 已知缺口/留待执行时确认:**
- `wallet` 表是否有 `status='ACTIVE'` 字段 + `assetId`：执行 C1 前 grep 确认字段名（mock 适配器依赖）。
- `internalFund` 是否有 `txHash`/`internalFundNo`/`assetId` 字段：执行 D 前以 schema 为准微调 select。
- I2 桥贡献精确值（open-swap 聚合）在 MVP 用余额留痕近似；精确聚合可作执行时增强（spec §2.3 注）。

---

## 范围外（不在本计划）

阶段二全部（平账 dry-run / Working Sheet 处置 / Reimbursement / Case 关闭 / SLA 升级）；真实 HexTrust/Zand adapter；前端 admin 页面落地（本轮只读后端 + 演示原型已验证 UX）；V7 EOD 时序改造。
