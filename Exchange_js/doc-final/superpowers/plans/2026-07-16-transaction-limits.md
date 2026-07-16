# Transaction Limit（金额限额）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一张 `transaction_limit_rules` 表（A 单笔/B 累计/D1 大额三种行形状）+ L1 判定引擎，接入提现与兑换；退役旧 governance/transaction-limits 半成品。

**Architecture:** 新模块 `src/modules/asset-treasury/transaction-limits/`。A/B 在订单 persist 前判定（拒绝→不建单不耗 quote）；D1 判定留在现有 `handleWithdrawalCreated` 事件 handler 原位，仅把阈值来源从死常量换成规则行。AED 估值复用 `BinanceRateProvider`（fail-closed）。B 用量 = SUM 订单 `grossAedValue`（withdraw 已有此列，swap 本轮补）。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle（本轮不碰记账）+ React admin。

**执行环境：** 在专用 worktree 跑（`.claude/worktrees/transaction-limits/`），`bash scripts/stack.sh up`（self 栈）。迁移用 `npx prisma migrate dev`（.env 由 stack.sh 自愈生成）。

**设计 spec：** `doc-final/superpowers/specs/2026-07-16-transaction-limits-design.md`

**关键复用（已核实，勿重造）：**
- 权限 `TRANSACTION_LIMIT_READ/WRITE` 已在 `rbac.catalog.ts:502-513`（换路由即可，权限名不动）
- 审批动作 `ApprovalActionTypes.TRANSACTION_LIMIT_CREATION/_CHANGE` 已在 `approval.constants.ts:63-65`（直接复用）
- 审计 `AuditEntityTypes.TRANSACTION_LIMIT_POLICY` + workflow types 已在 `audit-actions.constant.ts`（复用，另加 REJECTED 动作）
- 前端 `TransactionLimitList/Detail.tsx` + App.tsx 路由 `assets/transaction-limits` + 侧边栏注释入口 `DashboardLayout.tsx:244` 均在（重写内容/复活入口）
- 旧模块审批工作流模式：`governance/transaction-limits/transaction-limit-creation-workflow.service.ts`（照抄结构）

---

### Task 1: Prisma schema — 新表 + swap 加列

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: schema 加 TransactionLimitRule 模型**（放在现 `TransactionLimitPolicy` 附近）

```prisma
// ─── Transaction Limit Rules（金额限额，2026-07-16 三行形状统一表）───
model TransactionLimitRule {
  id             String   @id @default(uuid())
  ruleNo         String   @unique
  gateType       String                      // SINGLE | CUMULATIVE | LARGE_APPROVAL
  operationType  String                      // WITHDRAWAL | SWAP | DEPOSIT(配置先行,执行随充值任务)
  assetId        String?                     // SINGLE 必填,其余必空
  tradingTier    String?                     // CUMULATIVE 必填(BASIC|PREMIUM),其余必空
  period         String?                     // CUMULATIVE 必填(DAILY|MONTHLY),其余必空
  minAmount      Decimal?                    // SINGLE(原生币种,可只填一边)
  maxAmount      Decimal?                    // SINGLE(原生币种)
  defaultLimit   Decimal?                    // CUMULATIVE(AED)
  cap            Decimal?                    // CUMULATIVE(AED,客户微调层上限,本轮仅占位)
  threshold      Decimal?                    // LARGE_APPROVAL(AED)
  status         String   @default("ACTIVE") // ACTIVE | PENDING_APPROVAL
  approvalCaseId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([gateType, operationType, assetId, tradingTier, period])
  @@index([gateType, status])
  @@map("transaction_limit_rules")
}
```

⚠️ SQLite 复合唯一索引对 NULL 不去重（两条同 (LARGE_APPROVAL, WITHDRAWAL, null,null,null) 能共存）——服务层必须做唯一性预检（Task 3 有）。

- [ ] **Step 2: SwapTransaction 加 AED 快照列**（字段名与 withdraw 对齐；在 `spreadAmount` 附近加）

```prisma
  grossAedValue    Decimal?                  // 创建时 AED 估值快照(B 累计用量取数)
```

- [ ] **Step 3: 生成迁移并应用**

```bash
npx prisma migrate dev --name transaction_limit_rules
```
Expected: 迁移创建 `transaction_limit_rules` 表 + `swap_transactions` 加列；`prisma generate` 自动跑。

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(limits): transaction_limit_rules 表 + swap grossAedValue 列"
```

---

### Task 2: 规则服务（CRUD + 三查找）— TDD

**Files:**
- Create: `src/modules/asset-treasury/transaction-limits/transaction-limit-rules.service.ts`
- Create: `src/modules/asset-treasury/transaction-limits/constants/transaction-limit.constants.ts`
- Create: `src/modules/asset-treasury/transaction-limits/dto/transaction-limit-rule.dto.ts`
- Test: `src/modules/asset-treasury/transaction-limits/transaction-limit-rules.service.spec.ts`

- [ ] **Step 1: 常量文件**

```typescript
export const GATE_TYPES = ['SINGLE', 'CUMULATIVE', 'LARGE_APPROVAL'] as const;
export type GateType = (typeof GATE_TYPES)[number];

export const LIMIT_OPERATION_TYPES = ['WITHDRAWAL', 'SWAP', 'DEPOSIT'] as const;
export type LimitOperationType = (typeof LIMIT_OPERATION_TYPES)[number];

export const LIMIT_PERIODS = ['DAILY', 'MONTHLY'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];

export const LIMIT_TRADING_TIERS = ['BASIC', 'PREMIUM'] as const;

