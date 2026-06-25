# Swap 资金单编排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 把 swap 从「原子记账瞬间 SUCCESS」改为「4 个 InternalFund 资金单直挂 swap、按序手动推进、每腿两阶段记账（发起 pending / 完成 post / 失败 void）、全腿 CLEAR 才 SUCCESS、失败 FAILED+人工修复」。

**Architecture:** swap 模块新增 `SwapSettlementService` 拥有编排；`InternalFund` 加 `swapTransactionId`+`legSeq` 直挂 swap（不建 InternalTransaction、不走白名单/transfer-workflow）；每腿对应 1–2 条 TB 转账，用 `AccountingService.executePendingTransfer/postPendingTransfer/voidPendingTransfer`；admin simulate 端点驱动推进。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle；Jest（TB mock）。设计依据：`doc-final/superpowers/specs/2026-06-25-swap-funds-flow-orchestration-design.md`。

**前置约定：** 分支 `funds-realtime-1to1`；fresh DB；`npm test`（TB mock）；e2e 经 `npx ts-node` + main env（DB `file:/tmp/exchange_js_main/dev.db`、`TB_ADDRESS=127.0.0.1:3003`）。每任务末 commit（`feat(funds):`/`refactor(funds):`/`test(funds):`）。

---

## File Structure

**Schema/常量**
- `prisma/schema.prisma` — `InternalFund` 加 `swapTransactionId`/`legSeq`、`internalTransactionId` 改可空 + 关系；migration。
- `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts` — `SwapTransactionStatus` 加 `SETTLING`/`REVERSED`。
- `src/modules/funds-layer/constants/swap-leg-plan.constant.ts`（新）— 纯函数：按方向产出 4 腿（角色/币种/介质 + 每腿 TB 记账规格）。

**Domain**
- `src/modules/funds-layer/domain/funds-flow.service.ts` — 加 `createSwapLeg`、`transitionSwapLeg`（不依赖 InternalTransaction）。

**Workflow/orchestration（swap 模块）**
- `src/modules/trading/swap-transactions/swap-settlement.service.ts`（新）— `start` + `advanceLeg` + `reverseSwap`/`retryLeg`。
- `src/modules/trading/swap-transactions/swap-workflow.service.ts` — `executeSwap` 改：建 SETTLING swap + 调 `settlement.start`，删原子 `postSwapLegs`；SWAP_SUCCEEDED 事件移到末腿 CLEAR。
- `src/modules/trading/swap-transactions/swap-transactions.service.ts` — `create` 状态改 `SETTLING`；加 `markStatus`。

**Endpoint/RBAC**
- `src/modules/trading/swap-transactions/swap-admin.controller.ts`（或现有 admin 控制器）+ `rbac.catalog.ts` 登记。

---

## Task 1: Schema — InternalFund 挂 swap + swap 状态

**Files:** Modify `prisma/schema.prisma`；Create migration；Modify `swap-transaction.dto.ts`

- [ ] **Step 1: 改 InternalFund 模型**（`internalTransactionId` 改可空，加 swap 字段 + 关系 + 索引）

```prisma
model InternalFund {
  // ...
  internalTransactionId String?    // was required → nullable (swap legs don't use InternalTransaction)
  swapTransactionId     String?    // NEW: hang leg directly on swap
  legSeq                Int?       // NEW: 1..4 ordering
  // ...
  internalTransaction   InternalTransaction? @relation(fields: [internalTransactionId], references: [id], onDelete: Cascade)
  swapTransaction       SwapTransaction?     @relation("SwapInternalFunds", fields: [swapTransactionId], references: [id], onDelete: Cascade)
  // ...
  @@index([swapTransactionId])
}
```
并在 `model SwapTransaction` 加反向关系：`internalFunds InternalFund[] @relation("SwapInternalFunds")`。

