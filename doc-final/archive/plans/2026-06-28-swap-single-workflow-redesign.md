# V6 兑换单一工作流 + 自愈多腿重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把兑换收敛成唯一 `SwapWorkflowService`（删"结算"概念）；4 腿陆续创建、admin 逐腿推进、先收后付；腿失败自动 void+重建（≤3 次）→ 超限 NEEDS_REVIEW 人工挂起，永不整笔回滚。

**Architecture:** `SwapWorkflowService`（L3 唯一当家）持有建单/逐腿推进/成功/自愈/恢复 + 全部审计与事件；`SwapSettlementService` 删除，纯 TB 记账机械降为无状态 `SwapLegAccounting` helper；domain `SwapTransactionsService` 不变（清 legacy 死码）。swap 主状态收敛为 PROCESSING/SUCCESS，腿承载全部细分 + `attempt`/`NEEDS_REVIEW`，swap 加派生投影 `currentStage`/`needsReview`。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle；`@nestjs/event-emitter`；测试 jest + e2e `demo:swap`/`verify:coa`。

**Spec:** `doc-final/superpowers/specs/2026-06-28-swap-single-workflow-redesign-design.md`

**前置约束：**
- 分支 `refactor/v4-v5-three-layer`（**不新建分支**）。
- **共用工作树**：用户在 Trae 并行编辑 `src/modules/clearing-settle/reconciliation/**` 与 `admin-web/.../Reconciliation*`。**永不碰 reconciliation 文件**；**提交一律显式路径**（`git add <具体文件>`，禁 `git add -A`）；提交后 `git show --stat HEAD` 自检仅含本任务文件。
- 验收用 main 栈或 claude 验收栈；`verify:coa` 需注入 env：`DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003`。
- 每 Task 独立 commit、可单步回滚。

---

## 关键数据/语义约定（全计划共用）

- **腿键**：InternalFund 行按 `(swapTransactionId, legSeq, attempt)`。同 legSeq 可多条（失败留 FAILED/NEEDS_REVIEW 历史 + 新 attempt）。
- **活跃腿(legSeq)** = 该 legSeq 下 **attempt 最大**那条。其 status 即该腿当前态。
- **SUCCESS 条件** = legSeq 1..4 每个的活跃腿都 `CLEAR`。
- **currentStage** = 活跃腿非 CLEAR 的**最小 legSeq** 的角色（SELL/BUY/FEE；leg2 归集映射 SELL 同段或 'SETTLING'）。`needsReview` = 任一活跃腿为 `NEEDS_REVIEW`。
- **N = 3**（每 legSeq 最大尝试次数）。
- **先收后付** = legSeq 升序推进 + 现有 sequence guard（前序腿未 CLEAR 不可推后腿）；leg1 恒为 SELL_CLIENT（`swap-leg-plan.constant.ts` 已是此序）。

---

## 文件改动地图

**新增：**
- `src/modules/trading/swap-transactions/swap-leg-accounting.ts` — 无状态 TB 记账 helper（initiate/post/void + ctx/evidence/walletRef）
- `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts` — 新工作流测试

**重写/改：**
- `swap-workflow.service.ts` — 吸收 start/advanceLeg/self-heal/resume + 审计/事件
- `swap-transactions.service.ts` — findOne 清 legacy；markStatus 收敛；新增 `recomputeProjections`
- `swap-transactions.controller.ts`（admin）— advance/resume 重接 workflow、删 reverse
- `funds-flow.service.ts` — createSwapLeg 加 `attempt`；transitionSwapLeg 支持 NEEDS_REVIEW
- audit-actions / internal-fund.dto / domain-events — 新增常量
- `prisma/schema.prisma` + migration — InternalFund.attempt + NEEDS_REVIEW；SwapTransaction.currentStage/needsReview
- `admin-web` swap 详情/列表页
- `scripts/demo-lib.ts` — driveSwapToSuccess 适配

**删：**
- `swap-settlement.service.ts`（整文件）+ 其 spec

---

## Task 0: 基线锚定

**Files:** 无