/** 每种 gateType 的行形状：哪些维度必填/必空、哪些金额字段合法 */
export const GATE_SHAPES: Record<GateType, { required: string[]; forbidden: string[]; amountFields: string[] }> = {
  SINGLE:         { required: ['operationType', 'assetId'],                 forbidden: ['tradingTier', 'period'], amountFields: ['minAmount', 'maxAmount'] },
  CUMULATIVE:     { required: ['operationType', 'tradingTier', 'period'],   forbidden: ['assetId'],               amountFields: ['defaultLimit', 'cap'] },
  LARGE_APPROVAL: { required: ['operationType'],                            forbidden: ['assetId', 'tradingTier', 'period'], amountFields: ['threshold'] },
};
```

- [ ] **Step 2: 写失败测试**（关键行为：行形状校验拒绝错维度、三查找命中/miss、唯一性预检）

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('TransactionLimitRulesService', () => {
  let service: TransactionLimitRulesService;
  const prisma = {
    transactionLimitRule: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  } as any;

  beforeEach(async () => {
    jest.resetAllMocks();
    const mod = await Test.createTestingModule({
      providers: [TransactionLimitRulesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(TransactionLimitRulesService);
  });

  it('validateShape rejects SINGLE row with tradingTier set', () => {
    expect(() =>
      service.validateShape({ gateType: 'SINGLE', operationType: 'WITHDRAWAL', assetId: 'a1', tradingTier: 'BASIC' } as any),
    ).toThrow(BadRequestException);
  });

  it('validateShape rejects SINGLE with neither minAmount nor maxAmount', () => {
    expect(() =>
      service.validateShape({ gateType: 'SINGLE', operationType: 'WITHDRAWAL', assetId: 'a1' } as any),
    ).toThrow(BadRequestException);
  });

  it('validateShape accepts a well-formed CUMULATIVE row', () => {
    expect(() =>
      service.validateShape({ gateType: 'CUMULATIVE', operationType: 'SWAP', tradingTier: 'BASIC', period: 'DAILY', defaultLimit: 100000, cap: 200000 } as any),
    ).not.toThrow();
  });

  it('getSingleRule queries ACTIVE row by op+asset', async () => {
    prisma.transactionLimitRule.findFirst.mockResolvedValue({ id: 'r1' });
    const r = await service.getSingleRule('WITHDRAWAL', 'asset-1');
    expect(prisma.transactionLimitRule.findFirst).toHaveBeenCalledWith({
      where: { gateType: 'SINGLE', operationType: 'WITHDRAWAL', assetId: 'asset-1', status: 'ACTIVE' },
    });
    expect(r).toEqual({ id: 'r1' });
  });

  it('getLargeApprovalThreshold returns null when no rule', async () => {
    prisma.transactionLimitRule.findFirst.mockResolvedValue(null);
    expect(await service.getLargeApprovalThreshold('WITHDRAWAL')).toBeNull();
  });

  it('assertUnique throws when a same-key row exists', async () => {
    prisma.transactionLimitRule.findFirst.mockResolvedValue({ ruleNo: 'TLR-001', status: 'ACTIVE' });
    await expect(
      service.assertUnique({ gateType: 'LARGE_APPROVAL', operationType: 'WITHDRAWAL' } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest src/modules/asset-treasury/transaction-limits --no-coverage
```
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现服务**

```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GATE_SHAPES, GATE_TYPES, LIMIT_OPERATION_TYPES, LIMIT_PERIODS, LIMIT_TRADING_TIERS, GateType } from './constants/transaction-limit.constants';

export interface RuleShapeInput {
  gateType: GateType;
  operationType: string;
  assetId?: string | null;
  tradingTier?: string | null;
  period?: string | null;
  minAmount?: number | string | null;
  maxAmount?: number | string | null;
  defaultLimit?: number | string | null;
  cap?: number | string | null;
  threshold?: number | string | null;
}

@Injectable()
export class TransactionLimitRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 行形状校验：维度必填/必空 + 金额字段至少一个且不许带别形状的字段 */
  validateShape(input: RuleShapeInput): void {
    if (!GATE_TYPES.includes(input.gateType)) throw new BadRequestException(`Invalid gateType: ${input.gateType}`);
    if (!LIMIT_OPERATION_TYPES.includes(input.operationType as any)) throw new BadRequestException(`Invalid operationType: ${input.operationType}`);
    const shape = GATE_SHAPES[input.gateType];
    for (const f of shape.required) {
      if (!(input as any)[f]) throw new BadRequestException(`${input.gateType} rule requires ${f}`);
    }
    for (const f of shape.forbidden) {
      if ((input as any)[f]) throw new BadRequestException(`${input.gateType} rule must not set ${f}`);
    }
    if (input.period && !LIMIT_PERIODS.includes(input.period as any)) throw new BadRequestException(`Invalid period: ${input.period}`);
    if (input.tradingTier && !LIMIT_TRADING_TIERS.includes(input.tradingTier as any)) throw new BadRequestException(`Invalid tradingTier: ${input.tradingTier}`);
    const amountSet = shape.amountFields.filter((f) => (input as any)[f] != null);
    if (amountSet.length === 0) throw new BadRequestException(`${input.gateType} rule requires at least one of: ${shape.amountFields.join(', ')}`);
    const alien = ['minAmount', 'maxAmount', 'defaultLimit', 'cap', 'threshold'].filter(
      (f) => !shape.amountFields.includes(f) && (input as any)[f] != null,
    );
    if (alien.length) throw new BadRequestException(`${input.gateType} rule must not set: ${alien.join(', ')}`);
    for (const f of shape.amountFields) {
      const v = (input as any)[f];
      if (v != null && new Prisma.Decimal(v).lte(0)) throw new BadRequestException(`${f} must be > 0`);
    }
    if (input.minAmount != null && input.maxAmount != null && new Prisma.Decimal(input.minAmount).gte(new Prisma.Decimal(input.maxAmount))) {
      throw new BadRequestException('minAmount must be < maxAmount');
    }
  }

  /** SQLite 复合唯一对 NULL 不去重 → 服务层预检（含 PENDING_APPROVAL 占坑） */
  async assertUnique(input: RuleShapeInput): Promise<void> {
    const existing = await this.prisma.transactionLimitRule.findFirst({
      where: {
        gateType: input.gateType,
        operationType: input.operationType,
        assetId: input.assetId ?? null,
        tradingTier: input.tradingTier ?? null,
        period: input.period ?? null,
      },
    });
    if (existing) {
      throw new BadRequestException(`Rule already exists for this key (${existing.ruleNo}, status: ${existing.status})`);
    }
  }

  // ── 三查找（引擎/工作流消费，只认 ACTIVE）──
  getSingleRule(operationType: string, assetId: string) {
    return this.prisma.transactionLimitRule.findFirst({
      where: { gateType: 'SINGLE', operationType, assetId, status: 'ACTIVE' },
    });
  }

  getCumulativeRules(operationType: string, tradingTier: string) {
    return this.prisma.transactionLimitRule.findMany({
      where: { gateType: 'CUMULATIVE', operationType, tradingTier, status: 'ACTIVE' },
    });
  }

  async getLargeApprovalThreshold(operationType: string): Promise<Prisma.Decimal | null> {
    const rule = await this.prisma.transactionLimitRule.findFirst({
      where: { gateType: 'LARGE_APPROVAL', operationType, status: 'ACTIVE' },
    });
    return rule?.threshold ? new Prisma.Decimal(rule.threshold) : null;
  }

  // ── admin 读面 ──
  findAll(gateType?: string) {
    return this.prisma.transactionLimitRule.findMany({
      where: gateType ? { gateType } : undefined,
      orderBy: [{ gateType: 'asc' }, { operationType: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findByNo(ruleNo: string) {
    const rule = await this.prisma.transactionLimitRule.findUnique({ where: { ruleNo } });
    if (!rule) throw new NotFoundException(`Rule ${ruleNo} not found`);
    return rule;
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/modules/asset-treasury/transaction-limits --no-coverage
```
Expected: PASS 全绿

