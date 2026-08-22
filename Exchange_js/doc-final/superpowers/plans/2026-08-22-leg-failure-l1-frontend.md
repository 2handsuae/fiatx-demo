# 第四批实施计划 · 资金腿失败对齐 + L1 闸门收口 + 前端统一化

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「资金腿失败了怎么办」三域收成一个答案、把 L1 闸门从散落的守卫收成一份可回显的判定、把三域前端的状态渲染与详情页收成一套。

**Architecture:** 三域**故意分叉**（仓库 29 处成文声明），所以 A/C 的状态机改动各域自己写、不抽基类；但 L1 是**横切关注点**，建一份公共 `L1GateService`，三域注入同一个。前端状态映射表按域各一份（对齐 `depositStatusMap`/`withdrawStatusMap` 的既有形状），但 badge 组件与颜色令牌统一。

**Tech Stack:** NestJS 10 + Prisma 5 (SQLite) + TigerBeetle ｜ React 18 + Tailwind（admin-web / client-web）｜ Jest

设计稿：`doc-final/superpowers/specs/2026-08-22-leg-failure-l1-frontend-design.md`

---

## Global Constraints

- **工作目录**：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js`。每个 Task 开始前 `source ~/.nvm/nvm.sh && nvm use 20`。
- **Demo 数据约定**：数据可随时格式化重铺。**禁止** backfill / 迁移兼容层 / 双写过渡 / 向后兼容列。schema 改动直接按目标终态做，`prisma/migrations` 仍按正常流程新增（保证空库能从零建起）。
- **deliberate fork**：充值/提现/兑换三域故意分叉、各自演进、**不共享状态机基类**。三份同构的状态机代码是正确做法。唯一例外是本批新建的 `L1GateService`（横切关注点，业主明确要求收成公共服务）。
- **五条不可违反规则**（`CLAUDE.md`）：① 有持久状态、operator 可见操作必须写 `AuditLogsService`（DI 注入，禁止 `new`）；② 多表状态变更必须用 `prisma.$transaction`；③ 有稳定业务键（`customerNo`/`depositNo`…）禁止以 `id` 作对外主查询合同；④ 禁止绕过 onboarding / compliance 状态门语义；⑤ Workflow 禁止直接写 domain 实体的 Prisma 表，必须走该 domain 的 service 方法。
- **admin 前端禁止裸 Tailwind 颜色**（`doc-final/rules/frontend-admin.md`）—— 一律用 `adm-*` 令牌组合。
- **admin 页面禁止暴露原始 UUID** —— 实体间关联一律用业务键（`customerNo`/`depositNo`/`swapNo`）。
- **本批明确不做**：审计日志专项（单独一轮）、权限/安全（`assertAdmin` 类，业主单独任务）、TR 判定进 L1、资产状态闸、充值累计额度、充值大额审批、needsReview 的任何修复按钮。看到这些**不要顺手补上**。
- **三个闸门每个 Task 结束都要跑**（`tsc -p tsconfig.json` 照不到 `test/` 也照不到 `admin-web/`）：
  ```
  npx tsc --noEmit -p tsconfig.json
  npx tsc --noEmit -p tsconfig.test.json
  cd admin-web && npx tsc -b --noEmit && cd ..
  npx jest            # 不带任何路径过滤
  ```
- **已知 jest 基线**：`3 suites / 4 tests failed`（`client-web/src/utils/restrictedCapabilities.spec.ts`、`src/modules/asset-treasury/wallets/system-wallet.util.spec.ts`、`src/modules/asset-treasury/wallets/wallets.service.spec.ts`）。**净新失败必须是 0。**

---

## File Structure

**后端 · 新建**
- `src/modules/trading/shared/l1-gate/l1-gate.types.ts` — L1 判定结果类型（`L1Check` / `L1Snapshot`）
- `src/modules/trading/shared/l1-gate/l1-gate.service.ts` — 公共求值器，三域注入
- `src/modules/trading/shared/l1-gate/l1-gate.module.ts` — 导出上面那个 service
- `prisma/migrations/20260822010000_batch4_needs_review_and_l1/migration.sql`

**后端 · 修改**
- `prisma/schema.prisma` — `DepositTransaction` 加 `needsReview`；三张表各加 `l1Snapshot`
- `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts` — 删 `CONFISCATE_FAILED`
- `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` — 转移表删边、`markNeedsReview`/`clearNeedsReview`、`l1Snapshot` 写入
- `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` — 没收腿重试、三态置红标、`approveDeposit` L1 守卫、`initiateReturn`/`onReturnApproved` 守卫放宽
- `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts` — 新增退回端点
- `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` — 写 L1 快照
- `src/modules/trading/swap-transactions/swap-workflow.service.ts` — 写 L1 快照 + 建单余额校验

**前端 · 新建**
- `admin-web/src/utils/swapStatusMap.ts`
- `admin-web/src/utils/swapStatusMap.spec.ts`
- `admin-web/src/components/L1GateCard.tsx` — 三域详情页共用的 L1 回显卡
- `client-web/src/pages/SwapDetail.tsx`

**前端 · 修改**
- `admin-web/src/components/ui/StatusPill.tsx` — 兑换列表改用 `swapStatusMap` 后，这里的 `FROZEN` 青色不再被交易页用到
- `admin-web/src/pages/SwapTransactionList.tsx` / `DepositTransactionList.tsx`
- `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx`
- `client-web/src/App.tsx`

**文档**
- `doc-final/reference/truth/v4-deposit.md` / `v5-withdraw.md` / `v6-swap.md`
- `doc-final/BACKLOG.md`

---

# Phase A · 资金腿失败对齐 + 充值红标

## Task A1: 充值加 `needsReview` 列与读写方法

**Files:**
- Modify: `prisma/schema.prisma`（`DepositTransaction` 模型）
- Create: `prisma/migrations/20260822010000_batch4_needs_review_and_l1/migration.sql`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

**Interfaces:**
- Produces: `DepositTransactionsService.markNeedsReview(id: string): Promise<any>` 与 `clearNeedsReview(id: string): Promise<any>`，签名与 `WithdrawTransactionsService` 同名方法逐字一致（`withdraw-transactions.service.ts:997` / `:1007`）。Task A2、A3 会调 `markNeedsReview`。
- Produces: `DepositTransaction.needsReview: boolean`（默认 `false`），Task A4 的前端读它。

**背景**：提现（`schema.prisma:1210`）和兑换（`:1300`）都有 `needsReview Boolean @default(false)`，只有充值没有。这是充值域「没有标红这个能力」的根因。本 Task 只加能力，A2/A3 才用它。

- [ ] **Step 1: 写失败的测试**

在 `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts` 末尾（`describe` 块内）加：

```typescript
  describe('needsReview 红标', () => {
    it('markNeedsReview 只写 needsReview 一列，不碰状态', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'd1', needsReview: true });
      (prisma as any).depositTransaction = { update };

      await service.markNeedsReview('d1');

      expect(update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { needsReview: true },
      });
    });

    it('clearNeedsReview 只写 needsReview 一列', async () => {
      const update = jest.fn().mockResolvedValue({ id: 'd1', needsReview: false });
      (prisma as any).depositTransaction = { update };

      await service.clearNeedsReview('d1');

      expect(update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { needsReview: false },
      });
    });
  });
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -t "needsReview 红标"
```

Expected: FAIL — `service.markNeedsReview is not a function`

- [ ] **Step 3: schema 加列**

在 `prisma/schema.prisma` 的 `model DepositTransaction` 里，紧挨 `limitHoldReason` 那一行下面加：

```prisma
  needsReview          Boolean           @default(false)
```

- [ ] **Step 4: 写迁移 SQL**

创建 `prisma/migrations/20260822010000_batch4_needs_review_and_l1/migration.sql`：

```sql
-- 充值红标（提现/兑换早有此列，本批补齐充值）
ALTER TABLE "deposit_transactions" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- L1 判定快照（三域，Task B2 使用；一次迁移建全，避免两次表重建）
ALTER TABLE "deposit_transactions"  ADD COLUMN "l1Snapshot" TEXT;
ALTER TABLE "withdraw_transactions" ADD COLUMN "l1Snapshot" TEXT;
ALTER TABLE "swap_transactions"     ADD COLUMN "l1Snapshot" TEXT;
```

> 用 `TEXT` 存 JSON 字符串而不是 Prisma `Json` 类型：SQLite provider 下 `Json` 会走 `ALTER TABLE` 重建，而纯 `ADD COLUMN` 不会。业主口径「不用筛查，点开能看就行」，字符串足够。

同步在 `schema.prisma` 三个模型各加：

```prisma
  l1Snapshot           String?
```

- [ ] **Step 5: 应用迁移并重新生成 client**

```bash
npx prisma migrate dev --name batch4_needs_review_and_l1 --skip-seed
npx prisma generate
```

Expected: `Your database is now in sync with your schema.`

- [ ] **Step 6: 写实现**

在 `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` 里，紧挨现有的 `markSlaBreached` 方法之后加：

```typescript
  /**
   * 红标：资金腿重试耗尽后由 workflow 置起。**只写这一列，绝不碰状态** ——
   * 三个在途处置态（CONFISCATING/RETURNING/SEIZING）卡死时单子留在原地，
   * 「卡住了」这件事靠这面旗表达，不靠状态迁移（业主 2026-08-22 定稿）。
   * 与 WithdrawTransactionsService.markNeedsReview / SwapTransactionsService
   * 的同名方法逐字同构（三域故意分叉，各写各的，不抽 helper）。
   */
  async markNeedsReview(id: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { needsReview: true },
    });
  }

  /** 处置成功落地后清旗（运营卫生）。 */
  async clearNeedsReview(id: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { needsReview: false },
    });
  }
```

- [ ] **Step 7: 跑测试确认通过**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -t "needsReview 红标"
```

Expected: PASS（2 passed）

- [ ] **Step 8: 跑全部闸门**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
```

Expected: tsc 三个都 0 错；jest `3 failed, 4 tests failed` = 基线，净新 0

- [ ] **Step 9: 提交**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
git commit -m "feat(deposit): 加 needsReview 红标列与读写方法;同批预留三域 l1Snapshot 列"
```

---

## Task A2: 退回 / 上缴腿重试耗尽后置红标

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（`onReturnLegFailed` 起始 `:2473`；`onSeizeLegFailed` 见 `grep -n "private async onSeizeLegFailed"`）
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `DepositTransactionsService.markNeedsReview(id)`（Task A1）

**背景**：这两条弧**已经是**业主要的形状 —— 重试 3 次、耗尽后原地不动、写 `DEPOSIT_RETURN_STUCK` / `DEPOSIT_SEIZE_STUCK` 审计（`onSeizeLegFailed` 的 reason 原文就是 `deposit stays SEIZING`）。缺的只是那面旗。每个方法有**两处** STUCK 落点：正常耗尽分支 + `catch` 崩溃分支，两处都要置旗。

- [ ] **Step 1: 写失败的测试**

在 `deposit-workflow.service.spec.ts` 加：

```typescript
  describe('A2 · 处置腿卡死置红标', () => {
    it('退回腿第 3 次仍失败 → 写 STUCK 审计并置 needsReview,状态一步不动', async () => {
      const deposit = {
        id: 'd1', depositNo: 'DEP001', ownerType: 'CUSTOMER', ownerId: 'c1',
        traceId: 't1', amount: '100', asset: { decimals: 2, currency: 'AED' },
        status: 'RETURNING',
      };
      accountingService.voidPendingTransfer.mockResolvedValue(undefined);

      await (service as any).onReturnLegFailed(deposit, 'fo1', 3);

      expect(depositService.markNeedsReview).toHaveBeenCalledWith('d1');
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_RETURN_STUCK }),
      );
    });

    it('退回腿第 1 次失败 → 重建 attempt 2,不置红标', async () => {
      const deposit = {
        id: 'd1', depositNo: 'DEP001', ownerType: 'CUSTOMER', ownerId: 'c1',
        traceId: 't1', amount: '100', asset: { decimals: 2, currency: 'AED' },
        status: 'RETURNING',
      };
      accountingService.voidPendingTransfer.mockResolvedValue(undefined);
      fundsOrders.create.mockResolvedValue({ fundsOrderNo: 'FO2' });

      await (service as any).onReturnLegFailed(deposit, 'fo1', 1);

      expect(depositService.markNeedsReview).not.toHaveBeenCalled();
      expect(fundsOrders.create).toHaveBeenCalled();
    });

    it('上缴腿第 3 次仍失败 → 置 needsReview,状态一步不动', async () => {
      const deposit = {
        id: 'd2', depositNo: 'DEP002', ownerType: 'CUSTOMER', ownerId: 'c1',
        traceId: 't2', amount: '100', asset: { decimals: 2, currency: 'AED' },
        status: 'SEIZING',
      };
      accountingService.voidPendingTransfer.mockResolvedValue(undefined);

      await (service as any).onSeizeLegFailed(deposit, 'fo9', 3);

      expect(depositService.markNeedsReview).toHaveBeenCalledWith('d2');
      expect(depositService.updateStatus).not.toHaveBeenCalled();
    });
  });
```

若 spec 文件里 `depositService` mock 尚无 `markNeedsReview`，在其 mock 工厂里加一行 `markNeedsReview: jest.fn()`。

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "A2 · 处置腿卡死置红标"
```

Expected: FAIL — `expect(jest.fn()).toHaveBeenCalledWith('d1')` / Number of calls: 0

- [ ] **Step 3: 在 `onReturnLegFailed` 的两处 STUCK 落点置旗**

`onReturnLegFailed` 里，**正常耗尽分支**（`const MAX = 3; if (attempt < MAX) {...return;}` 之后那段 `DEPOSIT_RETURN_STUCK` 审计）改成先置旗再写审计：

```typescript
      // 重试三级梯耗尽 —— 单子留在 RETURNING 原地不动,靠红标让运营看见。
      // 「卡住了」是一面旗,不是一个状态（业主 2026-08-22 定稿）。
      await this.depositService.markNeedsReview(deposit.id);

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_RETURN_STUCK, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
        workflowType: 'DEPOSIT_RETURN', traceId: deposit.traceId || undefined, result: AuditResult.FAILED,
        reason: `Return leg failed after ${attempt} attempts — manual intervention required (deposit stays RETURNING)`,
        metadata: { depositNo: deposit.depositNo, fundsOrderId, attempt },
        requestId: `DEPOSIT_RETURN_STUCK_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
      });
```

同一方法的 **`catch` 崩溃分支**同样在 `recordSystem` 之前加：