- [ ] **Step 1: 确认分支 + 起栈**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git rev-parse --abbrev-ref HEAD   # 期望 refactor/v4-v5-three-layer
bash scripts/stack.sh up main 2>/dev/null || true
```

- [ ] **Step 2: 记录 swap 基线绿态**

Run:
```bash
npm run demo:swap 2>&1 | tail -8
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 npm run verify:coa 2>&1 | tail -4
npx jest src/modules/trading/swap-transactions --silent 2>&1 | grep -E "Tests:|FAIL"
```
Expected: demo:swap SUCCESS；verify:coa ALL PASS；jest 记下基线失败数（预期含 swap 侧 0 或既有失败）。**记此为基线**。

- [ ] **Step 3: 提交 spec + plan**
```bash
git add doc-final/superpowers/specs/2026-06-28-swap-single-workflow-redesign-design.md doc-final/superpowers/plans/2026-06-28-swap-single-workflow-redesign.md
git commit -m "docs(swap): single-workflow + self-heal multi-leg redesign spec & plan"
```

---

## Task 1: 常量 + 枚举 + DB 迁移（机械）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/funds-layer/dto/internal-fund.dto.ts`
- Modify: `prisma/schema.prisma`
- Create: migration via `npx prisma migrate dev`

- [ ] **Step 1: 新增 4 个审计动作**

在 `audit-actions.constant.ts` 的 `SWAP_REVERSED: 'SWAP_REVERSED',` 行后插入：
```typescript
  SWAP_LEG_POSTED: 'SWAP_LEG_POSTED',
  SWAP_LEG_RETRIED: 'SWAP_LEG_RETRIED',
  SWAP_LEG_STUCK: 'SWAP_LEG_STUCK',
  SWAP_LEG_RESUMED: 'SWAP_LEG_RESUMED',
```

- [ ] **Step 2: InternalFundStatus 加 NEEDS_REVIEW**

在 `internal-fund.dto.ts` 的 `InternalFundStatus` 枚举 `RETURNED = 'RETURNED',` 后加：
```typescript
  NEEDS_REVIEW = 'NEEDS_REVIEW',
```

- [ ] **Step 3: schema 加列**

在 `prisma/schema.prisma`：
- `model InternalFund` 加：`attempt Int @default(1)`
- `model SwapTransaction` 加：`currentStage String?` 和 `needsReview Boolean @default(false)`

