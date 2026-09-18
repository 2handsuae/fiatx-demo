# Spec #6 — Swap Fee 并行结算（两 batch 同时启动）

**日期**：2026-06-16
**范围**：swap fee（不动 withdraw fee — withdraw 留下轮）
**前序**：Spec #5（fee_accrual 列表+详情页）已交付

---

## 1. 问题陈述

当前 swap fee 的内部结算编排 **强加了无依据的顺序依赖**：fee batch 必须等 principal batch 的 FIAT_SETTLE_IN hop2 CLEAR 后才被创建。

### 1.1 现状代码链路

```
swap.success
  ↓ (a) 建 Outstanding (OPEN) + principal batch + FIAT_SETTLE_IN transfer
  ↓
  ↓ ... 等 admin/银行推 hop1+hop2 → CLEAR ...
  ↓
  ↓ (b) fiat-settlement-workflow:177 监听 hop2 CLEAR 事件
  ↓     → collectSwapFees(swapId) 触发
  ↓     → 此刻才 accrue + settle：建 FeeAccrual + SWAP_FEE batch + fee transfer
```

`fee-accrual-listener.service.ts:30` 在 SWAP_SUCCEEDED 事件里**显式跳过 fiat-side**：
```ts
if (swap.toAsset?.type !== 'CRYPTO') return;  // ← 跳过 fiat
```

`fiat-fee-collection-workflow.service.ts:17` 的 `collectSwapFees` 在 FIAT_SETTLE_IN hop2 CLEAR 时被 `fiat-settlement-workflow.service.ts:177` 调用。

### 1.2 真实状态（SQL 实证 SWP2606165419）

```
[16:11:22] SWAP_SUCCEEDED — Outstanding 双行建好
            ├ OUT 2123 USDT OPEN
            └ IN 7737.73 AED LOCKED (绑 FIAT_SETTLE_IN transfer)
[此刻] fee_accruals 表里 SWP2606165419 → 0 行
[此刻] settlement_batches 表里 category=SWAP_FEE 关联 SWP2606165419 → 0 行
```

### 1.3 不依赖的铁证

TB 4 笔转账在 swap.success 瞬间已全部 POSTED：
1. SWAP_LOCK_FROM: 客户 USDT → TRADE_CLEARING
2. SWAP_CREDIT_TO: TRADE_CLEARING → 客户 AED (gross)
3. SWAP_SPREAD: TRADE_CLEARING → SPREAD_INCOME (38.99 AED)
4. SWAP_FEE: 客户 AED → FEE_INCOME (10 AED)

复式记账层面 **fee 已经是平台收入**。F_OPS 钱包 mockBalance 在 swap 瞬间已 +48.99 AED 等额预留。fee transfer 是 `F_OPS → F_FEE`（两个平台钱包之间）—— 与客户、与 principal 转账 **完全不耦合**。

---

## 2. 顶层设计

**底层逻辑**：TB 已同时确认 principal 与 fee 收入，**内部 fund transfer 编排也应同时启动两条结算链**。两 batch 各自独立推进、互不依赖、互不阻塞、互不回滚。

**抓手**：
1. SWAP_SUCCEEDED listener 改动：
   - **crypto-side**：保持现状（只 `accrueForSwap`、等 EOD 批量 settle —— 这是 crypto 净额清算的设计意图）
   - **fiat-side**：从"跳过"改为"立即 `accrueForSwap` + 立即 `settle`"（建 SWAP_FEE batch + fee transfer + 翻 FeeAccrual LOCKED）
2. 删除 `fiat-settlement-workflow.service:177` 调 `collectSwapFees` 的链路（fee 不再等 principal hop2 CLEAR）
3. 删除 `fiat-fee-collection-workflow.collectSwapFees` 方法（无人调用、保留 `onFiatWithdrawalSucceeded`）

**闭环边界**：
- ✅ 做：swap fee batch 与 principal batch 同时刻并立
- ❌ 不做：withdraw fee（结构相同问题、留下一轮；当前 `onFiatWithdrawalSucceeded` 不动）
- ❌ 不做：合并成一个 batch（保留 PRINCIPAL / SWAP_FEE 两 category 的领域边界）
- ❌ 不做：动 outstanding 结算链路（只动 fee 一侧）
- ❌ 不做：动 TB 转账时机（TB 已经对、不碰）

---

## 3. 时序图（改后）

