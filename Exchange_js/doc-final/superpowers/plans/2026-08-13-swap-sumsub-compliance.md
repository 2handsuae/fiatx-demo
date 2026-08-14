# 兑换合规 · Sumsub 集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 兑换订单接入 Sumsub 交易监控——建单即消费报价并提交卖出腿，webhook 裁决驱动 4 态状态机，被拒时零记账痕迹并把补料要求挂到客户身上。

**Architecture:** `executeSwap()` 从"一个事务干完"劈成两段：`initiateSwap()`（L1 → consumeQuote → 建单 COMPLIANCE_PENDING → 提交卖出腿）与 `onKytApproved()`（markStatus PROCESSING → createLeg → 补提买入腿）。中间隔一次 Sumsub webhook 往返。拒绝时订单直接终态，材料要求写进客户 `restrictions` 并由客户端 banner 承接。

**Tech Stack:** NestJS + Prisma + SQLite + TigerBeetle｜Jest（单测）/ Jest e2e｜Sumsub KYT API

**设计依据：** [`specs/2026-08-13-swap-sumsub-compliance-flow-design.md`](../specs/2026-08-13-swap-sumsub-compliance-flow-design.md)

## Global Constraints

- **工作树**：本计划在独立 worktree 执行（`.claude/worktrees/swap-sumsub/`），栈用 `bash scripts/stack.sh up`（self，自动分端口）。禁止在主工作树 `main` 分支起服务。
- **审计铁律**：有持久状态、operator 可见的操作必须写 `AuditLogsService`（DI 注入，禁止 `new`）。
- **事务铁律**：多表状态变更必须用 `prisma.$transaction`。
- **业务键铁律**：有 `swapNo`/`customerNo` 等稳定业务键时禁止以 `id` 作主查询合同。
- **状态写入口铁律**：状态字段唯一写入口 = webhook handler；同步响应只落审计快照，绝不写状态。
- **RBAC**：新增 admin 端点必须在 `rbac.catalog.ts` 登记 + `npm run db:base:sync` + **重启后端**（SUPER_ADMIN 走内存定义，只 seed 不重启无效）。
- **命名**：新状态值 `COMPLIANCE_PENDING` / `REJECTED`（大写下划线，与提现域逐字一致）。
- **不动区**：四腿两阶段记账、`onLegConfirmed` 链式、`onLegFailedSelfHeal` 自愈、`needsReview`/STUCK、`advanceLeg`——本计划一行不碰。
- **死枚举**：`FAILED` / `REVERSED` 保持不可达，不复活。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `prisma/schema.prisma` | `SwapTransaction` 新增 6 个 Sumsub 字段 |
| `swap-transactions/dto/swap-transaction.dto.ts` | 状态枚举 + 动作枚举 |
| `swap-transactions/swap-transactions.service.ts` | `transitions` 表 + `markStatus` 守卫 + `findBySumsubTxnId` |
| `swap-transactions/swap-workflow.service.ts` | `executeSwap` → `initiateSwap` + `onKytApproved` + `applyKytVerdict` |
| `swap-sumsub/swap-webhook.router.ts` | webhook 类型分流 |
| `swap-sumsub/swap-kyt-verdict.handler.ts` | 按 txnId 认领 → 归一 verdict → 调 workflow |
| `swap-sumsub/swap-sla.service.ts` | 合规超时看门狗 |
| `swap-sumsub/demo-scenario.service.ts` + `admin-swap-demo.controller.ts` + `fixtures/verdict-buttons.ts` | 模拟层 |
| `trading/shared/customer-transaction-guard.ts` | 已有，本计划只补调用点传参 |
| `identity/onboarding/onboarding.service.ts` | `assertTradingEligibility` 接通 restrictions |
| `identity/customers/customer-restrictions.service.ts` | **新建**：restrictions 读写唯一入口 |

---

## Task 1: 接通 restrictions 死码 + 订正 truth

`CustomerMain.restrictions` 有读无写，且三个 `ensureCustomerCanTransact()` 调用点全未传 `capability`（检查包在 `if (capability)` 内恒不执行）。本任务复活它——这是后续 Task 7 写入限制的落点。

**Files:**
- Create: `src/modules/identity/customers/customer-restrictions.service.ts`
- Create: `src/modules/identity/customers/customer-restrictions.service.spec.ts`
- Modify: `src/modules/identity/onboarding/onboarding.service.ts:1345-1389`（`assertTradingEligibility`）
- Modify: `doc-final/reference/truth/v2-customer-compliance.md:33`

**Interfaces:**
- Produces: `CustomerRestrictionsService.add(customerId, capabilities: TradeAction[], reason: string, actorId: string): Promise<void>`｜`.clear(customerId, capabilities: TradeAction[], actorId: string): Promise<void>`｜`.list(customerId): Promise<{capability: string; reason: string}[]>`
- Consumes: `AuditLogsService`、`PrismaService`

- [ ] **Step 1: 写失败测试**

```ts
// customer-restrictions.service.spec.ts
describe('CustomerRestrictionsService', () => {
  it('add 写入去重，clear 只移除指定 capability', async () => {
    const prisma = { customerMain: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'C-001', restrictions: null }),
      update: jest.fn().mockResolvedValue({}),
    } } as any;
    const audit = { recordByActor: jest.fn() } as any;
    const svc = new CustomerRestrictionsService(prisma, audit);

    await svc.add('c1', ['SWAP', 'WITHDRAW'], 'KYT_REJECTED', 'system');
    expect(JSON.parse(prisma.customerMain.update.mock.calls[0][0].data.restrictions))
      .toEqual([
        { capability: 'SWAP', reason: 'KYT_REJECTED' },
        { capability: 'WITHDRAW', reason: 'KYT_REJECTED' },
      ]);

    prisma.customerMain.findUnique.mockResolvedValue({
      id: 'c1', customerNo: 'C-001',
      restrictions: JSON.stringify([
        { capability: 'SWAP', reason: 'KYT_REJECTED' },
        { capability: 'WITHDRAW', reason: 'KYT_REJECTED' },
      ]),
    });
    await svc.clear('c1', ['SWAP', 'WITHDRAW'], 'system');
    expect(JSON.parse(prisma.customerMain.update.mock.calls[1][0].data.restrictions)).toEqual([]);
  });

  it('add 幂等：重复加同一 capability 不产生重复条目', async () => {
    const prisma = { customerMain: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1', customerNo: 'C-001',
        restrictions: JSON.stringify([{ capability: 'SWAP', reason: 'KYT_REJECTED' }]),
      }),
      update: jest.fn().mockResolvedValue({}),
    } } as any;
    const svc = new CustomerRestrictionsService(prisma, { recordByActor: jest.fn() } as any);
    await svc.add('c1', ['SWAP'], 'KYT_REJECTED', 'system');
    expect(JSON.parse(prisma.customerMain.update.mock.calls[0][0].data.restrictions)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts`
Expected: FAIL — `Cannot find module './customer-restrictions.service'`

- [ ] **Step 3: 实现 service**