```typescript
      // 崩溃路径同样置旗:pending 可能还锁着,更需要被看见。markNeedsReview 自带
      // try/catch 兜底——它失败不能盖掉下面这条 STUCK 审计。
      await this.depositService.markNeedsReview(deposit.id).catch((e) =>
        this.logger.error(`markNeedsReview failed for deposit ${deposit.depositNo}: ${e.message}`),
      );
```

- [ ] **Step 4: 在 `onSeizeLegFailed` 的两处 STUCK 落点做同样的事**

正常耗尽分支：

```typescript
      await this.depositService.markNeedsReview(deposit.id);
```

置于 `action: AuditActions.DEPOSIT_SEIZE_STUCK` 那条 `recordSystem` 之前。

`catch` 崩溃分支：

```typescript
      await this.depositService.markNeedsReview(deposit.id).catch((e) =>
        this.logger.error(`markNeedsReview failed for deposit ${deposit.depositNo}: ${e.message}`),
      );
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "A2 · 处置腿卡死置红标"
```

Expected: PASS（3 passed）

- [ ] **Step 6: 变异测试 —— 证明断言不是空的**

临时把 `onReturnLegFailed` 正常耗尽分支的 `await this.depositService.markNeedsReview(deposit.id);` 注释掉，重跑上面的命令。

Expected: 第 1 个用例**必须变红**。确认后把那行恢复。

> 这一步不可跳过。前三批有过三次「自证型绿灯」—— 断言看着在测，其实删掉生产代码也照样过。

- [ ] **Step 7: 跑全部闸门**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
```

Expected: tsc 0 错；jest 净新失败 0

- [ ] **Step 8: 提交**

```bash
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
git commit -m "feat(deposit): 退回/上缴腿重试耗尽后置 needsReview 红标(四处落点),状态一步不动"
```

---

## Task A3: 没收腿改成重试 3 次,删 `confiscate_failed` 边

**Files:**
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts:94`（删 `CONFISCATE_FAILED`）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:819`（转移表删边）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（`startConfiscation` 起始 `:1461`；`onConfiscationLegChanged` `:1533`；`onConfiscationLegFailed` `:1577`）
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`（转移表边数断言）、`deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `DepositTransactionsService.markNeedsReview(id)`（Task A1）
- Produces: `DepositWorkflowService.buildConfiscationLegInput(deposit, attempt)` 与 `pendConfiscationLegs(deposit, attempt)` 两个私有方法，与退回弧的 `buildReturnLegInput`/`pendReturnSuspense` 同构。

**背景（读懂再动手）**：没收腿现在**零重试**——一次失败就 void 两条 pending 然后推 `CONFISCATE_FAILED` → `OPERATION_PENDING`。代码注释写明了原因：

> 没收腿的 `deterministicTransferId` 第 4 参**写死常量 1**（非 attempt），重建的新腿会算出同一个 pending id 撞车。

所以改造的核心就是**把 `attempt` 穿透进去**，让它和退回/上缴弧逐字同构。`startConfiscation` 里有**两处** `legIndex: 1`（`CONFISCATE_REVERSE_SUSPENSE` 与 `CONFISCATE_INCOME_OTHER`），`onConfiscationLegFailed` 里有**两处** `deterministicTransferId(..., 1)`。

改完之后充值三个处置态形状完全一致，`CONFISCATING` 只剩 `confiscate_settle → CONFISCATED` 一条出边，转移表 28 边 → **27 边**。

- [ ] **Step 1: 写失败的测试（转移表）**

在 `deposit-transactions.service.spec.ts` 里找到断言总边数的那个用例（`grep -n "28" src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`），把期望值 28 改成 27，并加一个用例：

```typescript
    it('CONFISCATING 只剩 confiscate_settle 一条出边（confiscate_failed 已退役）', () => {
      expect(() =>
        (service as any).getNextStatus(
          DepositTransactionStatus.CONFISCATING,
          'confiscate_failed' as any,
        ),
      ).toThrow(/Invalid|not allowed|无效/i);

      expect(
        (service as any).getNextStatus(
          DepositTransactionStatus.CONFISCATING,
          DepositTransactionAction.CONFISCATE_SETTLE,
        ),
      ).toBe(DepositTransactionStatus.CONFISCATED);
    });
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -t "CONFISCATING 只剩"
```

Expected: FAIL — 没抛错，返回了 `OPERATION_PENDING`

- [ ] **Step 3: 删动作枚举与转移表那条边**

`dto/deposit-transaction.dto.ts` 删掉这一行：

```typescript
  CONFISCATE_FAILED = 'confiscate_failed',
```

`deposit-transactions.service.ts` 的转移表里，`[DepositTransactionStatus.CONFISCATING]` 那一块删掉 `CONFISCATE_FAILED` 那一条，只留：

```typescript
      [DepositTransactionStatus.CONFISCATING]: {
        [DepositTransactionAction.CONFISCATE_SETTLE]:
          DepositTransactionStatus.CONFISCATED,
      },
```

同时把 `getNextStatus` 上方那段注释里的 `14 状态/15 动作/26 边` 订正为 `14 状态/15 动作/27 边`（原注释数字本来就已过期，实际改动前是 16 动作 28 边；删完是 15 动作 27 边）。

- [ ] **Step 4: `startConfiscation` 把 attempt 穿透**

把 `startConfiscation` 里建腿与压 pending 的那三段抽成两个可复用的私有方法。在 `onConfiscationLegFailed` 上方加：

```typescript
  /**
   * 没收腿（legSeq 2）的建单入参。attempt 进 deterministicTransferId 的第 4 参,
   * 与退回弧的 buildReturnLegInput 逐字同构 —— 这是没收腿能重试的前提:
   * 2026-08-13 那版把第 4 参写死成常量 1,重建的新腿会算出同一个 pending id 撞车,
   * 所以当时只能「一次失败就退回 OPERATION_PENDING」。
   */
  private buildConfiscationLegInput(deposit: any, attempt: number): CreateFundsOrderInput {
    return {
      depositTransactionId: deposit.id,
      legSeq: 2,
      attempt,
      initialStatus: FundsOrderStatus.CREATED,
      assetId: deposit.assetId,
      amount: String(deposit.amount),
      netAmount: String(deposit.amount),
      fromWalletId: deposit.toWalletId ?? null,
      toWalletId: null,
      traceId: deposit.traceId || undefined,
    };
  }

  /** 没收的两条 pending（反冲 suspense + 计入 INCOME_OTHER）,legIndex 取 attempt。 */
  private async pendConfiscationLegs(deposit: any, attempt: number): Promise<void> {
    const asset = deposit.asset;
    if (!asset?.tbLedgerId) throw new Error(`Asset ${asset?.currency} has no tbLedgerId`);
    const ledger = asset.tbLedgerId;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);

    const suspenseId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: deposit.ownerId });
    const clientAssetId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });
    const firmAssetId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger, ownerType: 'SYSTEM' });
    const incomeOtherId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.INCOME_OTHER, ledger, ownerType: 'SYSTEM' });

    await this.accountingService.executePendingTransfer({
      debitAccountId: suspenseId, creditAccountId: clientAssetId, amount: amountBigint, ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET, timeout: 0, legIndex: attempt,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'CONFISCATE_REVERSE_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
      },
    });

    await this.accountingService.executePendingTransfer({
      debitAccountId: firmAssetId, creditAccountId: incomeOtherId, amount: amountBigint, ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_INCOME_OTHER, timeout: 0, legIndex: attempt,
      evidence: {
        sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'CONFISCATE_INCOME_OTHER',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_OTHER],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
      },
    });
  }
```

然后把 `startConfiscation` 里原来那段「`fundsOrders.create({...legSeq:2...})` + 两次 `executePendingTransfer({...legIndex: 1...})`」替换成：

```typescript
    const [existing] = await this.fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 2 });
    if (!existing) {
      await this.fundsOrders.create(this.buildConfiscationLegInput(deposit, 1));
    }
    await this.pendConfiscationLegs(deposit, 1);
```

> 保留 `findByParent` 幂等判据不动 —— 它防的是 `startConfiscation` 被重复调用。

- [ ] **Step 5: `onConfiscationLegChanged` 传 attempt**

把 `:1560` 那行改成：

```typescript
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT:
        await this.onConfiscationLegFailed(deposit, event.fundsOrderId, event.newStatus, event.attempt);
        break;
