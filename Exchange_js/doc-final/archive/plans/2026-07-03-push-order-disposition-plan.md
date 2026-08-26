# 推单（Push-Order）处置动作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地平账第一个原子动作"推单"全路径：同步/人工两腿推进资金单状态机至终态，落账回填生效日，一键重对账批量自愈 case。

**Architecture:** 记账双漏斗（writeEvidence/enrichForPost）开可选 effectiveDate 口 → advance() 事件链穿透 → 推单编排服务（同步唯一回执 / 人工证据三件套）→ 前端双按钮 + 一键重对账。检测侧引擎零改动。

**Tech Stack:** NestJS + Prisma + SQLite、事件驱动 workflow（deposit/withdraw）、React admin、jest fake-prisma 单测模式。

**Spec:** `doc-final/superpowers/specs/2026-07-03-push-order-disposition-design.md`

**执行位置:** worktree `.claude/worktrees/settle-opt/`（分支 `settle-opt`），所有命令在其 `Exchange_js/` 内执行。**栈隔离铁律**：本 worktree 用 self 栈（`bash scripts/stack.sh up` 自动分端口，DB=`/tmp/exchange_js_wt_settle-opt/dev.db`），demo/rerun 一律经 `bash scripts/on-stack.sh self <script>` 包装，**禁止碰 main 栈 3000-3003 及其 DB**。

---

## ⚠️ 落地发现的 spec 增量（写 plan 钉锚点时发现，已按此展开；用户审阅 plan 即确认）

1. **回填口子是两个漏斗，不是一个**。spec §3 只写了 `writeEvidence` 加可选参数；实际记账链路是：workflow 监听 `FUNDS_ORDER_STATUS_CHANGED` → 完成时既调 `writeEvidence`（新腿，如 FEE_FIRM）**也调 `enrichForPost`**（两阶段 pending→post 转正既有 evidence 行）。转正的行如果不更新生效日，会保留"锁定日"的旧值 → 推单回填对它不生效。故 `enrichForPost` 的 fields patch 同步增加可选 `effectiveDate`（仅推单链路传；普通实时流转不传、行为不变）。投影器 upsert update 块已带 effectiveDate（effdate T2 交付），转正重投影自动刷新流水表，零额外改动。
2. **swap 腿本期禁推**。`advanceByNo` 明确拒绝 swap 腿（须走 swap 控制器的 advanceLeg 顺序守卫）；穿透 swap workflow 记账链工作量≈deposit+withdraw 之和。本期：推单按钮对 swap 腿资金单禁用并提示"走 Swap 详情页逐腿推进"，登记 BACKLOG。
3. **在途行"已推进·待重对账"派生态需要后端喂状态**：case 详情 API 的在途行只带 `fundsOrderNo`，前端不知单子当前状态。`getCase` 对在途行批量补查一次资金单状态（一条 `IN` 查询，非 N+1）。

## 已核实的关键锚点（执行者不用再查）

| 锚点 | 证据 |
|---|---|
| 状态机推进唯一入口 | `funds-order.service.ts` `advance(id, action, operatorId, tx?)` — 改状态+发 `funds_order.status.changed`，**本身不记账** |
| 记账在 workflow | withdraw: `withdraw-workflow.service.ts:707` `@OnEvent(FUNDS_ORDER_STATUS_CHANGED)` → CLEARED 分支 → `enrichForPost`(:1009 NET, :1078 FEE) + writeEvidence(FEE_FIRM)；deposit: `deposit-workflow.service.ts:61` → CONFIRMED → `onPayinConfirmed(depositId, fundsOrderId)` |
| 事件 payload 接口 | withdraw-workflow.service.ts:55 `FundsOrderStatusChangedEvent`（swap-workflow.service.ts:33 同名副本；deposit 用内联/本地类型——以 tsc 为准找全） |
| 状态/动作枚举 | `FundsOrderStatus` CREATED→SUBMITTED→CONFIRMING→CONFIRMED→CLEARED + FAILED/TIMEOUT；`FundsOrderAction` SUBMIT/OBSERVE_CONFIRMING/CONFIRM/CLEAR/FAIL/TIMEOUT；迁移表 `getTransitionMap(direction, assetType)`（funds-orders/constants） |
| swap 腿拒绝 | `advanceByNo` 对 `swapTransactionId` 非空直接 400 |
| enrichForPost 签名 | `tb-evidence.service.ts` `enrichForPost(tbTransferId, fields{eventCode?,memo?,debitWalletRef?,creditWalletRef?,externalRef?,isExternalCrossing?}, tx?)` |
| writeEvidence 现状 | `const now = new Date(); createdAt: now, effectiveDate: toBusinessDate(now)`（effdate T2 交付） |
| 外部对账单行 | `ExternalStatementLine`：`externalRef`/`amount`/`direction`/`datetime`/`accountRef`/`subAccount`；钱包→外部账户映射走 `ExternalBalance.walletRef→(source,accountRef)`（run 服务 `fetchExternalLinesForWallet` 同思路） |
| 手动触发 run | `POST /admin/reconciliation/runs/wallet {cutoff}` 已有（RBAC 已注册）；离线 `recon:rerun`（须 on-stack self 包装） |
| case 在途行 | `ReconciliationCasesDetailPage.tsx:621` 已有 fundsOrderNo 深链到 `/admin/funds-orders/:no` |
| 资金单详情页 | `FundsOrderDetail.tsx`：:390 起 ⚡模拟面板（`useSimulationMode` 门控，swap 腿走 swap advance 端点） |
| RBAC 纪律 | 新 admin 端点必须 `rbac.catalog.ts` `route()` 登记 + `db:base:sync` + **重启后端**（记忆：只 seed 不重启=白费） |
| 审计字典 | `audit-logging/constants/audit-actions.constant.ts`；写审计必须用 `AuditActions` 字典（effdate T5 教训：勿误用 AuditEntityTypes） |