- [ ] **Step 6: Commit**

```bash
git add src/modules/asset-treasury/transaction-limits
git commit -m "feat(limits): 规则服务——三行形状校验 + 三查找 + 唯一性预检 (TDD)"
```

---

### Task 3: 创建/变更审批工作流 + admin controller + 模块注册 + RBAC 路由

**Files:**
- Create: `src/modules/asset-treasury/transaction-limits/transaction-limit-rule-workflow.service.ts`
- Create: `src/modules/asset-treasury/transaction-limits/transaction-limit-rules.controller.ts`
- Create: `src/modules/asset-treasury/transaction-limits/transaction-limits.module.ts`
- Modify: `src/app.module.ts`（或 asset-treasury 聚合模块——grep `WalletsModule` 注册位照做）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:501-513`（换 4 条路由路径）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（加 REJECTED 动作，复用其余）

- [ ] **Step 1: 工作流服务**——照抄 `governance/transaction-limits/transaction-limit-creation-workflow.service.ts` 的结构（initiate→createAndSubmit 审批→decided handler→生效/回滚），一个文件装创建+变更两个 initiate + 两个 `@OnEvent` handler。关键差异：

```typescript
// 复用现成常量，不新造：
//   ApprovalActionTypes.TRANSACTION_LIMIT_CREATION / TRANSACTION_LIMIT_CHANGE（approval.constants.ts:63-65）
//   AuditEntityTypes.TRANSACTION_LIMIT_POLICY + AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_*（audit-actions.constant.ts）
// initiateCreate(dto, actor):
//   1. rulesService.validateShape(dto) + rulesService.assertUnique(dto)
//   2. 生成 ruleNo：`TLR-${Date.now()}`（样式同旧 policyNo）
//   3. prisma.transactionLimitRule.create({ ...dto, ruleNo, status: 'PENDING_APPROVAL' })
//   4. approvalsService.createAndSubmit({ actionType: TRANSACTION_LIMIT_CREATION, entityRef: rule.id, objectSnapshot: dto }, { reason: dto.reason }, actor)
//   5. update rule.approvalCaseId；审计 recordSystem
// @OnEvent('workflow.transaction-limit-creation.decided')（沿用旧事件名——approval.constants.ts:327-333 secondaryEventName 已配）:
//   APPROVED → status: 'ACTIVE'；REJECTED → 物理删该 PENDING 行；均审计
// initiateChange(ruleNo, dto{金额字段+reason}, actor):
//   1. 只允许改本形状的金额字段（validateShape 用 merged row 校验）
//   2. 走 TRANSACTION_LIMIT_CHANGE 审批，objectSnapshot 带 {before, after}
//   3. decided APPROVED → update 金额字段；REJECTED → 不动；均审计
```

⚠️ 先确认旧事件名：`grep -n 'secondaryEventName' src/modules/governance/approvals/constants/approval.constants.ts | grep -i limit` 拿到精确字符串再写 `@OnEvent`。

- [ ] **Step 2: controller**（4 端点，新路径 `/admin/transaction-limit-rules`）

```typescript
@Controller('admin/transaction-limit-rules')
export class TransactionLimitRulesController {
  // GET    /                 → rulesService.findAll(query.gateType)      权限 TRANSACTION_LIMIT_READ
  // GET    /:ruleNo          → rulesService.findByNo                     权限 TRANSACTION_LIMIT_READ
  // POST   /                 → workflow.initiateCreate(dto, actorFromReq) 权限 TRANSACTION_LIMIT_WRITE
  // POST   /:ruleNo/change   → workflow.initiateChange                   权限 TRANSACTION_LIMIT_WRITE
  // Guard/actor 提取样式照抄旧 transaction-limits.controller.ts
}
```

- [ ] **Step 3: module + 注册**

```typescript
@Module({
  imports: [/* 照 withdraw-transactions.module.ts 引入 Approvals/AuditLogs 所在模块 + PricingCenterModule(Task 4 用) */],
  providers: [TransactionLimitRulesService, TransactionLimitRuleWorkflowService],
  controllers: [TransactionLimitRulesController],
  exports: [TransactionLimitRulesService],
})
export class TransactionLimitsModule {}
// ⚠️ TransactionLimitGateService 在 Task 4 创建后再加进 providers/exports（此刻加会编译失败）
```
注册进 app（grep 现有 `AssetsModule` 在哪注册，同位加）。

- [ ] **Step 4: rbac.catalog 路由替换**（`rbac.catalog.ts:501-513` 原 4 条 `/admin/transaction-limit-policies*` 改为）：

```typescript
  // Transaction Limit Rules
  route('GET', '/admin/transaction-limit-rules', 'List transaction limit rules', ['TRANSACTION_LIMIT_READ']),
  route('GET', '/admin/transaction-limit-rules/:ruleNo', 'Get transaction limit rule detail', ['TRANSACTION_LIMIT_READ']),
  route('POST', '/admin/transaction-limit-rules', 'Create transaction limit rule', ['TRANSACTION_LIMIT_WRITE']),
  route('POST', '/admin/transaction-limit-rules/:ruleNo/change', 'Submit transaction limit rule change', ['TRANSACTION_LIMIT_WRITE']),
```

- [ ] **Step 5: 审计常量加一条拒绝动作**（`audit-actions.constant.ts`，放 TRANSACTION_LIMIT_CHANGE 附近）：

```typescript
  TRANSACTION_LIMIT_REJECTED: 'TRANSACTION_LIMIT_REJECTED',   // L1 金额限额拦截(A/B)
```

- [ ] **Step 6: 编译 + 手测创建审批链**

```bash
npx tsc --noEmit -p tsconfig.json
# 起 self 栈后手测：POST /admin/transaction-limit-rules 建 SINGLE 行 → approvals 里出现 case → approve → 行变 ACTIVE
```
Expected: tsc 0 error；审批链通。

- [ ] **Step 7: Commit**

```bash
git add src/modules/asset-treasury/transaction-limits src/modules/identity/access-control/rbac.catalog.ts src/modules/audit-logging/constants/audit-actions.constant.ts src/app.module.ts
git commit -m "feat(limits): 规则创建/变更审批工作流 + admin controller + RBAC 路由"
```

---

### Task 4: 判定引擎 TransactionLimitGateService — TDD

**Files:**
- Create: `src/modules/asset-treasury/transaction-limits/transaction-limit-gate.service.ts`
- Create: `src/modules/asset-treasury/transaction-limits/dubai-window.util.ts`
- Test: `src/modules/asset-treasury/transaction-limits/transaction-limit-gate.service.spec.ts`
- Test: `src/modules/asset-treasury/transaction-limits/dubai-window.util.spec.ts`

- [ ] **Step 1: 迪拜窗口 util + 测试**（迪拜 UTC+4 无夏令时）

```typescript
// dubai-window.util.ts
const DUBAI_OFFSET_MS = 4 * 3600 * 1000;