```

- [ ] **Step 6: 重写 `onConfiscationLegFailed`**

整个方法体替换为（签名多一个 `attempt`）：

```typescript
  /**
   * 没收腿 FAILED/TIMEOUT —— 与退回/上缴弧同一形状（业主 2026-08-22 定稿：
   * 资金单有问题就重试三次,还不行原地标红）：
   *   1. void 掉本次 attempt 的两条 pending
   *   2. attempt < 3 → 重建 attempt+1 的腿与 pending,写 RETRIED 审计
   *   3. attempt 耗尽 → 置 needsReview 红标 + 写 STUCK 审计,**deposit 留在 CONFISCATING**
   * 2026-08-13 那版「一次失败就退回 OPERATION_PENDING」已随 confiscate_failed
   * 边一起退役——它是三个处置态里唯一的异类。
   * 整体 try/catch 不上抛（@OnEvent 异步监听器里抛没人接）。
   */
  private async onConfiscationLegFailed(
    deposit: any,
    fundsOrderId: string,
    legStatus: string,
    attempt: number,
  ) {
    try {
      const asset = deposit.asset;
      const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
      const pend1 = deterministicTransferId('DEPOSIT', deposit.depositNo, 'CONFISCATE_REVERSE_SUSPENSE', attempt);
      const pend2 = deterministicTransferId('DEPOSIT', deposit.depositNo, 'CONFISCATE_INCOME_OTHER', attempt);

      await this.accountingService.voidPendingTransfer({
        pendingTransferId: pend1, amount: amountBigint,
        evidence: {
          sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'CONFISCATE_REVERSE_SUSPENSE_VOID',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
        },
      });
      await this.accountingService.voidPendingTransfer({
        pendingTransferId: pend2, amount: amountBigint,
        evidence: {
          sourceType: 'DEPOSIT', sourceNo: deposit.depositNo, eventCode: 'CONFISCATE_INCOME_OTHER_VOID',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.INCOME_OTHER],
          assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType: 'SYSTEM', actorId: 'SYSTEM',
        },
      });

      const MAX = 3;
      if (attempt < MAX) {
        const nextAttempt = attempt + 1;
        const newLeg = await this.fundsOrders.create(this.buildConfiscationLegInput(deposit, nextAttempt));
        await this.pendConfiscationLegs(deposit, nextAttempt);

        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_CONFISCATION_RETRIED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
          workflowType: 'DEPOSIT_CONFISCATION', traceId: deposit.traceId || undefined, result: AuditResult.SUCCESS,
          reason: `Confiscation leg attempt ${attempt} ${legStatus} — rebuilt attempt ${nextAttempt}`,
          metadata: { depositNo: deposit.depositNo, fundsOrderId, attempt: nextAttempt, fundsOrderNo: newLeg.fundsOrderNo },
          requestId: `DEPOSIT_CONFISCATION_RETRIED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
        });
        return;
      }

      await this.depositService.markNeedsReview(deposit.id);
      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_CONFISCATION_STUCK, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
        workflowType: 'DEPOSIT_CONFISCATION', traceId: deposit.traceId || undefined, result: AuditResult.FAILED,
        reason: `Confiscation leg failed after ${attempt} attempts — manual intervention required (deposit stays CONFISCATING)`,
        metadata: { depositNo: deposit.depositNo, fundsOrderId, attempt },
        requestId: `DEPOSIT_CONFISCATION_STUCK_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
      });
    } catch (err: any) {
      this.logger.error(
        `onConfiscationLegFailed crashed for deposit ${deposit.depositNo} attempt ${attempt}: ${err.message} — deposit stays CONFISCATING, pending legs may still be locked`,
      );
      await this.depositService.markNeedsReview(deposit.id).catch((e) =>
        this.logger.error(`markNeedsReview failed for deposit ${deposit.depositNo}: ${e.message}`),
      );
      await this.auditLogsService
        .recordSystem({
          action: AuditActions.DEPOSIT_CONFISCATION_UNLOCK_FAILED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
          workflowType: 'DEPOSIT_CONFISCATION', traceId: deposit.traceId || undefined, result: AuditResult.FAILED,
          reason: `onConfiscationLegFailed crashed (attempt ${attempt}): ${err.message} — manual intervention required (deposit stays CONFISCATING)`,
          metadata: { depositNo: deposit.depositNo, fundsOrderId, attempt, error: err.message },
          requestId: `DEPOSIT_CONFISCATION_UNLOCK_FAILED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM',
        })
        .catch(() => undefined);
    }
  }
```

- [ ] **Step 7: 补两个审计动作常量**

在 `src/modules/audit-logging/constants/audit-actions.constant.ts` 里 `DEPOSIT_CONFISCATION_LEG_FAILED` 旁边加：

```typescript
  DEPOSIT_CONFISCATION_RETRIED: 'DEPOSIT_CONFISCATION_RETRIED',
  DEPOSIT_CONFISCATION_STUCK: 'DEPOSIT_CONFISCATION_STUCK',
```

`DEPOSIT_CONFISCATION_LEG_FAILED` 常量本身**保留但不再被写入**（本批不做审计专项，不清理死常量；登记 BACKLOG 由审计那一轮统一处理）。

- [ ] **Step 8: 写 workflow 测试**

```typescript
  describe('A3 · 没收腿重试', () => {
    const deposit = {
      id: 'd3', depositNo: 'DEP003', ownerType: 'CUSTOMER', ownerId: 'c1',
      assetId: 'a1', traceId: 't3', amount: '100', toWalletId: 'w1',
      asset: { decimals: 2, currency: 'AED', tbLedgerId: 1 },
      status: 'CONFISCATING',
    };

    it('第 1 次失败 → 重建 attempt 2,不推状态、不置红标', async () => {
      accountingService.voidPendingTransfer.mockResolvedValue(undefined);
      accountingService.resolveTbAccountId.mockResolvedValue(1n);
      accountingService.executePendingTransfer.mockResolvedValue(undefined);
      fundsOrders.create.mockResolvedValue({ fundsOrderNo: 'FO-C2' });

      await (service as any).onConfiscationLegFailed(deposit, 'fo1', 'FAILED', 1);

      expect(fundsOrders.create).toHaveBeenCalled();
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(depositService.markNeedsReview).not.toHaveBeenCalled();
    });

    it('第 3 次失败 → 置红标 + STUCK 审计,状态留在 CONFISCATING', async () => {
      accountingService.voidPendingTransfer.mockResolvedValue(undefined);

      await (service as any).onConfiscationLegFailed(deposit, 'fo1', 'TIMEOUT', 3);

      expect(depositService.markNeedsReview).toHaveBeenCalledWith('d3');
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_CONFISCATION_STUCK }),
      );
    });
  });
```

- [ ] **Step 9: 跑测试确认全绿**

```bash
npx jest src/modules/trading/deposit-transactions/ -t "A3 · 没收腿重试"
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
```

Expected: 两条命令都 PASS

- [ ] **Step 10: 变异测试**

把 Step 6 里 `if (attempt < MAX)` 改成 `if (false)`，重跑 `-t "A3 · 没收腿重试"`。

Expected: 第 1 个用例**必须变红**。确认后恢复。

- [ ] **Step 11: 跑全部闸门 + 确认死枚举清干净**

```bash
grep -rn "CONFISCATE_FAILED\|confiscate_failed" src/ admin-web/src/ client-web/src/ | grep -v "CONFISCATION"
```

Expected: **零命中**（若有命中说明还有引用没清）

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
```

Expected: tsc 0 错；jest 净新失败 0

- [ ] **Step 12: 提交**

```bash
git add src/modules/trading/deposit-transactions/ src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "refactor(deposit): 没收腿改重试 3 次+原地标红,删 confiscate_failed 边(28→27 边)"
```

---

## Task A4: 充值前端红标 —— 详情页 + 列表页筛选

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`
- Modify: `admin-web/src/pages/DepositTransactionList.tsx`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（admin 列表/详情投影带上 `needsReview`）

**Interfaces:**
- Consumes: `DepositTransaction.needsReview`（Task A1）

**背景**：镜像 `SwapTransactionList.tsx` 现有的 `needsReviewOnly` 复选框（`:234-241`）与 `SwapTransactionDetail.tsx:717` 的 `Needs Review` 徽章。**不要加任何"修复"按钮** —— 业主明确：所有 needsReview 标红暂时都不要修复按钮。

- [ ] **Step 1: 确认后端已经把字段吐出来**

```bash
grep -n "include:" src/modules/trading/deposit-transactions/deposit-transactions.service.ts | head -5
```

admin 侧列表与详情用的是 `include`（不是 `select`），新列自动带出。若查到某处用了 `select`，把 `needsReview: true` 加进去。

- [ ] **Step 2: 详情页加类型字段与徽章**

`DepositTransactionDetail.tsx` 的详情数据 interface 里，`limitHoldReason?: string | null;` 那行下面加：

```typescript
  needsReview?: boolean;
```

在 `Lifecycle` 卡片里（与提现/兑换同位置）加一行只读 KV：

```tsx
              <InfoField
                label="Needs Review"
                value={data.needsReview ? <AdminBadge value="NEEDS_REVIEW" /> : 'No'}
              />
```

- [ ] **Step 3: 列表页加 `needsReviewOnly` 复选框**

`DepositTransactionList.tsx` 的 `FilterState` interface 里，`slaBreachedOnly: boolean;` 旁边加：

```typescript
  needsReviewOnly: boolean;
```

`DEFAULT_FILTERS` 里加 `needsReviewOnly: false,`。

列表行类型里加 `needsReview?: boolean;`。

在 `useMemo` 的过滤链里，`slaBreachedOnly` 那条旁边加：

```typescript
        .filter((it) => (filters.needsReviewOnly ? it.needsReview : true))
```

并把 `needsReviewOnly` 加进 `useMemo` 依赖数组。

在 `slaBreachedOnly` 复选框旁边加（**逐字对齐兑换列表 `:230-241` 的写法**）：

```tsx
        <label
          className="ml-2 inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-adm-t2"
          title="仅过滤当前页已加载的行，不是全库筛选"
        >
          <input
            type="checkbox"
            checked={filters.needsReviewOnly}
            onChange={(e) =>
              setFilters((f) => ({ ...f, needsReviewOnly: e.target.checked }))
            }
            className="h-3.5 w-3.5 accent-adm-red"
          />
          Needs review only
        </label>
```

- [ ] **Step 4: 列表加一列红标**

在 SLA 那一列旁边加单元格：

```tsx
              <td className="px-3 py-2">
                {it.needsReview ? <AdminBadge value="NEEDS_REVIEW" /> : <span className="text-adm-t3">—</span>}
              </td>
```

表头同位置加 `<th className="px-3 py-2 text-left">Review</th>`。

若 `AdminBadge` 尚未 import，加 `import AdminBadge from '../components/AdminBadge';`（路径以该文件里既有的 import 为准）。

- [ ] **Step 5: 渲染验证（不是 tsc 过了就算）**

```bash
bash scripts/stack.sh up main
```

用种子管理员 `admin@fiatx.com` / `123456` 登录 `http://127.0.0.1:3001`，打开 Deposit Transactions 列表，确认：
1. 多了 `Review` 一列
2. 多了 `Needs review only` 复选框，勾上后列表会过滤
3. 随便点进一笔单，Lifecycle 卡里有 `Needs Review` 一行

用 `computer` 工具截图留存。

> 业主原则：**声称前端完成前必须渲染截图比对，curl 200 / tsc 0 错不算数。**

- [ ] **Step 6: 跑全部闸门**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
```

Expected: tsc 0 错；jest 净新失败 0

- [ ] **Step 7: 提交**

```bash
git add admin-web/src/pages/DepositTransactionList.tsx admin-web/src/pages/DepositTransactionDetail.tsx src/modules/trading/deposit-transactions/deposit-transactions.service.ts
git commit -m "feat(admin): 充值列表/详情页显示 needsReview 红标+仅看待复核筛选(对齐兑换页)"
```

---

# Phase B · L1 闸门收口 + 回显

> **设计取向（先读懂再动手）**：L1 的九项判定里，有六项**已经在各域各自的位置正确执行着**（单笔上下限、累计额度、大额转审批走 `TransactionLimitGateService`；收付账户就绪、报价有效性、交易起始就绪各域自己判）。本批**不重写这些**——重写它们风险高、收益低，而且会打断现有的错误码契约（前端依赖 `TRANSACTION_LIMIT_BELOW_MIN` 这类 code）。
>
> `L1GateService` 的真实职责是两条：
> 1. **执行没人执行的那三项**——客户资格（lifecycle）、客户限制（便签）、客户档位快照。充值域**这三项一项都没查**，兑换域也没查（`assertCapability()` 全仓只有 `withdraw-workflow.service.ts:269` 一个调用方）。
> 2. **把各域已判过的项收集成一份可回显的快照**，写进 `l1Snapshot`。
>
> 这才是业主要的「收口」——**一份判定、一处存、三域一样回显**——而不是把能跑的代码推倒重来。

## Task B1: 建 `L1GateService` 与快照类型

**Files:**
- Create: `src/modules/trading/shared/l1-gate/l1-gate.types.ts`
- Create: `src/modules/trading/shared/l1-gate/l1-gate.service.ts`
- Create: `src/modules/trading/shared/l1-gate/l1-gate.module.ts`
- Create: `src/modules/trading/shared/l1-gate/l1-gate.service.spec.ts`

**Interfaces:**
- Produces: `L1GateService.evaluate(input: L1GateInput): Promise<L1Snapshot>` —— Task B2/B3/B4 调它
- Produces: `L1Snapshot` / `L1Check` / `L1CheckCode` / `L1Verdict` 类型 —— Task B5 前端也用同一套字段名

- [ ] **Step 1: 写类型文件**

创建 `src/modules/trading/shared/l1-gate/l1-gate.types.ts`：

```typescript
/**
 * L1 = 我方系统内部就能算出答案的判定（业主 2026-08-22 定义）。
 * 反面是 L2：必须问外部（Sumsub）才知道的。
 *
 * ⚠️ Travel Rule 类型判定**刻意不在这里**——业主裁定：判断照做，但不算 L1
 * 内容、不进 L1 卡片（`resolveKytTxnType()` 保持原位不动）。
 * ⚠️ 资产状态闸**刻意没有**——业主裁定「我们也不下架资产」。
 */

export type L1Domain = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

/** PASS=过了 ｜ FAIL=没过 ｜ NA=这个域天然不适用 ｜ SKIPPED=调用方未提供该项结果 */
export type L1Outcome = 'PASS' | 'FAIL' | 'NA' | 'SKIPPED';

export type L1CheckCode =
  | 'CUSTOMER_ELIGIBILITY'   // 生命周期 ACTIVE
  | 'CUSTOMER_RESTRICTION'   // 限制便签是否卡住本域能力
  | 'SINGLE_LIMIT'           // 单笔上下限（原生币种）
  | 'CUMULATIVE_LIMIT'       // 累计额度（AED，档位 × 日/月窗口）
  | 'LARGE_APPROVAL'         // 大额转审批阈值（AED）
  | 'ACCOUNT_READINESS'      // 收付账户就绪
  | 'BALANCE_SUFFICIENCY'    // 余额充足
  | 'QUOTE_VALIDITY'         // 报价有效性
  | 'TRADING_READINESS';     // 交易起始就绪

export interface L1Check {
  code: L1CheckCode;
  outcome: L1Outcome;
  /** 人话，运营在详情页直接读这句。 */
  detail: string;
}

/**
 * PASS  = 全过
 * BLOCK = 有 FAIL，且本域**可以拒**（提现/兑换：钱还没动）
 * HOLD  = 有 FAIL，但本域**拒不了**（充值：钱已经在链上到账，只能挂起等处置）
 */
export type L1Verdict = 'PASS' | 'BLOCK' | 'HOLD';

export interface L1Snapshot {
  evaluatedAt: string;
  domain: L1Domain;
  verdict: L1Verdict;
  /** 充值 HOLD 时的挂起原因（如 'SANCTION' / 'ADMIN_SUSPENSION' / 'BELOW_MIN'）。 */
  holdReason: string | null;
  /** 附加信息，非判定项：这笔当时按哪个档位算的。事后客户升档也说得清。 */
  tradingTier: string;
  checks: L1Check[];
}

export interface L1GateInput {
  domain: L1Domain;
  customerId: string;
  /**
   * 调用方已经判过的项（单笔/累计/大额/账户/余额/报价/起始就绪）。
   * 这些判定住在各域自己的位置，L1GateService 不重复执行，只收进快照。
   */
  preChecks?: L1Check[];
}
```

- [ ] **Step 2: 写失败的测试**

创建 `src/modules/trading/shared/l1-gate/l1-gate.service.spec.ts`：

```typescript
import { L1GateService } from './l1-gate.service';

describe('L1GateService', () => {
  let service: L1GateService;
  let customerAccess: any;
  let prisma: any;

  beforeEach(() => {
    customerAccess = { resolve: jest.fn() };
    prisma = { customerMain: { findUnique: jest.fn() } };
    service = new L1GateService(customerAccess, prisma);
  });

  const activeAccess = { lifecycle: 'ACTIVE', blocked: new Set<string>(), disclosed: [] };

  it('全过 → verdict PASS,holdReason 为 null', async () => {
    customerAccess.resolve.mockResolvedValue(activeAccess);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'PREMIUM' });

    const snap = await service.evaluate({ domain: 'WITHDRAW', customerId: 'c1' });

    expect(snap.verdict).toBe('PASS');
    expect(snap.holdReason).toBeNull();
    expect(snap.tradingTier).toBe('PREMIUM');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_ELIGIBILITY')?.outcome).toBe('PASS');
  });

  it('生命周期非 ACTIVE + 提现域 → BLOCK（钱还没动,可以拒）', async () => {
    customerAccess.resolve.mockResolvedValue({ ...activeAccess, lifecycle: 'SUSPENDED' });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'WITHDRAW', customerId: 'c1' });

    expect(snap.verdict).toBe('BLOCK');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_ELIGIBILITY')?.outcome).toBe('FAIL');
  });

  it('生命周期非 ACTIVE + 充值域 → HOLD（钱已到账,拒不了）', async () => {
    customerAccess.resolve.mockResolvedValue({ ...activeAccess, lifecycle: 'SUSPENDED' });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.verdict).toBe('HOLD');
    expect(snap.holdReason).toBe('LIFECYCLE_NOT_ACTIVE');
  });

  it('便签卡住本域能力 → 充值 HOLD 且 holdReason 是该 cause', async () => {
    customerAccess.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
      disclosed: [],
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.verdict).toBe('HOLD');
    expect(snap.holdReason).toBe('CAPABILITY_RESTRICTED');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION')?.outcome).toBe('FAIL');
  });

  it('便签只卡 WITHDRAW/SWAP 时,充值域该项判 PASS', async () => {
    customerAccess.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['WITHDRAW', 'SWAP']),
      disclosed: [],
    });
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.verdict).toBe('PASS');
    expect(snap.checks.find((c) => c.code === 'CUSTOMER_RESTRICTION')?.outcome).toBe('PASS');
  });

  it('调用方传进来的 preChecks 原样进快照,FAIL 会影响 verdict', async () => {
    customerAccess.resolve.mockResolvedValue(activeAccess);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({
      domain: 'SWAP',
      customerId: 'c1',
      preChecks: [{ code: 'BALANCE_SUFFICIENCY', outcome: 'FAIL', detail: '余额不足' }],
    });

    expect(snap.verdict).toBe('BLOCK');
    expect(snap.checks.find((c) => c.code === 'BALANCE_SUFFICIENCY')?.detail).toBe('余额不足');
  });

  it('未提供的项一律落 SKIPPED,九项一个不少', async () => {
    customerAccess.resolve.mockResolvedValue(activeAccess);
    prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });

    const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1' });

    expect(snap.checks).toHaveLength(9);
    expect(snap.checks.find((c) => c.code === 'QUOTE_VALIDITY')?.outcome).toBe('NA');
  });
});
```

- [ ] **Step 3: 跑测试确认它失败**

```bash
npx jest src/modules/trading/shared/l1-gate/
```

Expected: FAIL — `Cannot find module './l1-gate.service'`

- [ ] **Step 4: 写实现**

创建 `src/modules/trading/shared/l1-gate/l1-gate.service.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CustomerAccessService,
  type Capability,
} from '../../../identity/customers/customer-access.service';
import type {
  L1Check,
  L1CheckCode,
  L1Domain,
  L1GateInput,
  L1Snapshot,
  L1Verdict,
} from './l1-gate.types';

/** 九项的固定顺序 —— 详情页按这个顺序渲染,三域一致。 */
const CHECK_ORDER: L1CheckCode[] = [
  'CUSTOMER_ELIGIBILITY',
  'CUSTOMER_RESTRICTION',
  'SINGLE_LIMIT',
  'CUMULATIVE_LIMIT',
  'LARGE_APPROVAL',
  'ACCOUNT_READINESS',
  'BALANCE_SUFFICIENCY',
  'QUOTE_VALIDITY',
  'TRADING_READINESS',
];