---

### Task 1: 记账双漏斗开 effectiveDate 口（TDD）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（writeEvidence + enrichForPost）
- Test: `src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts`

- [ ] **Step 0: 起 self 栈 + 捕获金闸门基线（任何代码改动之前）**

```bash
bash scripts/stack.sh up 2>&1 | tail -5        # 自动分栈；记下分到的端口段
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break 2>&1 | tee /tmp/push-order-baseline.txt
```

Expected: self 栈四服务起来；九场景 `9/9 DETECTED`。基线文件留给 Task 5 diff。

- [ ] **Step 1: writeEvidence 可选参数红测**

`tb-evidence.service.spec.ts` `describe('writeEvidence')` 内加：

```ts
    it('honors an explicit effectiveDate (back-value funnel) while createdAt stays now', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue(params);

      await service.writeEvidence({ ...params, effectiveDate: '2026-06-30' } as any);

      const data = mockPrisma.tbTransferEvidence.create.mock.calls[0][0].data;
      expect(data.effectiveDate).toBe('2026-06-30');
      expect(data.createdAt.toISOString().slice(0, 10)).not.toBe('2026-06-30');
    });
```

Run: `npx jest src/modules/accounting/tigerbeetle/tb-evidence --silent` → Expected: FAIL（现实现忽略传入值，仍写当天）。

- [ ] **Step 2: writeEvidence 实现**

`WriteEvidenceParams` 接口（同文件上方）加可选字段：

```ts
  effectiveDate?: string; // 平账回填口：不传=写入当天；仅资金单推单链路传入（YYYY-MM-DD）
```

`writeEvidence()` 内把 `effectiveDate: toBusinessDate(now),` 改为：

```ts
        effectiveDate: params.effectiveDate ?? toBusinessDate(now),
```

Run 同上 → Expected: PASS（含既有 same-instant 测试——不传时行为逐字不变）。

- [ ] **Step 3: enrichForPost 可选 effectiveDate 红测**

同 spec 文件 enrichForPost 相关 describe 内加（mock 形态照抄相邻 enrichForPost 用例——update mock + findUnique 返回行 + 投影器桩）：

```ts
    it('enrichForPost with effectiveDate back-values the promoted evidence row', async () => {
      mockPrisma.tbTransferEvidence.update.mockResolvedValue({});
      mockPrisma.tbTransferEvidence.findUnique.mockResolvedValue({ tbTransferId: 'tid-1', effectiveDate: '2026-06-30' });

      await service.enrichForPost('tid-1', { eventCode: 'X', effectiveDate: '2026-06-30' } as any);

      const patch = mockPrisma.tbTransferEvidence.update.mock.calls[0][0].data;
      expect(patch.effectiveDate).toBe('2026-06-30');
    });

    it('enrichForPost without effectiveDate never touches the date (existing behavior)', async () => {
      mockPrisma.tbTransferEvidence.update.mockResolvedValue({});
      mockPrisma.tbTransferEvidence.findUnique.mockResolvedValue({ tbTransferId: 'tid-1' });

      await service.enrichForPost('tid-1', { eventCode: 'X' });

      const patch = mockPrisma.tbTransferEvidence.update.mock.calls[0][0].data;
      expect('effectiveDate' in patch).toBe(false);
    });
```

Run 同上 → Expected: 第一条 FAIL。

- [ ] **Step 4: enrichForPost 实现**

fields 类型加 `effectiveDate?: string;`（注释同 Step 2）。update data 组装处加（模式照抄相邻可选字段的条件展开）：

```ts
        ...(fields.effectiveDate !== undefined && { effectiveDate: fields.effectiveDate }),
```

Run 同上 → Expected: 全 PASS。再跑投影器回归：`npx jest src/modules/clearing-settle/reconciliation/projector --silent` → PASS（转正重投影经既有 update 块自动刷新流水 effectiveDate）。

- [ ] **Step 5: tsc + Commit**

```bash
npx tsc --noEmit
git add src/modules/accounting/tigerbeetle/
git commit -m "feat(recon/push): 记账双漏斗开 effectiveDate 回填口（writeEvidence+enrichForPost，默认行为零变化）"
```

---

### Task 2: advance 事件链穿透 effectiveDate（TDD）

**Files:**
- Modify: `src/modules/funds-orders/funds-order.service.ts`（advance 签名+事件 payload）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（事件接口 + CLEARED 记账链）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（事件处理 + CONFIRMED 记账链）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（仅事件接口副本加字段，行为不用）
- Test: `src/modules/funds-orders/funds-order.service.spec.ts`