/** 返回迪拜日历日/日历月窗口起点（UTC Date） */
export function dubaiWindowStart(period: 'DAILY' | 'MONTHLY', now: Date): Date {
  const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
  if (period === 'DAILY') {
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - DUBAI_OFFSET_MS);
  }
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - DUBAI_OFFSET_MS);
}
```

```typescript
// dubai-window.util.spec.ts
import { dubaiWindowStart } from './dubai-window.util';

describe('dubaiWindowStart', () => {
  it('UTC 21:00 已是迪拜次日 → 日窗起点 = 当天 20:00 UTC', () => {
    expect(dubaiWindowStart('DAILY', new Date('2026-07-15T21:30:00Z')).toISOString()).toBe('2026-07-15T20:00:00.000Z');
  });
  it('UTC 19:59 仍是迪拜当日 → 日窗起点 = 前一天 20:00 UTC', () => {
    expect(dubaiWindowStart('DAILY', new Date('2026-07-15T19:59:00Z')).toISOString()).toBe('2026-07-14T20:00:00.000Z');
  });
  it('月窗起点 = 迪拜当月 1 日 00:00 = 上月末 20:00 UTC', () => {
    expect(dubaiWindowStart('MONTHLY', new Date('2026-07-15T12:00:00Z')).toISOString()).toBe('2026-06-30T20:00:00.000Z');
  });
});
```

- [ ] **Step 2: 引擎失败测试**（mock prisma/rules/rateProvider/audit）

```typescript
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransactionLimitGateService } from './transaction-limit-gate.service';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { BinanceRateProvider } from '../../trading/pricing-center/providers/binance-rate.provider';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('TransactionLimitGateService', () => {
  let gate: TransactionLimitGateService;
  const rules = { getSingleRule: jest.fn(), getCumulativeRules: jest.fn() } as any;
  const prisma = {
    asset: { findUnique: jest.fn() },
    customerMain: { findUnique: jest.fn() },
    withdrawTransaction: { aggregate: jest.fn() },
    swapTransaction: { aggregate: jest.fn() },
  } as any;
  const rate = { fetchRate: jest.fn() } as any;
  const audit = { recordSystem: jest.fn().mockResolvedValue(undefined) } as any;

  beforeEach(async () => {
    jest.resetAllMocks();
    audit.recordSystem.mockResolvedValue(undefined);
    prisma.asset.findUnique.mockResolvedValue({ id: 'a1', code: 'BTC', currency: 'BTC' });
    prisma.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'C-1', tradingTier: 'BASIC' });
    rate.fetchRate.mockResolvedValue({ rate: D(100), fetchedAt: new Date() }); // 1 unit = 100 AED
    rules.getSingleRule.mockResolvedValue(null);
    rules.getCumulativeRules.mockResolvedValue([]);
    prisma.withdrawTransaction.aggregate.mockResolvedValue({ _sum: { grossAedValue: null } });
    prisma.swapTransaction.aggregate.mockResolvedValue({ _sum: { grossAedValue: null } });
    const mod = await Test.createTestingModule({
      providers: [
        TransactionLimitGateService,
        { provide: TransactionLimitRulesService, useValue: rules },
        { provide: PrismaService, useValue: prisma },
        { provide: BinanceRateProvider, useValue: rate },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();
    gate = mod.get(TransactionLimitGateService);
  });

  const input = { operationType: 'WITHDRAWAL' as const, customerId: 'c1', assetId: 'a1', amount: D('1') };

  it('A: 低于 minAmount → BELOW_MIN 拒绝并审计', async () => {
    rules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-1', minAmount: D('2'), maxAmount: null });
    await expect(gate.evaluate(input)).rejects.toThrow(BadRequestException);
    expect(audit.recordSystem).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRANSACTION_LIMIT_REJECTED' }));
  });

  it('A: 等于 minAmount → 放行（边界含等号）', async () => {
    rules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-1', minAmount: D('1'), maxAmount: D('5') });
    await expect(gate.evaluate(input)).resolves.toBeDefined();
  });

  it('A: 高于 maxAmount → ABOVE_MAX 拒绝', async () => {
    rules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-1', minAmount: null, maxAmount: D('0.5') });
    await expect(gate.evaluate(input)).rejects.toThrow(BadRequestException);
  });

  it('B: 用量+本笔 > defaultLimit → CUMULATIVE 拒绝', async () => {
    rules.getCumulativeRules.mockResolvedValue([{ ruleNo: 'TLR-2', period: 'DAILY', defaultLimit: D('150') }]);
    prisma.withdrawTransaction.aggregate.mockResolvedValue({ _sum: { grossAedValue: D('100') } }); // 100 已用 + 本笔100 > 150
    await expect(gate.evaluate(input)).rejects.toThrow(BadRequestException);
  });

  it('B: 用量+本笔 == defaultLimit → 放行（边界含等号）', async () => {
    rules.getCumulativeRules.mockResolvedValue([{ ruleNo: 'TLR-2', period: 'DAILY', defaultLimit: D('200') }]);
    prisma.withdrawTransaction.aggregate.mockResolvedValue({ _sum: { grossAedValue: D('100') } });
    await expect(gate.evaluate(input)).resolves.toBeDefined();
  });

  it('B: 有 CUMULATIVE 规则但汇率失败 → fail-closed 拒绝', async () => {
    rules.getCumulativeRules.mockResolvedValue([{ ruleNo: 'TLR-2', period: 'DAILY', defaultLimit: D('200') }]);
    rate.fetchRate.mockRejectedValue(new Error('binance down'));
    await expect(gate.evaluate(input)).rejects.toThrow(BadRequestException);
  });

  it('无任何规则 + 汇率失败 → 放行但 rateFetchFailed=true（无 B 规则不 fail-closed）', async () => {
    rate.fetchRate.mockRejectedValue(new Error('binance down'));
    const r = await gate.evaluate(input);
    expect(r.rateFetchFailed).toBe(true);
    expect(r.grossAedValue).toBeNull();
  });

  it('SWAP 用量查 swapTransaction 聚合、排除 FAILED/REVERSED', async () => {
    rules.getCumulativeRules.mockResolvedValue([{ ruleNo: 'TLR-3', period: 'DAILY', defaultLimit: D('1000') }]);
    await gate.evaluate({ ...input, operationType: 'SWAP' });
    expect(prisma.swapTransaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { notIn: ['FAILED', 'REVERSED'] } }) }),
    );
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest src/modules/asset-treasury/transaction-limits --no-coverage
```
Expected: gate spec 全 FAIL（类不存在）

- [ ] **Step 4: 实现引擎**

```typescript
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes, AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { BinanceRateProvider } from '../../trading/pricing-center/providers/binance-rate.provider';
import { TransactionLimitRulesService } from './transaction-limit-rules.service';
import { dubaiWindowStart } from './dubai-window.util';

// 提现活跃/成功态计入用量；终态失败/拒绝/取消/退回不计
const WITHDRAW_COUNTED_EXCLUDE = ['FAILED', 'REJECTED', 'CANCELLED', 'RETURNED'];
const SWAP_COUNTED_EXCLUDE = ['FAILED', 'REVERSED'];

export interface GateInput {
  operationType: 'WITHDRAWAL' | 'SWAP';
  customerId: string;
  assetId: string;
  amount: Prisma.Decimal;
}

export interface GateValuation {
  grossAedValue: Prisma.Decimal | null;
  aedRate: Prisma.Decimal | null;
  rateFetchedAt: Date | null;
  rateFetchFailed: boolean;
}

@Injectable()
export class TransactionLimitGateService {
  private readonly logger = new Logger(TransactionLimitGateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: TransactionLimitRulesService,
    private readonly binanceRateProvider: BinanceRateProvider,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** L1 金额限额判定：A 单笔(原生币种) + B 累计(AED)。拒绝=审计+抛异常；通过=返回 AED 估值快照供落单。 */
  async evaluate(input: GateInput): Promise<GateValuation> {
    const asset = await this.prisma.asset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw new BadRequestException('Asset not found');

    // ── A: 单笔 min/max（原生币种直比，边界含等号放行）──
    const single = await this.rules.getSingleRule(input.operationType, input.assetId);
    if (single?.minAmount && input.amount.lt(new Prisma.Decimal(single.minAmount))) {
      await this.reject(input, single.ruleNo, 'TRANSACTION_LIMIT_BELOW_MIN', {
        minAmount: single.minAmount.toString(), assetCode: asset.code,
      });
    }
    if (single?.maxAmount && input.amount.gt(new Prisma.Decimal(single.maxAmount))) {
      await this.reject(input, single.ruleNo, 'TRANSACTION_LIMIT_ABOVE_MAX', {
        maxAmount: single.maxAmount.toString(), assetCode: asset.code,
      });
    }

    // ── AED 估值（一次取汇率，A 不需要、B/落单需要）──
    const valuation = await this.valuate(asset.currency, input.amount);

    // ── B: 周期累计（AED）──
    const customer = await this.prisma.customerMain.findUnique({ where: { id: input.customerId } });
    const tier = customer?.tradingTier || 'BASIC';
    const cumRules = await this.rules.getCumulativeRules(input.operationType, tier);
    if (cumRules.length > 0 && valuation.rateFetchFailed) {
      // fail-closed：有 B 规则却算不出 AED → 拒绝（与 D1 fail-closed 语义一致）
      await this.reject(input, cumRules[0].ruleNo, 'TRANSACTION_LIMIT_UNPRICEABLE', {});
    }
    for (const rule of cumRules) {
      const windowStart = dubaiWindowStart(rule.period as 'DAILY' | 'MONTHLY', new Date());
      const used = await this.sumUsage(input.operationType, input.customerId, windowStart);
      const projected = used.add(valuation.grossAedValue!);
      if (projected.gt(new Prisma.Decimal(rule.defaultLimit!))) {
        await this.reject(input, rule.ruleNo, 'TRANSACTION_LIMIT_CUMULATIVE_EXCEEDED', {
          period: rule.period, limitAed: rule.defaultLimit!.toString(),
          usedAed: used.toString(), remainingAed: Prisma.Decimal.max(new Prisma.Decimal(rule.defaultLimit!).sub(used), new Prisma.Decimal(0)).toString(),
        });
      }
    }

    return valuation;
  }

  private async valuate(currency: string, amount: Prisma.Decimal): Promise<GateValuation> {
    try {
      const r = await this.binanceRateProvider.fetchRate(currency, 'AED');
      return { grossAedValue: amount.mul(r.rate), aedRate: r.rate, rateFetchedAt: r.fetchedAt, rateFetchFailed: false };
    } catch (err) {
      this.logger.warn(`AED valuation failed for ${currency}: ${(err as Error).message}`);
      return { grossAedValue: null, aedRate: null, rateFetchedAt: null, rateFetchFailed: true };
    }
  }

  /** 窗口内该客户该方向用量（AED）：SUM grossAedValue；历史 null 行(汇率曾失败)按 0 计 */
  private async sumUsage(operationType: string, customerId: string, windowStart: Date): Promise<Prisma.Decimal> {
    if (operationType === 'WITHDRAWAL') {
      const agg = await this.prisma.withdrawTransaction.aggregate({
        _sum: { grossAedValue: true },
        where: { ownerId: customerId, createdAt: { gte: windowStart }, status: { notIn: WITHDRAW_COUNTED_EXCLUDE } },
      });
      return new Prisma.Decimal(agg._sum.grossAedValue || 0);
    }
    const agg = await this.prisma.swapTransaction.aggregate({
      _sum: { grossAedValue: true },
      where: { ownerId: customerId, createdAt: { gte: windowStart }, status: { notIn: SWAP_COUNTED_EXCLUDE } },
    });
    return new Prisma.Decimal(agg._sum.grossAedValue || 0);
  }

  private async reject(input: GateInput, ruleNo: string, code: string, context: Record<string, string | undefined>): Promise<never> {
    await this.auditLogsService.recordSystem({
      action: AuditActions.TRANSACTION_LIMIT_REJECTED,
      entityType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY,
      entityId: ruleNo,
      entityNo: ruleNo,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: input.customerId,
      workflowType: AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE,
      detail: { code, operationType: input.operationType, amount: input.amount.toString(), ...context },
    });
    throw new BadRequestException({ code, ruleNo, ...context });
  }
}
```

⚠️ `recordSystem` 的实参形状以 `withdraw-workflow.service.ts` 现有调用为准（detail 字段名可能是 `metadata`/`context`——grep 后对齐）；`AuditActions` vs `AuditGovernanceActions` 归属同理，以 Task 3 加常量时的实际落点为准。

- [ ] **Step 5: 注册进模块**——`transaction-limits.module.ts` 的 providers/exports 加 `TransactionLimitGateService`（Task 3 留的口子）

- [ ] **Step 6: 跑测试确认通过**

```bash
npx jest src/modules/asset-treasury/transaction-limits --no-coverage
```
Expected: 全 PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/asset-treasury/transaction-limits
git commit -m "feat(limits): L1 判定引擎——A 原生币种直比 + B 迪拜窗口累计(计在途,fail-closed) (TDD)"
```

---

### Task 5: 接入提现（A/B 前置拦截 + D1 阈值换源 + 估值落单）

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（createWithdrawal ~L146-240 + handleWithdrawalCreated ~L450-465）
- Modify: `src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.ts`
- Modify: `src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.spec.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`（import TransactionLimitsModule）

- [ ] **Step 1: `shouldRequireApproval` 改为阈值入参的纯函数**（常量文件删 `WITHDRAW_APPROVAL_AED_THRESHOLD`，保留 `SYSTEM_APPROVAL_ACTOR`）

```typescript
/**
 * Decide whether a withdrawal needs the large-value approval gate.
 * Fail-closed: missing value / failed rate fetch / missing rule all route to approval.
 */
export function shouldRequireApproval(
  input: { grossAedValue: Prisma.Decimal | null; rateFetchFailed: boolean },
  threshold: Prisma.Decimal | null,
): boolean {
  if (input.rateFetchFailed) return true;
  if (!input.grossAedValue) return true;
  if (!threshold) return true; // 规则被删/未种 → fail-closed 走审批
  return input.grossAedValue.gte(threshold);
}
```

同步改 spec：原 "threshold is 200000 AED" 用例删除，改传参用例（≥/</null threshold/rateFetchFailed 四例）。

- [ ] **Step 2: handleWithdrawalCreated 换阈值来源**（~L462）

```typescript
      const threshold = await this.limitRulesService.getLargeApprovalThreshold('WITHDRAWAL');
      if (shouldRequireApproval(valuation, threshold)) {
```
（构造器注入 `TransactionLimitRulesService`；`openApprovalGate` 里写死的 `≥ 200000 AED` reason 文案改为 `≥ ${threshold} AED`——threshold 作参数传入。）

- [ ] **Step 3: createWithdrawal 插入 A/B 前置闸**（`ensureCustomerCanTransact` 之后、`$transaction` 之前；`amountDecimal` 定义后）

```typescript
    // ── L1 Transaction Limit gate (A single min/max + B cumulative) ──
    // Rejects BEFORE order persist & quote consumption; returns AED valuation for the row.
    let gateValuation: GateValuation | null = null;
    if (ownerType === 'CUSTOMER') {
      gateValuation = await this.limitGateService.evaluate({
        operationType: 'WITHDRAWAL',
        customerId: userId,
        assetId,
        amount: amountDecimal,
      });
    }
```

- [ ] **Step 4: 估值随单落库**——在 `$transaction` 内 withdraw create data 加：

```typescript
          grossAedValue: gateValuation?.grossAedValue ?? undefined,
          aedRate: gateValuation?.aedRate ?? undefined,
          rateFetchedAt: gateValuation?.rateFetchedAt ?? undefined,
          rateFetchFailed: gateValuation?.rateFetchFailed ?? undefined,
```
（消灭 B 用量的竞态窗口：订单出生即带 AED。`handleWithdrawalCreated` 里现有 `valuateAed`+`saveValuationSnapshot` 保持不动——重估覆盖无害且保留 ADMIN 单路径。）

- [ ] **Step 5: 编译 + 全仓 grep 死常量**

```bash
npx tsc --noEmit -p tsconfig.json
grep -rn 'WITHDRAW_APPROVAL_AED_THRESHOLD' src/ | grep -v spec
```
Expected: tsc 0 error；grep 0 命中（常量已死尽）

- [ ] **Step 6: 跑本域测试**

```bash
npx jest src/modules/trading/withdraw-transactions --no-coverage
```
Expected: PASS（含改造后的 constant.spec）

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/withdraw-transactions
git commit -m "feat(limits): 提现接入——A/B 建单前拦截 + D1 阈值改读规则行 + 估值出生落单"
```

---

### Task 6: 接入兑换（A/B 前置拦截 + 估值落单）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（executeSwap ~L183-200 + create data）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.module.ts`（import TransactionLimitsModule）

- [ ] **Step 1: executeSwap 插闸**（`assertTradingEligibility` 之后、`$transaction` 之前；quote 在事务内才消费 → 事务外只读 peek 拿金额）

```typescript
    // ── L1 Transaction Limit gate (A + B) — evaluate BEFORE quote consumption ──
    const quotePeek = await this.prisma.swapQuote.findUnique({
      where: { id: quoteId },
      select: { fromAssetId: true, amountIn: true },
    });
    if (!quotePeek) throw new NotFoundException('Swap quote not found');
    const gateValuation = await this.limitGateService.evaluate({
      operationType: 'SWAP',
      customerId: ownerId,
      assetId: quotePeek.fromAssetId,
      amount: new Prisma.Decimal(quotePeek.amountIn),
    });
```

- [ ] **Step 2: swap create data 加 `grossAedValue: gateValuation.grossAedValue ?? undefined`**（事务内建 swap 行处）

- [ ] **Step 3: 编译 + 本域测试**

```bash
npx tsc --noEmit -p tsconfig.json && npx jest src/modules/trading/swap-transactions --no-coverage
```
Expected: 双绿

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/swap-transactions
git commit -m "feat(limits): 兑换接入——A/B 建单前拦截(quote peek) + AED 估值落单"
```

---

### Task 7: 种子数据（业务初始化命令链路）

**Files:**
- Modify: `prisma/seed.business.ts`（原 `seedTransactionLimitPolicies` 函数整体替换为 `seedTransactionLimitRules`，主函数调用点同步改名）

- [ ] **Step 1: 新种子函数**——⚠️ **值必须宽到不绊倒 demo 脚本**（demo:all 连跑充提兑；先 `grep -n 'amount' scripts/demo-*.ts` 确认 demo 单笔量级，限额取其 10 倍以上）：

```typescript
export async function seedTransactionLimitRules(prisma: PrismaClient): Promise<void> {
  // A: 每资产 × WITHDRAWAL/SWAP 单笔 min/max（原生币种；值从旧 Asset min/max 字段沿袭精神,swap 补默认）
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, type: true } });
  const singleDefaults: Record<string, { min: string; max: string }> = {
    // 按 code 给 demo 值；未列出的资产用 fallback
    BTC: { min: '0.0001', max: '10' },
    ETH: { min: '0.001', max: '100' },
    USDT: { min: '10', max: '1000000' },
    AED: { min: '10', max: '1000000' },
    USD: { min: '10', max: '1000000' },
  };
  const rules: any[] = [];
  let seq = 1;
  const no = () => `TLR-${String(seq++).padStart(3, '0')}`;
  for (const a of assets) {
    const d = singleDefaults[a.code] || { min: '0.0001', max: '1000000' };
    for (const op of ['WITHDRAWAL', 'SWAP']) {
      rules.push({ ruleNo: no(), gateType: 'SINGLE', operationType: op, assetId: a.id, minAmount: d.min, maxAmount: d.max });
    }
  }
  // B: tier × 方向 × 周期（AED；默认值+cap；沿旧 TLP 值量级放大防绊 demo）
  const cum = [
    ['BASIC', 'WITHDRAWAL', 'DAILY', '50000', '100000'],
    ['BASIC', 'WITHDRAWAL', 'MONTHLY', '500000', '1000000'],
    ['BASIC', 'SWAP', 'DAILY', '100000', '200000'],
    ['BASIC', 'SWAP', 'MONTHLY', '1000000', '2000000'],
    ['PREMIUM', 'WITHDRAWAL', 'DAILY', '500000', '1000000'],
    ['PREMIUM', 'WITHDRAWAL', 'MONTHLY', '5000000', '10000000'],
    ['PREMIUM', 'SWAP', 'DAILY', '1000000', '2000000'],
    ['PREMIUM', 'SWAP', 'MONTHLY', '10000000', '20000000'],
  ];
  for (const [tier, op, period, defaultLimit, cap] of cum) {
    rules.push({ ruleNo: no(), gateType: 'CUMULATIVE', operationType: op, tradingTier: tier, period, defaultLimit, cap });
  }
  // D1: 提现大额审批线（承接原 WITHDRAW_APPROVAL_AED_THRESHOLD=200000）
  rules.push({ ruleNo: no(), gateType: 'LARGE_APPROVAL', operationType: 'WITHDRAWAL', threshold: '200000' });

  for (const r of rules) {
    await prisma.transactionLimitRule.upsert({
      where: { gateType_operationType_assetId_tradingTier_period: {
        gateType: r.gateType, operationType: r.operationType,
        assetId: r.assetId ?? null, tradingTier: r.tradingTier ?? null, period: r.period ?? null,
      } },
      update: { minAmount: r.minAmount, maxAmount: r.maxAmount, defaultLimit: r.defaultLimit, cap: r.cap, threshold: r.threshold, status: 'ACTIVE' },
      create: { ...r, status: 'ACTIVE' },
    });
  }
  console.log(`  ✔ Seeded ${rules.length} transaction limit rules`);
}
```
⚠️ upsert 复合唯一 where 含 null 在 Prisma+SQLite 可能不支持——若报错改成 `findFirst`+`create/update` 手写 upsert。

- [ ] **Step 2: 主函数替换调用**：`seedTransactionLimitPolicies(prisma)` → `seedTransactionLimitRules(prisma)`（旧函数体先留着，Task 8 一并删）

- [ ] **Step 3: 跑种子验证**

```bash
bash scripts/on-stack.sh self db:biz:init
```
Expected: 日志出现 `✔ Seeded N transaction limit rules`

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.business.ts
git commit -m "feat(limits): 种子——A 每资产×两方向 + B 8行(默认值+cap) + D1 200k,随 db:biz:init 注入"
```