/** 各域天然不适用的项（业主 2026-08-22 逐条拍板）。 */
const NOT_APPLICABLE: Record<L1Domain, L1CheckCode[]> = {
  // 充值：钱是进来的 → 无余额/报价问题；累计额度「拦不住」、大额审批「拒了也没用」
  DEPOSIT: ['CUMULATIVE_LIMIT', 'LARGE_APPROVAL', 'BALANCE_SUFFICIENCY', 'QUOTE_VALIDITY'],
  WITHDRAW: [],
  // 兑换：资金不出境,刻意无大额审批门
  SWAP: ['LARGE_APPROVAL'],
};

const DOMAIN_CAPABILITY: Record<L1Domain, Capability> = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAW: 'WITHDRAW',
  SWAP: 'SWAP',
};

/**
 * L1 闸门求值器（三域共用的**唯一**一份 —— 业主 2026-08-22：「通用模块要变成
 * 公共服务」。注意这是 deliberate fork 的例外：状态机/处置弧仍然三域各写各的,
 * 只有横切关注点收成公共实现）。
 *
 * 本 service **不抛错**,只返回快照。怎么处置由各域自己决定：
 *   - 提现/兑换 verdict==='BLOCK' → 抛（钱还没动,可以拒）
 *   - 充值 verdict==='HOLD'      → 落挂起原因,单子照建（钱已到链上,拒不了）
 *
 * 它亲自执行的只有三件事：客户资格、客户限制、档位快照。其余六项住在各域自己
 * 的守卫里（`TransactionLimitGateService` 等）,由调用方判完通过 `preChecks`
 * 传进来 —— 本批不重写那些能跑的代码,只把结果收成一份可回显的快照。
 */
@Injectable()
export class L1GateService {
  constructor(
    private readonly customerAccess: CustomerAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async evaluate(input: L1GateInput): Promise<L1Snapshot> {
    const access = await this.customerAccess.resolve(input.customerId);
    const customer = await (this.prisma as any).customerMain.findUnique({
      where: { id: input.customerId },
      select: { tradingTier: true },
    });

    const own: L1Check[] = [];

    // ① 客户资格
    const lifecycleOk = access.lifecycle === 'ACTIVE';
    own.push({
      code: 'CUSTOMER_ELIGIBILITY',
      outcome: lifecycleOk ? 'PASS' : 'FAIL',
      detail: lifecycleOk
        ? '客户生命周期 ACTIVE'
        : `客户生命周期为 ${access.lifecycle}，不可交易`,
    });

    // ② 客户限制 —— 只看卡不卡**本域**这个能力。
    //    七种因由里只有 SANCTION / ADMIN_SUSPENSION 的 scope 是 ALL（含 DEPOSIT）,
    //    其余五种只卡 WITHDRAW+SWAP —— 材料过期不该挡住别人给你打钱。
    const capability = DOMAIN_CAPABILITY[input.domain];
    const restricted = access.blocked.has(capability);
    own.push({
      code: 'CUSTOMER_RESTRICTION',
      outcome: restricted ? 'FAIL' : 'PASS',
      detail: restricted
        ? `客户被限制账摁住 ${capability} 能力（共 ${access.blocked.size} 项能力受限）`
        : '限制账无卡住本域能力的 OPEN 便签',
    });

    // ③ 合并：本 service 判的 + 调用方传进来的 + 域内不适用的 + 其余 SKIPPED
    const provided = new Map<L1CheckCode, L1Check>();
    for (const c of own) provided.set(c.code, c);
    for (const c of input.preChecks ?? []) provided.set(c.code, c);

    const na = new Set(NOT_APPLICABLE[input.domain]);
    const checks: L1Check[] = CHECK_ORDER.map((code) => {
      const hit = provided.get(code);
      if (hit) return hit;
      if (na.has(code)) {
        return { code, outcome: 'NA' as const, detail: '本域不适用' };
      }
      return { code, outcome: 'SKIPPED' as const, detail: '本次未评估' };
    });

    const failed = checks.filter((c) => c.outcome === 'FAIL');
    const verdict: L1Verdict =
      failed.length === 0 ? 'PASS' : input.domain === 'DEPOSIT' ? 'HOLD' : 'BLOCK';

    return {
      evaluatedAt: new Date().toISOString(),
      domain: input.domain,
      verdict,
      holdReason: verdict === 'HOLD' ? this.holdReasonOf(failed[0]) : null,
      tradingTier: customer?.tradingTier || 'BASIC',
      checks,
    };
  }

  /** 充值挂起原因：取第一条没过的项,映射成一个稳定的机器可读串。 */
  private holdReasonOf(first: L1Check): string {
    switch (first.code) {
      case 'CUSTOMER_ELIGIBILITY':
        return 'LIFECYCLE_NOT_ACTIVE';
      case 'CUSTOMER_RESTRICTION':
        return 'CAPABILITY_RESTRICTED';
      case 'SINGLE_LIMIT':
        return 'BELOW_MIN';
      default:
        return first.code;
    }
  }
}
```

创建 `src/modules/trading/shared/l1-gate/l1-gate.module.ts`：

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { CustomersModule } from '../../../identity/customers/customers.module';
import { L1GateService } from './l1-gate.service';

/**
 * 三域交易 module 各自 import 本 module 拿 L1GateService。
 * CustomersModule 已导出 CustomerAccessService（提现域 Task 5 起就在用）。
 */
@Module({
  imports: [PrismaModule, CustomersModule],
  providers: [L1GateService],
  exports: [L1GateService],
})
export class L1GateModule {}
```

> 若 `CustomersModule` 与交易 module 之间已有环，按仓库既有做法用 `forwardRef(() => CustomersModule)`（`swap` 域有三处 forwardRef 先例）。

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/modules/trading/shared/l1-gate/
```

Expected: PASS（7 passed）

- [ ] **Step 6: 变异测试**

把 `verdict` 那行的 `input.domain === 'DEPOSIT' ? 'HOLD' : 'BLOCK'` 改成恒 `'BLOCK'`，重跑。

Expected: 「充值域 → HOLD」那两个用例**必须变红**。确认后恢复。

- [ ] **Step 7: 跑全部闸门**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
```

Expected: tsc 0 错；jest 净新失败 0

- [ ] **Step 8: 提交**

```bash
git add src/modules/trading/shared/l1-gate/
git commit -m "feat(l1): 建三域共用的 L1GateService 与快照类型(九项判定,不抛错只出快照)"
```

---

## Task B2: 提现 / 兑换接入 L1 快照

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（`:265` 附近的 `assertCapability` 与 `:326` 的限额闸）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`（import `L1GateModule`）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（`:218-228` 的限额闸）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.module.ts`
- Test: 两域的 `*-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `L1GateService.evaluate(input)`（Task B1）；`WithdrawTransactionsService` / `SwapTransactionsService` 建单入参新增 `l1Snapshot`

**背景**：提现已经在建单前调 `assertCapability(userId, 'WITHDRAW')`（`:269`），**兑换没有** —— 本 Task 给兑换补上，两域都把结果落进快照。

- [ ] **Step 1: 写失败的测试（兑换缺资格闸）**

在 `swap-workflow.service.spec.ts` 加：

```typescript
  describe('B2 · 兑换 L1 资格闸', () => {
    it('L1 verdict=BLOCK 时不建单、不消费报价', async () => {
      l1GateService.evaluate.mockResolvedValue({
        evaluatedAt: '2026-08-22T00:00:00.000Z',
        domain: 'SWAP', verdict: 'BLOCK', holdReason: null, tradingTier: 'BASIC',
        checks: [{ code: 'CUSTOMER_RESTRICTION', outcome: 'FAIL', detail: 'blocked' }],
      });

      await expect(
        service.initiateSwap('c1', { quoteId: 'q1' } as any),
      ).rejects.toThrow();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('L1 verdict=PASS 时快照写进建单入参', async () => {
      l1GateService.evaluate.mockResolvedValue({
        evaluatedAt: '2026-08-22T00:00:00.000Z',
        domain: 'SWAP', verdict: 'PASS', holdReason: null, tradingTier: 'PREMIUM',
        checks: [],
      });

      await service.initiateSwap('c1', { quoteId: 'q1' } as any).catch(() => undefined);

      expect(swapService.create).toHaveBeenCalledWith(
        expect.objectContaining({ l1Snapshot: expect.stringContaining('"tradingTier":"PREMIUM"') }),
        expect.anything(),
      );
    });
  });
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t "B2 · 兑换 L1 资格闸"
```

Expected: FAIL — `l1GateService is not defined` / `evaluate` 未被调用

- [ ] **Step 3: 兑换 workflow 接入**

`swap-workflow.service.ts` 构造器注入：

```typescript
    private readonly l1Gate: L1GateService,
```

在 `:218` 那段 quotePeek + 限额闸之后、`const now = new Date();` 之前插入：

```typescript
    // ── L1 闸门收口（第四批）──
    // 把已经判过的限额结果收进快照,再由 L1GateService 补上兑换域此前**完全没查**
    // 的两项：客户资格（lifecycle）与客户限制（便签卡没卡住 SWAP 能力）。
    // 兑换钱还没动 → verdict BLOCK 直接拒,与提现同口径。
    const preChecks: L1Check[] = [];
    if (quotePeek) {
      preChecks.push({
        code: 'SINGLE_LIMIT', outcome: 'PASS',
        detail: `单笔上下限已过（${quotePeek.amountIn}）`,
      });
      preChecks.push({
        code: 'CUMULATIVE_LIMIT', outcome: 'PASS',
        detail: `累计额度已过（AED ${gateValuation?.grossAedValue ?? '—'}）`,
      });
      preChecks.push({ code: 'QUOTE_VALIDITY', outcome: 'PASS', detail: '报价有效' });
    }

    const l1 = await this.l1Gate.evaluate({
      domain: 'SWAP',
      customerId: ownerId,
      preChecks,
    });
    if (l1.verdict === 'BLOCK') {
      throw new ForbiddenException({
        code: 'L1_GATE_BLOCKED',
        // 中性文案 —— 与 CustomerAccessService 的 NEUTRAL_DENIAL 同口径,
        // 绝不透出 cause / visibility（tipping-off 防线）。
        message: 'This operation is not available for your account at the moment.',
      });
    }
```

在 `swapService.create({...})` 的入参里加：

```typescript
          l1Snapshot: JSON.stringify(l1),
```

`swap-transactions.module.ts` 的 `imports` 加 `L1GateModule`。

- [ ] **Step 4: 提现 workflow 接入**

`withdraw-workflow.service.ts` 构造器注入 `private readonly l1Gate: L1GateService,`。

把 `:269` 的 `assertCapability` 保留不动（它是快速失败路径），在限额闸（`:326`）之后加：

```typescript
    // ── L1 闸门收口（第四批）── assertCapability 已在上面快速失败过一轮,
    // 这里重跑一次是为了拿到**可回显的快照**（不是重复校验：上面抛的是中性错误,
    // 拿不到逐项结果）。verdict 到这里必然 PASS,除非并发窗口内便签刚被开出来。
    const l1 = await this.l1Gate.evaluate({
      domain: 'WITHDRAW',
      customerId: userId,
      preChecks: [
        { code: 'SINGLE_LIMIT', outcome: 'PASS', detail: `单笔上下限已过（${amount}）` },
        { code: 'CUMULATIVE_LIMIT', outcome: 'PASS', detail: `累计额度已过（AED ${gateValuation?.grossAedValue ?? '—'}）` },
        { code: 'ACCOUNT_READINESS', outcome: 'PASS', detail: '出款地址已注册且 ACTIVE' },
        { code: 'BALANCE_SUFFICIENCY', outcome: 'PASS', detail: '建单即锁额，TB pending 已通过' },
        { code: 'QUOTE_VALIDITY', outcome: 'PASS', detail: '报价有效' },
        { code: 'TRADING_READINESS', outcome: 'PASS', detail: '交易起始前置已满足' },
      ],
    });
    if (l1.verdict === 'BLOCK') {
      throw new ForbiddenException({
        code: 'L1_GATE_BLOCKED',
        message: 'This operation is not available for your account at the moment.',
      });
    }
```

在 `insertRecord({...})` 的入参里加 `l1Snapshot: JSON.stringify(l1),`。

`withdraw-transactions.module.ts` 的 `imports` 加 `L1GateModule`。

- [ ] **Step 5: 两个 service 的建单方法接住新字段**

`WithdrawTransactionsService.insertRecord` 与 `SwapTransactionsService.create` 的入参类型各加 `l1Snapshot?: string;`，并在 `data: {...}` 里透传。

- [ ] **Step 6: 跑测试确认通过**

```bash
npx jest src/modules/trading/swap-transactions/ src/modules/trading/withdraw-transactions/
```

Expected: PASS

- [ ] **Step 7: 变异测试**

把兑换那段 `if (l1.verdict === 'BLOCK') { throw ... }` 注释掉，重跑 `-t "B2 · 兑换 L1 资格闸"`。

Expected: 第 1 个用例**必须变红**。确认后恢复。

- [ ] **Step 8: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add src/modules/trading/
git commit -m "feat(l1): 提现/兑换接入 L1 快照;兑换补上此前完全没有的客户资格+限制闸"
```

---

## Task B3: 兑换补建单余额校验

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（`:262` 的 ledger precheck 之后）
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`

**Interfaces:**
- Consumes: `AccountingService`（已注入）；快照里落 `BALANCE_SUFFICIENCY`

**背景（勿混淆）**：`:262` 现有的那段叫 "Ledger precheck"，但它**只检查币种在 TigerBeetle 里注册过账本没有**（`this.resolveLedger(...)`），**跟余额一分钱关系都没有**。

兑换现在的真实暴露面：报价烧了、KYT 过了、单子建了，等到建第一条腿才发现钱不够 —— 而 `PROCESSING` 只有 `success` 一条出边，没有失败出边，单子就永久卡在那儿。

提现是反例：建单即在 TB 创建 pending 转账锁住净额+手续费，余额不足 TB 当场拒 → 建单失败，什么都没发生。

- [ ] **Step 1: 写失败的测试**

```typescript
  describe('B3 · 兑换建单余额校验', () => {
    it('卖出侧余额不足 → 建单前就拒,不消费报价', async () => {
      accountingService.getCustomerAvailableBalance.mockResolvedValue({ available: 50n, held: 0n, total: 50n });

      await expect(
        service.initiateSwap('c1', { quoteId: 'q1' } as any),
      ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_BALANCE' } });

      expect(swapQuoteService.getActiveQuoteOrThrow).not.toHaveBeenCalled();
    });

    it('余额充足 → 放行,快照里 BALANCE_SUFFICIENCY 为 PASS', async () => {
      accountingService.getCustomerAvailableBalance.mockResolvedValue({ available: 100_000_00n, held: 0n, total: 100_000_00n });

      await service.initiateSwap('c1', { quoteId: 'q1' } as any).catch(() => undefined);

      expect(l1GateService.evaluate).toHaveBeenCalledWith(
        expect.objectContaining({
          preChecks: expect.arrayContaining([
            expect.objectContaining({ code: 'BALANCE_SUFFICIENCY', outcome: 'PASS' }),
          ]),
        }),
      );
    });
  });
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t "B3 · 兑换建单余额校验"
```

Expected: FAIL — 没抛 `INSUFFICIENT_BALANCE`

- [ ] **Step 3: 实现**

在 `quotePeek` 拿到之后、L1 evaluate 之前插入：

```typescript
    // ── 建单前余额校验（第四批补）──
    // 提现建单即压 TB pending 锁额,余额不足当场被 TB 拒;兑换此前**没有这道闸**,
    // 要等 KYT 过了建第一条腿才发现钱不够 —— 那时报价已烧、KYT 已过,而 PROCESSING
    // 没有失败出边,单子永久卡死。所以必须前移到建单前。
    //
    // 在 Decimal 空间比,不在 bigint 空间比：`decimalToBigint` 是
    // swap-leg-accounting.ts 的**私有**方法,本文件拿不到;而
    // getCustomerAvailableBalance 返回的是账本最小单位的 bigint,
    // 除以 10^decimals 降回业务单位即可,不必新造 helper。
    if (quotePeek) {
      const sellAsset = await this.prisma.asset.findUnique({
        where: { id: quotePeek.fromAssetId },
        select: { currency: true, decimals: true },
      });
      if (sellAsset) {
        const bal = await this.accountingService.getCustomerAvailableBalance(
          ownerId,
          sellAsset.currency,
        );
        const availableDecimal = new Prisma.Decimal(bal.available.toString()).div(
          new Prisma.Decimal(10).pow(sellAsset.decimals),
        );
        const needed = new Prisma.Decimal(quotePeek.amountIn);
        if (availableDecimal.lt(needed)) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_BALANCE',
            assetCode: sellAsset.currency,
            message: `余额不足：需要 ${needed.toString()} ${sellAsset.currency}，可用 ${availableDecimal.toString()}`,
          });
        }
        preChecks.push({
          code: 'BALANCE_SUFFICIENCY', outcome: 'PASS',
          detail: `卖出侧余额充足（需 ${needed.toString()} ${sellAsset.currency}，可用 ${availableDecimal.toString()}）`,
        });
      }
    }
```

> `preChecks` 数组的声明要挪到这段之前（Task B2 里它声明在 L1 evaluate 上方，这里前移一行即可）。
>
> `getCustomerAvailableBalance(customerUuid, assetCurrency)` 的真实签名见 `accounting.service.ts:376`，返回 `{ available, held, total }` 三个 bigint；它内部自己 resolve `CLIENT_PAYABLE` 账户，**不需要**调用方传 ledger 或 accountId。

- [ ] **Step 4: 跑测试确认通过 + 变异**

```bash
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t "B3 · 兑换建单余额校验"
```

Expected: PASS。然后把 `if (availableDecimal.lt(needed))` 改成 `if (false)` 重跑 —— 第 1 个用例**必须变红**，确认后恢复。

- [ ] **Step 5: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add src/modules/trading/swap-transactions/
git commit -m "fix(swap): 建单前补余额校验,堵住「报价烧了KYT过了才发现钱不够、卡死 PROCESSING」"
```

---

## Task B4: 充值接入 L1 —— 建单算、入账处守卫、挂起不拒单

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（建单处 `:1031` 附近）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（`approveDeposit` `:1115` 的 `holdBelowMinIfNeeded` 旁边）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts`
- Test: 两个 spec

**Interfaces:**
- Consumes: `L1GateService.evaluate`（B1）

**背景 —— 本 Task 修的是本批最实的一个洞**：

`assertCapability()` 全仓只有一个调用方（提现）。充值域注入了 `CustomerAccessService` 但只用于订阅冻结广播。后果：制裁广播只冻「制裁时已存在的在途单」，**制裁之后新到的钱建单于广播之后，广播冻不到它，充值域自己也不查限制账 —— 一路正常走到 SUCCESS 入账。**

**充值的 L1 不拒单，只决定落地姿势**（钱已在链上，拒绝在物理上不存在）：
- 执法级（`SANCTION`，SILENT）→ 已有的 `FROZEN`
- 非执法级（`ADMIN_SUSPENSION` / `BELOW_MIN`）→ 已有的 `OPERATION_PENDING` + 挂起原因

**零新状态。L1 是入账那一刻的守卫，不是一个状态。**

- [ ] **Step 1: 写失败的测试**

```typescript
  describe('B4 · 充值 L1', () => {
    it('建单时算一次 L1,快照落库', async () => {
      l1GateService.evaluate.mockResolvedValue({
        evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'DEPOSIT',
        verdict: 'PASS', holdReason: null, tradingTier: 'BASIC', checks: [],
      });

      await service.createFromInboundSignal({ /* 按现有入参形状填 */ } as any);

      expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ l1Snapshot: expect.stringContaining('"verdict":"PASS"') }),
        }),
      );
    });

    it('L1 HOLD 时照样建单,只落挂起原因 —— 绝不拒', async () => {
      l1GateService.evaluate.mockResolvedValue({
        evaluatedAt: '2026-08-22T00:00:00.000Z', domain: 'DEPOSIT',
        verdict: 'HOLD', holdReason: 'CAPABILITY_RESTRICTED', tradingTier: 'BASIC', checks: [],
      });

      await expect(
        service.createFromInboundSignal({ /* 同上 */ } as any),
      ).resolves.toBeDefined();

      expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ limitHoldReason: 'CAPABILITY_RESTRICTED' }),
        }),
      );
    });

    it('approveDeposit 遇到未解除的 L1 挂起 → 不入账,推 OPERATION_PENDING', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'd1', depositNo: 'DEP001', status: 'COMPLIANCE_PENDING',
        limitHoldReason: 'CAPABILITY_RESTRICTED', ownerType: 'CUSTOMER', ownerId: 'c1',
      });

      await service.approveDeposit('d1');

      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.anything(),
      );
      expect(accountingService.executeDepositAccounting).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/trading/deposit-transactions/ -t "B4 · 充值 L1"