```
swap.success (executeSwap tx commit)
  │
  ├── (同步在 swap-workflow tx 内已发生)
  │   ├ Outstanding 双行建好 (OUT OPEN / IN OPEN)
  │   └ 4 笔 TB transfer POSTED
  │
  ↓ emit SWAP_SUCCEEDED 事件 (post-commit)
  │
  ├──→ fee-accrual-listener.onSwapSucceeded (改后无 fiat/crypto 分流)
  │      ├ accrueForSwap: 建 2 行 FeeAccrual ACCRUED
  │      └ settle:
  │          ├ 建 settlement_batch (category='SWAP_FEE')
  │          ├ 建 transfer (path=FIAT_SWAP_FEE_COLLECT / CRYPTO_SWAP_FEE_COLLECT)
  │          └ flip 2 行 FeeAccrual ACCRUED → LOCKED (+ settledByTransferId + lockedAt)
  │
  ├──→ fiat-settlement-workflow.onSwapSucceeded (不变 — principal 路径)
  │      ├ 建 settlement_batch (category='PRINCIPAL')
  │      ├ 建 transfer (path=FIAT_SETTLE_IN, F_OPS→F_SET→C_VIBAN)
  │      └ Outstanding IN: OPEN → LOCKED (绑 transfer)
  │
  ↓ (两条链此刻并立、状态相同：LOCKED + 待 transfer CLEAR)
  ↓
  ↓ ... admin/银行推各自 transfer 的 hop → CLEAR ...
  ↓
  ├─ fee transfer hop CLEAR → fee-accrual.settleByTransfer
  │     └ flip FeeAccrual LOCKED → SETTLED
  │
  └─ principal hop2 CLEAR → outstanding-consumer.settle
        └ flip Outstanding LOCKED → SETTLED
        (不再调 collectSwapFees — 删除)
```

---

## 4. 改动清单

### 4.1 文件级

| 文件 | 改动 | 净行数 |
|---|---|---|
| `src/modules/funds-layer/workflow/fee-accrual-listener.service.ts` | line 30: 删除 `if (swap.toAsset?.type !== 'CRYPTO') return;` 过滤；接 settle 方法（建 batch + transfer + 翻 LOCKED） | +15 / -2 |
| `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts:175-178` | 删除 `if (transfer.pathLabel === TransferPath.FIAT_SETTLE_IN) { ... collectSwapFees(swapId); }` 块 | -5 |
| `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts:17-30` | 删除 `collectSwapFees` 方法（无人调用、`onFiatWithdrawalSucceeded` 保留） | -14 |
| `src/modules/funds-layer/workflow/*.spec.ts` | 测试调整：listener 期望产 fiat fee batch、fiat-settlement-workflow 不再期望 collectSwapFees | ~20 行 |

**总计**：~6 文件、~50 行净改动（含测试）。

### 4.2 listener 改后代码（关键段）

```ts
@OnEvent(DomainEventNames.SWAP_SUCCEEDED)
async onSwapSucceeded(event: { swapId: string }): Promise<void> {
  try {
    const swap = await (this.prisma as any).swapTransaction.findUnique({
      where: { id: event.swapId },
      select: { toAsset: { select: { type: true } } },
    });
    if (!swap) return;

    // (1) Always accrue (was: crypto-only)
    await this.feeAccrual.accrueForSwap(event.swapId, this.prisma);

    // (2) For fiat-side, also immediately settle: build batch + transfer + flip LOCKED
    //     Crypto-side stays ACCRUED and is settled by EOD batch pass.
    if (swap.toAsset?.type === 'FIAT') {
      const accruals = await (this.prisma as any).feeAccrual.findMany({
        where: { sourceType: 'SWAP', sourceId: event.swapId, status: 'ACCRUED' },
      });
      if (accruals.length) {
        await this.feeAccrual.settle(accruals, 'SWAP_FEE', 'FIAT_SWAP', this.prisma);
      }
    }
  } catch (err) {
    this.logger.error(
      `Swap fee settle init failed for swap=${event.swapId}`,
      err instanceof Error ? err.stack : undefined,
    );
  }
}
```

> 注：crypto-side 此刻只 ACCRUED、不 LOCKED；fiat-side 此刻 ACCRUED → LOCKED 一气呵成。crypto 的 LOCKED→SETTLED 由 EOD `eod-settlement-workflow` 负责（与现状一致、不动）。

### 4.3 删除的链路（fiat-settlement-workflow.service.ts:175-178）

```ts
// 删除：
if (transfer.pathLabel === TransferPath.FIAT_SETTLE_IN) {
  const swapId = String(transfer.sourceId || '').split(':')[0];
  if (swapId) await this.feeCollection.collectSwapFees(swapId);
}
```

---

## 5. 状态机两侧对照（改后并立）

| 时刻 | Outstanding (PRINCIPAL batch) | FeeAccrual (SWAP_FEE batch) |
|---|---|---|
| swap.success 瞬间 | OUT OPEN / IN LOCKED | 2 行 ACCRUED → LOCKED |
| 各自 transfer hop CLEAR 时 | IN: LOCKED → SETTLED | 2 行: LOCKED → SETTLED |
| 触发方 | admin/银行推 FIAT_SETTLE_IN hop1+hop2 | admin/银行推 fee transfer 的 hop（fiat 是 1 hop；crypto 是状态机 4 步） |
| 触发独立 | ✅ 是 | ✅ 是（不再依赖 principal） |

---

## 6. 测试覆盖（TDD）