---

### Task 8: 退役旧模块（代码 + 表 + 旧种子）

**Files:**
- Delete: `src/modules/governance/transaction-limits/`（整目录 8 文件）
- Modify: 注册处（`grep -rn 'TransactionLimitsModule\|transaction-limits' src/ --include='*.module.ts'` 找到 governance 侧注册删掉）
- Modify: `prisma/seed.business.ts`（删旧 `seedTransactionLimitPolicies` 函数体）
- Modify: `prisma/schema.prisma`（删 `TransactionLimitPolicy` + `TransactionLimitChangeRequest` 两模型）
- Migration: drop 两表

- [ ] **Step 1: 消费方普查**（删前必查，谁还在引用旧模块/旧表）

```bash
grep -rn 'transactionLimitPolicy\|TransactionLimitPolicy\|transaction-limit-policies\|TransactionLimitChangeRequest' src/ client-web/src/ admin-web/src/ scripts/ --include='*.ts' --include='*.tsx' | grep -v 'governance/transaction-limits'
```
Expected: 仅 admin-web 旧页面（Task 9 重写）+ 可能的 reset 脚本。**reset 脚本**（`scripts/reset-business-data.ts` 等）若删旧表要同步去引用、加新表清理。客户端若有 `transaction-limits-customer.controller` 的调用（`grep -rn 'transaction-limit' client-web/src/`）：有则本轮该端点保留读新表重写，无则直接删。