- [ ] **Step 1: advance 透传红测**

`funds-order.service.spec.ts` 找到既有 advance 事件断言用例，旁边加：

```ts
    it('advance forwards opts.effectiveDate into the status.changed event payload', async () => {
      // fixture/mocks 照抄相邻 advance 用例（fake prisma 返回非终态单 + eventEmitter spy）
      await service.advance(orderId, FundsOrderAction.CONFIRM, 'op-1', undefined, { effectiveDate: '2026-06-30' });
      const payload = emitSpy.mock.calls.find(([name]) => name === 'funds_order.status.changed')![1];
      expect(payload.effectiveDate).toBe('2026-06-30');
    });

    it('advance without opts emits payload with undefined effectiveDate (unchanged)', async () => {
      await service.advance(orderId, FundsOrderAction.CONFIRM, 'op-1');
      const payload = emitSpy.mock.calls.find(([name]) => name === 'funds_order.status.changed')![1];
      expect(payload.effectiveDate).toBeUndefined();
    });
```

Run: `npx jest src/modules/funds-orders --silent` → Expected: 新用例 FAIL（TS：advance 无第 5 参）。

- [ ] **Step 2: advance 实现**

签名改为：

```ts
  async advance(id: string, action: FundsOrderAction, operatorId: string, tx?: Tx, opts?: { effectiveDate?: string }) {
```

emit 的 payload 对象加一行：

```ts
      effectiveDate: opts?.effectiveDate,
```

（`advanceByNo` **不加** opts——模拟/运维入口永远不回填，语义分家从源头开始。）

Run 同上 → Expected: PASS。

- [ ] **Step 3: 三处事件接口副本加字段**

`FundsOrderStatusChangedEvent`（withdraw-workflow.service.ts:55、swap-workflow.service.ts:33、deposit-workflow 的本地事件类型——以 `grep -rn "interface FundsOrderStatusChangedEvent" src/` + tsc 为准找全）各加：

```ts
  effectiveDate?: string; // 平账推单回填的业务归属日；普通实时流转恒为 undefined
```

- [ ] **Step 4: withdraw 记账链穿透**

`withdraw-workflow.service.ts` CLEARED 分支的调用链（handler → 该分支调的 leg-post 私有方法 → 其中的 `enrichForPost`/`writeEvidence` 调用）逐级加参：handler 从 `event.effectiveDate` 取值 → 私有方法签名加 `effectiveDate?: string` 末参 → `enrichForPost(..., { ...既有 fields, ...(effectiveDate && { effectiveDate }) })`、`writeEvidence({ ...既有 params, ...(effectiveDate && { effectiveDate }) })`。改动原则：**只在 CLEARED 分支的链路上加**，FAILED/TIMEOUT 等分支不动。

- [ ] **Step 5: deposit 记账链穿透**

`deposit-workflow.service.ts` 同法：`case FundsOrderStatus.CONFIRMED:` 改为 `await this.onPayinConfirmed(depositId, event.fundsOrderId, event.effectiveDate);`，`onPayinConfirmed` 签名加末参并透传到其内部全部 `enrichForPost`/`writeEvidence` 调用（同 Step 4 的条件展开写法）。

- [ ] **Step 6: 回归 + Commit**

```bash
npx jest src/modules/funds-orders src/modules/trading src/modules/accounting --silent 2>&1 | tail -4
npx tsc --noEmit
git add src/modules/funds-orders/ src/modules/trading/ 
git commit -m "feat(recon/push): advance 事件链穿透 effectiveDate（deposit/withdraw 记账链，默认路径零变化）"
```

Expected: 全 PASS、tsc 0。若 trading 既有 spec 因新参编译失败，修 fixture 不修断言。

---

### Task 3: 推单编排服务 + 双端点（TDD）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/disposition/receipt-lookup.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/disposition/push-order.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/disposition/push-order.controller.ts`
- Create: `src/modules/clearing-settle/reconciliation/dto/push-order.dto.ts`
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`（providers/controllers 注册）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（两个新动作）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（两条 route）
- Test: `disposition/receipt-lookup.service.spec.ts`、`disposition/push-order.service.spec.ts`

- [ ] **Step 1: 审计动作字典**

`audit-actions.constant.ts` 按文件既有分组风格加：

```ts
  // ── Reconciliation disposition: push-order（平账·推单）──
  RECON_PUSH_ORDER_SYNCED: 'RECON_PUSH_ORDER_SYNCED',
  RECON_PUSH_ORDER_MANUAL: 'RECON_PUSH_ORDER_MANUAL',
```

Run: `npx jest src/modules/audit-logging --silent` → Expected: PASS（字典 spec 校验无重复）。

- [ ] **Step 2: 回执查找服务红测（同步唯一性两档）**

`receipt-lookup.service.spec.ts`（fake prisma 模式照抄 engine/v2 spec）：

```ts
import { ReceiptLookupService } from './receipt-lookup.service';

const line = (over: any = {}) => ({
  id: over.id ?? 'ext-1', externalRef: over.externalRef ?? null,
  amount: over.amount ?? 100, direction: over.direction ?? 'IN',
  datetime: over.datetime ?? new Date('2026-06-30T10:00:00Z'), ...over,
});