- [ ] **Step 2: 生成 migration**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx prisma migrate dev --name swap_internal_fund_legs --create-only`
然后人工核对 SQL（SQLite：加列 + 索引；`internalTransactionId` 由 NOT NULL 改 nullable 需重建表——Prisma 自动生成，核对不丢数据；fresh DB 无历史，安全）。

- [ ] **Step 3: 应用 + 重新生成 client**

Run: `DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx prisma migrate deploy && npx prisma generate`
Expected: 迁移成功，client 重新生成。

- [ ] **Step 4: swap 状态枚举加 SETTLING/REVERSED**

```typescript
// swap-transaction.dto.ts
export enum SwapTransactionStatus {
  SETTLING = 'SETTLING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}
```

- [ ] **Step 5: 编译检查 + commit**

Run: `npx tsc --noEmit`（仅这几个文件相关错误；swap-workflow 后续任务再改，若引用旧字段报错记下留 Task 5 修）
```bash
git add prisma/ src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts
git commit -m "feat(funds): InternalFund hangs on swap (swapTransactionId+legSeq) + SETTLING/REVERSED status"
```

---

## Task 2: 腿计划纯函数（按方向产出 4 腿 + 每腿记账规格）

**Files:** Create `src/modules/funds-layer/constants/swap-leg-plan.constant.ts`；Test 同名 `.spec.ts`

腿的记账规格用 COA code（落地时 resolve 成账户）。`amountRef` ∈ `from`(卖出额) / `grossTo`(买入毛额) / `fee`。

- [ ] **Step 1: 写失败测试**

```typescript
// swap-leg-plan.constant.spec.ts
import { buildSwapLegPlan } from './swap-leg-plan.constant';
import { TB_ACCOUNT_CODES as C } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

describe('buildSwapLegPlan', () => {
  it('crypto→fiat (USDT→AED) = 4 legs, 7 accounting transfers', () => {
    const legs = buildSwapLegPlan({ fromIsFiat: false });
    expect(legs.map((l) => [l.fromRole, l.toRole])).toEqual([
      ['C_DEP', 'F_OPS'], ['F_OPS', 'F_SET'], ['F_SET', 'C_VIBAN'], ['C_VIBAN', 'F_FEE'],
    ]);
    expect(legs.flatMap((l) => l.accounting)).toHaveLength(7);
    // leg1 sell: 2 entries on from-ledger
    expect(legs[0].accounting.map((a) => a.creditCode)).toEqual([C.CLIENT_ASSET, C.FIRM_OPS]);
  });

  it('fiat→crypto (AED→USDT) = 4 legs, 7 accounting transfers', () => {
    const legs = buildSwapLegPlan({ fromIsFiat: true });
    expect(legs.map((l) => [l.fromRole, l.toRole])).toEqual([
      ['C_VIBAN', 'F_SET'], ['F_SET', 'F_OPS'], ['F_OPS', 'C_DEP'], ['C_DEP', 'F_FEE'],
    ]);
    expect(legs.flatMap((l) => l.accounting)).toHaveLength(7);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `npx jest swap-leg-plan -i` → FAIL

- [ ] **Step 3: 实现**

```typescript
// swap-leg-plan.constant.ts
import { TB_ACCOUNT_CODES as C } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES as T } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

export type AmountRef = 'from' | 'grossTo' | 'fee';
export type LegSide = 'from' | 'to'; // which ledger this transfer books on
export interface LegAccounting {
  code: number;        // TB_TRANSFER_CODES
  debitCode: number;   // TB_ACCOUNT_CODES
  creditCode: number;
  side: LegSide;       // from-ledger or to-ledger
  amountRef: AmountRef;
  eventCode: string;
}
export interface SwapLegSpec {
  legSeq: number;
  fromRole: string;
  toRole: string;
  side: LegSide;       // which asset moves on this leg (from=sell ccy, to=buy ccy)
  accounting: LegAccounting[];
}

// crypto→fiat: sell crypto direct, buy fiat via SET, fee in to(fiat)
const CRYPTO_TO_FIAT: SwapLegSpec[] = [
  { legSeq: 1, fromRole: 'C_DEP', toRole: 'F_OPS', side: 'from', accounting: [
    { code: T.SWAP_SELL_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_ASSET, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_CLIENT' },
    { code: T.SWAP_SELL_FIRM,   debitCode: C.FIRM_ASSET,     creditCode: C.FIRM_OPS,     side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_FIRM' },
  ] },
  { legSeq: 2, fromRole: 'F_OPS', toRole: 'F_SET', side: 'to', accounting: [
    { code: T.SWAP_BUY_OPS_TO_SET, debitCode: C.FIRM_OPS, creditCode: C.FIRM_SET, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_OPS_TO_SET' },
  ] },
  { legSeq: 3, fromRole: 'F_SET', toRole: 'C_VIBAN', side: 'to', accounting: [
    { code: T.SWAP_BUY_SET_TO_ASSET, debitCode: C.FIRM_SET,    creditCode: C.FIRM_ASSET,     side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_SET_TO_ASSET' },
    { code: T.SWAP_BUY_CLIENT,       debitCode: C.CLIENT_ASSET, creditCode: C.CLIENT_PAYABLE, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_CLIENT' },
  ] },
  { legSeq: 4, fromRole: 'C_VIBAN', toRole: 'F_FEE', side: 'to', accounting: [
    { code: T.SWAP_FEE_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_ASSET, side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_CLIENT' },
    { code: T.SWAP_FEE_FIRM,   debitCode: C.FIRM_ASSET,     creditCode: C.FIRM_FEE,     side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_FIRM' },
  ] },
];

// fiat→crypto: sell fiat via SET, buy crypto direct, fee in to(crypto)
const FIAT_TO_CRYPTO: SwapLegSpec[] = [
  { legSeq: 1, fromRole: 'C_VIBAN', toRole: 'F_SET', side: 'from', accounting: [
    { code: T.SWAP_SELL_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_ASSET, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_CLIENT' },
    { code: T.SWAP_SELL_FIRM,   debitCode: C.FIRM_ASSET,     creditCode: C.FIRM_SET,     side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_FIRM' },
  ] },
  { legSeq: 2, fromRole: 'F_SET', toRole: 'F_OPS', side: 'from', accounting: [
    { code: T.SWAP_SELL_SET_TO_OPS, debitCode: C.FIRM_SET, creditCode: C.FIRM_OPS, side: 'from', amountRef: 'from', eventCode: 'SWAP_SELL_SET_TO_OPS' },
  ] },
  { legSeq: 3, fromRole: 'F_OPS', toRole: 'C_DEP', side: 'to', accounting: [
    { code: T.SWAP_BUY_OPS_TO_ASSET, debitCode: C.FIRM_OPS,    creditCode: C.FIRM_ASSET,     side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_OPS_TO_ASSET' },
    { code: T.SWAP_BUY_CLIENT,       debitCode: C.CLIENT_ASSET, creditCode: C.CLIENT_PAYABLE, side: 'to', amountRef: 'grossTo', eventCode: 'SWAP_BUY_CLIENT' },
  ] },
  { legSeq: 4, fromRole: 'C_DEP', toRole: 'F_FEE', side: 'to', accounting: [
    { code: T.SWAP_FEE_CLIENT, debitCode: C.CLIENT_PAYABLE, creditCode: C.CLIENT_ASSET, side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_CLIENT' },
    { code: T.SWAP_FEE_FIRM,   debitCode: C.FIRM_ASSET,     creditCode: C.FIRM_FEE,     side: 'to', amountRef: 'fee', eventCode: 'SWAP_FEE_FIRM' },
  ] },
];

export function buildSwapLegPlan(p: { fromIsFiat: boolean }): SwapLegSpec[] {
  return p.fromIsFiat ? FIAT_TO_CRYPTO : CRYPTO_TO_FIAT;
}
```

> 注：`SWAP_SELL_SET_TO_OPS` / `SWAP_BUY_OPS_TO_ASSET` 已存在于 `tb-transfer-codes.constant.ts`（现有 postSwapLegs 在用）；若缺则在该常量文件补（沿用现有编号段）。

- [ ] **Step 4: 跑测试确认通过** — Run: `npx jest swap-leg-plan -i` → PASS

- [ ] **Step 5: Commit**
```bash
git add src/modules/funds-layer/constants/swap-leg-plan.constant.ts src/modules/funds-layer/constants/swap-leg-plan.constant.spec.ts
git commit -m "feat(funds): swap leg plan (4 legs + per-leg accounting, both directions)"
```

---

## Task 3: InternalFund domain — createSwapLeg + transitionSwapLeg

**Files:** Modify `src/modules/funds-layer/domain/funds-flow.service.ts`；Test 追加

模型于现有 `createLeg`（internalFundNo 生成+重试+审计）与 `appendStatusHistory`，但挂 `swapTransactionId`+`legSeq`、`internalTransactionId=null`；`transitionSwapLeg` 用 `getTransitionMap(asset.type)` 校验动作、推进状态、append 历史、CLEAR 写 completedAt。**不调** `syncStatusFromFunds`（无 InternalTransaction）。

- [ ] **Step 1: 写失败测试**（mock prisma + auditLogs）

```typescript
// funds-flow.service.spec.ts —— 追加 describe('swap legs')
it('createSwapLeg hangs on swap with legSeq, status CREATED', async () => {
  // arrange mock internalFund.create to capture data; assert data.swapTransactionId/legSeq/internalTransactionId=null/status=CREATED
});
it('transitionSwapLeg advances crypto leg CREATED→SIGNING and appends history', async () => {
  // arrange leg {status:CREATED, asset:{type:CRYPTO}}; action SIGN → expect update status SIGNING + statusHistory appended
});
it('transitionSwapLeg rejects illegal action', async () => {
  // CREATED + CONFIRM (crypto) → throws BadRequest
});
```
（按现有 spec 的 mock 风格补全断言。）

- [ ] **Step 2: 跑确认失败** — `npx jest funds-flow.service -i` → FAIL

- [ ] **Step 3: 实现两方法**（加到 FundsFlowService）

```typescript
async createSwapLeg(
  input: { swapTransactionId: string; legSeq: number; assetId: string; amount: Prisma.Decimal;
           fromWalletId?: string | null; toWalletId?: string | null; },
  operatorId = 'SYSTEM',
  tx?: TxClient,
) {
  const exec = async (client: TxClient) => {
    for (let attempt = 1; attempt <= FundsFlowService.MAX_NO_GENERATION_RETRIES; attempt++) {
      const internalFundNo = generateReferenceNo('IFD');
      try {
        const created = await (client as any).internalFund.create({ data: {
          internalFundNo, internalTransactionId: null,
          swapTransactionId: input.swapTransactionId, legSeq: input.legSeq,
          status: InternalFundStatus.CREATED, assetId: input.assetId,
          amount: input.amount, feeAmount: new Prisma.Decimal(0), netAmount: input.amount,
          fromWalletId: input.fromWalletId ?? null, toWalletId: input.toWalletId ?? null,
          statusHistory: this.appendStatusHistory(null, InternalFundStatus.CREATED, operatorId, `Swap leg ${input.legSeq} created`),
        }});
        await this.auditLogsService.recordByActor(
          { action: AuditActions.CREATED, entityType: AuditEntityTypes.INTERNAL_FUND, entityId: created.id, entityNo: created.internalFundNo, reason: `Swap leg ${input.legSeq} created`, sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API' },
          { actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN', actorId: operatorId, actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN' },
          client,
        );
        return created;
      } catch (e) { if (this.isInternalFundNoUniqueConflict(e)) continue; throw e; }
    }
    throw new InternalServerErrorException('Failed to generate unique internalFundNo');
  };
  return tx ? exec(tx) : (this.prisma as any).$transaction((c: TxClient) => exec(c));
}

async transitionSwapLeg(
  id: string, action: InternalFundAction, operatorId = 'SYSTEM', tx?: TxClient,
): Promise<{ leg: any; prevStatus: InternalFundStatus; nextStatus: InternalFundStatus }> {
  const exec = async (client: TxClient) => {
    const leg = await (client as any).internalFund.findUnique({ where: { id }, include: { asset: true } });
    if (!leg) throw new NotFoundException('Internal fund leg not found');
    const cur = leg.status as InternalFundStatus;
    const map = this.getTransitionMap(leg.asset?.type || 'CRYPTO');
    const next = map[cur]?.[action];
    if (!next) throw new BadRequestException(`Invalid action ${action} for status ${cur}`);
    const updated = await (client as any).internalFund.update({ where: { id }, data: {
      status: next,
      statusHistory: this.appendStatusHistory(leg.statusHistory, next, operatorId, `Swap leg → ${next}`),
      confirmedAt: next === InternalFundStatus.CONFIRMED ? new Date() : leg.confirmedAt,
      completedAt: TERMINAL_STATUSES.has(next) ? new Date() : leg.completedAt,
    }});
    await this.auditLogsService.recordByActor(
      { action: AuditActions.UPDATED, entityType: AuditEntityTypes.INTERNAL_FUND, entityId: id, entityNo: leg.internalFundNo, reason: `Swap leg ${cur}→${next}`, sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API' },
      { actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN', actorId: operatorId, actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN' },
      client,
    );
    return { leg: updated, prevStatus: cur, nextStatus: next };
  };
  return tx ? exec(tx) : (this.prisma as any).$transaction((c: TxClient) => exec(c));
}
```
（`getTransitionMap`、`TERMINAL_STATUSES`、`appendStatusHistory`、`isInternalFundNoUniqueConflict` 均现有。）

- [ ] **Step 4: 跑确认通过** — `npx jest funds-flow.service -i` → PASS

- [ ] **Step 5: Commit**
```bash
git add src/modules/funds-layer/domain/funds-flow.service.ts src/modules/funds-layer/domain/funds-flow.service.spec.ts
git commit -m "feat(funds): createSwapLeg + transitionSwapLeg (swap-owned, no InternalTransaction)"
```

---

## Task 4: SwapSettlementService（编排核心）

**Files:** Create `src/modules/trading/swap-transactions/swap-settlement.service.ts`；Test 同名 `.spec.ts`；register in swap module。

职责：`start(swap, fromIsFiat, amounts, tx)` 建 4 腿(CREATED) + **发起 leg1**（pending 记账 + 腿进首在途态）。`advanceLeg(swapNo, legSeq, action, operator)`：按序守卫→`transitionSwapLeg`→**进首在途态时建 pending**、**CLEAR 时 post + 发起下一腿 / 末腿→swap SUCCESS**、**失败时 void + swap FAILED**。

记账：用 `buildSwapLegPlan` 得每腿 `accounting[]`；amount 由 `amountRef`(from/grossTo/fee) 映射到三个 bigint；ledger 由 `side`(from/to) 映射；resolve 账户用 `accountingService.resolveTbAccountId`（CLIENT_PAYABLE 用 ownerType CUSTOMER+ownerUuid，其余 SYSTEM）。pending 用 `executePendingTransfer`（timeout 0），post 用 `postPendingTransfer`，void 用 `voidPendingTransfer`。pending 的 tbTransferId 存于该腿（见下：腿首在途态时记下每条 pending 的 hex，存 leg.statusHistory 或新字段；最简：用 deterministic id 由 sourceNo+eventCode 复算，post/void 时重算同 id——`executePendingTransfer` 用 `deterministicTransferId(sourceType,sourceNo,eventCode,0)`，故 post/void 时用 `deterministicTransferId('SWAP', swapNo, eventCode, 0)` 复算 pendingTransferId，无需存）。

- [ ] **Step 1: 写失败测试**（mock accountingService + fundsFlow + prisma + swapTransactionsService）

```typescript
// swap-settlement.service.spec.ts
// it('start creates 4 legs and books leg1 pending (2 transfers) + advances leg1 to in-flight')
// it('advanceLeg CLEAR posts leg pending and initiates next leg')
// it('advanceLeg CLEAR on last leg → swap SUCCESS')
// it('advanceLeg FAIL → void pending + swap FAILED')
// it('advanceLeg out-of-order (leg2 before leg1 post) → rejected')
```
（断言：`executePendingTransfer` 调用次数/参数 code、`postPendingTransfer`/`voidPendingTransfer`、`swapTransactionsService.markStatus` 入参。）

- [ ] **Step 2: 跑确认失败** — `npx jest swap-settlement.service -i` → FAIL

- [ ] **Step 3: 实现 SwapSettlementService**（完整新文件）

核心逻辑（伪具体，落地按签名补全）：
```typescript
@Injectable()
export class SwapSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fundsFlow: FundsFlowService,
    private readonly accounting: AccountingService,
    private readonly wallets: SystemWalletResolver,
    private readonly swaps: SwapTransactionsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // amounts: { fromAmountBigint, grossToAmountBigint, feeAmountBigint, fromLedger, toLedger, fromCurrency, toCurrency }
  async start(ctx: SwapSettleCtx, tx: Prisma.TransactionClient) {
    const legs = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat });
    for (const spec of legs) {
      const assetId = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
      const amount = this.amountFor(spec, ctx); // Decimal
      await this.fundsFlow.createSwapLeg(
        { swapTransactionId: ctx.swapId, legSeq: spec.legSeq, assetId, amount }, 'SYSTEM', tx,
      );
    }
    // initiate leg 1 (book pending + advance to first in-flight)
    await this.initiateLeg(ctx, legs[0], tx);
  }

  // book pending accounting for a leg, then advance it CREATED→(SIGN|SUBMIT) by asset type
  private async initiateLeg(ctx, spec, client) {
    for (const a of spec.accounting) {
      const ledger = a.side === 'from' ? ctx.fromLedger : ctx.toLedger;
      const ccy = a.side === 'from' ? ctx.fromCurrency : ctx.toCurrency;
      const amount = this.bigintFor(a.amountRef, ctx);
      if (amount <= 0n) continue; // fee==0 skip
      const debitId = await this.resolve(a.debitCode, ledger, ctx.ownerId);
      const creditId = await this.resolve(a.creditCode, ledger, ctx.ownerId);
      await this.accounting.executePendingTransfer({
        debitAccountId: debitId, creditAccountId: creditId, amount, ledger, code: a.code, timeout: 0,
        evidence: this.ev(ctx, a, ccy), tx: client,
      });
    }
    const legRow = await this.legRow(ctx.swapId, spec.legSeq, client);
    const isFiat = (spec.side === 'from' ? ctx.fromIsFiat : !ctx.fromIsFiat);
    await this.fundsFlow.transitionSwapLeg(legRow.id, isFiat ? InternalFundAction.SUBMIT : InternalFundAction.SIGN, 'SYSTEM', client);
  }

  async advanceLeg(swapNo: string, legSeq: number, action: InternalFundAction, operatorId: string) {
    return this.prisma.$transaction(async (client) => {
      const swap = await this.swaps.findByNoInternal(swapNo, client);
      if (swap.status !== 'SETTLING') throw new BadRequestException('Swap not in SETTLING');
      // sequence guard: all legs < legSeq must be CLEAR
      const legs = await client.internalFund.findMany({ where: { swapTransactionId: swap.id }, orderBy: { legSeq: 'asc' }, include: { asset: true } });
      const target = legs.find((l) => l.legSeq === legSeq);
      if (!target) throw new NotFoundException('leg');
      if (legs.some((l) => (l.legSeq ?? 0) < legSeq && l.status !== 'CLEAR')) throw new BadRequestException('previous leg not cleared');
      const { nextStatus } = await this.fundsFlow.transitionSwapLeg(target.id, action, operatorId, client);
      const ctx = await this.ctxFromSwap(swap, client);
      const spec = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat }).find((s) => s.legSeq === legSeq)!;
      if (nextStatus === InternalFundStatus.CLEAR) {
        await this.postLeg(ctx, spec, client);                    // post all this leg's pendings
        const nextSpec = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat }).find((s) => s.legSeq === legSeq + 1);
        if (nextSpec) await this.initiateLeg(ctx, nextSpec, client);
        else { await this.swaps.markStatus(swap.id, 'SUCCESS', client); this.emitSuccess(swap); }
      } else if (TERMINAL_FAIL.has(nextStatus)) {
        await this.voidLeg(ctx, spec, client);                    // void this leg's pendings
        await this.swaps.markStatus(swap.id, 'FAILED', client);
      }
      return this.legRow(swap.id, legSeq, client);
    });
  }
  // postLeg / voidLeg: for each a in spec.accounting (amount>0): pendingId = deterministicTransferId('SWAP', swapNo, a.eventCode, 0); accounting.postPendingTransfer/voidPendingTransfer({ pendingTransferId, amount, evidence })
  // resolve(code, ledger, ownerId): CLIENT_PAYABLE→{ownerType:'CUSTOMER',ownerUuid:ownerId}; else {ownerType:'SYSTEM'}
}
```
落地要点：① pending id 复算用 `deterministicTransferId`（accounting.types 已导出/在 accounting.service 用）——post/void 用同 `('SWAP', swapNo, eventCode, 0)` 复算，无需新增存储字段；② `markStatus`/`findByNoInternal` 在 Task 5 给 `SwapTransactionsService` 补；③ 钱包 resolve（fromWalletId/toWalletId）用 `SystemWalletResolver`（C_DEP/C_VIBAN 用 resolveCustomer，F_* 用 resolve）填到 createSwapLeg（非必需于记账，但腿要记物理钱包）。

- [ ] **Step 4: 跑确认通过** — `npx jest swap-settlement.service -i` → PASS

- [ ] **Step 5: Commit**
```bash
git add src/modules/trading/swap-transactions/swap-settlement.service.ts src/modules/trading/swap-transactions/swap-settlement.service.spec.ts src/modules/trading/swap-transactions/swap-transactions.module.ts
git commit -m "feat(funds): SwapSettlementService — 4-leg two-phase orchestration"
```

---

## Task 5: 改 executeSwap + swap service（建 SETTLING、调 start、删原子记账）

**Files:** Modify `swap-workflow.service.ts`、`swap-transactions.service.ts`

- [ ] **Step 1: swap service `create` 状态改 SETTLING + 加 `markStatus`/`findByNoInternal`**

`create`：`status: 'SETTLING'`、`completedAt: null`、statusHistory note 改 "Swap settling (legs pending)"；移除 tbFrom/To/Fee transferId 必填（可空）。加：
```typescript
async markStatus(swapId: string, status: string, tx: Prisma.TransactionClient) {
  return tx.swapTransaction.update({ where: { id: swapId }, data: {
    status, completedAt: status === 'SUCCESS' ? new Date() : null,
    statusHistory: /* append */, }});
}
async findByNoInternal(swapNo: string, tx?: Prisma.TransactionClient) { /* findUniqueOrThrow by swapNo include asset */ }
```

- [ ] **Step 2: executeSwap 改**：删 `postSwapLegs` 调用 + 删该私有方法（原子 7 腿）；在事务内建 swap(SETTLING) 后调 `swapSettlement.start(ctx, tx)`；**移除**事务后的 `eventEmitter.emit(SWAP_SUCCEEDED)`（改由 settlement 末腿 CLEAR 时 emit）。保留 L1 eligibility + consumeQuote + 审计 SWAP_CREATED（SWAP_SUCCEEDED 审计移到末腿）。注入 `SwapSettlementService`。

- [ ] **Step 3: 改 swap-workflow 单测**：断言 swap 创建后状态 SETTLING、`swapSettlement.start` 被调、不再原子 post 7 腿。

- [ ] **Step 4: 跑** — `npx jest swap -i` → PASS

- [ ] **Step 5: 全量编译** — `npx tsc --noEmit` → 0 error（修 Task1 留下的引用）

- [ ] **Step 6: Commit**
```bash
git add src/modules/trading/swap-transactions/
git commit -m "refactor(funds): executeSwap creates SETTLING swap + delegates to SwapSettlementService (no atomic posting)"
```

---

## Task 6: Admin simulate 推进端点 + RBAC

**Files:** Modify/Create swap admin controller；`rbac.catalog.ts`

- [ ] **Step 1: 端点**（仿 `settlement-admin.controller.ts` 模式）

```typescript
@Post(':swapNo/legs/:legSeq/advance')
@RequirePermissions(buildPermissionCode('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/advance'))
advanceLeg(@Param('swapNo') swapNo: string, @Param('legSeq') legSeq: string, @Body() dto: { action: InternalFundAction }, @Req() req) {
  return this.swapSettlement.advanceLeg(swapNo, Number(legSeq), dto.action, req.user?.userNo || 'ADMIN');
}
```

- [ ] **Step 2: RBAC 登记**（`rbac.catalog.ts`，TRADING_SWAP_WRITE 组）
```typescript
route('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/advance', 'Advance swap settlement leg', ['TRADING_SWAP_WRITE']),
```

- [ ] **Step 3: sync RBAC + 重启后端**（SUPER_ADMIN 走内存定义，需重启）
Run: `DATABASE_URL=... npm run db:base:sync`（重启在 e2e Task 8 统一做）

- [ ] **Step 4: Commit**
```bash
git add src/modules/trading/swap-transactions/ src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(funds): admin simulate endpoint to advance swap legs + RBAC"
```

---

## Task 7: 失败修复入口（reverse / retry，最小版）

**Files:** Modify `swap-settlement.service.ts`、admin controller、rbac.catalog

- [ ] **Step 1: `reverseSwap(swapNo)`**：仅当 swap=FAILED；对每条**已 POSTED**的腿记账生成反向 `executeTransfer`（debit/credit 互换、同 amount、code 复用 + memo 'REVERSE'），swap 标 `REVERSED`，审计。`retryLeg(swapNo, legSeq)`：对 FAILED 腿重建 pending + 重置腿状态 CREATED→initiate。

- [ ] **Step 2: 端点 + RBAC** `POST /admin/swap-transactions/:swapNo/reverse`、`.../legs/:legSeq/retry`（TRADING_SWAP_WRITE）。

- [ ] **Step 3: 单测** reverse 生成反向分录 + swap REVERSED。Run: `npx jest swap-settlement -i` → PASS

- [ ] **Step 4: Commit**
```bash
git add src/modules/trading/swap-transactions/ src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(funds): swap settlement repair surface (reverse/retry)"
```

---

## Task 8: e2e 验收

**Files:** 无（运行）；如需更新 `scripts/demo-swap.ts` 让其推进 4 腿。

- [ ] **Step 1: 全量单测** — `npm test` → 全绿
- [ ] **Step 2: 重置栈**（fresh TB+DB+seed，起后端）— 见会话既有流程（format TB → seed base+business → 起 node dist/main）
- [ ] **Step 3: 建 swap**（client API 或 demo-swap）→ 断言 swap=SETTLING、4 个 internal_funds 挂在 swap、leg1 pending 记账已现（tb_transfer_evidence transferType=PENDING）
- [ ] **Step 4: 逐腿 advance**（admin 端点：leg1 SIGN→…→CLEAR，leg2…leg4）→ 每腿 CLEAR 后对应 PENDING→POSTED；末腿后 swap=SUCCESS
- [ ] **Step 5: verify:coa** → `ALL INVARIANTS PASS`
- [ ] **Step 6: 失败用例** — 新 swap，leg2 走 FAIL → swap=FAILED、leg2 pending VOIDED；`reverse` → 已 posted 腿冲正、swap=REVERSED；verify:coa 仍平
- [ ] **Step 7: Commit**（如改 demo）
```bash
git add scripts/
git commit -m "test(funds): swap orchestration e2e (legs advance, fail+reverse, coa green)"
```

---

## Self-Review

- **Spec 覆盖**：§3 schema→T1；§4 腿结构→T2；§5 两阶段记账→T4(initiate/post/void)；§6 生命周期+SETTLING→T4/T5；§7 修复→T7；§8 端点→T6；§9 验收→T8。✅
- **占位扫描**：T4 实现给的是带签名的核心逻辑骨架（pending-id 复算策略明确、resolve 规则明确）；执行时按既有 `executePendingTransfer`/`deterministicTransferId` 签名补全——非 TBD。
- **类型一致**：`InternalFundAction`(SIGN/SUBMIT/CONFIRM/CLEAR/FAIL)、`SwapTransactionStatus`(SETTLING/SUCCESS/FAILED/REVERSED)、leg plan 的 code/debitCode/creditCode 跨任务一致；pending→post 用同 `deterministicTransferId('SWAP',swapNo,eventCode,0)`。
- **已知风险**：T5 后 swap 不再原子成功，demo-swap/旧 swap 单测须改（T5/T8 覆盖）；pending-id 复算依赖 `deterministicTransferId` 对同 (sourceNo,eventCode) 稳定——已确认其实现如此。