- [ ] **Step 2: 删目录 + 去注册 + 删旧种子函数**，schema 删两模型，生成迁移：

```bash
npx prisma migrate dev --name drop_transaction_limit_policies
```

- [ ] **Step 3: 全编译 + 全测试**

```bash
npx tsc --noEmit -p tsconfig.json && npx jest --no-coverage 2>&1 | tail -5
```
Expected: tsc 0；jest 失败数 == main 基线（净新 0）

- [ ] **Step 4: Commit**

```bash
git add -A src/modules/governance prisma scripts
git commit -m "refactor(limits): 退役旧 governance/transaction-limits 模块+两表(零消费半成品,被新模块吸收)"
```

---

### Task 9: 前端——三 tab 配置页 + 侧边栏复活 + 资产表单撤 4 输入框 + 客户端文案

**Files:**
- Rewrite: `admin-web/src/pages/TransactionLimitList.tsx`（三 tab：Single / Cumulative / Large Approval）
- Rewrite: `admin-web/src/pages/TransactionLimitDetail.tsx`（规则详情 + 发起变更表单）
- Modify: `admin-web/src/App.tsx:77-78,576-580,661-662`（路由指向新页面 props/权限核对）
- Modify: `admin-web/src/components/DashboardLayout.tsx:244`（解除注释，label 'Transaction Limits'，权限对齐）
- Modify: `admin-web/src/rbac/permissions.ts`（核对 `TRANSACTION_LIMIT_*` 常量与后端 `TRANSACTION_LIMIT_READ/WRITE` 对齐；旧 `TRANSACTION_LIMIT_POLICIES_READ` 若与后端字符串不一致按后端改）
- Modify: `admin-web/src/pages/AssetCreate.tsx` / `AssetEdit.tsx`（撤 min/maxDeposit/Withdraw 4 输入框；AssetDetail 若展示同撤）
- Modify: `client-web/src/pages/Withdraw.tsx` / `Swap.tsx`（错误码映射友好文案）