```

Expected: FAIL

- [ ] **Step 3: 建单处算 L1**

`deposit-transactions.service.ts` 的建单方法里，把现有的 BELOW_MIN 判定段（`:1030-1035`）扩成：

```typescript
    // ── L1 闸门（第四批）──
    // 充值**不拒单**：钱已经在链上到账了,「拒绝」在物理上不存在。L1 只决定
    // 这笔钱的**落地姿势**——过不了就建单 + 落挂起原因,等运营/MLRO 处置。
    // 单笔下限（BELOW_MIN）是这套机制的第一个特例,现在并入同一个字段。
    let limitHoldReason: string | undefined;
    const singleRule = await this.limitRulesService.getSingleRule('DEPOSIT', input.assetId);
    const belowMin =
      !!singleRule?.minAmount &&
      new Prisma.Decimal(input.amount).lt(new Prisma.Decimal(singleRule.minAmount));

    const l1 = await this.l1Gate.evaluate({
      domain: 'DEPOSIT',
      customerId: wallet.ownerId,
      preChecks: [
        {
          code: 'SINGLE_LIMIT',
          outcome: belowMin ? 'FAIL' : 'PASS',
          detail: belowMin
            ? `低于单笔下限 ${singleRule!.minAmount}（本笔 ${input.amount}）`
            : '单笔下限已过',
        },
        { code: 'ACCOUNT_READINESS', outcome: 'PASS', detail: '收款钱包存在且资产匹配' },
        { code: 'TRADING_READINESS', outcome: 'PASS', detail: '交易起始前置已满足' },
      ],
    });
    if (l1.verdict === 'HOLD') {
      limitHoldReason = l1.holdReason ?? undefined;
    }
```

`create({ data: {...} })` 里加 `l1Snapshot: JSON.stringify(l1),`。

构造器注入 `private readonly l1Gate: L1GateService,`；module 的 `imports` 加 `L1GateModule`。

- [ ] **Step 4: 客户面藏不藏改成按因由查表**

现有的客户面隐藏判据是 `limitHoldReason: null`（无条件藏）。改成只藏 SILENT 类：

在 `deposit-transactions.service.ts` 顶部加：

```typescript
/**
 * 哪些 L1 挂起原因要对客户隐藏。
 * SANCTION 是 SILENT（tipping-off——告诉客户涉制裁调查在多数 AML 法域是刑事犯罪）;
 * BELOW_MIN 沿用业主既有裁定（客户面不显示,等运营处置）;
 * ADMIN_SUSPENSION 是 DISCLOSED（customerLabel 'Account suspended'）—— 给客户看,
 * 藏了反而像吞钱。
 */
const L1_HOLD_HIDDEN_FROM_CUSTOMER = new Set(['CAPABILITY_RESTRICTED', 'BELOW_MIN']);
```

把客户面查询里的 `where.limitHoldReason = null` 换成：

```typescript
    if (options?.customerScope) {
      where.OR = [
        { limitHoldReason: null },
        { limitHoldReason: { notIn: Array.from(L1_HOLD_HIDDEN_FROM_CUSTOMER) } },
      ];
    }
```

> ⚠️ `CAPABILITY_RESTRICTED` 目前无法区分是 SANCTION 还是 ADMIN_SUSPENSION 触发的 —— 保守起见**一律藏**（宁可错杀，tipping-off 的代价不对称）。要精确区分需要 `holdReasonOf()` 带上 cause，登记 BACKLOG。

- [ ] **Step 5: `approveDeposit` 补 L1 守卫**

`deposit-workflow.service.ts` 的 `approveDeposit` 里，把 `:1115` 那一行：

```typescript
    if (await this.holdBelowMinIfNeeded(deposit)) return;
```

替换成：

```typescript
    // ── 资金入账唯一出口的 L1 守卫（第四批）──
    // 四条 approve→SUCCESS 边全汇于本方法,所以 L1 只需要在这里挂一道,
    // 不需要新造状态。BELOW_MIN 是这套机制的第一个实例,其余挂起原因与它并列。
    if (await this.holdOnL1IfNeeded(deposit)) return;
```

并把 `holdBelowMinIfNeeded` 改写为 `holdOnL1IfNeeded`（保留原方法体的结构，只是判据从「等于 BELOW_MIN」放宽到「非空」）：

```typescript
  /**
   * L1 挂起守卫：单子带着未解除的 L1 挂起原因时,不入账,推 OPERATION_PENDING
   * 等运营处置。**不是新状态**——L1 是入账那一刻的守卫（业主 2026-08-22 定稿）。
   * 判定依据是建单时落的 `limitHoldReason`,**不在此处重跑 L1**：规则/便签可能
   * 在单子生命周期内变过,用出生时的快照更稳定、也可追溯（与 BELOW_MIN 原有口径一致）。
   */
  private async holdOnL1IfNeeded(deposit: any): Promise<boolean> {
    const reason = deposit.limitHoldReason;
    if (!reason) return false;

    await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.OPERATION_PENDING,
        reason: `Compliance approved; L1 hold '${reason}' still in force — awaiting ops disposition`,
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'SYSTEM' },
        sourcePlatform: 'SYSTEM',
      },
    );

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_HELD_BELOW_MIN,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: `Deposit held: compliance approved but L1 hold '${reason}' still in force`,
      metadata: { depositNo: deposit.depositNo, amount: String(deposit.amount), l1HoldReason: reason },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.warn(
      `L1 hold: deposit ${deposit.id} approved by compliance but held on '${reason}' — OPERATION_PENDING`,
    );
    return true;
  }
```

同步把 `approveDeposit` 顶部那个「重复 approve no-op」判据里的 `deposit.limitHoldReason === 'BELOW_MIN'` 放宽成 `!!deposit.limitHoldReason`。

- [ ] **Step 6: 跑测试 + 变异**

```bash
npx jest src/modules/trading/deposit-transactions/ -t "B4 · 充值 L1"
```

Expected: PASS。然后把 Step 5 的 `if (!reason) return false;` 改成 `return false;` 重跑 —— 第 3 个用例**必须变红**，确认后恢复。

- [ ] **Step 7: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add src/modules/trading/deposit-transactions/
git commit -m "fix(deposit): 建单查 L1+入账口守卫,堵住「制裁之后新到的钱一路 SUCCESS 入账」"
```

---

## Task B5: 三域详情页 L1 卡片回显

**Files:**
- Create: `admin-web/src/components/L1GateCard.tsx`
- Create: `admin-web/src/components/L1GateCard.spec.tsx`
- Modify: `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx`

**Interfaces:**
- Consumes: `l1Snapshot` 字符串（B2/B4 写入）；字段名与 `l1-gate.types.ts` 逐字一致

**背景**：三个详情页现在都有一个写着 `L1 · Eligibility` 的格子，但它读的是 `data.customer.complianceStatus`（客户级资格），**不是限额闸判定** —— 名字被占了。真正的 L1 判定在三个页面上一个字都没有。

- [ ] **Step 1: 写组件测试**

创建 `admin-web/src/components/L1GateCard.spec.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import L1GateCard from './L1GateCard';

const snapshot = JSON.stringify({
  evaluatedAt: '2026-08-22T10:00:00.000Z',
  domain: 'DEPOSIT',
  verdict: 'HOLD',
  holdReason: 'CAPABILITY_RESTRICTED',
  tradingTier: 'PREMIUM',
  checks: [
    { code: 'CUSTOMER_ELIGIBILITY', outcome: 'PASS', detail: '客户生命周期 ACTIVE' },
    { code: 'CUSTOMER_RESTRICTION', outcome: 'FAIL', detail: '客户被限制账摁住 DEPOSIT 能力' },
    { code: 'CUMULATIVE_LIMIT', outcome: 'NA', detail: '本域不适用' },
  ],
});

describe('L1GateCard', () => {
  it('逐项渲染判定与人话说明', () => {
    render(<L1GateCard raw={snapshot} />);
    expect(screen.getByText('CUSTOMER_RESTRICTION')).toBeInTheDocument();
    expect(screen.getByText('客户被限制账摁住 DEPOSIT 能力')).toBeInTheDocument();
  });

  it('显示 verdict 与挂起原因与档位', () => {
    render(<L1GateCard raw={snapshot} />);
    expect(screen.getByText('HOLD')).toBeInTheDocument();
    expect(screen.getByText(/CAPABILITY_RESTRICTED/)).toBeInTheDocument();
    expect(screen.getByText(/PREMIUM/)).toBeInTheDocument();
  });

  it('快照为空时显示未评估,不崩', () => {
    render(<L1GateCard raw={null} />);
    expect(screen.getByText(/未评估|Not evaluated/)).toBeInTheDocument();
  });

  it('快照是坏 JSON 时降级显示原文,不崩', () => {
    render(<L1GateCard raw={'{ 坏掉的' } />);
    expect(screen.getByText(/无法解析|unparseable/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest admin-web/src/components/L1GateCard.spec.tsx
```