- [ ] **Step 4: 生成迁移**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx prisma migrate dev --name swap_self_heal_legs --create-only
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx prisma migrate deploy
npx prisma generate
```
Expected: 迁移文件生成 + 应用；client 重新生成。

- [ ] **Step 5: 编译 + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → 无错误。
```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/funds-layer/dto/internal-fund.dto.ts prisma/schema.prisma prisma/migrations
git commit -m "feat(swap): add leg audit actions + NEEDS_REVIEW + attempt/projection columns"
```

---

## Task 2: 抽出无状态 `SwapLegAccounting` helper

**Files:**
- Create: `src/modules/trading/swap-transactions/swap-leg-accounting.ts`

- [ ] **Step 1: 新建 helper（从 settlement 逐字搬纯记账机械）**

把 `swap-settlement.service.ts` 中**纯 TB 记账**部分搬入新 helper，**去掉所有审计/事件/状态/markStatus**：`SwapSettleCtx` 接口、`amountDecimal/amountBigint/decimalToBigint/ledgerFor/currencyFor/legPrimaryAmountDecimal/resolveAcct/evidence/resolveWallet/walletRefForCode/resolveLegWalletRefs/ctxFromSwap`，以及三个动作 `initiateLegPending/postLeg/voidLeg`。helper 仅注入 `AccountingService` + `SystemWalletResolver`。签名：
```typescript
@Injectable()
export class SwapLegAccounting {
  constructor(
    private readonly accounting: AccountingService,
    private readonly wallets: SystemWalletResolver,
  ) {}
  ctxFromSwap(swap: any): SwapSettleCtx { /* 迁移，保留 SWAP_UNRESOLVABLE_LEDGER 抛错 */ }
  async initiateLegPending(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> { /* 迁移 */ }
  async postLeg(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> { /* 迁移 */ }
  async voidLeg(ctx: SwapSettleCtx, spec: SwapLegSpec, client: any): Promise<void> { /* 迁移 */ }
  // + 上述私有 helper 全部迁入
}
export { SwapSettleCtx } from /* 就地定义 */;
```
> 注：`postLeg/voidLeg` 用 `deterministicTransferId('SWAP', swapNo, eventCode, 0)` 定位 pending——**第 4 参数 attempt 维度**：本任务保持 `0`（与现状一致），Task 6 自愈重建时改用 `attempt` 以避免 deterministic-id 冲突（见 Task 6 Step 3）。

- [ ] **Step 2: 注册 + 编译**

在 `swap-transactions.module.ts` 的 providers 加 `SwapLegAccounting`。
Run: `npx tsc --noEmit -p tsconfig.json` → 无错误（helper 暂无人调用）。

- [ ] **Step 3: commit**
```bash
git add src/modules/trading/swap-transactions/swap-leg-accounting.ts src/modules/trading/swap-transactions/swap-transactions.module.ts
git commit -m "refactor(swap): extract stateless SwapLegAccounting helper (TB mechanics only)"
```

---

## Task 3: domain — 活跃腿/投影/markStatus 收敛 + 清 legacy

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`
- Test: `src/modules/trading/swap-transactions/swap-transactions.service.spec.ts`

- [ ] **Step 1: 写失败测试（findOne 不再含 legacy fundsOrders）**

把现有 2 个 `findOne attaches fundsOrders` 陈旧测试**改写**为新契约：findOne 返回 `internalFunds`（腿）且**不含** `fundsOrders` 键。断言 `result.fundsOrders` 为 `undefined`、`result.internalFunds` 为数组。
Run: `npx jest swap-transactions.service.spec -t "findOne" -v` → FAIL（当前仍返回 fundsOrders）。

- [ ] **Step 2: 清 legacy + 加投影/活跃腁工具**

`swap-transactions.service.ts`：
- `findOne`：删 `internalTransferService.findFundsOrderBySource` 调用与 `fundsOrders` 字段；移除 `InternalTransferService` import + 构造注入（确认无其他用法）。返回只含 `internalFunds`（腿，按 legSeq asc、attempt asc）。
- 新增：
```typescript
  /** 活跃腁 = 每个 legSeq 下 attempt 最大那条。 */
  async activeLegsBySeq(swapId: string, tx?: Prisma.TransactionClient) {
    const client: any = tx ?? this.prisma;
    const rows = await client.internalFund.findMany({
      where: { swapTransactionId: swapId },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'desc' }],
    });
    const seen = new Set<number>(); const active: any[] = [];
    for (const r of rows) { if (!seen.has(r.legSeq)) { seen.add(r.legSeq); active.push(r); } }
    return active; // 每 legSeq 一条（attempt 最大）
  }

  /** 从活跃腿重算 currentStage/needsReview 投影并落库。legRole(legSeq)→SELL/SETTLE/BUY/FEE 由调用方传角色映射。 */
  async recomputeProjections(swapId: string, stageOf: (legSeq: number) => string, tx: Prisma.TransactionClient) {
    const active = await this.activeLegsBySeq(swapId, tx);
    const needsReview = active.some((l) => l.status === 'NEEDS_REVIEW');
    const working = active.filter((l) => l.status !== 'CLEAR').sort((a,b)=>a.legSeq-b.legSeq)[0];
    const currentStage = working ? stageOf(working.legSeq) : null;
    await (tx as any).swapTransaction.update({ where: { id: swapId }, data: { currentStage, needsReview } });
  }
```
- `markStatus`：仅允许写 `SUCCESS`（PROCESSING 是建单初值）；删除任何 `FAILED/REVERSED` 写入路径的调用点将在 Task 5/10 处理，本任务不主动写这两态。

- [ ] **Step 3: 跑测试通过**

Run: `npx jest swap-transactions.service.spec -t "findOne" -v` → PASS。

- [ ] **Step 4: 编译 + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → 无错误。
```bash
git add src/modules/trading/swap-transactions/swap-transactions.service.ts src/modules/trading/swap-transactions/swap-transactions.service.spec.ts
git commit -m "refactor(swap-domain): drop legacy fundsOrders; add activeLegsBySeq + recomputeProjections"
```

---

## Task 4: workflow 接管建单（陆续：只建 leg1）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Modify: `src/modules/funds-layer/domain/funds-flow.service.ts`（createSwapLeg 加 attempt）

- [ ] **Step 1: createSwapLeg 加 attempt 参数**

`funds-flow.service.ts` `createSwapLeg`：入参对象加 `attempt?: number`（默认 1），写入 InternalFund.create 的 `data.attempt = input.attempt ?? 1`。

- [ ] **Step 2: workflow.executeSwap 改为只建 leg1**

`swap-workflow.service.ts`：注入 `SwapLegAccounting`（替代 `SwapSettlementService`）。把现在调用 `swapSettlement.start(...)` 的那段，改为**进度式建单**——只创建 legSeq=1、initiate 其 pending、推第 1 跳：
```typescript
    // 取 leg plan，只建 leg1
    const legs = buildSwapLegPlan({ fromIsFiat: fromAsset?.type === 'FIAT' });
    const spec1 = legs[0]; // 恒为 SELL_CLIENT（先收后付）
    const assetId1 = spec1.side === 'from' ? quote.fromAssetId : quote.toAssetId;
    const amount1 = /* spec1 主腿金额，按 amountRef */;
    const fromW = await /* best-effort resolveWallet(assetId1, spec1.fromRole) */;
    const toW = await /* best-effort resolveWallet(assetId1, spec1.toRole) */;
    await this.fundsFlow.createSwapLeg({ swapTransactionId: swap.id, legSeq: 1, attempt: 1, assetId: assetId1, amount: amount1, fromWalletId: fromW, toWalletId: toW }, 'SYSTEM', tx);
    const ctx = this.swapLegAccounting.ctxFromSwap({ ...swap, fromAsset, toAsset });
    await this.swapLegAccounting.initiateLegPending(ctx, spec1, tx);
    const leg1Action = fromAsset?.type === 'FIAT' ? InternalFundAction.SUBMIT : InternalFundAction.SIGN;
    const leg1 = await tx.internalFund.findFirst({ where: { swapTransactionId: swap.id, legSeq: 1, attempt: 1 } });
    await this.fundsFlow.transitionSwapLeg(leg1!.id, leg1Action, 'SYSTEM', tx);
    await this.swapTransactionsService.recomputeProjections(swap.id, (n) => stageOf(legs, n), tx);
```
（`stageOf(legs, legSeq)`：从 spec 角色推 SELL/SETTLE/BUY/FEE——把它做成 workflow 私有工具。）
保留现有 `SWAP_CREATED` 审计与 catch 内 `SWAP_FAILED`（建单失败）不变。

- [ ] **Step 3: 验证建单只产生 leg1**

Run: `npx tsc --noEmit -p tsconfig.json` → 无错误。
（行为验证留到 Task 5 接上 advance 后，用 demo:swap 端到端。）

- [ ] **Step 4: commit**
```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/funds-layer/domain/funds-flow.service.ts
git commit -m "feat(swap): workflow owns create — progressive leg1 only (sell-first)"
```

---

## Task 5: workflow.advanceLeg —逐腿推进 + 陆续建下一腿 + SUCCESS（TDD）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`（新建）

- [ ] **Step 1: 写失败测试（末腁 CLEAR → SUCCESS；非末腿 CLEAR → 陆续建下一腿）**

新建 spec，mock funds-flow/legAccounting/swaps/audit/eventEmitter。用例：
1. 推进 legSeq=1 到 CLEAR（非末腿）→ 断言 `legAccounting.postLeg` 调用 + `fundsFlow.createSwapLeg` 以 legSeq=2/attempt=1 被调（陆续建腿）+ swap 仍 PROCESSING。
2. 推进 legSeq=4 到 CLEAR（末腿）→ 断言 `swaps.markStatus(_, 'SUCCESS', _)` + 写 `SWAP_SUCCEEDED` 审计 + emit `SWAP_SUCCEEDED`。
Run: `npx jest swap-workflow.service.spec -t "advance" -v` → FAIL（方法未实现）。

- [ ] **Step 2: 实现 advanceLeg（从 settlement 迁 + 进度式建腿）**

`SwapWorkflowService.advanceLeg(swapNo, legSeq, action, operatorId)`：开 `$transaction`，迁移 settlement.advanceLeg 的：取 swap（须 PROCESSING）、**活跃腁定位**（用 `activeLegsBySeq` 取该 legSeq 的 attempt 最大行作为 target）、sequence guard（前序 legSeq 活跃腿须 CLEAR）、若 target CREATED 先 `legAccounting.initiateLegPending`、`fundsFlow.transitionSwapLeg`。然后：
```typescript
      if (nextStatus === 'CLEAR') {
        await this.swapLegAccounting.postLeg(ctx, spec, client);
        await this.auditLogs.recordSystem({ action: AuditActions.SWAP_LEG_POSTED, /* swap 实体, legSeq metadata */ }, client);
        const isLast = !allSpecs.some((s) => s.legSeq === legSeq + 1);
        if (isLast) {
          await this.swaps.markStatus(swap.id, 'SUCCESS', client);
          await this.auditLogs.recordSystem({ action: AuditActions.SWAP_SUCCEEDED, /* ... */ }, client);
          emitSuccess = true; /* 捕获 id/no/owner */
        } else {
          // 陆续建下一腁 + initiate
          const nextSpec = allSpecs.find((s) => s.legSeq === legSeq + 1)!;
          const nAssetId = nextSpec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
          const nAmount = this.legPrimaryAmount(nextSpec, ctx);
          const fW = await /* resolveWallet */; const tW = await /* resolveWallet */;
          await this.fundsFlow.createSwapLeg({ swapTransactionId: swap.id, legSeq: legSeq + 1, attempt: 1, assetId: nAssetId, amount: nAmount, fromWalletId: fW, toWalletId: tW }, 'SYSTEM', client);
          await this.swapLegAccounting.initiateLegPending(ctx, nextSpec, client);
          const a = nextSpec.side === 'from' && ctx.fromIsFiat ? InternalFundAction.SUBMIT : InternalFundAction.SIGN; // 起跳 action 按 side
          const nl = await client.internalFund.findFirst({ where: { swapTransactionId: swap.id, legSeq: legSeq + 1, attempt: 1 } });
          await this.fundsFlow.transitionSwapLeg(nl.id, a, 'SYSTEM', client);
        }
        await this.swapTransactionsService.recomputeProjections(swap.id, (n) => this.stageOf(allSpecs, n), client);
      }
      // 失败分支留到 Task 6
```
事务提交后 emit `SWAP_SUCCEEDED`（沿用 settlement 现有 post-commit emit 写法）。

- [ ] **Step 3: 跑测试通过**

Run: `npx jest swap-workflow.service.spec -t "advance" -v` → PASS。

- [ ] **Step 4: commit**
```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "feat(swap): workflow.advanceLeg — post + progressive next-leg + SUCCESS (no settlement)"
```

---

## Task 6: 自愈失败 — void + 重建 attempt+1，≤3 次 → NEEDS_REVIEW（TDD）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Modify: `src/modules/trading/swap-transactions/swap-leg-accounting.ts`（postLeg/voidLeg 用 attempt 维度的 deterministic id）
- Test: `swap-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试**

用例：
1. 推进某腿到 FAILED（attempt=1）→ 断言 `legAccounting.voidLeg` 调用 + `fundsFlow.createSwapLeg` 以同 legSeq/attempt=2 被调 + 写 `SWAP_LEG_RETRIED` + swap 仍 PROCESSING（**不**调 markStatus FAILED）。
2. 同 legSeq 连续失败到 attempt=3 再失败 → 断言**不再**建新 attempt，活跃腁置 `NEEDS_REVIEW`（`fundsFlow.transitionSwapLeg`/直接 update 到 NEEDS_REVIEW）+ 写 `SWAP_LEG_STUCK` + `recomputeProjections` 使 `needsReview=true`。
Run: `npx jest swap-workflow.service.spec -t "self-heal" -v` → FAIL。

- [ ] **Step 2: deterministic id 加 attempt 维度**

`swap-leg-accounting.ts` `initiateLegPending/postLeg/voidLeg`：把 `deterministicTransferId('SWAP', ctx.swapNo, a.eventCode, 0)` 的第 4 参数从 `0` 改为传入的 `attempt`（ctx 加 `attempt` 字段，或方法签名加 `attempt` 入参）。externalRef 也带 attempt：`${swapNo}:${legSeq}:${attempt}:pending`。**保证每次重试用不同 pending id，不撞已 void 的旧 id。**

- [ ] **Step 3: 实现自愈分支（advanceLeg 的 TERMINAL_FAIL 分支）**

在 Task 5 的 advanceLeg 里补失败分支：
```typescript
      else if (TERMINAL_FAIL.has(nextStatus)) {
        await this.swapLegAccounting.voidLeg(ctx, spec, client); // 撤销本 attempt pending
        const attempt = target.attempt ?? 1;
        if (attempt < 3) {
          // 自愈：建同 legSeq 新 attempt
          const aAssetId = spec.side === 'from' ? ctx.fromAssetId : ctx.toAssetId;
          await this.fundsFlow.createSwapLeg({ swapTransactionId: swap.id, legSeq, attempt: attempt + 1, assetId: aAssetId, amount: this.legPrimaryAmount(spec, ctx), fromWalletId: /*…*/, toWalletId: /*…*/ }, 'SYSTEM', client);
          await this.swapLegAccounting.initiateLegPending({ ...ctx, attempt: attempt + 1 }, spec, client);
          const newLeg = await client.internalFund.findFirst({ where: { swapTransactionId: swap.id, legSeq, attempt: attempt + 1 } });
          const a0 = spec.side === 'from' && ctx.fromIsFiat ? InternalFundAction.SUBMIT : InternalFundAction.SIGN;
          await this.fundsFlow.transitionSwapLeg(newLeg.id, a0, 'SYSTEM', client);
          await this.auditLogs.recordSystem({ action: AuditActions.SWAP_LEG_RETRIED, /* legSeq, attempt+1 */ }, client);
        } else {
          // 满 3 次 → 挂起
          await (client as any).internalFund.update({ where: { id: target.id }, data: { status: 'NEEDS_REVIEW' } });
          await this.auditLogs.recordSystem({ action: AuditActions.SWAP_LEG_STUCK, /* legSeq, attempt */ }, client);
        }
        await this.swapTransactionsService.recomputeProjections(swap.id, (n) => this.stageOf(allSpecs, n), client);
        // 注意：不 markStatus FAILED、不 emit、不回滚已 CLEAR 腁
      }
```

- [ ] **Step 4: 跑测试通过 + commit**

Run: `npx jest swap-workflow.service.spec -t "self-heal" -v` → PASS。
```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/trading/swap-transactions/swap-leg-accounting.ts
git commit -m "feat(swap): self-heal failed legs (void + recreate ≤3) → NEEDS_REVIEW hold"
```

---

## Task 7: 人工恢复 resumeLeg（TDD）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Test: `swap-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试**

用例：某 legSeq 活跃腁为 NEEDS_REVIEW，调 `resumeLeg(swapNo, legSeq, op)` → 断言建同 legSeq 新 attempt（=旧 attempt+1）+ initiate + 写 `SWAP_LEG_RESUMED` + `needsReview` 投影回 false（若无其他卡腿）。非 NEEDS_REVIEW 时调用 → 抛 BadRequest。
Run: `npx jest swap-workflow.service.spec -t "resume" -v` → FAIL。

- [ ] **Step 2: 实现 resumeLeg**
```typescript
  async resumeLeg(swapNo: string, legSeq: number, operatorId: string) {
    return this.prisma.$transaction(async (client) => {
      const swap = await this.swaps.findByNoInternal(swapNo, client);
      const [active] = await this.swapTransactionsService.activeLegsBySeq(swap.id, client).then(a => a.filter(l => l.legSeq === legSeq));
      if (!active || active.status !== 'NEEDS_REVIEW') throw new BadRequestException('SWAP_LEG_NOT_STUCK');
      const ctx = this.swapLegAccounting.ctxFromSwap(swap);
      const spec = buildSwapLegPlan({ fromIsFiat: ctx.fromIsFiat }).find(s => s.legSeq === legSeq)!;
      const attempt = (active.attempt ?? 1) + 1;
      await this.fundsFlow.createSwapLeg({ swapTransactionId: swap.id, legSeq, attempt, assetId: spec.side==='from'?ctx.fromAssetId:ctx.toAssetId, amount: this.legPrimaryAmount(spec, ctx), fromWalletId:/*…*/, toWalletId:/*…*/ }, operatorId, client);
      await this.swapLegAccounting.initiateLegPending({ ...ctx, attempt }, spec, client);
      const nl = await client.internalFund.findFirst({ where: { swapTransactionId: swap.id, legSeq, attempt } });
      await this.fundsFlow.transitionSwapLeg(nl.id, ctx.fromIsFiat && spec.side==='from'?InternalFundAction.SUBMIT:InternalFundAction.SIGN, operatorId, client);
      await this.auditLogs.recordSystem({ action: AuditActions.SWAP_LEG_RESUMED, /* … */ }, client);
      await this.swapTransactionsService.recomputeProjections(swap.id, (n)=>this.stageOf(buildSwapLegPlan({fromIsFiat:ctx.fromIsFiat}), n), client);
      return this.swaps.findByNoInternal(swapNo, client);
    });
  }
```

- [ ] **Step 3: 跑测试通过 + commit**

Run: `npx jest swap-workflow.service.spec -t "resume" -v` → PASS。
```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "feat(swap): manual resumeLeg from NEEDS_REVIEW (new attempt)"
```

---

## Task 8: 先收后付不变量（TDD）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Test: `swap-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试**

用例:在卖出腿(leg1)未 CLEAR 时,试图推进/创建买入腿(leg3)→ 应抛 `BadRequestException('SWAP_SEQUENCE_VIOLATION')`(前序腁未 CLEAR)。并断言 buildSwapLegPlan 两套的 leg1 均为 `SWAP_SELL_CLIENT`(`fromRole` 为客户卖出角色)。
Run: `npx jest swap-workflow.service.spec -t "sell-first" -v` → FAIL(若现 guard 文案不同则调整)。

- [ ] **Step 2: 固化不变量**

在 advanceLeg 的 sequence guard 处显式化:前序 legSeq 的**活跃腿**须 CLEAR,否则抛 `SWAP_SEQUENCE_VIOLATION`;并在文件顶部加断言注释/单测覆盖 leg1=SELL。(本质是把现有顺序 guard 用活跃腿口径重述 + 命名。)

- [ ] **Step 3: 跑通 + commit**

Run: `npx jest swap-workflow.service.spec -t "sell-first" -v` → PASS。
```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "test(swap): enforce sell-first (buy leg gated behind sell CLEAR)"
```

---

## Task 9: 控制器重接 + resume 端点 + 删 reverse

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（route 登记）

- [ ] **Step 1: advance 重接 workflow + 新增 resume + 删 reverse**

`swap-transactions.controller.ts`:注入改为 `SwapWorkflowService`(替 `SwapSettlementService`):
- `advanceSwapLeg` → `this.swapWorkflow.advanceLeg(swapNo, Number(legSeq), dto.action, operator)`
- **新增** `@Post(':swapNo/legs/:legSeq/resume')` → `this.swapWorkflow.resumeLeg(swapNo, Number(legSeq), operator)`(加 `RequirePermissions(buildPermissionCode('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/resume'))`)
- **删** `@Post(':swapNo/reverse')` 整个方法。

- [ ] **Step 2: RBAC 登记 resume route + 去 reverse**

`rbac.catalog.ts`:加 resume 的 `route('POST', '/admin/swap-transactions/:swapNo/legs/:legSeq/resume', …)`;删 reverse route。
Run:
```bash
npx tsc --noEmit -p tsconfig.json
npm run db:base:sync 2>/dev/null || true
```

- [ ] **Step 3: commit**
```bash
git add src/modules/trading/swap-transactions/swap-transactions.controller.ts src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(swap): admin advance→workflow, add resume endpoint, remove reverse"
```

---

## Task 10: 删 SwapSettlementService + FAILED/REVERSED 残留

**Files:**
- Delete: `src/modules/trading/swap-transactions/swap-settlement.service.ts`(+ spec 若有)
- Modify: `swap-transactions.module.ts`、`swap-transaction.dto.ts`

- [ ] **Step 1: 确认无残留引用**

Run:
```bash
grep -rn "SwapSettlementService\|reverseSwap\|SWAP_REVERSED\b" src --include="*.ts" | grep -v ".spec.ts"
```
Expected: 仅剩待删处(module 注册 + audit 常量定义)。若 workflow/controller 仍引用 → 先回 Task 5/9 修。

- [ ] **Step 2: 删文件 + 注销**

```bash
git rm src/modules/trading/swap-transactions/swap-settlement.service.ts
git rm src/modules/trading/swap-transactions/swap-settlement.service.spec.ts 2>/dev/null || true
```
`swap-transactions.module.ts`:删 `SwapSettlementService` import/providers/exports。
`swap-transaction.dto.ts`:`SwapTransactionStatus` 保留 PROCESSING/SUCCESS(FAILED/REVERSED 仅为历史兼容读,可留枚举值但**代码无写入路径**;若 query DTO 校验需要可保留)。

- [ ] **Step 3: 编译 + e2e + commit**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npm run demo:swap 2>&1 | tail -6
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 npm run verify:coa 2>&1 | tail -4
```
Expected: 编译无错;demo:swap 4 腿推到 SUCCESS;verify:coa ALL PASS。
```bash
git add -A -- src/modules/trading/swap-transactions/ && git status --short  # 自检仅 swap 文件
git commit -m "chore(swap): delete SwapSettlementService; collapse to single workflow"
```
> ⚠️ 此处 `git add -A -- <目录>` 限定在 swap 目录;仍须 `git show --stat HEAD` 确认无 reconciliation 文件。

---

## Task 11: 前端 swap 详情/列表

**Files:**
- Modify: `admin-web/src/pages/`(swap 详情页 + 列表页;实施时 grep `swap` 定位)

- [ ] **Step 1: 详情页**

去掉 reverse 按钮/调用;腿列表展示 `attempt` 历史 + `NEEDS_REVIEW` 徽章 + 对 NEEDS_REVIEW 腿显示 **Resume** 按钮(调 `POST …/legs/:legSeq/resume`);advance 保留。

- [ ] **Step 2: 列表页**

列展示 `currentStage` + `needsReview`(红点);支持按 `needsReview` 筛。

- [ ] **Step 3: 渲染验证 + commit**

按 [[feedback_verify_ui_by_rendering]]:起 claude 验收栈、登录注入 token、预览渲染截图比对(详情页腿+resume、列表 needsReview 筛)。
```bash
git add admin-web/src/pages/<改动文件>
git commit -m "feat(admin-swap): leg attempts + NEEDS_REVIEW resume; drop reverse; list currentStage/needsReview"
```

---

## Task 12: demo-lib 适配 + 全量回归

**Files:**
- Modify: `scripts/demo-lib.ts`

- [ ] **Step 1: driveSwapToSuccess 适配**

`demo-lib.ts` 的 swap 推进:适配陆续建腁(推进时活跃腿按 legSeq 取最新 attempt);去掉任何 reverse;推进序列对 4 腿逐一 advance 到 CLEAR → SUCCESS。

- [ ] **Step 2: 全量回归**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/trading/swap-transactions src/modules/funds-layer --silent 2>&1 | grep -E "Tests:|FAIL"
npm run demo:all 2>&1 | grep -E "asserts:|SUCCESS|✗"
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 npm run verify:coa 2>&1 | tail -4
```
Expected: tsc 无错;jest 无新增失败(原 2 个 swap fundsOrders 已转绿);demo:all 含 swap SUCCESS;verify:coa ALL PASS。

- [ ] **Step 3: 自愈手验(关键)**

写临时脚本或经 admin:构造一笔 swap,把某腁推到 FAILED → 断言自动建 attempt=2、swap 仍 PROCESSING;连失 3 次 → 该腿 NEEDS_REVIEW、`needsReview=true`;resume → 新 attempt → 最终 SUCCESS。贴输出。

- [ ] **Step 4: 死符号终检 + commit**

Run:
```bash
grep -rn "SwapSettlementService\|reverseSwap" src --include="*.ts" | grep -v ".spec.ts"   # 期望空
git add scripts/demo-lib.ts
git commit -m "test(swap): demo-lib progressive-leg drive; full regression + self-heal manual proof"
```

---

## Self-Review（plan 对 spec 覆盖）

- spec §3 单一 workflow + helper → Task 2/4/5/10 ✅
- spec §4 两台状态机 → Task 4(swap)+5/6/7(腁机器) ✅
- spec §5 陆续建腁 + 先收后付 → Task 4/5 + Task 8 ✅
- spec §6 自愈 ≤3 → NEEDS_REVIEW → Task 6 ✅
- spec §7 投影 currentStage/needsReview → Task 3(recompute)+各任务调用 ✅
- spec §8 审计/事件归 workflow → Task 1(常量)+5/6/7(写入) ✅
- spec §9 数据模型 → Task 1 ✅
- spec §10 删除清单 → Task 3(legacy)+9(reverse)+10(settlement) ✅
- spec §11 API/前端 → Task 9/11 ✅
- spec §12 验收 → Task 12 ✅

**命名一致性：** `SwapLegAccounting` / `activeLegsBySeq` / `recomputeProjections` / `advanceLeg` / `resumeLeg` / `stageOf` / `legPrimaryAmount` / `SWAP_LEG_POSTED|RETRIED|STUCK|RESUMED` / `NEEDS_REVIEW` / `attempt` / `currentStage` / `needsReview` 全计划统一。

**实施时确认的小项（非阻塞）：** `stageOf`/`legPrimaryAmount` 在 workflow 内的实现(从 spec 复制工具);`SwapSettleCtx` 从 helper 导出供 workflow 复用。