- [ ] **Step 1: List 页三 tab**——版式照抄 `WithdrawalFeeLevelList.tsx`（同为审批型配置列表）。数据源 `GET /admin/transaction-limit-rules?gateType=`。三 tab 列定义：

```
Single:         Rule No | Operation | Asset | Min | Max | Status | 详情→
Cumulative:     Rule No | Operation | Tier | Period | Default Limit (AED) | Cap (AED) | Status | 详情→
Large Approval: Rule No | Operation | Threshold (AED) | Status | 详情→
```
每 tab 一个 Create 按钮 → 弹本形状字段的表单 → `POST /admin/transaction-limit-rules`（提交后提示"已提交审批"）。

- [ ] **Step 2: Detail 页**——规则全字段只读 + Change 表单（仅本形状金额字段可改 + reason）→ `POST /admin/transaction-limit-rules/:ruleNo/change`；`approvalCaseId` 有值时链到审批详情（按业务键跳转，勿裸 UUID 展示——项目铁律）。

- [ ] **Step 3: 侧边栏解注释** `DashboardLayout.tsx:244-245`，权限用与 `permissions.ts` 对齐后的 READ 常量。

- [ ] **Step 4: 资产表单撤 4 输入框**（AssetCreate/AssetEdit/AssetDetail 中 `minDepositAmount|maxDepositAmount|minWithdrawAmount|maxWithdrawAmount` 的表单项/展示行删除；后端 DTO 不动——列还在只是不再从这配）。