Expected: FAIL — `Cannot find module './L1GateCard'`

- [ ] **Step 3: 写组件**

创建 `admin-web/src/components/L1GateCard.tsx`：

```tsx
/**
 * L1 闸门回显卡（三域详情页共用）。
 *
 * 业主口径：「这个东西不用筛查，我就是点击后有个代码行能看就行」——
 * 所以后端存的是一个 JSON 字符串,这里只负责把它摊开成人能读的表。
 *
 * ⚠️ 与页面上既有的 `L1 · Eligibility` 格子是**两回事**：那个读的是客户级
 * complianceStatus,本卡读的是这笔单出生时的 L1 判定快照。
 */

interface L1Check {
  code: string;
  outcome: 'PASS' | 'FAIL' | 'NA' | 'SKIPPED';
  detail: string;
}

interface L1Snapshot {
  evaluatedAt: string;
  domain: string;
  verdict: 'PASS' | 'BLOCK' | 'HOLD';
  holdReason: string | null;
  tradingTier: string;
  checks: L1Check[];
}

const OUTCOME_CLASS: Record<string, string> = {
  PASS: 'text-adm-green',
  FAIL: 'text-adm-red',
  NA: 'text-adm-t3',
  SKIPPED: 'text-adm-t3',
};

const VERDICT_CLASS: Record<string, string> = {
  PASS: 'border-adm-green/25 bg-adm-green/10 text-adm-green',
  HOLD: 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
  BLOCK: 'border-adm-red/25 bg-adm-red/10 text-adm-red',
};

const L1GateCard = ({ raw }: { raw?: string | null }) => {
  if (!raw) {
    return (
      <div className="rounded-lg border border-adm-border bg-adm-bg p-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 Gate</div>
        <div className="mt-1 font-mono text-[11px] text-adm-t3">未评估（本单建于 L1 收口之前）</div>
      </div>
    );
  }

  let snap: L1Snapshot | null = null;
  try {
    snap = JSON.parse(raw) as L1Snapshot;
  } catch {
    return (
      <div className="rounded-lg border border-adm-border bg-adm-bg p-3">
        <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 Gate</div>
        <div className="mt-1 font-mono text-[11px] text-adm-yellow">
          快照无法解析（unparseable）：<span className="text-adm-t3">{raw.slice(0, 80)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-adm-border bg-adm-bg p-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">L1 Gate</div>
        <span
          className={`rounded border px-1.5 py-px font-mono text-[9px] uppercase tracking-wider ${
            VERDICT_CLASS[snap.verdict] ?? VERDICT_CLASS.BLOCK
          }`}
        >
          {snap.verdict}
        </span>
      </div>

      <div className="mt-1 font-mono text-[10px] text-adm-t3">
        档位 {snap.tradingTier}
        {snap.holdReason ? ` · 挂起原因 ${snap.holdReason}` : ''}
        {snap.evaluatedAt ? ` · ${new Date(snap.evaluatedAt).toLocaleString()}` : ''}
      </div>

      <div className="mt-2 space-y-1">
        {snap.checks.map((c) => (
          <div key={c.code} className="flex items-start gap-2">
            <span className={`w-[124px] shrink-0 font-mono text-[10px] ${OUTCOME_CLASS[c.outcome] ?? 'text-adm-t3'}`}>
              {c.code}
            </span>
            <span className={`w-9 shrink-0 font-mono text-[10px] ${OUTCOME_CLASS[c.outcome] ?? 'text-adm-t3'}`}>
              {c.outcome}
            </span>
            <span className="min-w-0 flex-1 font-mono text-[10px] text-adm-t2">{c.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default L1GateCard;
```

- [ ] **Step 4: 三个详情页挂上去**

三个页面的详情数据 interface 各加：

```typescript
  l1Snapshot?: string | null;
```

在各自的 `Compliance` 卡片里，`L1 · Eligibility` / `L2 · Transaction Screen` 那个两列 grid **下方**加一行：

```tsx
              <div className="col-span-2 mt-2">
                <L1GateCard raw={data.l1Snapshot} />
              </div>
```

并 import：`import L1GateCard from '../components/L1GateCard';`

> 保留既有的 `L1 · Eligibility` 格子不动 —— 它表达的是客户级资格,与本卡不是同一件事。本卡把「限额闸到底判了什么」补上。

- [ ] **Step 5: 渲染验证 + 截图**

```bash
bash scripts/stack.sh up main
```

登录管理台，三个域各点进一笔单，确认 L1 Gate 卡出现且逐项可读。新建一笔充值（走客户端）再看 —— 它应该有完整快照；旧单显示「未评估」不崩。

用 `computer` 截图三张留存。

- [ ] **Step 6: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add admin-web/src/components/L1GateCard.tsx admin-web/src/components/L1GateCard.spec.tsx admin-web/src/pages/
git commit -m "feat(admin): 三域详情页加 L1 Gate 回显卡(九项判定逐条+挡位+挂起原因)"
```

---

# Phase C · `OPERATION_PENDING → RETURNING`

## Task C1: 加退回边 + 守卫放宽 + admin 端点 + action 栏按钮

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（转移表 `OPERATION_PENDING` 那一块）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（`initiateReturn` `:1983`、`onReturnApproved` 的状态守卫）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`
- Test: `deposit-transactions.service.spec.ts` / `deposit-workflow.service.spec.ts`

**Interfaces:**
- Produces: `POST /deposit-transactions/:id/return`，body `{ reason: string }`，走 MLRO maker-checker 审批案（**不是直推**）

**背景**：运营在 `OPERATION_PENDING` 看到「客户账户已暂停」这个挂起原因时，现有出边只有 `approve→SUCCESS`（不该放行）、`confiscate_start`（太重）、`freeze`（太重）—— **没有退回汇款人这条路**。

而且充值域的「原路退回」此前**根本没有运营入口**：`initiateReturn()` 全仓唯一调用方是 `applyKytRejected` 里判 `dispoTag === 'RETURN_TO_SENDER'` 的分支，控制器上没有对应路由。合规官想退钱得跑去 Sumsub 后台改裁决标签。本 Task 一并补上正门。

- [ ] **Step 1: 写失败的测试**

`deposit-transactions.service.spec.ts` 加：

```typescript
    it('OPERATION_PENDING 可以走 return → RETURNING（第四批新增边）', () => {
      expect(
        (service as any).getNextStatus(
          DepositTransactionStatus.OPERATION_PENDING,
          DepositTransactionAction.RETURN,
        ),
      ).toBe(DepositTransactionStatus.RETURNING);
    });
```

并把总边数断言 27 → **28**。

`deposit-workflow.service.spec.ts` 加：

```typescript
  describe('C1 · OPERATION_PENDING 退回', () => {
    it('OPERATION_PENDING 的单可以开退回审批案', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'd1', depositNo: 'DEP001', status: 'OPERATION_PENDING',
        fromAddress: 'TX-SENDER', ownerType: 'CUSTOMER', ownerId: 'c1',
      });
      approvalsService.list.mockResolvedValue({ items: [] });

      await expect(
        service.initiateReturn('d1', { reason: '客户账户已暂停，原路退回' }, actor),
      ).resolves.toBeDefined();
    });

    it('SUCCESS 的单不能开退回审批案', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'd2', depositNo: 'DEP002', status: 'SUCCESS',
        fromAddress: 'TX-SENDER', ownerType: 'CUSTOMER', ownerId: 'c1',
      });

      await expect(
        service.initiateReturn('d2', { reason: 'x' }, actor),
      ).rejects.toThrow(/cannot open a return approval/i);
    });
  });
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/trading/deposit-transactions/ -t "OPERATION_PENDING"
```

Expected: FAIL — 转移表抛 Invalid；`initiateReturn` 抛 `not awaiting manual review`

- [ ] **Step 3: 转移表加边**

`deposit-transactions.service.ts` 的 `[DepositTransactionStatus.OPERATION_PENDING]` 那一块加一条：

```typescript
        [DepositTransactionAction.RETURN]: DepositTransactionStatus.RETURNING,
```

把 `getNextStatus` 上方注释的边数订正为 `28 边`。

- [ ] **Step 4: 两处状态守卫放宽**

`deposit-workflow.service.ts` 的 `initiateReturn`（`:1983`）：

```typescript
    // 第四批：OPERATION_PENDING 也能发起退回 —— 运营看到 L1 挂起原因（如「客户账户
    // 已暂停」）时,除了放行/上缴/冻结之外必须有「把钱原路退回去」这条路。
    const RETURNABLE_STATUSES: string[] = [
      DepositTransactionStatus.MANUAL_CHECKING,
      DepositTransactionStatus.OPERATION_PENDING,
    ];
    const deposit = await this.depositService.findOne(depositId);
    if (!RETURNABLE_STATUSES.includes(deposit.status)) {
      throw new BadRequestException(
        'Deposit is not in a returnable status (MANUAL_CHECKING / OPERATION_PENDING), cannot open a return approval',
      );
    }
```

`onReturnApproved` 里同款守卫（原文 `if (deposit.status !== DepositTransactionStatus.MANUAL_CHECKING)`）改成同一个 `RETURNABLE_STATUSES.includes(...)` 判据。把该常量提到类级别 `private static readonly RETURNABLE_STATUSES` 供两处共用。

- [ ] **Step 5: 加 admin 端点**

`deposit-transactions.controller.ts` 在 `:199` 的 `confiscate` 端点旁边加：

```typescript
  @Post(':id/return')
  @ApiOperation({ summary: 'Open a return-to-sender approval (MLRO maker-checker) for a deposit' })
  @RequirePermissions(buildPermissionCode('POST', '/deposit-transactions/:id/return'))
  initiateReturn(
    @Param('id') id: string,
    @Body() dto: InitiateDepositReturnDto,
    @Req() req: any,
  ) {
    this.assertAdmin(req);
    return this.workflow.initiateReturn(id, dto, {
      actorId: req.user?.userId,
      actorNo: req.user?.userNo,
      actorRole: req.user?.role,
    });
  }
```

> `assertAdmin(req)` 必须带 —— 本批「不做安全」指的是不去清既存的洞，**新增端点一律加闸**（与第三批 `simulate-sla-timeout` 同一先例）。

DTO（放在该域 dto 目录，与 `ConfiscateDepositDto` 同文件）：

```typescript
export class InitiateDepositReturnDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
```

- [ ] **Step 6: 登记 RBAC catalog 并重启后端**

`rbac.catalog.ts` 加一行 `route('POST', '/deposit-transactions/:id/return')`（照该文件既有写法）。然后：

```bash
npm run db:base:sync
bash scripts/stack.sh down main && bash scripts/stack.sh up main
```

> ⚠️ 只 seed 不重启 = 白费：SUPER_ADMIN 权限走内存里的 `RBAC_PERMISSION_DEFINITIONS`，不读 DB。

- [ ] **Step 7: 详情页 action 栏加按钮**

`DepositTransactionDetail.tsx`，在 `OPERATION_PENDING` 的处置区（与既有的 waive 按钮同组）加：

```tsx
          {data.status === 'OPERATION_PENDING' && (
            <SidebarGroup title="Ops Disposition">
              {/* 退回是 MLRO maker-checker 审批案,不是直推 —— 点下去开的是审批,
                  钱不会立刻退。文案要说清楚,否则运营以为点完就结束了。 */}
              <button
                onClick={() => {
                  setDispositionError('');
                  setReturnReason('');
                  setIsReturnModalOpen(true);
                }}
                disabled={dispositionSubmitting}
                className={adminButtonClass('workflowSecondary')}
              >
                Initiate Return to Sender
              </button>
            </SidebarGroup>
          )}
```

弹窗照抄同页 `Initiate Seize` 那个 modal 的结构（一个 reason textarea + 确认/取消），提交打 `POST /deposit-transactions/${data.id}/return`。

- [ ] **Step 8: 跑测试 + 变异**

```bash
npx jest src/modules/trading/deposit-transactions/
```

Expected: PASS。然后把 Step 4 的 `RETURNABLE_STATUSES` 里的 `OPERATION_PENDING` 删掉重跑 —— `OPERATION_PENDING 的单可以开退回审批案` **必须变红**，确认后恢复。

- [ ] **Step 9: 渲染验证**

起 main 栈，找一笔 `OPERATION_PENDING` 的充值单（可用 `⚡ Simulation` 造一笔低于下限的），确认 action 栏出现 `Initiate Return to Sender`，点开弹窗填理由提交，确认返回 200 且审批中心出现一条待办。截图留存。

- [ ] **Step 10: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add src/modules/trading/deposit-transactions/ src/modules/identity/access-control/rbac.catalog.ts admin-web/src/pages/DepositTransactionDetail.tsx
git commit -m "feat(deposit): OPERATION_PENDING 加 return 边+admin 退回端点(MLRO审批案)+action 栏按钮"
```

---

# Phase D · 前端统一化

## Task D1: 建 `swapStatusMap`,兑换列表接上状态筛选

**Files:**
- Create: `admin-web/src/utils/swapStatusMap.ts`
- Create: `admin-web/src/utils/swapStatusMap.spec.ts`
- Modify: `admin-web/src/pages/SwapTransactionList.tsx`

**Interfaces:**
- Produces: `getSwapStatusMeta(status: string): SwapStatusMeta` 与 `SWAP_STATUS_FILTERS`，签名与 `depositStatusMap.ts` / `withdrawStatusMap.ts` 逐字同构

**背景 —— 这是业主并排看三个页面会当场看出来的那处不一致**：

```
充值   depositStatusMap  + DEPOSIT_STATUS_FILTERS  + AdminBadge
提现   withdrawStatusMap + WITHDRAW_STATUS_FILTERS
兑换   StatusPill 通用兜底 —— 无映射表、无状态筛选分组
```

硬证据：`StatusPill.tsx:45` 给 `FROZEN` 上的是 `bg-cyan-100 text-cyan-800`（**青色**），而 `depositStatusMap.ts` / `withdrawStatusMap.ts` 给 `FROZEN` 的是 `RED`。一笔被制裁冻结的兑换单在界面上是青色的，看起来像个中性态。

兑换 7 个状态里 `FAILED` / `REVERSED` 是**不可达死枚举**（转移表零入边，全仓无写入方）—— 映射表里仍要给它们条目（防止将来复活时 fallback 成 WARNING），但注释标明不可达。

- [ ] **Step 1: 写失败的测试**

创建 `admin-web/src/utils/swapStatusMap.spec.ts`：

```typescript
import { getSwapStatusMeta, SWAP_STATUS_FILTERS } from './swapStatusMap';