| # | 测试 | 验证 |
|---|---|---|
| 1 | `fee-accrual-listener.spec` SWAP_SUCCEEDED fiat-side | 立即建 FeeAccrual ACCRUED + 立即翻 LOCKED + 建 SWAP_FEE batch + 建 fee transfer |
| 2 | `fee-accrual-listener.spec` SWAP_SUCCEEDED crypto-side | 建 FeeAccrual ACCRUED（不再被 fiat-only return 跳过）、**不**调用 settle、行为与改前一致 |
| 3 | `fiat-settlement-workflow.spec` hop2 CLEAR | 不再调 collectSwapFees（断言 `feeCollection.collectSwapFees` 未被调用） |
| 4 | `fiat-fee-collection-workflow.spec` | `onFiatWithdrawalSucceeded` 保留行为；不再有 `collectSwapFees` 方法 |

---

## 7. 验收（Live Recon）

跑一笔 USDT → AED swap（与之前 SWP2606165419 等价）：

### 7.1 swap.success 瞬间快照（SQL）

```sql
-- 必须立即看到双 batch 双 transfer
SELECT category, batchNo, status FROM settlement_batches
WHERE id IN (
  SELECT DISTINCT settlementBatchId FROM outstandings WHERE swapTransactionId='<id>'
  UNION
  SELECT DISTINCT settlementBatchId FROM fee_accruals WHERE sourceId='<id>'
);
-- 期望：2 行
--   category='PRINCIPAL'  status='CREATED'
--   category='SWAP_FEE'   status='CREATED'

SELECT pathLabel, status FROM internal_transactions
WHERE settlementBatchId IN (...);
-- 期望：2 行
--   pathLabel='FIAT_SETTLE_IN'        status='INTERNAL_FUNDS_PENDING'
--   pathLabel='FIAT_SWAP_FEE_COLLECT' status='INTERNAL_FUNDS_PENDING'

SELECT status, COUNT(*) FROM fee_accruals WHERE sourceNo='SWP...';
-- 期望：LOCKED 2 行（不再是 0、不再延后）

SELECT status, COUNT(*) FROM outstandings WHERE swapTransactionId='<id>';
-- 期望：OPEN 1 + LOCKED 1（与现状相同）
```

### 7.2 推 hop → 最终态（SQL）

推完两 transfer 的 hop 到 CLEAR：

```sql
SELECT status FROM fee_accruals WHERE sourceNo='SWP...';
-- 期望：SETTLED × 2
SELECT status FROM outstandings WHERE swapTransactionId='<id>';
-- 期望：SETTLED × 2
```

### 7.3 audit 链
```sql
SELECT entityType, action FROM audit_log_events 
WHERE traceId='<swap.traceId>' ORDER BY occurredAt;
-- 期望（部分）：
--   SWAP_TRANSACTION   SWAP_SUCCEEDED
--   FEE_ACCRUAL        CREATED × 2  (新增)
--   FEE_ACCRUAL        LOCKED × 2   (新增、settle 瞬间)
--   OUTSTANDING        CREATED × 2
--   OUTSTANDING        LOCKED × 1
-- 后续 transfer CLEAR：
--   FEE_ACCRUAL        SETTLED × 2
--   OUTSTANDING        SETTLED × 1
```

---

## 8. 不做（YAGNI）

- ❌ 不动 withdraw fee 路径（withdraw 留下一轮 / Spec #7 候选）
- ❌ 不合并 PRINCIPAL + SWAP_FEE 成同一 batch（领域边界保留）
- ❌ 不动 TB 转账时机（已正确）
- ❌ 不动 Outstanding 结算路径
- ❌ 不引入新 status 枚举
- ❌ 不动 fee_accrual 数据库 schema（字段已齐）
- ❌ 不动 admin 前端列表/详情页（FeeAccrual 列表会自动展示新数据、无需 UI 改动）

---

## 9. 任务拆解预告（plan 阶段细化）

预计 4 任务：

1. **T1**：`fee-accrual-listener.onSwapSucceeded` 改动 — 去 fiat 过滤 + 接 settle 调用（TDD）
2. **T2**：删 `fiat-settlement-workflow:177` collectSwapFees 调用 + 测试期望调整
3. **T3**：删 `fiat-fee-collection-workflow.collectSwapFees` 方法（无人调用 + 调整 spec）
4. **T4**：Live recon — 跑 1 笔 USDT→AED swap + 7.1/7.2/7.3 SQL 三连验证

---

## 10. 决策记录

| 决策点 | 选择 | 原因 |
|---|---|---|
| 范围 | 仅 swap fee（不动 withdraw） | 用户拍板：scope 控制、心智单一 |
| 合并 batch vs 双 batch 并立 | 双 batch 并立 | 保留 PRINCIPAL/SWAP_FEE 领域边界 + 失败隔离 |
| crypto-side 是否改 | 改（去过滤、走相同代码路径） | 一致性：listener 一律走 accrue+settle、不再区分 |
| 失败隔离 | fee 失败不影响 principal、反之亦然 | 用 listener 各自 try/catch、单点失败不传染 |
| Withdraw 路径 | 不动（留下一轮） | YAGNI、scope 不扩散 |