function makePrisma(opts: { balances?: any[]; lines?: any[] }) {
  return {
    externalBalance: { findFirst: jest.fn(async () => opts.balances?.[0] ?? null) },
    externalStatementLine: {
      findMany: jest.fn(async ({ where }: any) =>
        (opts.lines ?? []).filter((l: any) =>
          (where.externalRef === undefined || l.externalRef === where.externalRef)),
      ),
    },
  } as any;
}

const order = {
  fundsOrderNo: 'FO-1', walletId: 'w-1', direction: 'IN', amount: 100,
  externalRef: '0xabc', createdAt: new Date('2026-06-29T00:00:00Z'), assetCode: 'USDT',
};

describe('ReceiptLookupService', () => {
  it('tier-1 externalRef exact match, exactly one → hit with businessDate', async () => {
    const prisma = makePrisma({ balances: [{ source: 'CHAIN', accountRef: 'acc-1' }], lines: [line({ externalRef: '0xabc' })] });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(order as any);
    expect(res).toEqual({ kind: 'HIT', lineId: 'ext-1', effectiveDate: '2026-06-30' });
  });

  it('zero candidates → MISS with count 0', async () => {
    const prisma = makePrisma({ balances: [{ source: 'CHAIN', accountRef: 'acc-1' }], lines: [] });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(order as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 0 });
  });

  it('multiple tier-2 candidates → MISS with count, never guesses', async () => {
    const noRef = { ...order, externalRef: null };
    const prisma = makePrisma({
      balances: [{ source: 'CHAIN', accountRef: 'acc-1' }],
      lines: [line({ id: 'a', amount: 100 }), line({ id: 'b', amount: 100 })],
    });
    const res = await new ReceiptLookupService(prisma).findUniqueReceipt(noRef as any);
    expect(res).toEqual({ kind: 'MISS', candidates: 2 });
  });
});
```

Run: `npx jest disposition/receipt-lookup --silent` → Expected: FAIL（模块不存在）。

- [ ] **Step 3: 回执查找服务实现**

`receipt-lookup.service.ts`：

```ts
// 平账·推单 同步腿的回执查找（spec §4）：两档严格度，任一档命中恰好 1 条即 HIT，否则 MISS 报数。
// 同步永不猜——多候选不进入下一档、不打分挑选。
// Port/adapter：本实现 = "已摄入对账单行" adapter；将来接银行/托管实时查询只换本类。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { toBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';

export type ReceiptLookupResult =
  | { kind: 'HIT'; lineId: string; effectiveDate: string }
  | { kind: 'MISS'; candidates: number };

export interface PushableOrderView {
  fundsOrderNo: string;
  walletId: string;
  direction: 'IN' | 'OUT';
  amount: number | string;
  externalRef: string | null;
  createdAt: Date;
}

@Injectable()
export class ReceiptLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findUniqueReceipt(order: PushableOrderView): Promise<ReceiptLookupResult> {
    // 钱包 → 外部账户定位（与 run 服务 fetchExternalLinesForWallet 同思路）
    const bal = await (this.prisma as any).externalBalance.findFirst({
      where: { walletRef: order.walletId },
      orderBy: { cutoffDate: 'desc' },
    });
    if (!bal) return { kind: 'MISS', candidates: 0 };

    // 档1：参考号精配
    if (order.externalRef) {
      const hits = await (this.prisma as any).externalStatementLine.findMany({
        where: { source: bal.source, accountRef: bal.accountRef, externalRef: order.externalRef },
      });
      if (hits.length === 1) return { kind: 'HIT', lineId: hits[0].id, effectiveDate: toBusinessDate(hits[0].datetime) };
      if (hits.length > 1) return { kind: 'MISS', candidates: hits.length };
      // 0 条 → 落档2
    }

    // 档2：要素精配（钱包账户 + 方向 + 金额相等 + 单子创建日~今天窗口内唯一）
    const all = await (this.prisma as any).externalStatementLine.findMany({
      where: { source: bal.source, accountRef: bal.accountRef, direction: order.direction },
    });
    const amt = String(order.amount);
    const from = order.createdAt.getTime();
    const cand = all.filter((l: any) => String(l.amount) === amt && l.datetime.getTime() >= from && l.datetime.getTime() <= Date.now());
    if (cand.length === 1) return { kind: 'HIT', lineId: cand[0].id, effectiveDate: toBusinessDate(cand[0].datetime) };
    return { kind: 'MISS', candidates: cand.length };
  }
}
```

Run 同上 → Expected: PASS。

- [ ] **Step 4: 推单编排红测**

`push-order.service.spec.ts`（fake FundsOrderService/ReceiptLookup/AuditLogs）：

```ts
import { BadRequestException } from '@nestjs/common';
import { PushOrderService } from './push-order.service';
import { FundsOrderStatus, FundsOrderAction } from '../../../funds-orders/dto/funds-order.dto';

const makeOrder = (over: any = {}) => ({
  id: 'id-1', fundsOrderNo: 'FO-1', status: FundsOrderStatus.CONFIRMING,
  swapTransactionId: null, walletId: 'w-1', direction: 'IN', amount: 100,
  externalRef: '0xabc', createdAt: new Date('2026-06-29T00:00:00Z'),
  ...over,
});