describe('swapStatusMap', () => {
  it('FROZEN 是红色 —— 与充值/提现同口径,不是 StatusPill 的青色', () => {
    const meta = getSwapStatusMeta('FROZEN');
    expect(meta.group).toBe('NEEDS_OFFICER');
    expect(meta.badgeClass).toContain('adm-red');
    expect(meta.badgeClass).not.toContain('cyan');
  });

  it('七个后端状态全覆盖', () => {
    for (const s of ['COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FROZEN', 'FAILED', 'REVERSED']) {
      expect(getSwapStatusMeta(s).label).not.toContain('UNKNOWN');
    }
  });

  it('未映射状态落 WARNING 且原样显示状态码（不静默吞）', () => {
    const meta = getSwapStatusMeta('SOME_FUTURE_STATUS');
    expect(meta.label).toBe('SOME_FUTURE_STATUS');
    expect(meta.group).toBe('EXCEPTION');
    expect(meta.badgeClass).toContain('adm-yellow');
  });

  it('筛选分组覆盖到每个状态', () => {
    const grouped = SWAP_STATUS_FILTERS.flatMap((f) => f.statuses);
    for (const s of ['COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED', 'FROZEN']) {
      expect(grouped).toContain(s);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest admin-web/src/utils/swapStatusMap.spec.ts
```

Expected: FAIL — `Cannot find module './swapStatusMap'`

- [ ] **Step 3: 写映射表**

创建 `admin-web/src/utils/swapStatusMap.ts`：

```typescript
// admin-web/src/utils/swapStatusMap.ts

/* ── Swap Status Map (admin, as-is) ──────────────────────────────
   兑换域此前没有映射表,列表页用通用 StatusPill 兜底 —— 后果是
   FROZEN 在兑换页显示青色（StatusPill.tsx:45），而在充值/提现页是红色。
   第四批统一：三域各有一份形状相同的映射表,颜色令牌共用。

   客户面的对应物是 client-web/src/utils/swapStatusView.ts（tipping-off
   收敛：FROZEN → REJECTED），两张表刻意不同,永远不要合并。

   七个后端状态来源：
   src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts
   ────────────────────────────────────────────────────────────── */

export type SwapStatusGroup =
  | 'IN_PROGRESS'
  | 'NEEDS_OFFICER'
  | 'COMPLETED'
  | 'EXCEPTION';

export interface SwapStatusMeta {
  label: string;
  group: SwapStatusGroup;
  badgeClass: string;
}

/* 颜色令牌与 depositStatusMap / withdrawStatusMap 逐字一致 */
const NEUTRAL = 'border-adm-t3/25 bg-adm-t3/10 text-adm-t2';
const RED = 'border-adm-red/25 bg-adm-red/10 text-adm-red';
const GREEN = 'border-adm-green/25 bg-adm-green/10 text-adm-green';
const GRAYRED = 'border-adm-red/20 bg-adm-t3/10 text-adm-red';
const WARNING = 'border-adm-yellow/40 bg-adm-yellow/10 text-adm-yellow';

const SWAP_STATUS_MAP: Record<string, SwapStatusMeta> = {
  COMPLIANCE_PENDING: { label: 'COMPLIANCE PENDING', group: 'IN_PROGRESS', badgeClass: NEUTRAL },
  PROCESSING: { label: 'PROCESSING', group: 'IN_PROGRESS', badgeClass: NEUTRAL },
  SUCCESS: { label: 'SUCCESS', group: 'COMPLETED', badgeClass: GREEN },
  REJECTED: { label: 'REJECTED', group: 'EXCEPTION', badgeClass: GRAYRED },
  /* 制裁/MLRO 冻结 —— 零出边终态。红色,与充值/提现的 FROZEN 同色。 */
  FROZEN: { label: 'FROZEN', group: 'NEEDS_OFFICER', badgeClass: RED },
  /* ⚠️ FAILED / REVERSED 在兑换转移表里零入边、全仓无写入方 —— 不可达。
     保留条目是为了将来若复活不会 fallback 成 WARNING 误导运营。 */
  FAILED: { label: 'FAILED', group: 'EXCEPTION', badgeClass: GRAYRED },
  REVERSED: { label: 'REVERSED', group: 'EXCEPTION', badgeClass: GRAYRED },
};

export function getSwapStatusMeta(status: string): SwapStatusMeta {
  const key = String(status || '').toUpperCase();
  return (
    SWAP_STATUS_MAP[key] ?? {
      label: key || 'UNKNOWN',
      group: 'EXCEPTION',
      badgeClass: WARNING,
    }
  );
}

export const SWAP_STATUS_FILTERS: Array<{ label: string; statuses: string[] }> = [
  { label: 'In progress', statuses: ['COMPLIANCE_PENDING', 'PROCESSING'] },
  { label: 'Needs officer', statuses: ['FROZEN'] },
  { label: 'Completed', statuses: ['SUCCESS'] },
  { label: 'Exception', statuses: ['REJECTED', 'FAILED', 'REVERSED'] },
];
```

- [ ] **Step 4: 列表页换掉 StatusPill**

`SwapTransactionList.tsx`：
- 删 `import StatusPill from '../components/ui/StatusPill';`
- 加 `import { getSwapStatusMeta, SWAP_STATUS_FILTERS } from '../utils/swapStatusMap';` 与 `import AdminBadge from '../components/AdminBadge';`
- 状态单元格从 `<StatusPill value={it.status} />` 换成充值列表同款渲染（照 `DepositTransactionList.tsx` 里用 `getDepositStatusMeta` 那段逐字改名）
- `FilterState` 加 `statusGroup: string;`（默认 `''` = All），照 `DepositTransactionList` 的分组下拉写法接上 `SWAP_STATUS_FILTERS`

- [ ] **Step 5: 跑测试 + 渲染验证**

```bash
npx jest admin-web/src/utils/swapStatusMap.spec.ts
```

Expected: PASS（4 passed）

起 main 栈，打开 Swap Transactions 列表，确认：① 多了状态分组下拉；② 一笔 FROZEN 兑换单显示**红色**而不是青色。与充值列表并排截图比对。

- [ ] **Step 6: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add admin-web/src/utils/swapStatusMap.ts admin-web/src/utils/swapStatusMap.spec.ts admin-web/src/pages/SwapTransactionList.tsx
git commit -m "feat(admin): 建 swapStatusMap+兑换列表状态筛选,FROZEN 从青色改回三域统一的红色"
```

---

## Task D2: 修兑换详情页三处假信息 + 删 Resume 按钮

**Files:**
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`（`:118-128` 类型、`:324-336` restrictions、`:551`/`:743` pendingAction、`:812`/`:847-857` Resume）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（admin 详情投影补限制账数据）

**背景 —— 这三处是本批最伤演示的东西**：

| 位置 | 问题 |
|---|---|
| `:326` | `Restrictions` 读 `data.customer.restrictions` —— `CustomerMain` 上**无此列**（限制早已搬到 `customer_restrictions` 表）→ `JSON.parse(undefined \|\| '[]')` → 恒 `None` |
| `:743` | `Pending Action` 读 `pendingActionExternalId` —— 同样无此列 → 恒 `—` |
| `:128`/`:880` | `rejectReason` 声明了类型、注释自称「裸列在 Hero/侧栏」、**全页零渲染** |
| `:847-857` | `Resume Leg` 按钮，判据 `status === 'NEEDS_REVIEW'` —— `FundsOrderStatus` 枚举无此值，永远点不出来 |

演制裁场景时刚说完「这个客户已被冻结」，侧栏写着 `Restrictions: None` —— 观众会开始怀疑别处是不是也在骗人。

- [ ] **Step 1: 后端详情投影补真数据**

`swap-transactions.service.ts` 的 admin 详情方法里，`customer` 那块的 `select` 加上真实来源：

```typescript
        customer: {
          select: {
            customerNo: true,
            complianceStatus: true,
            lifecycle: true,
            // 第四批：限制从 CustomerMain 上一个**不存在的列**改读真正的限制账。
            // 关系名是 `restrictionRows`（schema.prisma:CustomerMain）。
            // 数据模型是**一行一个 scope**：一张便签一个 restrictionNo,卡多个能力
            // = 同号多行不同 scope,同贴同撕同事务。所以这里拿到的是扁平的行集合,
            // 不是嵌套数组。只取 OPEN,含 SILENT —— admin 面要看全（客户面另有白名单收敛）。
            restrictionRows: {
              where: { status: 'OPEN' },
              select: { restrictionNo: true, cause: true, scope: true, visibility: true },
            },
          },
        },
```

> 已核实：`CustomerMain.restrictionRows`（`schema.prisma`），行上是 `scope: String`（**没有** `scopesJson`）、`cause`、`visibility`、`restrictionNo`。

- [ ] **Step 2: 前端接真数据源**

`SwapTransactionDetail.tsx` 的 interface：

```typescript
  customer?: {
    customerNo?: string | null;
    complianceStatus?: string | null;
    lifecycle?: string | null;
    restrictionRows?: Array<{
      restrictionNo: string;
      cause: string;
      scope: string;
      visibility: string;
    }>;
  };
  rejectReason?: string | null;
```

把 `:324-336` 那段 `restrictionCaps` 的 `JSON.parse(data.customer?.restrictions || '[]')` 整段换成：

```typescript
  // 第四批：改读限制账真数据（此前读 CustomerMain 上一个不存在的列,恒 None）。
  // 限制账是**一行一个 scope**,所以直接取 scope 去重即可,不需要 JSON.parse
  // （旧代码那次 JSON.parse 正是因为读了个不存在的列才恒返回 []）。
  const restrictionCaps: string[] = Array.from(
    new Set((data.customer?.restrictionRows ?? []).map((r) => r.scope).filter(Boolean)),
  );
```

- [ ] **Step 3: `Pending Action` 两处改接材料请求账**

`:551` 与 `:743` 的 `data.customer?.pendingActionExternalId` 已无数据源（该指针 2026-08-18 随材料请求账重写退役）。两处都改成显示**本单的材料请求数**：

```tsx
            <InfoField
              label="Material Requests"
              value={
                (data.materialRequests?.length ?? 0) > 0
                  ? `${data.materialRequests!.length} open`
                  : '—'
              }
            />
```

若详情投影里还没有 `materialRequests`，在 Step 1 的 `include` 里一并带出（按 `orderDomain='SWAP' && orderRef=swapNo` 过滤）。

- [ ] **Step 4: 渲染 `rejectReason`**

在 Hero 区状态徽章下方加：

```tsx
        {data.rejectReason && (
          <div className="mt-1 font-mono text-[11px] text-adm-red">
            Reject reason: {data.rejectReason}
          </div>
        )}
```

并把 `:880` 那句自称「rejectReason 行级裸列在 Hero/侧栏」的注释订正为实际位置。

- [ ] **Step 5: 删 Resume 按钮**

删掉 `:847-857` 整个 `{showResume && (...)}` 块、`:812` 的 `const showResume = ...`、组件 props 里的 `onResume`（`:798`/`:808`）、以及 `:621` 的 `onResume={resumeLeg}` 与页面里 `resumeLeg` 函数本体。

> 业主 2026-08-22：**兑换单不该有 resume 按钮；所有 needsReview 标红暂时都不要任何修复按钮。** 后端 `POST :swapNo/legs/:legSeq/resume` 端点**保留**（只摘 UI 入口，留一条命令行的路）。

- [ ] **Step 6: 确认死引用清干净**

```bash
grep -n "showResume\|onResume\|resumeLeg\|pendingActionExternalId" admin-web/src/pages/SwapTransactionDetail.tsx
```

Expected: **零命中**

- [ ] **Step 7: 渲染验证（本 Task 的验收核心）**

起 main 栈，用 `⚡ Simulation` 面板对一笔兑换单投递 `SANCTION_APPLICANT` 裁决，让客户被开制裁便签。然后打开该兑换单详情页，确认：

1. 侧栏 `Restrictions` 显示**真实的受限能力**（不再是 `None`）
2. Hero 区显示 `Reject reason`
3. 页面上**没有** `Resume Leg` 按钮

三张截图留存 —— 这是业主会亲自复核的一格。

- [ ] **Step 8: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add admin-web/src/pages/SwapTransactionDetail.tsx src/modules/trading/swap-transactions/swap-transactions.service.ts
git commit -m "fix(admin): 兑换详情页三处假信息接真数据源(Restrictions恒None/PendingAction恒—/rejectReason零渲染);删死的 Resume 按钮"
```

---

## Task D3: 详情页卡片命名对齐 + 兑换补 Frozen Disposition

**Files:**
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`（`:450` `:475` `:555` `:570` `:646` `:730`）

**背景**：充值与提现的卡片集合几乎逐字相同（14 块，只差一块域专属的），兑换另起了一套：

| 充值 / 提现 | 兑换 | 处置 |
|---|---|---|
| `Linked Funds Orders` | `Settlement Legs`（`:570`） | 改名 |
| `Sumsub Transaction Detail` | `Sumsub Detail`（`:555`） | 改名 |
| `Ops / Payout Disposition` | `Customer Disposition`（`:730`） | 改名为 `Ops Disposition` |
| `Transaction Details` | `Conversion`(`:450`) + `Pricing`(`:475`) + `Technical`(`:646`) | **保留拆分**（兑换确实多一层汇率/费率语义），但顺序对齐 |
| `Frozen Disposition` | **无**（全页 `FROZEN` 出现 0 次） | **补** |

- [ ] **Step 1: 三处改名**

```
:570  title="Settlement Legs"       →  title="Linked Funds Orders"
:555  title="Sumsub Detail"         →  title="Sumsub Transaction Detail"
:730  title="Customer Disposition"  →  title="Ops Disposition"
```

`Conversion` / `Pricing` / `Technical` 三块**保留** —— 兑换有买卖两侧资产与汇率，硬塞进一个 `Transaction Details` 反而更难读。这是**刻意保留的域差异**，在 truth 文档里写明理由（Task E1）。

- [ ] **Step 2: 补 Frozen Disposition 卡**

第二批给兑换加了真实的 `FROZEN` 状态（`COMPLIANCE_PENDING --FREEZE--> FROZEN`，零出边终态），前端至今**一个字都没提**。在侧栏 `Ops Disposition` 上方加：

```tsx
          {/* Frozen Disposition — 兑换的 FROZEN 是**零出边终态**（制裁命中客户本人时
              落地,见 truth/v6-swap.md §1）。与充值/提现刻意不同：那两域的 FROZEN
              可以经 maker-checker 解冻回流,兑换回不来 —— 所以这里**没有按钮**,
              只说明现状,免得运营去找一个不存在的解冻入口。 */}
          {data.status === 'FROZEN' && (
            <SidebarGroup title="Frozen Disposition">
              <p className="font-mono text-[11px] text-adm-t3">
                制裁冻结（零出边终态）。本单不可解冻、不可继续 —— 客户侧收敛显示为
                Unsuccessful，与普通 KYT 拒绝逐字相同。人身层处置见客户档案的限制账。
              </p>
            </SidebarGroup>
          )}
```

- [ ] **Step 3: 渲染验证**

三个详情页并排打开截图，确认卡片标题一致；对一笔 FROZEN 兑换单确认 Frozen Disposition 卡出现且**没有任何按钮**。

- [ ] **Step 4: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add admin-web/src/pages/SwapTransactionDetail.tsx
git commit -m "feat(admin): 兑换详情页卡片命名对齐充值/提现;补 Frozen Disposition 说明卡(无按钮)"
```

---

## Task D4: 补客户端兑换详情页

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（加按 `swapNo` 的客户面查询）
- Modify: `src/modules/trading/swap-transactions/swap-transactions.controller.ts` 或客户面控制器（加端点）
- Create: `client-web/src/pages/SwapDetail.tsx`
- Modify: `client-web/src/App.tsx`（加路由）
- Modify: `client-web/src/pages/Swap.tsx`（History 行可点击）

**Interfaces:**
- Produces: `GET /swap-transactions/my/:swapNo` → `toCustomerSwapView(...)`

**背景**：

```
Deposit.tsx  1163行   DepositDetail.tsx  177行   /deposit/:depositNo    ✅
Withdraw.tsx 1071行   WithdrawDetail.tsx 166行   /withdraw/:withdrawNo  ✅
Swap.tsx     1078行   SwapDetail.tsx     ❌       /swap/:swapNo         ❌
```

客户端**三个 tipping-off 收敛表都在**（`*StatusView.ts`），缺的只是页面 —— 以及后端那个按业务键取单条的端点（充值提现都有 `my/:xxxNo`，兑换只有 `my` 列表）。

客户点进一笔兑换看不到任何东西：汇率、报价号、成交价在下单弹窗闪一次，提交后不可回溯。

- [ ] **Step 1: 后端加按业务键取单条**

`swap-transactions.service.ts` 加（镜像 `findOneForCustomerByDepositNo`，**规则 3：禁止以 id 作对外主查询合同**）：

```typescript
  /**
   * 客户面按业务键 `swapNo` 取单条（规则 3）。先解出内部 id 再复用既有的
   * 客户面查询 + `toCustomerSwapView()` 白名单 —— 白名单是唯一出口,
   * 绝不在这里另拼一份响应体。
   */
  async findOneForCustomerBySwapNo(swapNo: string, customerId: string) {
    const row = await (this.prisma as any).swapTransaction.findFirst({
      where: { swapNo, ownerId: customerId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Swap transaction not found');
    return this.findOneForCustomer(row.id, customerId);
  }
```

控制器（客户面那个，与 `/swap-transactions/my` 同一个）加：

```typescript
  @Get('my/:swapNo')
  @ApiOperation({ summary: 'Customer-facing swap detail by business key' })
  findMyOne(@Param('swapNo') swapNo: string, @Req() req: any) {
    return this.swapTransactionsService.findOneForCustomerBySwapNo(swapNo, req.user.userId);
  }
```

> ⚠️ 路由声明顺序：`my/:swapNo` 必须写在更短的 `my` **之后**（否则 `my` 会被 `:swapNo` 抢先匹配）。充值域 `deposit-transactions.controller.ts:99-116` 有同款注释说明这件事。

- [ ] **Step 2: 写客户端页面**

创建 `client-web/src/pages/SwapDetail.tsx`（结构逐字对齐 `DepositDetail.tsx` / `WithdrawDetail.tsx`）：

```tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import { getSwapStatusView } from '../utils/swapStatusView';
import { formatAssetAmount } from '../utils/number-format';

/**
 * 客户面兑换详情页（第四批新增 —— 此前三域里唯一没有详情页的域）。
 *
 * 字段来源严格是 `toCustomerSwapView()` 白名单：成交前后金额、费用、汇率、
 * 时间。**没有** sumsubTxnId / rejectReason / needsReview / l1Snapshot 这类
 * 调查性字段 —— 客户面每多一个键就多一分泄漏面。
 *
 * status 已在服务端经 `toCustomerSwapStatus()` 收敛（FROZEN → REJECTED），
 * 这里拿到的就是可以直接显示的值,前端不做二次判断。
 */
interface SwapDetailData {
  swapNo: string;
  status: string;
  fromAmount: string;
  toAmount: string;
  netToAmount: string | null;
  feeAmount: string | null;
  feeCurrency: string | null;
  exchangeRate: string | null;
  createdAt: string;
  completedAt: string | null;
  fromAsset: { code: string; currency: string; network: string | null; decimals: number } | null;
  toAsset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

const SwapDetail = () => {
  const { swapNo } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /* 「从哪来回哪去」——与 DepositDetail 同一套判据：本次会话第一个历史条目上
     location.key === 'default'，此时 navigate(-1) 会把人送出本站,退回列表兜底。 */
  const goBack = () => (location.key === 'default' ? navigate('/swap') : navigate(-1));

  const [tx, setTx] = useState<SwapDetailData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!swapNo) return;
    (async () => {
      try {
        const res = await customerFetch(`/swap-transactions/my/${swapNo}`);
        if (!res.ok) {
          setErr('Unable to load this swap.');
          return;
        }
        setTx(await res.json());
      } catch (e) {
        if (e instanceof CustomerSessionError) return;
        setErr('Unable to load this swap.');
      }
    })();
  }, [swapNo]);

  if (err) {
    return (
      <div className="p-6">
        <button onClick={goBack} className="mb-4 flex items-center gap-1 text-sm text-gray-500">
          <ArrowLeft size={16} /> Back
        </button>
        <p className="text-sm text-red-600">{err}</p>
      </div>
    );
  }

  if (!tx) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  const view = getSwapStatusView(tx.status);

  return (
    <div className="p-6">
      <button onClick={goBack} className="mb-4 flex items-center gap-1 text-sm text-gray-500">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="mb-6">
        <div className="font-mono text-xs text-gray-400">{tx.swapNo}</div>
        <div className={`mt-1 text-lg font-semibold ${view.className}`}>{view.label}</div>
      </div>

      <dl className="space-y-3 text-sm">
        <Row label="You sold" value={`${formatAssetAmount(tx.fromAmount, tx.fromAsset?.decimals ?? 2)} ${tx.fromAsset?.code ?? ''}`} />
        <Row label="You received" value={`${formatAssetAmount(tx.netToAmount ?? tx.toAmount, tx.toAsset?.decimals ?? 2)} ${tx.toAsset?.code ?? ''}`} />
        {tx.exchangeRate && <Row label="Exchange rate" value={tx.exchangeRate} />}
        {tx.feeAmount && <Row label="Fee" value={`${tx.feeAmount} ${tx.feeCurrency ?? ''}`} />}
        <Row label="Created" value={new Date(tx.createdAt).toLocaleString()} />
        {tx.completedAt && <Row label="Completed" value={new Date(tx.completedAt).toLocaleString()} />}
      </dl>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between border-b border-gray-100 pb-2">
    <dt className="text-gray-500">{label}</dt>
    <dd className="font-medium text-gray-900">{value}</dd>
  </div>
);

export default SwapDetail;
```

> `getSwapStatusView` 的真实导出名与返回形状以 `client-web/src/utils/swapStatusView.ts` 为准，先 `sed -n '1,40p'` 读一遍再落笔（充值那份返回 `{label, className}`，兑换那份可能不同）。

- [ ] **Step 3: 加路由**

`client-web/src/App.tsx` 在 `path="/swap"` 之后加：

```tsx
        <Route path="/swap/:swapNo" element={<SwapDetail />} />
```

并 import。

- [ ] **Step 4: History 行可点击**

`Swap.tsx` 的历史列表行加 `onClick={() => navigate(`/swap/${h.swapNo}`)}` 与 `className` 上的 `cursor-pointer hover:bg-gray-50`，与 `Deposit.tsx` / `Withdraw.tsx` 的列表行写法一致。

- [ ] **Step 5: 渲染验证（本 Task 的验收核心）**

起 main 栈，用种子客户 `demo_alice@example.com` / `123456` 登录客户端 `http://127.0.0.1:3002`：

1. 做一笔兑换
2. 切到 History，点进那一行
3. 确认详情页显示成交金额、汇率、费用、时间
4. 确认页面上**没有**任何调查性字段（Sumsub id、拒绝理由、L1 快照）

截图留存，并与 `/deposit/:depositNo` 详情页并排比对结构一致性。

- [ ] **Step 6: 白名单守卫确认**

```bash
grep -n "sumsubTxnId\|rejectReason\|needsReview\|l1Snapshot" client-web/src/pages/SwapDetail.tsx
```

Expected: **零命中**

- [ ] **Step 7: 跑全部闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && npx jest
git add src/modules/trading/swap-transactions/ client-web/src/pages/SwapDetail.tsx client-web/src/App.tsx client-web/src/pages/Swap.tsx
git commit -m "feat(client): 补兑换详情页+按 swapNo 的客户面端点(三域里唯一缺的那个)"
```

---

# Phase E · 文档同步

## Task E1: truth 三份 + BACKLOG 收口

**Files:**
- Modify: `doc-final/reference/truth/v4-deposit.md` / `v5-withdraw.md` / `v6-swap.md`
- Modify: `doc-final/BACKLOG.md`

**背景 —— 第三批的教训，本 Task 必须避开**：上一批的文档收口批次里，审查只验了**新增章节**准确，没人回头读同一个 commit **改到一半的旧段落**，结果留下一句「超时走同一套 `handleRejectDisposition()`」的假描述（代码里根本不调）。**本 Task 的审查范围是 commit 的全部改动行，不是新增章节。**

- [ ] **Step 1: v4-deposit.md**

- §2 状态机：边数 28 → **28**（删了 `confiscate_failed`、加了 `OPERATION_PENDING --return-->`，一减一加）；动作 16 → **15**
- 新增 §4.8「L1 闸门」：九项判定表、充值只挂起不拒的理由、守卫挂在 `approveDeposit()` 的理由（四条 approve 边唯一出口）、`limitHoldReason` 从「金额挂起原因」泛化成「L1 挂起原因」、客户面藏不藏按因由 visibility 决定
- 新增 §4.9「资金腿失败」：三个处置态统一重试 3× + 原地标红；`needsReview` 列本批新增
- §4.6 订正：`actionSubmittedAt` 死列那段保持（上一批已订正，本批不动）
- 明确写下**制裁之后新到的钱此前照收不误**这个洞已修

- [ ] **Step 2: v5-withdraw.md**

- 新增「L1 闸门」节：九项表 + 提现是唯一有大额转审批的域
- 「资金腿失败」节：**出款腿不重试**的理由写死（钱可能已出门，`SUBMITTED`/`CONFIRMING` 之后重发即双花；`onPayoutLegFailed` 的 `THE P6 FIX (do not weaken)` 注释引用）；费腿重试 3× 原地标红
- 本批提现侧**资金腿处理零改动**，只加了 L1 快照 —— 写清楚，别让人以为动过

- [ ] **Step 3: v6-swap.md**

- 新增「L1 闸门」节：兑换此前**完全没有客户资格/限制闸**（`assertCapability` 全仓只有提现一个调用方），本批补上
- 新增「建单余额校验」：此前要等建腿才发现钱不够，而 `PROCESSING` 无失败出边 → 永久卡死
- 状态机节补一句：`FAILED` / `REVERSED` 是**不可达死枚举**（转移表零入边、全仓无写入方），本批未删（登记 BACKLOG）
- 前端节：`Resume Leg` 按钮已删（业主裁定 needsReview 一律不给修复按钮）；后端 `resumeLeg` 端点保留
- 卡片命名已对齐充值/提现；`Conversion`/`Pricing`/`Technical` 三块**刻意保留**不合并，理由写明

- [ ] **Step 4: BACKLOG 新登记**

新开一节 `## 技术债 — 第四批 L1 与前端统一（2026-08-22 落地）`：

- `CAPABILITY_RESTRICTED` 挂起原因无法区分 SANCTION 与 ADMIN_SUSPENSION，客户面一律藏（保守，tipping-off 代价不对称）；要精确区分需 `holdReasonOf()` 带上 cause
- 兑换 `FAILED` / `REVERSED` 两个不可达死枚举未删
- `directionOf()` 把提现两条腿都判成 `OUT`，费腿按语义应是 `INTERNAL`（功能无影响，`getTransitionMap` 里 `INTERNAL` 落到的也是 OUT 表）
- `DEPOSIT_CONFISCATION_LEG_FAILED` 审计常量保留但已无写入方（本批不做审计专项，交由审计那一轮统一清）
- L1 九项里有六项是各域自判后 `preChecks` 传入，`L1GateService` 只亲自执行三项 —— 若将来要真正统一执行，需重写各域守卫并改错误码契约
- 本批明确不做的六项（审计专项 / 权限安全 / TR 进 L1 / 资产状态闸 / 充值累计额度 / 充值大额审批），逐条写明**是业主裁定不做，不是遗漏**

- [ ] **Step 5: 三份 truth 的 `Last Verified` 更新**

每份都写清本批实跑了什么。**必须分开表述全量 jest 与 e2e**（`jest.config.js` 的 `roots` 不含 `test/`，e2e 不在全量结果里）。

- [ ] **Step 6: 自查 —— 用 diff 逐行读，不是只读新增章节**

```bash
git diff --stat
git diff doc-final/
```

逐行确认：改动到的**旧段落**没有留下半句过期表述。

- [ ] **Step 7: 提交**

```bash
git add doc-final/
git commit -m "docs(truth): 同步第四批 L1 闸门/资金腿失败对齐/前端统一;BACKLOG 新节登记六条"
```

---

## 收尾闸门（全部 Task 完成后）

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
cd admin-web && npx tsc -b --noEmit && cd ..
npx jest
npx jest --config test/jest-e2e.json
```

Expected：tsc 三个全 0 错；`npx jest` 净新失败 0（基线 3 suites / 4 tests）；e2e 全绿。

最后起 main 栈做一次端到端走查，覆盖本批四块各一个场景，截图留存。