```ts
// customer-restrictions.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes, AuditResult } from '../../audit-logging/constants/audit-actions.constant';

export type TradeAction = 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | 'ALL';
export interface CustomerRestriction { capability: string; reason: string }

@Injectable()
export class CustomerRestrictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async list(customerId: string): Promise<CustomerRestriction[]> {
    const c = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerId}`);
    return CustomerRestrictionsService.parse(c.restrictions);
  }

  async add(customerId: string, capabilities: TradeAction[], reason: string, actorId: string): Promise<void> {
    const c = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerId}`);
    const current = CustomerRestrictionsService.parse(c.restrictions);
    const next = [...current];
    for (const cap of capabilities) {
      if (!next.some((r) => r.capability === cap)) next.push({ capability: cap, reason });
    }
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { restrictions: JSON.stringify(next) },
    });
    await this.auditLogsService.recordSystem({
      action: AuditActions.CUSTOMER_RESTRICTION_ADDED,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: customerId,
      entityNo: c.customerNo || undefined,
      result: AuditResult.SUCCESS,
      reason: `${capabilities.join(',')} restricted: ${reason}`,
      metadata: { capabilities, reason, actorId },
    });
  }

  async clear(customerId: string, capabilities: TradeAction[], actorId: string): Promise<void> {
    const c = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerId}`);
    const next = CustomerRestrictionsService.parse(c.restrictions)
      .filter((r) => !capabilities.includes(r.capability as TradeAction));
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { restrictions: JSON.stringify(next) },
    });
    await this.auditLogsService.recordSystem({
      action: AuditActions.CUSTOMER_RESTRICTION_CLEARED,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: customerId,
      entityNo: c.customerNo || undefined,
      result: AuditResult.SUCCESS,
      reason: `${capabilities.join(',')} cleared`,
      metadata: { capabilities, actorId },
    });
  }

  private static parse(raw: string | null | undefined): CustomerRestriction[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
```

在 `audit-actions.constant.ts` 补两个常量：

```ts
CUSTOMER_RESTRICTION_ADDED: 'CUSTOMER_RESTRICTION_ADDED',
CUSTOMER_RESTRICTION_CLEARED: 'CUSTOMER_RESTRICTION_CLEARED',
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts`
Expected: PASS（2 个用例）

- [ ] **Step 5: 在 L1 门里接通 restrictions**

`onboarding.service.ts` 的 `assertTradingEligibility` 在三轴校验之后、`assertTradingReady` 之前插入：

```ts
    const restrictions = (() => {
      if (!customer.restrictions) return [] as { capability: string }[];
      try {
        const p = JSON.parse(customer.restrictions);
        return Array.isArray(p) ? p : [];
      } catch { return []; }
    })();
    if (restrictions.some((r: any) => r.capability === action || r.capability === 'ALL')) {
      throw new ForbiddenException({
        code: 'CAPABILITY_RESTRICTED',
        message: `${action} is currently restricted`,
        customerId,
        customerNo: customer.customerNo,
      });
    }
```

⚠️ `tradingEligibilitySelect` 必须包含 `restrictions` 字段，否则上面读到 `undefined`。检查并补上。

- [ ] **Step 6: 补 L1 门的测试**

```ts
// onboarding.service.spec.ts 追加
it('restrictions 含 SWAP 时拦截 SWAP，放行 DEPOSIT', async () => {
  prisma.customerMain.findUnique.mockResolvedValue({
    id: 'c1', customerNo: 'C-001',
    onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE', complianceStatus: 'CLEAR',
    restrictions: JSON.stringify([{ capability: 'SWAP', reason: 'KYT_REJECTED' }]),
  });
  await expect(service.assertTradingEligibility('c1', 'SWAP'))
    .rejects.toMatchObject({ response: { code: 'CAPABILITY_RESTRICTED' } });
  await expect(service.assertTradingEligibility('c1', 'DEPOSIT')).resolves.toBeUndefined();
});
```

Run: `npx jest src/modules/identity/onboarding/onboarding.service.spec.ts`
Expected: PASS

- [ ] **Step 7: 订正 truth 文档漂移**

`doc-final/reference/truth/v2-customer-compliance.md:33` 原文声称交易门含「restrictions 校验」但代码没有。改为记述本任务落地后的真实行为：

```
- **assertTradingEligibility（V4-V6 交易门，最关键）**：`onboardingStatus=APPROVED && adminStatus=ACTIVE && complianceStatus≠FROZEN` +
  **capability 级 restrictions 校验**（2026-08-13 接通：`restrictions[]` 含该 action 或 `ALL` 即抛 `CAPABILITY_RESTRICTED`；
  写入方 `CustomerRestrictionsService`）；被 deposit/withdraw/swap 全部调用
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/identity/customers/customer-restrictions.service.ts \
        src/modules/identity/customers/customer-restrictions.service.spec.ts \
        src/modules/identity/onboarding/onboarding.service.ts \
        src/modules/identity/onboarding/onboarding.service.spec.ts \
        src/modules/audit-logging/constants/audit-actions.constant.ts \
        doc-final/reference/truth/v2-customer-compliance.md
git commit -m "feat(customer): 接通 capability 级 restrictions 闸门 + 订正 truth 漂移"
```

---

## Task 2: 状态机 —— 枚举 / transitions / markStatus 守卫 / Prisma 字段

**Files:**
- Modify: `prisma/schema.prisma`（`SwapTransaction` 模型）
- Modify: `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts`
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts:321`（`markStatus`）
- Test: `src/modules/trading/swap-transactions/swap-transactions.service.spec.ts`

**Interfaces:**
- Produces: `SwapTransactionStatus.COMPLIANCE_PENDING | PROCESSING | SUCCESS | REJECTED`｜`SwapTransactionAction.KYT_APPROVED | KYT_REJECTED | SLA_BREACH | SUCCESS`｜`markStatus(swapId, action: SwapTransactionAction, tx, opts?): Promise<string>` 返回新状态｜`findBySumsubTxnId(txnId): Promise<SwapTransaction | null>`
- Consumes: Task 1 无依赖

- [ ] **Step 1: 写失败测试**

```ts
// swap-transactions.service.spec.ts
describe('markStatus transitions', () => {
  it('COMPLIANCE_PENDING + kyt_approved → PROCESSING', async () => {
    const swap = { id: 's1', status: 'COMPLIANCE_PENDING' };
    const tx = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue(swap),
        update: jest.fn().mockResolvedValue({ ...swap, status: 'PROCESSING' }),
      },
    } as any;
    const next = await service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, tx);
    expect(next).toBe('PROCESSING');
  });

  it('COMPLIANCE_PENDING + kyt_rejected → REJECTED', async () => {
    const tx = {
      swapTransaction: {
        findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' }),
        update: jest.fn().mockResolvedValue({ id: 's1', status: 'REJECTED' }),
      },
    } as any;
    expect(await service.markStatus('s1', SwapTransactionAction.KYT_REJECTED, tx)).toBe('REJECTED');
  });

  it('终态不可推进：REJECTED + kyt_approved 抛错', async () => {
    const tx = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'REJECTED' }) },
    } as any;
    await expect(service.markStatus('s1', SwapTransactionAction.KYT_APPROVED, tx))
      .rejects.toThrow(/Invalid transition/);
  });

  it('非法跳步：COMPLIANCE_PENDING + success 抛错', async () => {
    const tx = {
      swapTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' }) },
    } as any;
    await expect(service.markStatus('s1', SwapTransactionAction.SUCCESS, tx))
      .rejects.toThrow(/Invalid transition/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/swap-transactions/swap-transactions.service.spec.ts -t 'markStatus transitions'`
Expected: FAIL — `SwapTransactionAction is not defined`

- [ ] **Step 3: 加枚举 + transitions + 守卫**

`dto/swap-transaction.dto.ts`：

```ts
export enum SwapTransactionStatus {
  COMPLIANCE_PENDING = 'COMPLIANCE_PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  REJECTED = 'REJECTED',
  // 不可达死枚举，保留仅为历史行兼容 —— 见 BACKLOG「V6 兑换 FAILED/REVERSED 死枚举」
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

export enum SwapTransactionAction {
  KYT_APPROVED = 'kyt_approved',
  KYT_REJECTED = 'kyt_rejected',
  SLA_BREACH = 'sla_breach',
  SUCCESS = 'success',
}

export type SwapRejectReason = 'KYT_REJECTED' | 'TIMEOUT';
```

`swap-transactions.service.ts` 用 transitions 重写 `markStatus`：

```ts
  private readonly transitions: Record<string, Partial<Record<SwapTransactionAction, SwapTransactionStatus>>> = {
    [SwapTransactionStatus.COMPLIANCE_PENDING]: {
      [SwapTransactionAction.KYT_APPROVED]: SwapTransactionStatus.PROCESSING,
      [SwapTransactionAction.KYT_REJECTED]: SwapTransactionStatus.REJECTED,
      [SwapTransactionAction.SLA_BREACH]: SwapTransactionStatus.REJECTED,
    },
    [SwapTransactionStatus.PROCESSING]: {
      [SwapTransactionAction.SUCCESS]: SwapTransactionStatus.SUCCESS,
    },
    [SwapTransactionStatus.SUCCESS]: {},
    [SwapTransactionStatus.REJECTED]: {},
    [SwapTransactionStatus.FAILED]: {},
    [SwapTransactionStatus.REVERSED]: {},
  };

  async markStatus(
    swapId: string,
    action: SwapTransactionAction,
    tx: Prisma.TransactionClient,
    opts?: { rejectReason?: SwapRejectReason },
  ): Promise<string> {
    const swap = await tx.swapTransaction.findUnique({ where: { id: swapId } });
    if (!swap) throw new NotFoundException(`Swap not found: ${swapId}`);
    const next = this.transitions[swap.status]?.[action];
    if (!next) {
      throw new BadRequestException(`Invalid transition: ${swap.status} + ${action}`);
    }
    await tx.swapTransaction.update({
      where: { id: swapId },
      data: {
        status: next,
        ...(opts?.rejectReason ? { rejectReason: opts.rejectReason } : {}),
        ...(next === SwapTransactionStatus.SUCCESS ? { completedAt: new Date() } : {}),
      },
    });
    return next;
  }

  async findBySumsubTxnId(txnId: string) {
    return this.prisma.swapTransaction.findFirst({ where: { sumsubTxnIdOut: txnId } });
  }
```

⚠️ 现有 `markStatus(swapId, status: string, tx)` 的唯一调用点 `swap-workflow.service.ts:598` 传的是字面量 `'SUCCESS'`，改为 `SwapTransactionAction.SUCCESS`。

- [ ] **Step 4: 加 Prisma 字段并迁移**

`schema.prisma` 的 `SwapTransaction` 追加：

```prisma
  sumsubTxnIdOut      String?  @map("sumsub_txn_id_out")
  sumsubTxnIdIn       String?  @map("sumsub_txn_id_in")
  complianceVerdict   String?  @map("compliance_verdict")
  complianceAction    String?  @map("compliance_action")
  complianceRuleNames String?  @map("compliance_rule_names")
  sumsubDetailJson    String?  @map("sumsub_detail_json")
  rejectReason        String?  @map("reject_reason")
```

并在索引区追加 `@@index([sumsubTxnIdOut])`（handler 按它认领，必须走索引）。

```bash
npx prisma migrate dev --name swap_sumsub_fields
npm run prisma:generate
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest src/modules/trading/swap-transactions/swap-transactions.service.spec.ts`
Expected: PASS（4 个新用例 + 既有用例不回归）

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations \
        src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts \
        src/modules/trading/swap-transactions/swap-transactions.service.ts \
        src/modules/trading/swap-transactions/swap-transactions.service.spec.ts \
        src/modules/trading/swap-transactions/swap-workflow.service.ts
git commit -m "feat(swap): 4 态状态机 + transitions 守卫 + Sumsub 引用字段"
```

---

## Task 3: 扩展 SumsubTxnClient 共享原语

现有 `submitTxn` 只返回 `{ txnId }`，缺 `scoringResult`；`SubmitTxnInput` 缺 `orderId`/`props`/`infoType`。这是 `deposit-sumsub` 里的跨域共享件，改动需跑充值提现回归。

**Files:**
- Modify: `src/modules/deposit-sumsub/sumsub-txn-client.interface.ts`
- Modify: `src/modules/deposit-sumsub/sumsub-txn-client.http.ts`
- Modify: `src/modules/deposit-sumsub/sumsub-txn-client.mock.ts`
- Test: `src/modules/deposit-sumsub/sumsub-txn-client.mock.spec.ts`

**Interfaces:**
- Produces: `SubmitTxnInput` 增 `orderId?: string`、`props?: Record<string,string>`、`infoType?: string`；`submitTxn` 返回 `{ txnId: string; scoringResult?: SumsubScoringResult }`；`SumsubScoringResult = { action: 'score'|'onHold'|'awaitUser'|'reject'; score?: number; matchedRuleNames: string[]; applicantActions: {applicantActionId: string; externalActionId: string}[] }`；`MockSumsubTxnClient.primeSubmitResult(clientTxnId, result)`
- Consumes: Task 2 无依赖

- [ ] **Step 1: 写失败测试**

```ts
// sumsub-txn-client.mock.spec.ts 追加
it('primeSubmitResult 让 submitTxn 带回 scoringResult', async () => {
  const c = new MockSumsubTxnClient();
  c.primeSubmitResult('SWP-001', {
    txnId: 'abc123def456abc123def456',
    scoringResult: { action: 'reject', score: 90, matchedRuleNames: ['r1'], applicantActions: [] },
  });
  const r = await c.submitTxn({
    applicantId: 'a1', clientTxnId: 'SWP-001', type: 'finance', direction: 'out',
    amount: 100, currencyCode: 'USDT', currencyType: 'crypto',
    orderId: 'SWP-001', props: { txType: 'exchange' }, infoType: 'exchange',
  });
  expect(r.txnId).toBe('abc123def456abc123def456');
  expect(r.scoringResult?.action).toBe('reject');
});

it('未 prime 时 scoringResult 为 undefined，txnId 走确定性哈希兜底', async () => {
  const c = new MockSumsubTxnClient();
  const r = await c.submitTxn({
    applicantId: 'a1', clientTxnId: 'SWP-002', type: 'finance', direction: 'out',
    amount: 1, currencyCode: 'AED', currencyType: 'fiat',
  });
  expect(r.txnId).toMatch(/^[0-9a-f]{24}$/);
  expect(r.scoringResult).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/deposit-sumsub/sumsub-txn-client.mock.spec.ts`
Expected: FAIL — `primeSubmitResult is not a function`

- [ ] **Step 3: 改接口 + 两个实现**

`sumsub-txn-client.interface.ts`：

```ts
export interface SumsubScoringResult {
  action: 'score' | 'onHold' | 'awaitUser' | 'reject';
  score?: number;
  matchedRuleNames: string[];
  applicantActions: { applicantActionId: string; externalActionId: string }[];
}

export interface SubmitTxnInput {
  applicantId: string;
  clientTxnId: string;
  type: 'finance' | 'travelRule';
  direction: 'in' | 'out';
  amount: number;
  currencyCode: string;
  currencyType: 'fiat' | 'crypto';
  counterparty?: { fullName?: string; accountId?: string };
  orderId?: string;                      // 串多腿（兑换用 swapNo）
  props?: Record<string, string>;         // 域判别器：{ txType: 'exchange' }
  infoType?: string;                      // info.type 分类串
}

export interface SumsubTxnClient {
  submitTxn(input: SubmitTxnInput): Promise<{ txnId: string; scoringResult?: SumsubScoringResult }>;
  // 其余方法签名不变
}
```

`sumsub-txn-client.mock.ts` 追加：

```ts
  private readonly submitFullResults = new Map<string, { txnId: string; scoringResult?: SumsubScoringResult }>();

  primeSubmitResult(clientTxnId: string, result: { txnId: string; scoringResult?: SumsubScoringResult }): void {
    this.submitFullResults.set(clientTxnId, result);
  }

  async submitTxn(input: SubmitTxnInput): Promise<{ txnId: string; scoringResult?: SumsubScoringResult }> {
    const full = this.submitFullResults.get(input.clientTxnId);
    if (full) return full;
    const txnId =
      this.submitResults.get(input.clientTxnId) ?? MockSumsubTxnClient.fallbackTxnId(input.clientTxnId);
    return { txnId };
  }
```

`sumsub-txn-client.http.ts` 的 `submitTxn`：payload 里带上 `orderId`、`props`、`info.type`（来自 `infoType`），并从响应 `scoringResult` 映射出 `action` / `score` / `matchedRuleNames`（取 `matchedRules[].name`）/ `applicantActions`。

- [ ] **Step 4: 跑测试 + 充值提现回归**

Run: `npx jest src/modules/deposit-sumsub src/modules/withdraw-sumsub`
Expected: PASS（新用例通过，两域既有用例零回归）

- [ ] **Step 5: Commit**

```bash
git add src/modules/deposit-sumsub/
git commit -m "feat(sumsub): SubmitTxnInput 补 orderId/props/infoType，返回值补 scoringResult"
```

---

## Task 4: `executeSwap` 劈成 `initiateSwap` —— 建单落 COMPLIANCE_PENDING + 提交卖出腿

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:188-361`
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`

**Interfaces:**
- Produces: `initiateSwap(ownerId: string, quoteId: string): Promise<SwapTransaction>` 返回 `COMPLIANCE_PENDING` 的 swap；`submitSumsubTxnOut(swapId: string): Promise<void>`
- Consumes: Task 2 的 `SwapTransactionStatus.COMPLIANCE_PENDING`；Task 3 的 `SubmitTxnInput.props/orderId/infoType`

- [ ] **Step 1: 写失败测试**

```ts
it('initiateSwap 消费 quote、建单为 COMPLIANCE_PENDING、不建任何腿', async () => {
  const swap = await service.initiateSwap('cust-1', 'quote-1');
  expect(swap.status).toBe('COMPLIANCE_PENDING');
  expect(swapQuoteService.consumeQuote).toHaveBeenCalledTimes(1);
  expect(createLegSpy).not.toHaveBeenCalled();
  expect(accountingService.executePendingTransfer).not.toHaveBeenCalled();
});

it('submitSumsubTxnOut 提交卖出腿并回写 sumsubTxnIdOut', async () => {
  await service.submitSumsubTxnOut('s1');
  const arg = sumsubTxnClient.submitTxn.mock.calls[0][0];
  expect(arg).toMatchObject({
    type: 'finance', direction: 'out', currencyCode: 'USDT',
    orderId: 'SWP-001', props: { txType: 'exchange' }, infoType: 'exchange',
  });
  expect(prisma.swapTransaction.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ sumsubTxnIdOut: expect.any(String) }) }),
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t initiateSwap`
Expected: FAIL — `service.initiateSwap is not a function`

- [ ] **Step 3: 改造 executeSwap**

把 `executeSwap` 重命名为 `initiateSwap`，事务内保留到建单为止，删掉建腿段：

- `:277` 的 `swapTransactionsService.create({...})` 增加 `status: SwapTransactionStatus.COMPLIANCE_PENDING`（原先隐式 PROCESSING）
- 删除 `:334` 的 `await this.createLeg(swap, legSpecs[0]!, ctx, 1, 1, traceId, tx)` 及其所需的 `legSpecs` 计算（移到 Task 6 的 `onKytApproved`）
- 事务提交后追加：

```ts
    await this.submitSumsubTxnOut(swap.id);
    return swap;
```

新增私有方法：

```ts
  async submitSumsubTxnOut(swapId: string): Promise<void> {
    const swap = await this.prisma.swapTransaction.findUnique({
      where: { id: swapId },
      include: { customer: true, fromAsset: true },
    });
    if (!swap) throw new NotFoundException(`Swap not found: ${swapId}`);
    if (swap.sumsubTxnIdOut) return;                       // 幂等：看门狗重试安全

    const res = await this.sumsubTxnClient.submitTxn({
      applicantId: swap.customer?.sumsubApplicantId ?? '',
      clientTxnId: `${swap.swapNo}-OUT`,
      type: 'finance',
      direction: 'out',
      amount: Number(swap.fromAmount),
      currencyCode: swap.fromAsset.currency,
      currencyType: swap.fromAsset.type === 'CRYPTO' ? 'crypto' : 'fiat',
      orderId: swap.swapNo ?? undefined,
      props: { txType: 'exchange' },
      infoType: 'exchange',
    });

    await this.prisma.swapTransaction.update({
      where: { id: swapId },
      data: {
        sumsubTxnIdOut: res.txnId,
        // 同步响应只作证据快照，绝不写 status —— 状态唯一写入口是 webhook handler
        complianceAction: res.scoringResult?.action ?? null,
        complianceRuleNames: res.scoringResult?.matchedRuleNames?.join(',') ?? null,
      },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.SWAP_KYT_SUBMITTED,
      entityType: AuditEntityTypes.SWAP_TRANSACTION,
      entityId: swap.id,
      entityNo: swap.swapNo || undefined,
      result: AuditResult.SUCCESS,
      reason: 'Swap sell-leg submitted to Sumsub KYT',
      metadata: { sumsubTxnId: res.txnId, scoringAction: res.scoringResult?.action },
    });
  }
```

⚠️ 控制器调用点（`swap-transactions.controller.ts` / customer controller）里的 `executeSwap` 全部改名为 `initiateSwap`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/trading/swap-transactions/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/swap-transactions/
git commit -m "feat(swap): executeSwap → initiateSwap，建单落 COMPLIANCE_PENDING 并提交卖出腿"
```

---

## Task 5: swap-sumsub 模块 —— webhook router + verdict handler + 三级联注册

**Files:**
- Create: `src/modules/swap-sumsub/swap-sumsub.module.ts`
- Create: `src/modules/swap-sumsub/swap-webhook.router.ts`
- Create: `src/modules/swap-sumsub/swap-kyt-verdict.handler.ts`
- Create: `src/modules/swap-sumsub/swap-kyt-verdict.handler.spec.ts`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:135-140`

**Interfaces:**
- Produces: `SwapWebhookRouter.route(payload): Promise<boolean>`；`SwapKytVerdictHandler.handle(payload): Promise<boolean>`
- Consumes: Task 2 的 `findBySumsubTxnId`；Task 6 的 `applyKytVerdict`（本任务先定义调用契约，Task 6 实现）

- [ ] **Step 1: 写失败测试**

```ts
describe('SwapKytVerdictHandler', () => {
  it('Approved → 调 applyKytVerdict(verdict=approved)', async () => {
    swapService.findBySumsubTxnId.mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' });
    const hit = await handler.handle({ type: 'applicantKytTxnApproved', txnId: 'T1' });
    expect(hit).toBe(true);
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith('s1', expect.objectContaining({ verdict: 'approved' }));
  });

  it('onHold / awaitingUser 一律归一为 rejected（兑换无“等”的语义）', async () => {
    swapService.findBySumsubTxnId.mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' });
    await handler.handle({ type: 'applicantKytOnHold', txnId: 'T1' });
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith('s1', expect.objectContaining({ verdict: 'rejected' }));
  });

  it('Reviewed / Created 不推进状态机', async () => {
    swapService.findBySumsubTxnId.mockResolvedValue({ id: 's1', status: 'COMPLIANCE_PENDING' });
    await handler.handle({ type: 'applicantKytTxnReviewed', txnId: 'T1' });
    expect(workflow.applyKytVerdict).not.toHaveBeenCalled();
  });

  it('认领不到 swap → 返回 false 让级联继续', async () => {
    swapService.findBySumsubTxnId.mockResolvedValue(null);
    expect(await handler.handle({ type: 'applicantKytTxnApproved', txnId: 'ZZZ' })).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/swap-sumsub/`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 handler + router**

```ts
// swap-kyt-verdict.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import { SUMSUB_TXN_CLIENT, SumsubTxnClient } from '../deposit-sumsub/sumsub-txn-client.interface';

// 兑换无「等」的语义：onHold/awaitingUser 与 rejected 同处置（本次不成交）
const VERDICT_BY_TYPE: Record<string, 'approved' | 'rejected' | 'ignore'> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'rejected',
  applicantKytOnHold: 'rejected',
  applicantKytTxnReviewed: 'ignore',
  applicantKytTxnCreated: 'ignore',
};

@Injectable()
export class SwapKytVerdictHandler {
  private readonly logger = new Logger(SwapKytVerdictHandler.name);

  constructor(
    private readonly swapService: SwapTransactionsService,
    private readonly workflow: SwapWorkflowService,
    @Inject(SUMSUB_TXN_CLIENT) private readonly sumsubTxnClient: SumsubTxnClient,
  ) {}

  async handle(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');
    const kytTxnId = String(payload.txnId ?? '');
    const swap = await this.swapService.findBySumsubTxnId(kytTxnId);
    if (!swap) {
      this.logger.warn(`orphan KYT verdict webhook, no swap for kytTxnId=${kytTxnId}`);
      return false;
    }
    const verdict = VERDICT_BY_TYPE[type];
    if (!verdict || verdict === 'ignore') return true;   // 认领了但不推进

    let detailRaw: unknown;
    let applicantActions: { applicantActionId: string; externalActionId: string }[] = [];
    let typedTags: string[] = [];
    if (verdict === 'rejected') {
      const detail = await this.sumsubTxnClient.getTxn(kytTxnId);
      detailRaw = detail.raw;
      applicantActions = (detail as any).applicantActions ?? [];
      typedTags = (detail.typedTags ?? []).map((t: any) => String(t.label ?? t));
    }

    await this.workflow.applyKytVerdict(swap.id, { verdict, detailRaw, applicantActions, typedTags });
    return true;
  }
}
```

```ts
// swap-webhook.router.ts
@Injectable()
export class SwapWebhookRouter {
  private readonly logger = new Logger(SwapWebhookRouter.name);
  constructor(private readonly kytVerdictHandler: SwapKytVerdictHandler) {}

  async route(payload: Record<string, unknown>): Promise<boolean> {
    const type = String(payload.type ?? '');
    if (KYT_VERDICT_TYPES.has(type)) return await this.kytVerdictHandler.handle(payload);
    this.logger.warn(`orphan swap sumsub webhook type: ${type}`);
    return false;
  }
}
```

- [ ] **Step 4: 接进 ingestion 三级联**

`sumsub-ingestion.service.ts` 现有两级级联（deposit → withdraw），追加第三级：

```ts
        const depositHit = await this.depositWebhookRouter.route(payload);
        let withdrawHit = false;
        let swapHit = false;
        if (!depositHit) {
          withdrawHit = await this.withdrawWebhookRouter.route(payload);
          if (!withdrawHit) {
            swapHit = await this.swapWebhookRouter.route(payload);
          }
        }
```

并在构造函数注入 `private readonly swapWebhookRouter: SwapWebhookRouter`，`SumsubIngestionModule` 的 `imports` 追加 `forwardRef(() => SwapSumsubModule)`。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest src/modules/swap-sumsub/ src/modules/sumsub-ingestion/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/swap-sumsub/ src/modules/sumsub-ingestion/
git commit -m "feat(swap-sumsub): webhook router + KYT verdict handler + ingestion 三级联"
```

---

## Task 6: `applyKytVerdict` —— 放行走 PROCESSING，拒绝走 REJECTED

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`

**Interfaces:**
- Produces: `applyKytVerdict(swapId: string, input: { verdict: 'approved'|'rejected'; detailRaw?: unknown; applicantActions?: {applicantActionId: string; externalActionId: string}[]; typedTags?: string[] }): Promise<void>`
- Consumes: Task 2 `markStatus`/枚举；Task 4 建单产物；Task 1 `CustomerRestrictionsService`

- [ ] **Step 1: 写失败测试**

```ts
it('approved → PROCESSING + 建 leg1 + 补提买入腿', async () => {
  await service.applyKytVerdict('s1', { verdict: 'approved' });
  expect(markStatusSpy).toHaveBeenCalledWith('s1', SwapTransactionAction.KYT_APPROVED, expect.anything(), undefined);
  expect(createLegSpy).toHaveBeenCalledTimes(1);
  expect(sumsubTxnClient.submitTxn).toHaveBeenCalledWith(expect.objectContaining({ direction: 'in' }));
});

it('rejected → REJECTED 且 TB 零痕迹', async () => {
  await service.applyKytVerdict('s1', { verdict: 'rejected', applicantActions: [] });
  expect(markStatusSpy).toHaveBeenCalledWith('s1', SwapTransactionAction.KYT_REJECTED, expect.anything(),
    { rejectReason: 'KYT_REJECTED' });
  expect(accountingService.executePendingTransfer).not.toHaveBeenCalled();
  expect(accountingService.voidPendingTransfer).not.toHaveBeenCalled();
  expect(createLegSpy).not.toHaveBeenCalled();
});

it('已终态 → no-op（幂等抗 webhook 重投）', async () => {
  swapService.findOneInternal.mockResolvedValue({ id: 's1', status: 'REJECTED' });
  await service.applyKytVerdict('s1', { verdict: 'approved' });
  expect(markStatusSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t applyKytVerdict`
Expected: FAIL — `service.applyKytVerdict is not a function`

- [ ] **Step 3: 实现**

```ts
  private static readonly VERDICT_TERMINAL_STATUSES = new Set([
    SwapTransactionStatus.SUCCESS, SwapTransactionStatus.REJECTED,
    SwapTransactionStatus.FAILED, SwapTransactionStatus.REVERSED,
  ]);

  async applyKytVerdict(
    swapId: string,
    input: {
      verdict: 'approved' | 'rejected';
      detailRaw?: unknown;
      applicantActions?: { applicantActionId: string; externalActionId: string }[];
      typedTags?: string[];
    },
  ): Promise<void> {
    const swap = await this.swapTransactionsService.findOneInternal(swapId);
    if (SwapWorkflowService.VERDICT_TERMINAL_STATUSES.has(swap.status as SwapTransactionStatus)) {
      this.logger.debug(`applyKytVerdict no-op: swap ${swapId} already terminal (${swap.status})`);
      return;
    }

    await this.prisma.swapTransaction.update({
      where: { id: swapId },
      data: {
        complianceVerdict: input.verdict,
        sumsubDetailJson: input.detailRaw ? JSON.stringify(input.detailRaw) : undefined,
      },
    });

    if (input.verdict === 'approved') {
      await this.prisma.$transaction(async (tx) => {
        await this.swapTransactionsService.markStatus(swapId, SwapTransactionAction.KYT_APPROVED, tx);
        const ctx = await this.buildLegContext(swap, tx);
        const legSpecs = buildSwapLegPlan(ctx);
        await this.createLeg(swap, legSpecs[0]!, ctx, 1, 1, swap.traceId ?? undefined, tx);
      });
      await this.submitSumsubTxnIn(swapId);          // fire-and-forget，失败不阻断
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.swapTransactionsService.markStatus(swapId, SwapTransactionAction.KYT_REJECTED, tx, {
        rejectReason: 'KYT_REJECTED',
      });
    });
    await this.handleRejectDisposition(swap, input);   // Task 7 实现
  }

  private async submitSumsubTxnIn(swapId: string): Promise<void> {
    try {
      const swap = await this.prisma.swapTransaction.findUnique({
        where: { id: swapId }, include: { customer: true, toAsset: true },
      });
      if (!swap || swap.sumsubTxnIdIn) return;
      const res = await this.sumsubTxnClient.submitTxn({
        applicantId: swap.customer?.sumsubApplicantId ?? '',
        clientTxnId: `${swap.swapNo}-IN`,
        type: 'finance', direction: 'in',
        amount: Number(swap.netToAmount ?? swap.toAmount),
        currencyCode: swap.toAsset.currency,
        currencyType: swap.toAsset.type === 'CRYPTO' ? 'crypto' : 'fiat',
        orderId: swap.swapNo ?? undefined,
        props: { txType: 'exchange' },
        infoType: 'exchange',
      });
      await this.prisma.swapTransaction.update({
        where: { id: swapId }, data: { sumsubTxnIdIn: res.txnId },
      });
    } catch (err) {
      // 买入腿是纯数据腿，不承载裁决 —— 失败只告警，绝不回滚已成交的兑换
      this.logger.error(`buy-leg KYT submit failed for swap ${swapId}: ${String(err)}`);
    }
  }
```

⚠️ `buildLegContext` 是把原 `executeSwap` 事务内计算 `ctx`/`legSpecs` 的那段抽出的私有方法，从 Task 4 删掉的代码原样移来，签名 `private async buildLegContext(swap, tx): Promise<SwapLegContext>`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/trading/swap-transactions/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/swap-transactions/
git commit -m "feat(swap): applyKytVerdict —— approved 走四腿，rejected 零记账终态"
```

---

## Task 7: 拒绝侧处置 —— 软硬线分型 + restrictions 写入 + pendingAction 读面

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（`handleRejectDisposition`）
- Create: `src/modules/identity/customers/customer-pending-action.service.ts`
- Modify: `src/modules/identity/customers/customers.controller.ts`（客户端 `GET /client/me/pending-action`）
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`

**Interfaces:**
- Produces: `handleRejectDisposition(swap, input): Promise<void>`；`CustomerPendingActionService.get(customerId): Promise<{ externalActionId: string; reason: string } | null>`
- Consumes: Task 1 `CustomerRestrictionsService.add`

- [ ] **Step 1: 写失败测试**

```ts
it('软线（有 applicantActions）→ 写 restrictions + 存 actionId，pendingAction 可见', async () => {
  await service.applyKytVerdict('s1', {
    verdict: 'rejected',
    applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
  });
  expect(restrictionsService.add).toHaveBeenCalledWith('cust-1', ['SWAP', 'WITHDRAW'], 'KYT_REJECTED', 'system');
  expect(await pendingActionService.get('cust-1')).toEqual({ externalActionId: 'EA1', reason: 'KYT_REJECTED' });
});

it('硬线（SANCTION tag）→ 写 restrictions 但 pendingAction 为 null（tipping-off）', async () => {
  await service.applyKytVerdict('s1', {
    verdict: 'rejected',
    applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
    typedTags: ['SANCTION'],
  });
  expect(restrictionsService.add).toHaveBeenCalled();
  expect(await pendingActionService.get('cust-1')).toBeNull();
});

it('硬线（无 actions）→ 写 restrictions，pendingAction 为 null', async () => {
  await service.applyKytVerdict('s1', { verdict: 'rejected', applicantActions: [] });
  expect(await pendingActionService.get('cust-1')).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t 软线`
Expected: FAIL — `handleRejectDisposition` 未实现

- [ ] **Step 3: 实现分型**

```ts
  private async handleRejectDisposition(
    swap: { id: string; ownerId: string; swapNo: string | null },
    input: { applicantActions?: { applicantActionId: string; externalActionId: string }[]; typedTags?: string[] },
  ): Promise<void> {
    // 收紧方向、免事前审批：无论软硬线都先限制
    await this.customerRestrictionsService.add(swap.ownerId, ['SWAP', 'WITHDRAW'], 'KYT_REJECTED', 'system');

    const hasSanction = (input.typedTags ?? []).includes('SANCTION');
    const actions = input.applicantActions ?? [];

    // tipping-off 线：制裁调查不得提示客户；仅「有 action 可做」的软线才暴露入口
    const exposeToCustomer = actions.length > 0 && !hasSanction;

    await this.prisma.customerMain.update({
      where: { id: swap.ownerId },
      data: {
        pendingActionExternalId: exposeToCustomer ? actions[0]!.externalActionId : null,
        pendingActionReason: exposeToCustomer ? 'KYT_REJECTED' : null,
      },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.SWAP_KYT_REJECTED_DISPOSED,
      entityType: AuditEntityTypes.SWAP_TRANSACTION,
      entityId: swap.id,
      entityNo: swap.swapNo || undefined,
      result: AuditResult.SUCCESS,
      reason: hasSanction ? 'Sanction hit — customer not notified' : 'Restricted; action exposed to customer',
      metadata: { hasSanction, actionCount: actions.length, exposeToCustomer },
    });
  }
```

`schema.prisma` 的 `CustomerMain` 追加两字段并迁移：

```prisma
  pendingActionExternalId String? @map("pending_action_external_id")
  pendingActionReason     String? @map("pending_action_reason")
```

```bash
npx prisma migrate dev --name customer_pending_action
npm run prisma:generate
```

客户端读面（`customers.controller.ts`）：

```ts
  @Get('client/me/pending-action')
  @UseGuards(JwtAuthGuard)
  async getPendingAction(@Req() req: any) {
    return await this.pendingActionService.get(req.user.customerId);
  }
```

`CustomerPendingActionService.get` 直接返回上面两字段拼的对象或 `null`——**tipping-off 判断已在写入侧完成，读面不再判断**。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/trading/swap-transactions/ src/modules/identity/customers/`
Expected: PASS

- [ ] **Step 5: 登记 RBAC + 同步 + 重启**

```bash
npm run db:base:sync
```
（新增的是客户端端点，走 `JwtAuthGuard` 不进 admin RBAC catalog；若后续加 admin 侧查看端点须在 `rbac.catalog.ts` 登记并重启后端）

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/modules/trading/swap-transactions/ src/modules/identity/customers/
git commit -m "feat(swap): 拒绝侧软硬线分型 —— restrictions 写入 + tipping-off 收在后端"
```

---

## Task 8: 合规超时看门狗

**Files:**
- Create: `src/modules/swap-sumsub/swap-sla.service.ts`
- Create: `src/modules/swap-sumsub/swap-sla.service.spec.ts`
- Modify: `src/modules/swap-sumsub/swap-sumsub.module.ts`

**Interfaces:**
- Produces: `SwapSlaService.sweep(): Promise<{ timedOut: number; resubmitted: number }>`
- Consumes: Task 2 `markStatus` + `SLA_BREACH`；Task 4 `submitSumsubTxnOut`

- [ ] **Step 1: 写失败测试**

```ts
it('超过合规超时的 COMPLIANCE_PENDING 单 → REJECTED(TIMEOUT)', async () => {
  prisma.swapTransaction.findMany.mockResolvedValue([
    { id: 's1', status: 'COMPLIANCE_PENDING', sumsubTxnIdOut: 'T1',
      createdAt: new Date(Date.now() - 120_000) },
  ]);
  const r = await service.sweep();
  expect(r.timedOut).toBe(1);
  expect(markStatusSpy).toHaveBeenCalledWith('s1', SwapTransactionAction.SLA_BREACH, expect.anything(),
    { rejectReason: 'TIMEOUT' });
});

it('已建单但未提交（sumsubTxnIdOut 为空）→ 重试提交而非判超时', async () => {
  prisma.swapTransaction.findMany.mockResolvedValue([
    { id: 's2', status: 'COMPLIANCE_PENDING', sumsubTxnIdOut: null,
      createdAt: new Date(Date.now() - 120_000) },
  ]);
  const r = await service.sweep();
  expect(r.resubmitted).toBe(1);
  expect(r.timedOut).toBe(0);
  expect(workflow.submitSumsubTxnOut).toHaveBeenCalledWith('s2');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/swap-sumsub/swap-sla.service.spec.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

```ts
export const SWAP_COMPLIANCE_TIMEOUT_MS = 60_000;   // 独立时钟，不复用 quote TTL

@Injectable()
export class SwapSlaService {
  private readonly logger = new Logger(SwapSlaService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly swapService: SwapTransactionsService,
    private readonly workflow: SwapWorkflowService,
  ) {}

  @Cron('*/30 * * * * *')
  async handleCron() { await this.sweep(); }

  async sweep(): Promise<{ timedOut: number; resubmitted: number }> {
    const cutoff = new Date(Date.now() - SWAP_COMPLIANCE_TIMEOUT_MS);
    const stale = await this.prisma.swapTransaction.findMany({
      where: { status: SwapTransactionStatus.COMPLIANCE_PENDING, createdAt: { lt: cutoff } },
    });

    let timedOut = 0;
    let resubmitted = 0;
    for (const swap of stale) {
      if (!swap.sumsubTxnIdOut) {
        // 单已存在、quote 已消费，但提交没成功 —— 重试提交，别浪费 quote
        await this.workflow.submitSumsubTxnOut(swap.id);
        resubmitted += 1;
        continue;
      }
      await this.prisma.$transaction(async (tx) => {
        await this.swapService.markStatus(swap.id, SwapTransactionAction.SLA_BREACH, tx, {
          rejectReason: 'TIMEOUT',
        });
      });
      timedOut += 1;
    }
    if (timedOut || resubmitted) {
      this.logger.log(`swap SLA sweep: timedOut=${timedOut} resubmitted=${resubmitted}`);
    }
    return { timedOut, resubmitted };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/swap-sumsub/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/swap-sumsub/
git commit -m "feat(swap-sumsub): 合规超时看门狗 —— 超时判死 + 漏提交重试"
```

---

## Task 9: 模拟层 —— verdict buttons + demo scenario + admin 端点

**Files:**
- Create: `src/modules/swap-sumsub/fixtures/verdict-buttons.ts`
- Create: `src/modules/swap-sumsub/demo-scenario.service.ts`
- Create: `src/modules/swap-sumsub/admin-swap-demo.controller.ts`
- Test: `src/modules/swap-sumsub/demo-scenario.service.spec.ts`
- Modify: `src/modules/swap-sumsub/swap-sumsub.module.ts`、`src/modules/identity/access-control/rbac.catalog.ts`

**Interfaces:**
- Produces: `SWAP_VERDICT_BUTTONS: Record<string, {key,label,webhookType,verdict}>`；`SwapDemoScenarioService.runVerdict(swapId, buttonKey, actor)`
- Consumes: Task 3 `MockSumsubTxnClient.primeTxn`；Task 5 `SumsubIngestionService.ingest`

- [ ] **Step 1: 写失败测试**

```ts
it('喂 V2_REJECTED_HARD → swap 落 REJECTED 且零记账调用', async () => {
  const r = await service.runVerdict('s1', 'V2_REJECTED_HARD', actor);
  expect(r.statusAfter).toBe('REJECTED');
  expect(accountingService.executePendingTransfer).not.toHaveBeenCalled();
});

it('未知 buttonKey 抛 BadRequest 并列出合法键', async () => {
  await expect(service.runVerdict('s1', 'NOPE', actor)).rejects.toThrow(/Valid keys/);
});

it('非 mock client 时拒绝运行（生产安全闸）', async () => {
  const svc = new SwapDemoScenarioService(swapService, ingestion, audit, httpClient as any);
  await expect(svc.runVerdict('s1', 'V1_APPROVED', actor)).rejects.toThrow(/SUMSUB_MOCK_MODE/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/swap-sumsub/demo-scenario.service.spec.ts`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 实现八键**

```ts
// fixtures/verdict-buttons.ts
const TAG = (label: string) => ({ label, type: 'userDefined' as const });

export const SWAP_VERDICT_BUTTONS: Record<string, SwapVerdictButton> = {
  V1_APPROVED:        { key: 'V1_APPROVED',        label: '① Approved',
    webhookType: 'applicantKytTxnApproved', verdict: { reviewAnswer: 'GREEN', score: 10 } },
  V2_REJECTED_HARD:   { key: 'V2_REJECTED_HARD',   label: '② Rejected · 硬线（无 action）',
    webhookType: 'applicantKytTxnRejected', verdict: { reviewAnswer: 'RED', score: 90, applicantActions: [] } },
  V3_REJECTED_ACTION: { key: 'V3_REJECTED_ACTION', label: '③ Rejected · 软线（下发认证）',
    webhookType: 'applicantKytTxnRejected',
    verdict: { reviewAnswer: 'RED', score: 60,
      applicantActions: [{ applicantActionId: 'demo-action-1', externalActionId: 'demo-ext-1' }] } },
  V4_REJECTED_SANCTION: { key: 'V4_REJECTED_SANCTION', label: '④ Rejected · Sanctions',
    webhookType: 'applicantKytTxnRejected',
    verdict: { reviewAnswer: 'RED', score: 100, typedTags: [TAG('SANCTION')],
      applicantActions: [{ applicantActionId: 'demo-action-2', externalActionId: 'demo-ext-2' }] } },
  V5_ONHOLD:          { key: 'V5_ONHOLD',          label: '⑤ On hold（我方等同拒绝）',
    webhookType: 'applicantKytOnHold', verdict: { reviewAnswer: null, score: 50 } },
  V6_AWAIT_USER:      { key: 'V6_AWAIT_USER',      label: '⑥ Awaiting user（我方等同拒绝）',
    webhookType: 'applicantKytTxnAwaitingUser',
    verdict: { reviewAnswer: null, score: 40,
      applicantActions: [{ applicantActionId: 'demo-action-3', externalActionId: 'demo-ext-3' }] } },
  V7_ACTION_GREEN:    { key: 'V7_ACTION_GREEN',    label: '⑦ 认证通过（清限制）',
    webhookType: 'applicantActionReviewed', verdict: { reviewAnswer: 'GREEN' } },
  V8_ACTION_RED:      { key: 'V8_ACTION_RED',      label: '⑧ 认证不通过（升级）',
    webhookType: 'applicantActionReviewed', verdict: { reviewAnswer: 'RED' } },
};
```

`demo-scenario.service.ts` 照 `withdraw-sumsub/demo-scenario.service.ts` 结构 fork：取 swap → 铸 txnId（`swap.sumsubTxnIdOut ?? mint`）→ `primeTxn` → `ingestionService.ingest(payload, { isSimulated: true })` → 回读状态 → 写审计 `SWAP_DEMO_SCENARIO_RUN`。

`admin-swap-demo.controller.ts`：

```ts
@Controller('admin/swap-sumsub/demo')
export class AdminSwapDemoController {
  constructor(private readonly demo: SwapDemoScenarioService) {}

  @Post('run-verdict')
  @RequirePermissions('SWAP_TRANSACTION_READ')
  async runVerdict(@Body() body: { swapId: string; verdict: string }, @Req() req: any) {
    return await this.demo.runVerdict(body.swapId, body.verdict, {
      actorId: req.user.id, actorNo: req.user.userNo,
    });
  }
}
```

模块条件化注册（生产环境该 controller 压根不存在）：

```ts
const SUMSUB_MOCK_MODE = process.env.SUMSUB_MOCK_MODE === 'true';
@Module({ controllers: SUMSUB_MOCK_MODE ? [AdminSwapDemoController] : [], ... })
```

- [ ] **Step 4: 登记 RBAC 路由**

`rbac.catalog.ts` 追加（照 withdraw demo 端点的写法，注明只在 mock mode 注册）：

```ts
  route('POST', '/admin/swap-sumsub/demo/run-verdict', 'SWAP_TRANSACTION_READ'),
```

```bash
npm run db:base:sync
```
然后**重启后端**（SUPER_ADMIN 走内存 RBAC 定义，只 seed 不重启无效）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest src/modules/swap-sumsub/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/swap-sumsub/ src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(swap-sumsub): 八键模拟层 + demo 端点（mock mode 条件化注册）"
```

---

## Task 10: admin 详情页 —— Sumsub 区块 + ⚡ Simulation 面板

**Files:**
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`
- Modify: `admin-web/src/utils/swapStatusMap.ts`（若不存在则创建）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.controller.ts`（admin 详情返回 `sumsubDetail`）

**Interfaces:**
- Consumes: Task 2 字段、Task 9 `POST /admin/swap-sumsub/demo/run-verdict`

- [ ] **Step 1: 后端详情补字段**

admin 详情端点返回体追加：

```ts
      sumsubDetail: {
        txnIdOut: swap.sumsubTxnIdOut,
        txnIdIn: swap.sumsubTxnIdIn,
        verdict: swap.complianceVerdict,
        scoringAction: swap.complianceAction,
        matchedRules: swap.complianceRuleNames ? swap.complianceRuleNames.split(',') : [],
        rejectReason: swap.rejectReason,
        raw: swap.sumsubDetailJson ? JSON.parse(swap.sumsubDetailJson) : null,
      },
```

- [ ] **Step 2: 状态映射表加两个新状态**

```ts
// swapStatusMap.ts
export const SWAP_STATUS_META: Record<string, { label: string; tone: string }> = {
  COMPLIANCE_PENDING: { label: 'Compliance Pending', tone: 'warning' },
  PROCESSING:         { label: 'Processing',         tone: 'info' },
  SUCCESS:            { label: 'Success',            tone: 'success' },
  REJECTED:           { label: 'Rejected',           tone: 'danger' },
};
export const isSwapTerminalStatus = (s: string) => s === 'SUCCESS' || s === 'REJECTED';
```

- [ ] **Step 3: 详情页加区块**

在 `SwapTransactionDetail.tsx` 现有区块后追加「Sumsub Detail」只读区块（渲染上面 6 个字段 + 命中规则列表），以及 ⚡ Simulation 面板：仅当 `status === 'COMPLIANCE_PENDING'` 时渲染八个按钮，点击调 `POST /admin/swap-sumsub/demo/run-verdict`，成功后 `refetch()`。

- [ ] **Step 4: 渲染验证（不能只靠 tsc）**

```bash
bash scripts/stack.sh up
```
用 seed admin（`admin@fiatx.com` / `123456`）登录 admin，造一笔兑换到 `COMPLIANCE_PENDING`，**截图**详情页确认：状态徽章、Sumsub Detail 区块、⚡ 面板八按钮均正确渲染；点 ① 后状态变 PROCESSING、面板消失。

- [ ] **Step 5: Commit**

```bash
git add admin-web/src src/modules/trading/swap-transactions/swap-transactions.controller.ts
git commit -m "feat(admin): 兑换详情页 Sumsub 区块 + ⚡ Simulation 面板"
```

---

## Task 11: 客户端 —— 四态展示 + 认证 banner

**Files:**
- Modify: `client-web/src/pages/Swap.tsx`
- Create: `client-web/src/utils/swapStatusView.ts`
- Create: `client-web/src/components/PendingActionBanner.tsx`

**Interfaces:**
- Consumes: Task 7 `GET /client/me/pending-action`；Task 4 `initiateSwap` 返回 COMPLIANCE_PENDING

- [ ] **Step 1: 客户视角状态映射**

```ts
// swapStatusView.ts —— 客户看到的措辞，不暴露调查性字眼
export const getSwapStatusView = (status: string): { text: string; tone: string } => {
  switch (status) {
    case 'COMPLIANCE_PENDING': return { text: 'Processing',  tone: 'pending' };
    case 'PROCESSING':         return { text: 'Processing',  tone: 'pending' };
    case 'SUCCESS':            return { text: 'Completed',   tone: 'success' };
    case 'REJECTED':           return { text: 'Unsuccessful', tone: 'failed' };
    default:                   return { text: 'Processing',  tone: 'pending' };
  }
};
```

⚠️ `COMPLIANCE_PENDING` 与 `PROCESSING` 对客户**同为 Processing**——不暴露"正在被合规审查"。

- [ ] **Step 2: 提交后改为等待态**

`Swap.tsx` 提交处理：原先假定返回即成交，改为拿到 `COMPLIANCE_PENDING` 后进入轮询（每 2s，上限 90s），直到状态变 `SUCCESS`/`REJECTED` 或超时后提示"仍在处理，请稍后在记录中查看"。

- [ ] **Step 3: banner 组件**

```tsx
export function PendingActionBanner() {
  const { data } = useQuery(['pending-action'], () => api.get('/client/me/pending-action').then(r => r.data));
  if (!data) return null;                       // 后端已做 tipping-off 判断，前端不推导
  return (
    <div className="banner banner--warning">
      <span>Additional verification is required before you can continue trading.</span>
      <button onClick={() => startWebSdk(data.externalActionId)}>Complete verification</button>
    </div>
  );
}
```

挂载到 Swap 页右侧详情窗顶部。`startWebSdk` 复用 onboarding 既有 WebSDK 集成（后端换 access token 时带 `externalActionId` + `userId`）。

- [ ] **Step 4: 渲染验证 + 截图**

跑 self 栈，用 seed 客户走一遍：发起兑换 → admin 侧喂 ③ 软线 → 客户端确认状态变 Unsuccessful **且** banner 出现；再喂 ④ 制裁线 → 确认 **banner 不出现**（tipping-off）。两种情形各截一张图。

- [ ] **Step 5: Commit**

```bash
git add client-web/src
git commit -m "feat(client): 兑换四态展示 + 认证 banner（tipping-off 由后端裁定）"
```

---

## Task 12: e2e 收官 + truth 同步

**Files:**
- Create: `test/swap-sumsub-scenarios.e2e-spec.ts`
- Create: `test/swap-money-arc.e2e-spec.ts`
- **Modify: `scripts/demo-lib.ts:382`、`scripts/demo-fixtures.ts:316`、`scripts/verify-swap-self-heal.ts:40`、`scripts/verify-swap-redesign-happy.ts:48`**
  —— 这四处仍调用 Task 4 已删除的 `executeSwap`。它们在 `tsc` 的 `src/**` 范围外，编译通过但**运行时必炸**，
  且 `demo-lib.ts` 支撑 `demo:all` 闸门（可移植 Docker 交付靠它）。改名不够：`runSwaps` 断言"建单后 leg1 立即存在"，
  而该行为已随合规等待移除，须改为「initiateSwap → 喂 approved 裁决 → 再断言四腿」。
- Modify: `doc-final/reference/truth/v6-swap.md`
- Modify: `doc-final/BACKLOG.md`

- [ ] **Step 1: 写钱弧 e2e —— 核心断言是「零痕迹」**

```ts
it('KYT rejected 的兑换：TB 零痕迹、quote 已消费、客户余额分文未动', async () => {
  const before = await getClientBalances(customerId);
  const swap = await initiateSwapViaApi(customerId, quoteId);
  expect(swap.status).toBe('COMPLIANCE_PENDING');

  await feedVerdict(swap.id, 'V2_REJECTED_HARD');

  const after = await getSwap(swap.id);
  expect(after.status).toBe('REJECTED');
  expect(after.rejectReason).toBe('KYT_REJECTED');

  // 零记账痕迹 —— 本设计最重要的断言
  const fundsOrders = await getFundsOrdersBySwap(swap.id);
  expect(fundsOrders).toHaveLength(0);
  const flows = await getAccountFlowsByRef(swap.swapNo);
  expect(flows).toHaveLength(0);
  expect(await getClientBalances(customerId)).toEqual(before);

  // quote 已消费不可重用
  expect((await getQuote(quoteId)).status).toBe('USED');

  // 限制已写入，兑换与提现被拦，充值放行
  await expect(initiateSwapViaApi(customerId, newQuoteId)).rejects.toMatchObject({ status: 403 });
  await expect(createWithdrawViaApi(customerId)).rejects.toMatchObject({ status: 403 });
  await expect(createDepositSignal(customerId)).resolves.toBeTruthy();
});
```

- [ ] **Step 2: 写场景 e2e（八键全覆盖）**

逐键断言状态落点与副作用；⑦ 断言 `restrictions` 被清空且兑换恢复可发起；④ 断言 `pending-action` 端点返回 `null`。

- [ ] **Step 3: 跑全量硬闸**

```bash
npm run build
npx jest
npx jest --config ./test/jest-e2e.json
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self demo:all
```
Expected: build 通过；单测净新失败 0；两个新 e2e 全绿；`verify:coa` 输出 `ALL INVARIANTS PASS`；
**`demo:all` 8/8 PASS**（Task 4 改造后此闸门一度断裂，本任务须修复脚本使其恢复）

- [ ] **Step 4: 同步 truth**

`v6-swap.md` 整节改写：合规从「仅 L1」改为「L1 + webhook 驱动的 KYT 单闸」；状态机从 2 态可达改为 4 态；补 `initiateSwap`/`applyKytVerdict`/`submitSumsubTxnOut` 锚点；补 Sumsub 字段；刷新 `Last Verified`。

- [ ] **Step 5: 记 BACKLOG**

追加：
```
- [ ] **兑换 KYT 真接前必测**：规则自动裁决（无 officer 介入）是否自动发 applicantKytTxnApproved/Rejected webhook ——
      充值实测矩阵该格为空；不发则每笔兑换走超时死｜来源: 2026-08-13 兑换合规 spec §12
- [ ] **豁免位有效期**：poa/questionnaires 字段是否含提交时间戳待验；无时间戳则该档退回 tag + 我方管期限｜来源: 同上
- [ ] **兑换域规则清单与阈值**：另起规则目录文档，含排雷（含 rejected 计数 / 缺 .notRejected 的聚合规则会造成
      「被拒→加分→再被拒」死循环）｜来源: 同上 §7
```

- [ ] **Step 6: Commit**

```bash
git add test/ doc-final/
git commit -m "test(swap): 钱弧零痕迹 + 八场景 e2e；同步 truth 与 BACKLOG"
```

---

## Task 13: 人级 applicantActionReviewed 闭环（**须在 Task 11/12 之前执行**）

> **计划缺口补录（2026-08-13，Task 9 审查发现）**：spec §6 承诺「客户完成认证 → 清限制 → 恢复交易」的豁免闭环，
> 但原 12 个任务里**没有任何一个建它**。实测确认：`applicantActionReviewed` 不在 `KYT_VERDICT_TYPES` 里，
> ingestion 的通用分流只认 `MaterialRefreshCycle`（另一个域），`CustomerRestrictionsService.clear()` 至今零调用方。
> 后果：被限制的客户**永久锁死**，Task 9 的 V7 按钮标着「清限制」但什么也不清。

**Files:**
- Create: `src/modules/swap-sumsub/applicant-action.handler.ts`
- Create: `src/modules/swap-sumsub/applicant-action.handler.spec.ts`
- Modify: `src/modules/swap-sumsub/swap-webhook.router.ts`（认领 `applicantActionReviewed`）
- Modify: `src/modules/identity/customers/customer-pending-action.service.ts`（按 externalActionId 反查客户）

**Interfaces:**
- Produces: `SwapApplicantActionHandler.handle(payload): Promise<boolean>`；`CustomerPendingActionService.findByExternalActionId(externalActionId): Promise<CustomerMain | null>`
- Consumes: Task 1 `CustomerRestrictionsService.clear()`（至今零调用方，本任务是它的第一个）｜ Task 7 `hardLineDispositionedAt` sticky marker

**认领方式**：webhook 带 `externalActionId`；Task 7 已把它存在 `CustomerMain.pendingActionExternalId`。按该列反查客户即可认领；查不到返回 `false` 让级联继续（该 action 可能属于别的域）。

**⚠️ 硬线客户不得因完成某个 action 而解锁。** `hardLineDispositionedAt` 非空即制裁线——GREEN 也**只清 pendingAction 不清 restrictions**，并写审计说明为何未解锁。这是 Task 7 sticky marker 的存在意义，此处不得绕过。

- [ ] **Step 1: 写失败测试**

```ts
it('GREEN + 非硬线 → 清 SWAP/WITHDRAW 限制 + 清 pendingAction', async () => {
  pendingActionService.findByExternalActionId.mockResolvedValue({ id: 'c1', customerNo: 'C-001', hardLineDispositionedAt: null });
  expect(await handler.handle({ type: 'applicantActionReviewed', externalActionId: 'EA1',
    reviewResult: { reviewAnswer: 'GREEN' } })).toBe(true);
  expect(restrictions.clear).toHaveBeenCalledWith('c1', ['SWAP', 'WITHDRAW'], 'system');
  expect(pendingActionService.set).toHaveBeenCalledWith('c1', null, expect.anything());
});

it('GREEN + 硬线客户 → 【不】清限制，只清 pendingAction，并审计说明', async () => {
  pendingActionService.findByExternalActionId.mockResolvedValue({ id: 'c1', customerNo: 'C-001', hardLineDispositionedAt: new Date() });
  await handler.handle({ type: 'applicantActionReviewed', externalActionId: 'EA1', reviewResult: { reviewAnswer: 'GREEN' } });
  expect(restrictions.clear).not.toHaveBeenCalled();
  expect(audit.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
    action: AuditActions.SWAP_ACTION_GREEN_HARDLINE_HELD }), expect.anything());
});

it('RED → 限制保持 + needsReview 升级审计', async () => {
  pendingActionService.findByExternalActionId.mockResolvedValue({ id: 'c1', customerNo: 'C-001', hardLineDispositionedAt: null });
  await handler.handle({ type: 'applicantActionReviewed', externalActionId: 'EA1', reviewResult: { reviewAnswer: 'RED' } });
  expect(restrictions.clear).not.toHaveBeenCalled();
  expect(audit.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
    action: AuditActions.SWAP_ACTION_ESCALATED }), expect.anything());
});

it('认领不到客户 → 返回 false 让级联继续', async () => {
  pendingActionService.findByExternalActionId.mockResolvedValue(null);
  expect(await handler.handle({ type: 'applicantActionReviewed', externalActionId: 'ZZZ',
    reviewResult: { reviewAnswer: 'GREEN' } })).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/swap-sumsub/applicant-action.handler.spec.ts`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 handler + 反查 + 路由接线**

`findByExternalActionId` 按 `pendingActionExternalId` 唯一反查（该列需加 `@@index`，随迁移 `swap_pending_action_index`）。
handler 三分支按上面测试的语义实现；router 在 `KYT_VERDICT_TYPES` 判定之外增加 `applicantActionReviewed` 分支转本 handler。
新增审计常量 `SWAP_ACTION_CLEARED` / `SWAP_ACTION_GREEN_HARDLINE_HELD` / `SWAP_ACTION_ESCALATED`，参数取本文件较全的那种形状。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/swap-sumsub/ src/modules/identity/customers/`
Expected: PASS

- [ ] **Step 5: 摘掉 Task 9 的失效标注**

`fixtures/verdict-buttons.ts` 里 V7/V8 那两个「当前无人消费」的注释与 spec 说明改为生效描述；`demo-scenario.service.spec.ts` 里三条钉住缺口行为的测试改为钉住闭环行为。

- [ ] **Step 6: Commit**

```bash
git add src/modules/swap-sumsub/ src/modules/identity/customers/ prisma/ \
        src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(swap): 人级 applicantActionReviewed 闭环 —— 认证通过清限制，硬线客户不解锁"
```

---

## Self-Review

**Spec 覆盖核对**：spec §2 提交契约 → Task 4/6｜§3 状态机 → Task 2｜§4 节点条件 → Task 1/4/5/6/8｜§5 人级支线 → Task 7｜§6 豁免闭环 → Task 9（V7 键）+ BACKLOG（有效期待验）｜§7 规则纪律 → 不在代码范围，Task 12 记 BACKLOG 转规则目录文档｜§8 模拟层 → Task 9｜§9 代码改动点 → Task 4/6 + Task 11（前端契约变更）｜§10 差距 → 全覆盖｜§12 待决 → Task 12 记账。

**类型一致性核对**：`SwapTransactionAction` 四值在 Task 2 定义，Task 6/8 引用一致；`SumsubScoringResult` 在 Task 3 定义，Task 4/5 引用一致；`CustomerRestrictionsService.add/clear` 签名在 Task 1 定义，Task 7 引用一致；`applyKytVerdict` 入参在 Task 5 约定、Task 6 实现，字段名逐一对齐。

**已知留白（有意为之，非 placeholder）**：`buildLegContext` 是从 Task 4 删除的既有代码原样搬迁，不重写；HTTP client 的 `scoringResult` 映射依赖真实响应结构，实施时按 Task 3 的类型契约落即可。