function build(opts: { order?: any; lookup?: any } = {}) {
  const order = opts.order ?? makeOrder();
  const statuses = [order.status, FundsOrderStatus.CONFIRMED, FundsOrderStatus.CLEARED];
  let i = 0;
  const fundsOrders = {
    findByNo: jest.fn(async () => order),
    advance: jest.fn(async () => ({ ...order, status: statuses[++i] ?? FundsOrderStatus.CLEARED })),
  } as any;
  const lookup = { findUniqueReceipt: jest.fn(async () => opts.lookup ?? ({ kind: 'HIT', lineId: 'ext-1', effectiveDate: '2026-06-30' })) } as any;
  const audit = { recordAdmin: jest.fn(), recordSystem: jest.fn() } as any;
  return { svc: new PushOrderService(fundsOrders, lookup, audit), fundsOrders, lookup, audit };
}

describe('PushOrderService', () => {
  it('sync: unique receipt → advances to CLEARED with back-valued effectiveDate on every step', async () => {
    const { svc, fundsOrders } = build();
    const res = await svc.syncPush('FO-1', 'admin-1');
    expect(res.finalStatus).toBe(FundsOrderStatus.CLEARED);
    expect(fundsOrders.advance).toHaveBeenCalled();
    for (const call of fundsOrders.advance.mock.calls) {
      expect(call[4]).toEqual({ effectiveDate: '2026-06-30' });
    }
  });

  it('sync: MISS → no advance, reports candidate count', async () => {
    const { svc, fundsOrders } = build({ lookup: { kind: 'MISS', candidates: 3 } });
    await expect(svc.syncPush('FO-1', 'admin-1')).rejects.toThrow(/3/);
    expect(fundsOrders.advance).not.toHaveBeenCalled();
  });

  it('manual: validates evidence dates (future / before order creation rejected)', async () => {
    const { svc } = build();
    await expect(svc.manualPush('FO-1', 'admin-1', { receiptRef: 'R-1', externalDate: '2099-01-01', reason: 'x' }))
      .rejects.toThrow(BadRequestException);
    await expect(svc.manualPush('FO-1', 'admin-1', { receiptRef: 'R-1', externalDate: '2026-06-01', reason: 'x' }))
      .rejects.toThrow(BadRequestException);
  });

  it('manual: valid evidence → advances with operator-supplied effectiveDate + manual audit flag', async () => {
    const { svc, fundsOrders, audit } = build();
    const res = await svc.manualPush('FO-1', 'admin-1', { receiptRef: 'R-1', externalDate: '2026-06-30', reason: '银行后台已见到账' });
    expect(res.finalStatus).toBe(FundsOrderStatus.CLEARED);
    expect(fundsOrders.advance.mock.calls[0][4]).toEqual({ effectiveDate: '2026-06-30' });
    expect(JSON.stringify(audit.recordAdmin.mock.calls[0][0])).toContain('RECON_PUSH_ORDER_MANUAL');
  });

  it('rejects swap-leg and terminal orders', async () => {
    const { svc: s1 } = build({ order: makeOrder({ swapTransactionId: 'swap-1' }) });
    await expect(s1.syncPush('FO-1', 'a')).rejects.toThrow(BadRequestException);
    const { svc: s2 } = build({ order: makeOrder({ status: FundsOrderStatus.CLEARED }) });
    await expect(s2.syncPush('FO-1', 'a')).rejects.toThrow(BadRequestException);
  });
});
```

Run: `npx jest disposition/push-order --silent` → Expected: FAIL（模块不存在）。

- [ ] **Step 5: 推单编排实现**

`push-order.service.ts`：

```ts
// 平账·推单编排（spec §1/§2）：同步/人工两腿，同一条推进路径，差别只在证据提供者。
// 铁律：不直写 TB/账本——只循环调 FundsOrderService.advance，由状态机事件链记账（Task 2 穿透）。
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditActions } from '../../../audit-logging/constants/audit-actions.constant';
import { FundsOrderService } from '../../../funds-orders/funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from '../../../funds-orders/dto/funds-order.dto';
import { ReceiptLookupService } from './receipt-lookup.service';

const HAPPY_ACTIONS = [
  FundsOrderAction.SUBMIT,
  FundsOrderAction.OBSERVE_CONFIRMING,
  FundsOrderAction.CONFIRM,
  FundsOrderAction.CLEAR,
];
const MAX_STEPS = 6; // 状态机最长合法链路兜底，防死循环

export interface ManualPushEvidence { receiptRef: string; externalDate: string; reason: string }