- [ ] **Step 5: 客户端错误文案**——Withdraw.tsx / Swap.tsx 的提交 catch 里按 `err.response.data.code` 映射：

```typescript
const LIMIT_ERROR_TEXT: Record<string, (d: any) => string> = {
  TRANSACTION_LIMIT_BELOW_MIN: (d) => `Amount below minimum (${d.minAmount} ${d.assetCode})`,
  TRANSACTION_LIMIT_ABOVE_MAX: (d) => `Amount exceeds maximum (${d.maxAmount} ${d.assetCode})`,
  TRANSACTION_LIMIT_CUMULATIVE_EXCEEDED: (d) => `${d.period === 'DAILY' ? 'Daily' : 'Monthly'} limit exceeded — remaining ${d.remainingAed} AED`,
  TRANSACTION_LIMIT_UNPRICEABLE: () => 'Pricing temporarily unavailable, please retry later',
};
```

- [ ] **Step 6: 双前端编译**

```bash
cd admin-web && npx tsc --noEmit && cd ../client-web && npx tsc --noEmit && cd ..
```
Expected: 双 0 error

- [ ] **Step 7: 渲染验证**（项目铁律：UI 完成 = 预览渲染截图，非 tsc 过）——self 栈起 admin 预览，登录种子 admin，截图三 tab 列表 + 创建弹窗 + 详情页；客户端截图提现页撞 A-min 的错误提示。

- [ ] **Step 8: Commit**

```bash
git add admin-web/src client-web/src
git commit -m "feat(limits): 三tab配置页+侧边栏复活+资产表单撤限额输入+客户端限额文案"
```

---

### Task 10: 端到端回归 + 权限种子 + 文档同步

**Files:**
- Modify: `doc-final/reference/truth/v5-withdraw.md`（加"金额限额 L1"节：A/B 前置拦截 + D1 阈值改读规则）
- Modify: `doc-final/reference/truth/v6-swap.md`（同上，A/B）
- Modify: `doc-final/reference/truth/v3-financial-config.md`（金额闸门条目改现状：统一 transaction_limit_rules；Asset 4 字段仅存量列）
- Modify: `doc-final/BACKLOG.md`（勾「限额执行接入 vs 明示退役」待决策；新记 Asset 4 列待 drop、DEPOSIT 行配置先行执行未接）
- Modify: `doc-final/reference/roadmap.md`（V3「金额闸门体系 [~]」→ 更新为 A/B/D1 已接提现兑换、充值/TR 后续）

- [ ] **Step 1: 权限生效**（新 RBAC 路由注册后必须）

```bash
bash scripts/on-stack.sh self db:base:sync
# 重启后端（stack.sh up 自带重建；确认 admin 非 SUPER_ADMIN 角色也能按权限见到菜单）
bash scripts/stack.sh up
```

- [ ] **Step 2: 手动全链验收**（self 栈）
  1. admin 建一条 SINGLE 规则（如 BTC WITHDRAWAL min 提到 1 BTC）→ 审批通过 → 客户端提 0.5 BTC → 被拒、文案正确、审计出现 `TRANSACTION_LIMIT_REJECTED`
  2. 客户连续提现逼近 BASIC 日限 → 撞线被拒、remaining 正确
  3. 提现 ≥ 20 万 AED → 走 SMO 审批（D1 读规则行）；admin 改 D1 到 30 万（走变更审批）→ 25 万提现不再触发
  4. 兑换撞 SWAP 日限被拒；小额兑换正常成交

- [ ] **Step 3: 回归金闸门**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest --no-coverage 2>&1 | tail -5          # 失败数 == main 基线
bash scripts/on-stack.sh self demo:all          # 8/8 PASS（限额种子不绊 demo）
bash scripts/on-stack.sh self verify:coa        # ALL INVARIANTS PASS
```
Expected: 四门全绿。demo:all 若被限额绊倒 → 调大 Task 7 种子值重跑（不许改 demo 脚本迁就）。

- [ ] **Step 4: 文档五处同步**（truth×3 + BACKLOG + roadmap，内容见 Files 清单）

- [ ] **Step 5: Commit**

```bash
git add doc-final
git commit -m "docs(limits): truth v3/v5/v6 + BACKLOG + roadmap 同步金额限额落地现状"
```

---

## 验收总清单

- [ ] `transaction_limit_rules` 三行形状 CRUD + OPS 审批链全通
- [ ] 提现/兑换：A 拒（订单不生、quote 不耗）、B 撞线拒（计在途、迪拜窗口）、D1 读规则行开审批
- [ ] 旧 governance/transaction-limits 模块+两表+旧种子清零，全仓 grep 无残留
- [ ] admin 三 tab 页渲染截图 + 客户端错误文案截图
- [ ] tsc 0 / jest 净新 0 / demo:all 8/8 / verify:coa PASS
- [ ] truth×3 + BACKLOG + roadmap 五处文档同步
