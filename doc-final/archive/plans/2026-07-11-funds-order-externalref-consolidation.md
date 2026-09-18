# 资金单 externalRef 生成回写收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 externalRef(虚拟币 txHash / 法币 ReferenceNo)的生成与回写从 deposit/withdraw/swap 三个订单域收口到 `FundsOrderService`——首次到达 CONFIRMED 时按资产类型自铸并落到既有 `txHash`/`referenceNo` 列,账务/对账/前端统一读。

**Architecture:** `FundsOrderService.advance()`/`create()` 内在首达 CONFIRMED 时调 `buildExternalRefPatch()` 铸号(种子=`fundsOrderNo`,复用 `fake-external-refs.util`,幂等);新增 `resolveExternalRef(row)` 供下游读(crypto→txHash / fiat→referenceNo)。三域记账改读 resolver:deposit STEP_1 直读、withdraw 经 `enrichForPost` 读、swap 新增 `enrichForPost` 在 postLeg 补写(对齐 withdraw,替掉 `:pending` 合成串)。外部对账镜像 `writeMirror()` 从 `account_flows.externalRef` 复制,**自动同值**,无需改。

**Tech Stack:** NestJS + Prisma(SQLite)+ TigerBeetle;Jest(mocked-prisma 单测);demo/recon ts-node 脚本作 e2e 门。

**执行前置:** 本工作在 `main` 主工作树。开始编码前**先开分支**(如 `feat/funds-order-externalref-consolidation`),勿直接提交 main。栈用 main 栈(`bash scripts/stack.sh up main`),脚本经 `bash scripts/on-stack.sh main <script>` 包装。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/modules/funds-orders/funds-order.service.ts` | externalRef 唯一 owner:铸造 + 读取访问器 | 改(加 2 方法 + 2 处 wiring) |
| `src/modules/funds-orders/funds-order.service.spec.ts` | 单测 | 改(加铸造/读取用例) |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | 充值记账消费方 | 改(STEP_1 读 resolver) |
| `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` | 提现记账消费方 | 改(recognitionRefs 读 funds_order) |
| `src/modules/trading/swap-transactions/swap-leg-accounting.ts` | 兑换腿记账 helper | 改(注入 TbEvidence + 去合成串 + postLeg enrich) |
| `src/modules/trading/swap-transactions/swap-workflow.service.ts` | 兑换 CONFIRMED 编排 | 改(onLegConfirmed 解析 ref 传入 postLeg) |
| `doc-final/reference/truth/{funds-orders,v6-swap}.md` + `BACKLOG.md` | 真相/账本同步 | 改 |

---

## Task 1: `resolveExternalRef()` 读取访问器

**Files:**
- Modify: `src/modules/funds-orders/funds-order.service.ts`
- Test: `src/modules/funds-orders/funds-order.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `funds-order.service.spec.ts` 的 `describe('FundsOrderService', ...)` 内追加:

```typescript
  describe('resolveExternalRef', () => {
    it('crypto → returns txHash', () => {
      const ref = service.resolveExternalRef({
        asset: { type: 'CRYPTO' }, txHash: '0xabc', referenceNo: 'ZB1',
      } as any);
      expect(ref).toBe('0xabc');
    });

    it('fiat → returns referenceNo', () => {
      const ref = service.resolveExternalRef({
        asset: { type: 'FIAT' }, txHash: '0xabc', referenceNo: 'ZB1',
      } as any);
      expect(ref).toBe('ZB1');
    });

    it('missing asset → defaults CRYPTO → txHash', () => {
      const ref = service.resolveExternalRef({ txHash: '0xabc' } as any);
      expect(ref).toBe('0xabc');
    });

    it('null column → null', () => {
      const ref = service.resolveExternalRef({ asset: { type: 'FIAT' }, referenceNo: null } as any);
      expect(ref).toBeNull();
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/funds-orders/funds-order.service.spec.ts -t resolveExternalRef`
Expected: FAIL — `service.resolveExternalRef is not a function`

- [ ] **Step 3: 实现 `resolveExternalRef`**

在 `funds-order.service.ts` 类内(建议紧接 `findById` 之后)加:

```typescript
  /**
   * externalRef 消费方(账务 evidence / 对账 / admin)统一读取口:
   * crypto → txHash,fiat → referenceNo。单一漏斗,订单域不再各自推导。
   */
  resolveExternalRef(row: {
    asset?: { type?: string | null } | null;
    txHash?: string | null;
    referenceNo?: string | null;
  }): string | null {
    const assetType = (row.asset?.type ?? 'CRYPTO').toUpperCase();
    return assetType === 'CRYPTO' ? row.txHash ?? null : row.referenceNo ?? null;
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/funds-orders/funds-order.service.spec.ts -t resolveExternalRef`
Expected: PASS(4 passing)

- [ ] **Step 5: 提交**

```bash
git add src/modules/funds-orders/funds-order.service.ts src/modules/funds-orders/funds-order.service.spec.ts
git commit -m "feat(funds-order): add resolveExternalRef accessor (crypto→txHash / fiat→referenceNo)"
```

---

## Task 2: `buildExternalRefPatch()` 铸造 + wire 进 create()/advance()

**Files:**
- Modify: `src/modules/funds-orders/funds-order.service.ts`
- Test: `src/modules/funds-orders/funds-order.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 spec 内追加(顶部已 import `FundsOrderAction, FundsOrderStatus`;新增 fake util import):

```typescript
// 文件顶部 import 区追加:
import { fakeChainTxHash, fakeBankRef } from '../../common/utils/fake-external-refs.util';
```

```typescript
  describe('stamp externalRef on reaching CONFIRMED', () => {
    it('crypto OUT: CONFIRMING --CONFIRM--> CONFIRMED mints txHash', async () => {
      const row = {
        id: 'fo1', fundsOrderNo: 'FO-CRYPTO', status: 'CONFIRMING',
        depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
        legSeq: 1, attempt: 1, statusHistory: null, txHash: null, referenceNo: null,
        createdAt: new Date('2026-07-11T00:00:00Z'), asset: { type: 'CRYPTO' },
      };
      prisma.fundsOrder.findUnique.mockResolvedValue(row);
      prisma.fundsOrder.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
      await service.advance('fo1', FundsOrderAction.CONFIRM, 'SYSTEM');
      const updateArg = prisma.fundsOrder.update.mock.calls[0][0];
      expect(updateArg.data.status).toBe('CONFIRMED');
      expect(updateArg.data.txHash).toBe(fakeChainTxHash('FO-CRYPTO'));
      expect(updateArg.data.referenceNo).toBeUndefined();
    });

    it('fiat OUT: SUBMITTED --CONFIRM--> CONFIRMED mints referenceNo', async () => {
      const row = {
        id: 'fo2', fundsOrderNo: 'FO-FIAT', status: 'SUBMITTED',
        depositTransactionId: null, withdrawTransactionId: 'w2', swapTransactionId: null,
        legSeq: 1, attempt: 1, statusHistory: null, txHash: null, referenceNo: null,
        createdAt: new Date('2026-07-11T00:00:00Z'), asset: { type: 'FIAT' },
      };
      prisma.fundsOrder.findUnique.mockResolvedValue(row);
      prisma.fundsOrder.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
      await service.advance('fo2', FundsOrderAction.CONFIRM, 'SYSTEM');
      const updateArg = prisma.fundsOrder.update.mock.calls[0][0];
      expect(updateArg.data.status).toBe('CONFIRMED');
      expect(updateArg.data.referenceNo).toBe(fakeBankRef('FO-FIAT', row.createdAt));
    });

    it('idempotent: existing txHash (crypto deposit inbound) is NOT overwritten', async () => {
      const row = {
        id: 'fo3', fundsOrderNo: 'FO-DEP', status: 'CONFIRMING',
        depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
        legSeq: 1, attempt: 1, statusHistory: null, txHash: '0xINBOUND', referenceNo: null,
        createdAt: new Date('2026-07-11T00:00:00Z'), asset: { type: 'CRYPTO' },
      };
      prisma.fundsOrder.findUnique.mockResolvedValue(row);
      prisma.fundsOrder.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
      await service.advance('fo3', FundsOrderAction.CONFIRM, 'SYSTEM');
      const updateArg = prisma.fundsOrder.update.mock.calls[0][0];
      expect(updateArg.data.txHash).toBeUndefined(); // 保留旧值,不写
    });

    it('non-CONFIRMED transition does not mint', async () => {
      const row = {
        id: 'fo4', fundsOrderNo: 'FO-SUB', status: 'SUBMITTED',
        depositTransactionId: null, withdrawTransactionId: 'w4', swapTransactionId: null,
        legSeq: 1, attempt: 1, statusHistory: null, txHash: null, referenceNo: null,
        createdAt: new Date('2026-07-11T00:00:00Z'), asset: { type: 'CRYPTO' },
      };
      prisma.fundsOrder.findUnique.mockResolvedValue(row);
      prisma.fundsOrder.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
      await service.advance('fo4', FundsOrderAction.OBSERVE_CONFIRMING, 'SYSTEM'); // → CONFIRMING
      const updateArg = prisma.fundsOrder.update.mock.calls[0][0];
      expect(updateArg.data.txHash).toBeUndefined();
      expect(updateArg.data.referenceNo).toBeUndefined();
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/funds-orders/funds-order.service.spec.ts -t "stamp externalRef"`
Expected: FAIL — `update.data.txHash` 为 undefined(尚未铸造)

- [ ] **Step 3: 实现铸造 + wiring**

3a. 顶部 import 区加:

```typescript
import { fakeChainTxHash, fakeBankRef } from '../../common/utils/fake-external-refs.util';
```

3b. 类内加私有铸造方法(建议紧接 `resolveExternalRef` 之后):

```typescript
  /**
   * 资金单首次到达 CONFIRMED 时,按资产类型铸造 externalRef,返回列补丁(无则 null)。
   * 幂等:若对应列已有值(如虚拟币充值由发起方带入的 inbound txHash),保留不覆盖。
   * 确定性种子 = fundsOrderNo → 外部对账镜像(writeMirror 复制 account_flows.externalRef)
   * 构造性同值。方向无关:进/出/兑换腿同规则。
   */
  private buildExternalRefPatch(
    row: { fundsOrderNo: string; txHash?: string | null; referenceNo?: string | null; createdAt?: Date },
    assetType: FundsOrderAssetType,
  ): { txHash: string } | { referenceNo: string } | null {
    if (assetType === 'CRYPTO') {
      if (row.txHash) return null;
      return { txHash: fakeChainTxHash(row.fundsOrderNo) };
    }
    if (row.referenceNo) return null;
    return { referenceNo: fakeBankRef(row.fundsOrderNo, row.createdAt ?? new Date()) };
  }
```

3c. 在 `advance()` 的 `run` 内,把 `update` 那步改为带补丁(`assetType` 上文已算好):

```typescript
      const stampPatch =
        next === FundsOrderStatus.CONFIRMED ? this.buildExternalRefPatch(row, assetType) : null;
      const updated = await client.fundsOrder.update({
        where: { id },
        data: { status: next, statusHistory: JSON.stringify(history), ...(stampPatch ?? {}) },
      });
```

3d. 在 `create()` 里 `const row = await client.fundsOrder.create({...})` 之后、`this.eventEmitter.emit(...)` 之前,加 born-CONFIRMED 铸造(FIAT_IN 出生即 CONFIRMED,不经 advance):

```typescript
    // FIAT_IN 充值出生态即 CONFIRMED(绕过 advance)——同一铸造器补号(幂等:
    // 发起方已带 referenceNo 则为 no-op)。
    if (row.status === FundsOrderStatus.CONFIRMED) {
      const asset = await client.asset.findUnique({ where: { id: input.assetId } });
      const assetType = (asset?.type ?? 'CRYPTO').toUpperCase() as FundsOrderAssetType;
      const patch = this.buildExternalRefPatch(row, assetType);
      if (patch) {
        await client.fundsOrder.update({ where: { id: row.id }, data: patch });
        Object.assign(row, patch);
      }
    }
```

- [ ] **Step 4: 跑测试确认通过(含既有用例不回归)**

Run: `npx jest src/modules/funds-orders/funds-order.service.spec.ts`
Expected: PASS(既有 + 新增全绿)

- [ ] **Step 5: 提交**

```bash
git add src/modules/funds-orders/funds-order.service.ts src/modules/funds-orders/funds-order.service.spec.ts
git commit -m "feat(funds-order): mint externalRef into txHash/referenceNo on reaching CONFIRMED (idempotent, seed=fundsOrderNo)"
```

---

## Task 3: 充值 STEP_1 改读 resolver

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:476-477`

- [ ] **Step 1: 改推导为读 funds_order**

把 `executeDepositAccounting` 里(~476)的:

```typescript
    const externalRef: string | null =
      fundsOrder?.txHash ?? fundsOrder?.referenceNo ?? deposit.txHash ?? deposit.referenceNo ?? null;
```

替换为:

```typescript
    // externalRef 归 funds_order 所有(CONFIRMED 时按资产类型铸)。STEP_1 是外部穿越腿,
    // 读单一源,不再本地 coalesce。STEP_2(下方)是纯重分类,保持 externalRef:null。
    const externalRef: string | null = fundsOrder
      ? this.fundsOrders.resolveExternalRef(fundsOrder)
      : null;
```

> `this.fundsOrders` 已注入(本文件已用 `this.fundsOrders.findById`);`fundsOrder` 由 `onPayinConfirmed` 经 `findById` 传入,含 `asset`。STEP_2 的 `externalRef: null`(~556)不动。

- [ ] **Step 2: tsc 通过**

Run: `npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 3: e2e 验证(充值)**

```bash
bash scripts/stack.sh up main
bash scripts/on-stack.sh main main:reset:base
bash scripts/on-stack.sh main demo:deposit
```
Expected: 脚本 PASS。随后查最近充值资金单已回写号:

```bash
sqlite3 /tmp/exchange_js_main/dev.db \
 "SELECT fundsOrderNo, status, substr(txHash,1,10), referenceNo FROM funds_orders WHERE depositTransactionId IS NOT NULL ORDER BY createdAt DESC LIMIT 3;"
```
Expected: CLEARED 单的 txHash(crypto)或 referenceNo(fiat)非空。

- [ ] **Step 4: 提交**

```bash
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts
git commit -m "refactor(deposit): read externalRef from funds_order.resolveExternalRef (STEP_1)"
```

---

## Task 4: 提现两腿改读 funds_order

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`(`recognitionRefs` + 两处调用点)

- [ ] **Step 1: 改 `recognitionRefs` 签名读 funds_order**

把(~944):

```typescript
  private recognitionRefs(w: any): { walletRef: string | null; externalRef: string | null } {
    return {
      walletRef: w.fromWalletId ?? null,
      externalRef: w.txHash ?? w.referenceNo ?? null,
    };
  }
```

改为:

```typescript
  // walletRef 仍取客户源钱包;externalRef 归 funds_order(CONFIRMED 时按类型铸)。
  private recognitionRefs(w: any, fo: any): { walletRef: string | null; externalRef: string | null } {
    return {
      walletRef: w.fromWalletId ?? null,
      externalRef: fo ? this.fundsOrders.resolveExternalRef(fo) : null,
    };
  }
```

- [ ] **Step 2: 改两处调用点传入 funds_order**

`onPayoutLegConfirmed`(~978)把:

```typescript
    const { walletRef, externalRef } = this.recognitionRefs(w);
```

改为:

```typescript
    const fo = await this.fundsOrders.findById(fundsOrderId);
    const { walletRef, externalRef } = this.recognitionRefs(w, fo);
```

`onFeeLegConfirmed`(~1052)同样把 `const { walletRef, externalRef } = this.recognitionRefs(w);` 改为上面两行(该方法签名已有 `fundsOrderId` 参数)。

> `this.fundsOrders` 已注入(本文件已用 `this.fundsOrders.advance`);`findById` 含 `asset`。

- [ ] **Step 3: tsc 通过**

Run: `npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 4: e2e 验证(提现)**

```bash
bash scripts/on-stack.sh main demo:withdraw
sqlite3 /tmp/exchange_js_main/dev.db \
 "SELECT fundsOrderNo, legSeq, status, substr(txHash,1,10), referenceNo FROM funds_orders WHERE withdrawTransactionId IS NOT NULL ORDER BY createdAt DESC LIMIT 4;"
```
Expected: 提现资金单(此前 txHash 恒 null)现 CONFIRMED/CLEARED 单已回写号。

- [ ] **Step 5: 提交**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "refactor(withdraw): read externalRef from funds_order.resolveExternalRef (payout+fee legs)"
```

---

## Task 5: 兑换去合成串 + postLeg enrich 真实号

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-leg-accounting.ts`(注入 TbEvidence + 去合成串 + postLeg enrich)
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`(`onLegConfirmed` 解析 ref 传入)

- [ ] **Step 1: 给 `SwapLegAccounting` 注入 `TbEvidenceService` + import `bigintToHex`**

改 import(第 8 行)追加 `bigintToHex`,并新增 TbEvidence import:

```typescript
import { deterministicTransferId, bigintToHex } from '../../accounting/tigerbeetle/utils/tb-id.util';
import { TbEvidenceService } from '../../accounting/tigerbeetle/tb-evidence.service';
```

构造器(第 36-39 行)改为:

```typescript
  constructor(
    private readonly accounting: AccountingService,
    private readonly wallets: SystemWalletResolver,
    private readonly tbEvidence: TbEvidenceService,
  ) {}
```

> `TbEvidenceService` 在 trading 域已可注入(withdraw-workflow 已注入使用)。若编译报未 provider,确认 swap 模块 imports 了 accounting 模块并导出了 `TbEvidenceService`(与 withdraw 同源)。

- [ ] **Step 2: `initiateLegPending` 去掉合成串**

把(~294-299):

```typescript
    // Phase B: every swap leg is a real cross-wallet movement (per swap-leg-plan
    // there are no pure-bookkeeping legs). externalRef = `${swapNo}:${legSeq}:${attempt}:pending`
    // serves as the cross-validation key — swaps don't broadcast on-chain, so the
    // swap-internal reference IS sufficient for §8 recon. The attempt segment lets
    // the same swap+legSeq retain distinct refs across self-heal retries (Swap-6).
    const attempt = ctx.attempt ?? 1;
    const externalRef = `${ctx.swapNo}:${spec.legSeq}:${attempt}:pending`;
```

改为:

```typescript
    // Phase B: every swap leg is a real cross-wallet movement (per swap-leg-plan
    // there are no pure-bookkeeping legs). externalRef 归 funds_order 所有,在腿达到
    // CONFIRMED 时由 postLeg → enrichForPost 补写真实铸号;pending 行此刻不带 ref。
    const attempt = ctx.attempt ?? 1;
```

并把该 `for` 循环内 `this.evidence(ctx, a, {...})` 的 `externalRef` 字段删掉(保留 walletRef + `isExternalCrossing: true`):

```typescript
        evidence: this.evidence(ctx, a, {
          debitWalletRef,
          creditWalletRef,
          isExternalCrossing: true,
        }),
```

- [ ] **Step 3: `postLeg` 加 externalRef 参数 + enrich**

把(~330-348)整个 `postLeg` 改为:

```typescript
  async postLeg(
    ctx: SwapSettleCtx,
    spec: SwapLegSpec,
    client: any,
    externalRef?: string | null,
  ): Promise<void> {
    const attempt = ctx.attempt ?? 1;
    for (const a of spec.accounting) {
      const amt = this.amountBigint(a.amountRef, ctx);
      if (amt <= 0n) continue;
      const pendingId = deterministicTransferId('SWAP', ctx.swapNo, a.eventCode, attempt);
      await this.accounting.postPendingTransfer({
        pendingTransferId: pendingId,
        amount: amt,
        evidence: this.evidence(ctx, a),
        tx: client,
      });
      // postPendingTransfer 只翻转 transferType,不重写字段。用 enrichForPost 把
      // funds_order 铸的真实 externalRef 盖进 POSTED evidence 并重投影 account_flows。
      if (externalRef) {
        await this.tbEvidence.enrichForPost(
          bigintToHex(pendingId),
          { externalRef, isExternalCrossing: true },
          client,
        );
      }
    }
  }
```

- [ ] **Step 4: `onLegConfirmed` 解析 ref 传入 postLeg**

在 `swap-workflow.service.ts` 的 `onLegConfirmed`(~515)把:

```typescript
    await this.swapLegAccounting.postLeg(
      { ...ctx, attempt: event.attempt },
      spec,
      client,
    );
```

改为:

```typescript
    // 铸号已在 advance()→CONFIRMED 落到 leg funds_order(事件先于此提交)。读回真实号
    // 传入 postLeg,由 enrichForPost 盖进 evidence + account_flows。
    const legFo = await this.fundsOrders.findById(event.fundsOrderId);
    const externalRef = legFo ? this.fundsOrders.resolveExternalRef(legFo) : null;
    await this.swapLegAccounting.postLeg(
      { ...ctx, attempt: event.attempt },
      spec,
      client,
      externalRef,
    );
```

- [ ] **Step 5: tsc 通过**

Run: `npx tsc --noEmit`
Expected: 0 error

- [ ] **Step 6: e2e 验证(兑换)**

```bash
bash scripts/on-stack.sh main demo:swap
# 4 腿资金单已铸真实号,account_flows 无 :pending 残留:
sqlite3 /tmp/exchange_js_main/dev.db \
 "SELECT COUNT(*) AS pending_leftover FROM account_flows WHERE externalRef LIKE '%:pending';"
```
Expected: `pending_leftover = 0`;swap 腿资金单 `txHash`/`referenceNo` 非空。

- [ ] **Step 7: 提交**

```bash
git add src/modules/trading/swap-transactions/swap-leg-accounting.ts src/modules/trading/swap-transactions/swap-workflow.service.ts
git commit -m "fix(swap): replace :pending synthetic externalRef with funds_order-minted ref via enrichForPost"
```

---

## Task 6: 全量门 + 文档同步

**Files:**
- Modify: `doc-final/reference/truth/v6-swap.md`、`doc-final/reference/truth/funds-orders.md`、`doc-final/BACKLOG.md`
- Verify only: `scripts/recon-demo.ts`(mirror 自动同值,无需改)

- [ ] **Step 1: 硬门全绿**

```bash
bash scripts/on-stack.sh main demo:all          # Expected: 8/8 PASS
bash scripts/on-stack.sh main recon:demo:reset
bash scripts/on-stack.sh main recon:demo:pass    # Expected: PASS(mirror 从 account_flows 复制真号)
bash scripts/on-stack.sh main recon:demo:break   # Expected: 桶判定不回退
bash scripts/on-stack.sh main verify:coa         # Expected: ALL INVARIANTS PASS
npx tsc --noEmit                                  # Expected: 0 error
npx jest src/modules/funds-orders                 # Expected: PASS
```

> 若 `recon:demo:pass` 出现 externalRef 不匹配,读 `scripts/recon-demo.ts → writeMirror()`(第 524/536 行取 `l.externalRef`)与 Phase 1 account_flow 拉取,确认 flow.externalRef 已带真号;正常情况下**无需改脚本**。

- [ ] **Step 2: 同步 `truth/v6-swap.md`**

把 §0 定位行(约第 11 行)里 `资金不出境、无外部对手方` 改为:

```
平台内兑换（crypto↔fiat 余额交换，在我方掌控的账户体系内做真实转账，故每腿有真实 externalRef）
```

- [ ] **Step 3: 同步 `truth/funds-orders.md`**

- §3 加锚点:`funds-order.service.ts → resolveExternalRef()/buildExternalRefPatch()`(首达 CONFIRMED 铸号,种子=fundsOrderNo,幂等)。
- §4 已知缺口移除"swap `:pending` 合成串"相关项;补一句"externalRef 收口 owner=funds_order,消费方读 resolveExternalRef"。
- 刷新 `Last Verified: 2026-07-11`。

- [ ] **Step 4: 同步 `BACKLOG.md`**

- 勾掉 V6 段"FAILED/REVERSED / `:pending`"相关的 externalRef 条目(合成串已除)。
- 新登记一行:`client-web Deposit.tsx 铸号种子用 walletId 而非 fundsOrderNo(与 canonical fake-external-refs 不一致,不影响匹配,未来可统一)｜来源: 2026-07-11 externalRef 收口`。

- [ ] **Step 5: 提交**

```bash
git add doc-final/reference/truth/v6-swap.md doc-final/reference/truth/funds-orders.md doc-final/BACKLOG.md
git commit -m "docs(truth): sync externalRef consolidation — funds_order owns ref, purge swap no-external framing"
```

---

## 完成判定(对齐 spec §5 验收)

- □ 提现/兑换资金单 CONFIRMED 后 `txHash`(crypto)/`referenceNo`(fiat)非空。
- □ `account_flows` 无 `:pending` 残留;swap Pass1 可同 ref 互证。
- □ 充值沿用发起方带入号(幂等未覆盖),对账仍匹配。
- □ `demo:all` 8/8、`recon:demo:pass` PASS、`recon:demo:break` 不回退、`verify:coa` PASS、`tsc` 0、`jest funds-orders` PASS。
- □ 四份文档(v6-swap / funds-orders / BACKLOG + swap 注释)口径同步。