@Injectable()
export class PushOrderService {
  constructor(
    private readonly fundsOrders: FundsOrderService,
    private readonly receiptLookup: ReceiptLookupService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async syncPush(fundsOrderNo: string, operatorId: string) {
    const order = await this.loadPushable(fundsOrderNo);
    const receipt = await this.receiptLookup.findUniqueReceipt(order);
    if (receipt.kind === 'MISS') {
      throw new BadRequestException(
        `未找到唯一回执（${receipt.candidates} 条候选）——请核实外部对账单摄入情况，或走人工确认`,
      );
    }
    const final = await this.driveToCleared(order, operatorId, receipt.effectiveDate);
    await this.auditLogs.recordAdmin({
      action: AuditActions.RECON_PUSH_ORDER_SYNCED,
      actorId: operatorId,
      entityType: 'FUNDS_ORDER',
      entityId: fundsOrderNo,
      detail: { matchedLineId: receipt.lineId, effectiveDate: receipt.effectiveDate, fromStatus: order.status, toStatus: final.status },
    } as any);
    return { finalStatus: final.status, effectiveDate: receipt.effectiveDate, matchedLineId: receipt.lineId };
  }

  async manualPush(fundsOrderNo: string, operatorId: string, evidence: ManualPushEvidence) {
    const order = await this.loadPushable(fundsOrderNo);
    this.assertValidExternalDate(evidence.externalDate, order.createdAt);
    if (!evidence.receiptRef?.trim() || !evidence.reason?.trim()) {
      throw new BadRequestException('人工确认必填证据三件套：回执号 + 外部实际动账日 + 原因');
    }
    const final = await this.driveToCleared(order, operatorId, evidence.externalDate);
    await this.auditLogs.recordAdmin({
      action: AuditActions.RECON_PUSH_ORDER_MANUAL,
      actorId: operatorId,
      entityType: 'FUNDS_ORDER',
      entityId: fundsOrderNo,
      detail: { manualConfirm: true, ...evidence, effectiveDate: evidence.externalDate, fromStatus: order.status, toStatus: final.status },
    } as any);
    return { finalStatus: final.status, effectiveDate: evidence.externalDate };
  }

  private async loadPushable(fundsOrderNo: string) {
    const order = await this.fundsOrders.findByNo(fundsOrderNo);
    if (!order) throw new NotFoundException(`FundsOrder ${fundsOrderNo} not found`);
    if (order.swapTransactionId) {
      throw new BadRequestException('swap 腿资金单请走 Swap 详情页逐腿推进（顺序守卫），本期不支持推单');
    }
    const TERMINAL = new Set([FundsOrderStatus.CLEARED, FundsOrderStatus.FAILED, FundsOrderStatus.TIMEOUT]);
    if (TERMINAL.has(order.status)) {
      throw new BadRequestException(`FundsOrder ${fundsOrderNo} 已是终态（${order.status}），无可推进`);
    }
    return order;
  }

  /** 沿状态机既有合法迁移逐步推到 CLEARED；每步透传回填生效日，不跳步不造新迁移。 */
  private async driveToCleared(order: any, operatorId: string, effectiveDate: string) {
    let current = order;
    for (let i = 0; i < MAX_STEPS && current.status !== FundsOrderStatus.CLEARED; i++) {
      let advanced = null;
      for (const action of HAPPY_ACTIONS) {
        try {
          advanced = await this.fundsOrders.advance(current.id, action, operatorId, undefined, { effectiveDate });
          break;
        } catch { /* 该 action 对当前态非法，试下一个 */ }
      }
      if (!advanced) throw new BadRequestException(`FundsOrder ${order.fundsOrderNo} 在 ${current.status} 无合法推进动作`);
      current = advanced;
    }
    if (current.status !== FundsOrderStatus.CLEARED) {
      throw new BadRequestException(`推进未达终态（止于 ${current.status}）`);
    }
    return current;
  }

  private assertValidExternalDate(d: string, orderCreatedAt: Date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('外部动账日格式须为 YYYY-MM-DD');
    const today = new Date().toISOString().slice(0, 10);
    if (d > today) throw new BadRequestException('外部动账日不能是未来');
    if (d < orderCreatedAt.toISOString().slice(0, 10)) throw new BadRequestException('外部动账日不能早于单子创建日');
  }
}
```

（`FundsOrderService.findByNo` 若不存在，加一个 `findByNo(fundsOrderNo)` = `findUnique({where:{fundsOrderNo}, include:{asset:true}})` 的薄方法，带一行注释。）

Run 同上 → Expected: PASS。

- [ ] **Step 6: 控制器 + DTO + 模块注册 + RBAC**

`dto/push-order.dto.ts`：

```ts
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ManualPushDto {
  @IsString() @IsNotEmpty() receiptRef!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) externalDate!: string;
  @IsString() @IsNotEmpty() reason!: string;
}
```

`disposition/push-order.controller.ts`（守卫/装饰器样式照抄 reconciliation-admin.controller.ts）：

```ts
import { Body, Controller, Param, Post, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../identity/access-control/permission-code.util';
import { PushOrderService } from './push-order.service';
import { ManualPushDto } from '../dto/push-order.dto';

@ApiTags('Admin - Reconciliation Disposition (平账·推单)')
@ApiBearerAuth()
@Controller('admin/funds-orders')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PushOrderController {
  constructor(private readonly pushOrder: PushOrderService) {}

  @Post(':fundsOrderNo/push/sync')
  @ApiOperation({ summary: '推单·同步状态：查唯一外部回执并推进至终态（幂等安全）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/funds-orders/:fundsOrderNo/push/sync'))
  sync(@Param('fundsOrderNo') no: string, @Req() req: any) {
    return this.pushOrder.syncPush(no, req.user?.userNo ?? 'UNKNOWN');
  }

  @Post(':fundsOrderNo/push/manual')
  @ApiOperation({ summary: '推单·人工确认：证据三件套强推至终态（审计人工标记）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/funds-orders/:fundsOrderNo/push/manual'))
  manual(@Param('fundsOrderNo') no: string, @Body() dto: ManualPushDto, @Req() req: any) {
    return this.pushOrder.manualPush(no, req.user?.userNo ?? 'UNKNOWN', dto);
  }
}
```

`reconciliation.module.ts`：providers 加 `ReceiptLookupService, PushOrderService`，controllers 加 `PushOrderController`（模块已 import funds-orders/audit 相关依赖，缺则补 imports——以 tsc/启动报错为准）。

`rbac.catalog.ts` 在 :583 advance 那行旁边加：

```ts
  route('POST', '/admin/funds-orders/:fundsOrderNo/push/sync', 'Push order — sync from external receipt (recon disposition)', ['INTERNAL_FUND_READ']),
  route('POST', '/admin/funds-orders/:fundsOrderNo/push/manual', 'Push order — manual confirm with evidence (recon disposition)', ['INTERNAL_FUND_READ']),
```

- [ ] **Step 7: 回归 + Commit**

```bash
npx jest src/modules/clearing-settle/reconciliation src/modules/audit-logging --silent 2>&1 | tail -4
npx tsc --noEmit
git add src/modules/ 
git commit -m "feat(recon/push): 推单编排（同步唯一回执/人工证据三件套）+ 双端点 + 审计/RBAC 登记"
```

Expected: 全 PASS、tsc 0。

---

### Task 4: 前端——双按钮 + 待重对账标记 + 一键重新对账

**Files:**
- Modify: `admin-web/src/pages/FundsOrderDetail.tsx`（平账双按钮区 + 人工确认弹层）
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`（getCase 在途行补单子状态，一条 IN 查询）
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（在途行"已推进·待重对账"徽记 + 重新对账按钮）
- Modify: `admin-web/src/pages/ReconciliationRunsDetailPage.tsx`（重新对账按钮）

- [ ] **Step 1: getCase 在途行补状态**

`reconciliation-query.service.ts` getCase 组装在途行处：收集 `fundsOrderNo` 非空集合 → `prisma.fundsOrder.findMany({ where: { fundsOrderNo: { in: [...] } }, select: { fundsOrderNo: true, status: true } })` → 行对象加 `fundsOrderStatus`。DTO/前端接口同步加可选字段。

- [ ] **Step 2: FundsOrderDetail 平账双按钮区**

在 ⚡模拟面板（:390）**之前**加独立 section（不受 `simEnabled` 门控；仅 `非 swap 腿 && 非终态` 渲染）：

```tsx
{/* 2.4 平账·推单（processing disposition — 与下方模拟面板语义分家） */}
{!data.swapNo && !['CLEARED', 'FAILED', 'TIMEOUT'].includes(data.status) && (
  <section className="…照抄相邻 section 容器样式…">
    <Cap>平账 · 推单 / Push Order</Cap>
    <div className="mt-3 flex items-center gap-2">
      <button onClick={() => void handleSyncPush()} className={adminButtonClass('listPrimary')}>
        同步状态 / Sync
      </button>
      <button onClick={() => setManualOpen(true)} className={adminButtonClass('listSecondary')}>
        人工确认 / Manual Confirm
      </button>
      <span className="font-mono text-[10px] text-adm-t3">同步=查外部回执自动推进；人工=证据三件套强推（审计留痕）</span>
    </div>
  </section>
)}
```

`handleSyncPush` = `adminFetch POST /admin/funds-orders/:no/push/sync` → 成功 alert 结果+refresh；失败展示后端 message（"未找到唯一回执（N 条候选）"原样透出）。人工确认弹层 = 三输入（回执号 text / 动账日 date / 原因 textarea，全必填）→ POST `/push/manual`。swap 腿或终态不渲染该区（终态后自然消失）。

- [ ] **Step 3: case 在途行徽记 + 重新对账按钮**

`ReconciliationCasesDetailPage.tsx` 在途行：`row.fundsOrderStatus === 'CLEARED'`（case 仍 OPEN）时，fundsOrderNo 链接旁加 `<AdminBadge value="已推进·待重对账" />` 样式徽记（沿用 adm-blue 色调）。页头 Actions 区加"重新对账"按钮：`POST /admin/reconciliation/runs/wallet {cutoff: new Date().toISOString()}` → 完成后 refresh case。`ReconciliationRunsDetailPage.tsx` 加同一按钮（复用同一 fetch 逻辑，可提为小工具函数）。

- [ ] **Step 4: tsc + 渲染验证 + Commit**

```bash
(cd admin-web && npx tsc -b)
```

preview（self 栈 admin 端口）截图三张：资金单详情双按钮区／人工确认弹层／case 在途行徽记+重新对账按钮。

```bash
git add admin-web/src/pages/ src/modules/clearing-settle/reconciliation/
git commit -m "feat(admin/recon): 推单双按钮+人工确认弹层+待重对账徽记+一键重新对账"
```

---

### Task 5: e2e 闭环 + 金闸门 + 文档收口

**Files:**
- Modify: `doc-final/reference/roadmap.md`（推单交付记录 + 七动作进度）
- Modify: `doc-final/BACKLOG.md`（swap 腿推单 deferred 登记）
- Modify: `doc-final/superpowers/specs/2026-07-03-push-order-disposition-design.md`（§3 增补 enrichForPost 漏斗 + swap 腿禁推——把 plan 落地发现回写 spec）

- [ ] **Step 1: 全局硬闸**

```bash
npx tsc --noEmit && npx jest --silent 2>&1 | tail -3
```

Expected: tsc 0；jest 基线 `4 failed, 2 skipped`（asset-treasury/wallets 既有），净新增失败 0。

- [ ] **Step 2: 金闸门（检测侧零回归）**

```bash
bash scripts/on-stack.sh self recon:demo:reset && bash scripts/on-stack.sh self recon:demo:break 2>&1 | tee /tmp/push-order-after.txt
grep -E "DETECTED|PASS|BREAK|OK" /tmp/push-order-baseline.txt > /tmp/po-base.txt
grep -E "DETECTED|PASS|BREAK|OK" /tmp/push-order-after.txt  > /tmp/po-after.txt
diff /tmp/po-base.txt /tmp/po-after.txt && echo "GOLDEN_GATE_OK"
```

Expected: `GOLDEN_GATE_OK`（grep 模式两边一致；判定行样式以 baseline 实际输出为准微调）。

- [ ] **Step 3: 同步腿 e2e（在途 → 推单 → 重对账 → 自愈）**

demo break 后场景 1 有真实非终态资金单（在途桶）。对 self 栈 DB（`bash scripts/on-stack.sh self` 环境或直接 sqlite `/tmp/exchange_js_wt_settle-opt/dev.db`）：
(a) 查在途 case 拿 `fundsOrderNo` + walletRef + 金额方向；
(b) 给该单**手工播种一条匹配的外部对账单行**（externalRef=单子的 externalRef 或金额方向精配，datetime=昨天）——sqlite INSERT，字段照 external_statement_lines 表结构，dedupKey 唯一；
(c) 用 self 栈 admin token `curl POST /admin/funds-orders/<no>/push/sync` → Expected: 200，finalStatus=CLEARED，effectiveDate=昨天；
(d) sqlite 验证：该单关联的 evidence/flows 行 effectiveDate=昨天（回填生效）；
(e) `bash scripts/on-stack.sh self recon:rerun` → 该钱包桶 IN_TRANSIT→MATCHED、case AUTO_HEALED（RESOLVED）；
(f) 历史日验证：`bash scripts/on-stack.sh self recon:rerun -- --cutoff=<昨天>T23:59:59Z` → 昨天业务日新 run 该钱包 MATCHED。
每步贴实际输出。

- [ ] **Step 4: 人工腿 e2e + 失败路径**

再造/另选一个非终态单：(a) 不播种回执 → `push/sync` → Expected: 400"未找到唯一回执（0 条候选）"，单子状态不变；(b) `push/manual`（回执号+昨天+原因）→ CLEARED + 审计行含 `RECON_PUSH_ORDER_MANUAL` 与三件套（sqlite 查 audit_log_events）；(c) 校验拒绝：externalDate=未来 / 早于创建日 → 400。

- [ ] **Step 5: 前端闭环验证**

preview（self 栈）：case 在途行 → 去处理 → 详情页同步推单 → 回 case 页看"已推进·待重对账"徽记 → 点"重新对账" → case 变 RESOLVED。截图 2-3 张关键帧。

- [ ] **Step 6: 文档收口 + Commit**

roadmap：七动作清单推单打勾 + 交付记录（两腿/回填/一键重对账/e2e 结果）；BACKLOG：`- [ ] swap 腿推单（走 advanceLeg 顺序守卫 + swap workflow 记账链穿透）—— 推单 MVP 明确排除`；spec §3/§8 增补本 plan 头部两条落地发现。

```bash
git add doc-final/
git commit -m "docs(recon/push): 推单交付记录 + spec 落地增量回写 + swap 腿 deferred 登记"
```

---

## 自审记录

- Spec 覆盖：§1 全路径 → T3/T4/T5；§2 两按钮+分家 → T3 端点独立于 advance + T4 独立 section；§3 回填口 → T1（双漏斗，增量已标头部）+ T2 穿透；§4 唯一性两档 → T3 ReceiptLookup（档1→档2、多候选即止）；§5 一键重对账 → T4 Step3（复用既有端点）；§6 审计 → T3 字典+recordAdmin、T4 徽记派生态（后端补状态=实现该派生的最小代价）；§7 验收 6 条 → T5 Step1-5 逐条对应；§8 明确不做 → 无任务越界，swap 腿禁推已登记。
- 占位符扫描：无 TBD/TODO；两处"照抄相邻用例/样式"均指向明确文件与行号锚点，属 fixture 形态引用非逻辑省略。
- 类型一致性：`advance(id, action, operatorId, tx?, opts?)` T2 定义 ↔ T3 `advance(current.id, action, operatorId, undefined, { effectiveDate })` 一致；`ReceiptLookupResult`/`ManualPushEvidence` 单处定义；审计动作两常量 T3 Step1 定义后引用。
- 栈纪律：全程 self 栈 + on-stack.sh self 包装；金闸门基线在 T1 Step0（任何代码改动前）。
