# V4/V5 三层规范收敛 + 余额锁漏洞修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 V4 充值 / V5 提现收敛成干净三层（workflow 当家、domain 纯持久化、记账与审计归 workflow），并堵掉提现"异常终态不解锁、客户余额永久卡死"的漏洞。

**Architecture:** V5 三个编排 service 收敛为单一 `WithdrawWorkflowService`；建单+锁钱的原子事务所有权上提到 workflow；新增统一 `releaseLock()` 覆盖所有解锁型终态；删死代码 + 死 orchestrator + EVT_* 事件命名空间。V4 堵控制器裸绕过 + payin 归类 ingestion。**不动 V7 任何活逻辑**，仅删两个已 neuter 的 no-op handler。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle；事件总线 `@nestjs/event-emitter`；测试 jest + e2e 脚本 `demo:*` / `verify:coa`。

**Spec:** `doc-final/superpowers/specs/2026-06-27-v4-v5-three-layer-refactor-design.md`

**前置约束:**
- 全程 **main 栈**（API 3000 / TB 3003）。先 `bash scripts/stack.sh up main` 确保栈在跑。
- 每个 Task 独立 commit；任一步 `demo` 不绿即单步 revert。
- 用户要求**在分支中执行**（见 Task 0）。

---

## 文件结构（改动地图）

**删除：**
- `src/modules/trading/withdraw-transactions/withdraw-transaction-workflow.service.ts`（死代码）
- `src/orchestrators/withdraw-workflow.orchestrator.ts`（职责吸收后删）
- `src/modules/trading/withdraw-transactions/constants/withdraw-events.constant.ts`（EVT 命名空间整删）
- `src/modules/funds-layer/workflow/fee-accrual-listener.service.ts`（两 handler 均 no-op，整类删）

**新增/修改（核心）：**
- `withdraw-workflow.service.ts` — 接管 createWithdrawal（原子建单+锁）、source 钱包绑定、payout 失败补偿、releaseLock、修复入口
- `withdraw-transactions.service.ts` — 瘦身为纯 domain：新增 `insertRecord`，删 TB/审计/EVT
- `customer-withdraw.controller.ts` + `withdraw-transactions.controller.ts` — create 改调 workflow
- `orchestrators/payout-closeout-repair.controller.ts` — repair 入口重接 workflow
- `deposit-transactions.controller.ts` + `deposit-transactions.service.ts` — source 闸 + 走 workflow
- `deposit-workflow.service.ts` — 新增 admin 命名动作方法
- `payins.service.ts` — ingestion 定位声明注释
- `fiat-fee-collection-workflow.service.ts` — 仅删死方法 `onFiatWithdrawalSucceeded`，保留类
- module 文件：`withdraw-transactions.module.ts` / `funds-layer.module.ts` / `orchestrators/workflows.module.ts` 注销已删 provider
- 审计常量：新增 `WITHDRAW_LOCK_RELEASED` action

---

## Task 0: 建分支

**Files:** 无（git 操作）

- [ ] **Step 1: 确保 main 干净并起栈**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git status --short          # 期望：空（干净）
bash scripts/stack.sh up main
```
Expected: working tree clean；栈起在 3000–3003。

- [ ] **Step 2: 建并切到工作分支**

Run:
```bash
git checkout -b refactor/v4-v5-three-layer
git rev-parse --abbrev-ref HEAD   # 期望输出 refactor/v4-v5-three-layer
```

- [ ] **Step 3: 跑一遍基线，记录绿态**

Run:
```bash
npm run demo:all && npm run verify:coa
```
Expected: demo 三流 SUCCESS；verify:coa ALL PASS。**记下此为基线**，后续每个 Task 末尾回归对照。

- [ ] **Step 4: 提交 spec + plan（文档先落分支）**

```bash
git add doc-final/superpowers/specs/2026-06-27-v4-v5-three-layer-refactor-design.md \
        doc-final/superpowers/plans/2026-06-27-v4-v5-three-layer-refactor.md
git commit -m "docs(v4v5): three-layer refactor + balance-lock fix spec & plan"
```

---

## Task 1: 删死代码 `WithdrawTransactionWorkflowService`

**Files:**
- Delete: `src/modules/trading/withdraw-transactions/withdraw-transaction-workflow.service.ts`
- Delete (if exists): `src/modules/trading/withdraw-transactions/withdraw-transaction-workflow.service.spec.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`

- [ ] **Step 1: 确认零调用（防呆）**

Run:
```bash
grep -rn "WithdrawTransactionWorkflowService" src --include="*.ts" | grep -v "withdraw-transaction-workflow.service" | grep -v "withdraw-transactions.module.ts"
```
Expected: **空输出**（除 module 注册外无任何引用）。若非空 → 停止，回报。

- [ ] **Step 2: 删文件**

Run:
```bash
git rm src/modules/trading/withdraw-transactions/withdraw-transaction-workflow.service.ts
git rm src/modules/trading/withdraw-transactions/withdraw-transaction-workflow.service.spec.ts 2>/dev/null || true
```

- [ ] **Step 3: 从 module 注销**

在 `withdraw-transactions.module.ts` 中删除：
- `import { WithdrawTransactionWorkflowService } from './withdraw-transaction-workflow.service';`
- `providers` 数组中的 `WithdrawTransactionWorkflowService,`
- `exports` 数组中的 `WithdrawTransactionWorkflowService,`

- [ ] **Step 4: 编译验证**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误（无断引用）。

- [ ] **Step 5: 单测 + commit**

Run: `npx jest src/modules/trading/withdraw-transactions --silent`
Expected: PASS（或无相关用例时无新增失败）。
```bash
git add -A && git commit -m "chore(withdraw): remove dead WithdrawTransactionWorkflowService (zero callers)"
```

---

## Task 2: 新增审计 action `WITHDRAW_LOCK_RELEASED`

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: 加常量**

在 `AuditActions` 中，紧邻现有 `WITHDRAW_*` action（如 `WITHDRAW_ACCOUNTING_POSTED`）后新增：
```typescript
  WITHDRAW_LOCK_RELEASED: 'WITHDRAW_LOCK_RELEASED',
```
（若该常量集合是对象字面量则加键；若是 enum 则加成员。按文件现有风格对齐。）

- [ ] **Step 2: 编译 + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。
```bash
git add -A && git commit -m "feat(audit): add WITHDRAW_LOCK_RELEASED action"
```

---

## Task 3: V5 domain 新增纯插入 `insertRecord`

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`

- [ ] **Step 1: 加纯插入方法**

在 `WithdrawTransactionsService` 内新增（**只插入，不发事件、不写审计、不碰 TB**）：
```typescript
  /** Pure persistence: insert a withdrawal row inside a caller-owned tx.
   *  No events, no audit, no accounting — the workflow owns those. */
  async insertRecord(
    tx: Prisma.TransactionClient,
    data: Prisma.WithdrawTransactionCreateInput | Record<string, any>,
  ) {
    return (tx as any).withdrawTransaction.create({ data });
  }

  /** Persist TB pending transfer ids on a withdrawal inside a caller-owned tx. */
  async setPendingIds(
    tx: Prisma.TransactionClient,
    id: string,
    tbPendingNetId: string,
    tbPendingFeeId: string | null,
  ) {
    return (tx as any).withdrawTransaction.update({
      where: { id },
      data: { tbPendingNetId, tbPendingFeeId },
    });
  }
```

- [ ] **Step 2: 编译 + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误（纯新增，无人调用尚不影响）。
```bash
git add -A && git commit -m "feat(withdraw-domain): add pure insertRecord/setPendingIds for workflow-owned create"
```

---

## Task 4: V5 workflow 接管原子建单 `createWithdrawal`

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
- Modify: `src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts`（若 admin 也有 create 入口）

- [ ] **Step 1: 在 workflow 加 `createWithdrawal`（把现 domain `create()` 的编排迁入）**

将现 `WithdrawTransactionsService.create()`（`withdraw-transactions.service.ts:466-752`）的逻辑**整体迁入** `WithdrawWorkflowService.createWithdrawal()`，并按所有权重排：
```typescript
  async createWithdrawal(
    dto: CreateWithdrawTransactionDto,
    userId: string,
    ownerType: string = 'CUSTOMER',
  ) {
    // 1) 资产 + 客户可交易门 + 报价一致性校验（迁自现 create()，逻辑不变）
    //    asset 查询 / ensureCustomerCanTransact / quoteId 必填校验
    // 2) TB 锁补偿用的外层变量（迁自现 create()）
    let tbPendingNetBigint: bigint | undefined;
    let tbPendingFeeBigint: bigint | undefined;
    let netBigintForVoid = 0n;
    let feeBigintForVoid = 0n;

    let created: any;
    try {
      created = await this.prisma.$transaction(async (tx: any) => {
        // 2a) 消费报价、算 netAmount（迁自现 create()）
        // 2b) record = await this.withdrawService.insertRecord(tx, { ...withdrawNo, status CREATED, amount/netAmount/feeAmount, toWallet*, preKyt/kyt/travelRule 初值, traceId, statusHistory ... })
        // 2c) TB 锁两笔 pending（CLIENT_PAYABLE→CLIENT_ASSET，net + fee）：
        //     resolveTbAccountId(CLIENT_PAYABLE, customer) / (CLIENT_ASSET, SYSTEM)
        //     executePendingTransfer(WITHDRAW_NET_PENDING) → tbPendingNetBigint
        //     若 feeBigint>0 executePendingTransfer(WITHDRAW_FEE_PENDING) → tbPendingFeeBigint
        //     await this.withdrawService.setPendingIds(tx, record.id, hex(net), feeHexOrNull)
        // 2d) 首条审计由 workflow 写：
        //     await this.auditLogsService.recordByActor(WITHDRAW_REQUESTED, ..., tx)
        return record;
      }, { maxWait: 5000, timeout: 20000 });
    } catch (err) {
      // 3) 补偿：void 孤儿 TB pending（迁自现 create() catch，best-effort + CRITICAL 日志）
      if (tbPendingNetBigint) await this.accountingService.voidPendingTransferBestEffort(tbPendingNetBigint, netBigintForVoid);
      if (tbPendingFeeBigint) await this.accountingService.voidPendingTransferBestEffort(tbPendingFeeBigint, feeBigintForVoid);
      throw err;
    }

    // 4) 提交后 emit 生命周期事件（保持现有事件名）
    this.eventEmitter.emit(DomainEventNames.WITHDRAWAL_CREATED, {
      withdrawId: created.id, withdrawNo: created.withdrawNo, status: created.status,
      ownerType: created.ownerType, ownerId: created.ownerId,
      assetId: created.assetId, amount: created.amount.toString(), traceId: created.traceId,
    });
    return { ...created, type: this.deriveWithdrawType(/* asset.type */) };
  }
```
> 实现要点：accounting/审计/TB 常量的 import 已在 workflow 顶部存在（`AccountingService` / `TB_*` / `AuditLogsService` 已注入）。`WithdrawQuoteService` 需新增注入到 workflow（迁移报价消费）。`deriveWithdrawType` 可在 workflow 内复制一个私有小工具或从 domain 暴露。

- [ ] **Step 2: 客户端控制器改调 workflow**

`customer-withdraw.controller.ts:42-46` 的 `create()`：
```typescript
  async create(@Req() req: any, @Body() dto: CreateWithdrawTransactionDto) {
    const userId = this.assertCustomer(req);
    await this.onboardingService.assertTradingEligibility(userId, 'WITHDRAW');
    return this.workflow.createWithdrawal(dto, userId);   // ← 改：注入 WithdrawWorkflowService 为 this.workflow
  }
```
构造函数注入 `private readonly workflow: WithdrawWorkflowService`。
（admin controller 若有 create 入口同样改调；若仅 `createMockData` 则不动。）

- [ ] **Step 3: domain `create()` 降级为 deprecated 包装或删除**

将 `WithdrawTransactionsService.create()` 整体删除（逻辑已迁出）。确认无其他调用：
```bash
grep -rn "withdrawService\.create\b\|\.create(dto" src/modules/trading/withdraw-transactions --include="*.ts" | grep -v createWithdrawal | grep -v createMockData
```
Expected: 仅剩 workflow 内引用已改为 insertRecord；无残留 `service.create(` 调用。

- [ ] **Step 4: e2e 验证建单+锁钱**

Run:
```bash
npm run demo:withdraw && npm run verify:coa
```
Expected: 提现流 SUCCESS；verify:coa ALL PASS（锁→post 路径不变）。

- [ ] **Step 5: commit**
```bash
git add -A && git commit -m "refactor(withdraw): workflow owns atomic create+lock txn (create moved out of domain)"
```

---

## Task 5: V5 统一解锁闸 `releaseLock` + 堵 P6 漏洞（TDD）

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
- Test: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试（payout 失败必须解锁）**

在 spec 文件加用例（mock `accountingService.voidPendingTransferBestEffort` 与 `withdrawService`）：
```typescript
describe('releaseLock on terminal-unlock outcomes', () => {
  it('voids BOTH net and fee pending when payout fails', async () => {
    const w = { id: 'w1', withdrawNo: 'WD-1', netAmount: '100', feeAmount: '2',
                tbPendingNetId: 'aa', tbPendingFeeId: 'bb', asset: { decimals: 8 }, ownerType: 'CUSTOMER', ownerId: 'c1', traceId: 't' };
    withdrawService.findOneInternal.mockResolvedValue(w);
    accountingService.voidPendingTransferBestEffort.mockResolvedValue(true);

    await service.handlePayoutFailed({ withdrawId: 'w1', payoutId: 'p1', status: 'FAILED' });

    expect(accountingService.voidPendingTransferBestEffort).toHaveBeenCalledTimes(2); // net + fee
    expect(fundsFlowService.setWithdrawFeeFundStatus).toHaveBeenCalledWith('w1', InternalFundStatus.CANCELLED, expect.any(String));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest withdraw-workflow.service.spec -t "voids BOTH" -v`
Expected: FAIL（`handlePayoutFailed` 未定义 / void 未被调）。

- [ ] **Step 3: 实现 `releaseLock` + payout 失败订阅**

在 `WithdrawWorkflowService` 内：
```typescript
  /** Single unlock path for ALL terminal-unlock outcomes: void net+fee pending,
   *  cancel the fee fund order, audit. Idempotent (void is best-effort & safe on re-call). */
  private async releaseLock(w: any, reason: string): Promise<void> {
    const decimals = w.asset?.decimals ?? 8;
    if (w.tbPendingNetId) {
      const ok = await this.accountingService.voidPendingTransferBestEffort(
        hexToBigint(w.tbPendingNetId), this.decimalToBigint(w.netAmount, decimals));
      if (!ok) this.logger.error(`CRITICAL: net pending not voided for ${w.id} (${reason})`);
    }
    if (w.tbPendingFeeId) {
      const ok = await this.accountingService.voidPendingTransferBestEffort(
        hexToBigint(w.tbPendingFeeId), this.decimalToBigint(w.feeAmount, decimals));
      if (!ok) this.logger.error(`CRITICAL: fee pending not voided for ${w.id} (${reason})`);
    }
    await this.fundsFlowService.setWithdrawFeeFundStatus(w.id, InternalFundStatus.CANCELLED, reason);
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_LOCK_RELEASED,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id, entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType, entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined, workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Lock released: ${reason}`, sourcePlatform: 'SYSTEM',
    });
  }

  @OnEvent(PayoutEvents.EVT_PAYOUT_FAILED)
  async handlePayoutFailed(e: { withdrawId: string; payoutId: string; status: string }) {
    await this.compensatePayout(e.withdrawId, WithdrawTransactionAction.FAIL, WithdrawTransactionStatus.FAILED, `Payout ${e.status}`);
  }
  @OnEvent(PayoutEvents.EVT_PAYOUT_TIMEOUT)
  async handlePayoutTimeout(e: { withdrawId: string; payoutId: string; status: string }) {
    await this.compensatePayout(e.withdrawId, WithdrawTransactionAction.FAIL, WithdrawTransactionStatus.FAILED, `Payout TIMEOUT`);
  }
  @OnEvent(PayoutEvents.EVT_PAYOUT_RETURNED)
  async handlePayoutReturned(e: { withdrawId: string; payoutId: string; status?: string }) {
    await this.compensatePayout(e.withdrawId, WithdrawTransactionAction.RETURN, WithdrawTransactionStatus.RETURNED, `Payout RETURNED`);
  }

  private async compensatePayout(withdrawId: string, action: WithdrawTransactionAction, target: WithdrawTransactionStatus, reason: string) {
    const w = await this.withdrawService.findOneInternal(withdrawId);
    if (w.status === target) return; // idempotent
    await this.withdrawService.updateStatus(w.id, { action, reason }, this.systemCtx);
    await this.releaseLock(w, reason);
  }
```
import：`PayoutEvents`（`../../asset-treasury/payouts/constants/payout-events.constant`）。

- [ ] **Step 4: 重构大额审批被拒路径复用 releaseLock**

`onLargeValueApprovalDecided` 的 else 分支：把 `await this.voidWithdrawPending(w);` 替换为 `await this.releaseLock(w, 'Large-value approval ' + payload.decision);`，**删除私有方法 `voidWithdrawPending`**（已被 releaseLock 取代）。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest withdraw-workflow.service.spec -v`
Expected: PASS（含新 releaseLock 用例 + 原有用例）。

- [ ] **Step 6: commit**
```bash
git add -A && git commit -m "fix(withdraw): unify releaseLock for all terminal-unlock outcomes (P6 stuck-balance bug)"
```

---

## Task 6: V5 吸收来源钱包绑定 + payout 成功/修复入口，删 orchestrator

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
- Modify: `src/orchestrators/payout-closeout-repair.controller.ts`
- Delete: `src/orchestrators/withdraw-workflow.orchestrator.ts`
- Modify: `src/orchestrators/workflows.module.ts`

- [ ] **Step 1: 吸收来源钱包绑定**

把 orchestrator 的 `ensureSourceWalletBound`（`withdraw-workflow.orchestrator.ts:895-965`）迁为 `WithdrawWorkflowService` 私有方法（语义不变：crypto=客户 C_DEP / fiat=平台 C_CMA）。在 `initiatePayoutPhase` 创建 payout **之前**调用并回写 `fromWallet*`，消除现有竞态（现 `initiatePayoutPhase` 注释承认的 race）。

- [ ] **Step 2: 吸收修复入口**

把 `reCloseoutPayout(payoutId)` 与 `reCompensatePayout(payoutId)`（含其依赖私有方法 `orchestrateSuccessPath` / `executeCompensationPath` / `isCompensation*` 等）迁入 `WithdrawWorkflowService`，**去掉已 gutted 的 journal/clearing V2 残留**，补偿路径改为调用新的 `releaseLock`（Task 5）。成功修复路径复用 `finalizeWithdrawal`。

- [ ] **Step 3: repair 控制器重接**

`payout-closeout-repair.controller.ts`：注入从 `WithdrawWorkflowOrchestrator` 改为 `WithdrawWorkflowService`，两个端点改调新方法。

- [ ] **Step 4: 删 orchestrator + 注销**

```bash
git rm src/orchestrators/withdraw-workflow.orchestrator.ts
```
`workflows.module.ts`：删 import / providers / exports 中的 `WithdrawWorkflowOrchestrator`。确认无残留引用：
```bash
grep -rn "WithdrawWorkflowOrchestrator" src --include="*.ts"
```
Expected: 空。

- [ ] **Step 5: 编译 + e2e**

Run:
```bash
npx tsc --noEmit -p tsconfig.json && npm run demo:all && npm run verify:coa
```
Expected: 编译无错；三流 SUCCESS；verify:coa ALL PASS。

- [ ] **Step 6: commit**
```bash
git add -A && git commit -m "refactor(withdraw): absorb source-wallet binding + repair entrypoints into workflow; delete orchestrator"
```

---

## Task 7: V5 domain 去 EVT_* 发射 + 事件命名空间整删 + 两个 V7 死 handler

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`
- Delete: `src/modules/trading/withdraw-transactions/constants/withdraw-events.constant.ts`
- Delete: `src/modules/funds-layer/workflow/fee-accrual-listener.service.ts`
- Modify: `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts`
- Modify: `src/modules/funds-layer/funds-layer.module.ts`

- [ ] **Step 1: domain `updateStatus()` 移除 postCommitEvents 的 EVT_* 发射**

`withdraw-transactions.service.ts:857-908` 的 `postCommitEvents` 分支：删除所有 `WithdrawEvents.EVT_WITHDRAWAL_*` 推送（CANCELLED/REJECTED/APPROVED__*/FAILED/RETURNED__FIAT），以及 import。
**保留** SUCCESS 出站钩子：把 `EVT_WITHDRAWAL_SUCCESS__CRYPTO/FIAT` 两个推送**改为内联字符串常量**（因为 constant 文件将删），保留对 V7 的信号：
```typescript
      } else if (nextStatus === WithdrawTransactionStatus.SUCCESS) {
        // Outbound integration hook to V7 funds-layer (kept until V7 Phase C cleanup).
        postCommitEvents.push({
          eventName: withdrawType === 'crypto' ? 'EVT_WITHDRAWAL_SUCCESS__CRYPTO' : 'EVT_WITHDRAWAL_SUCCESS__FIAT',
          payload: { withdrawId: id },
        });
      }
```
> 注：V7 两个订阅者已 neuter（Step 3/4 删除）。一旦它们删掉，这两个 SUCCESS push 即为悬空信号 — 但 push 字符串本身无害，保留可避免本轮触碰 V7 fiat-settlement 的依赖。**若 Step 3/4 顺利删除两订阅者，则这两个 push 也可一并删**（无人再听）。实施时若删订阅者成功，优先连这两 push 一起删，彻底归零。

- [ ] **Step 2: 删事件常量文件**

确认除 domain/orchestrator(已删)/两个 V7 文件外无其他 `WithdrawEvents` 引用：
```bash
grep -rn "WithdrawEvents" src --include="*.ts" | grep -v ".spec.ts"
```
Expected: 仅剩 `withdraw-transactions.service.ts`（Step 1 已改为内联）+ 两个 V7 文件。
```bash
git rm src/modules/trading/withdraw-transactions/constants/withdraw-events.constant.ts
```

- [ ] **Step 3: 删 V7 死监听 `FeeAccrualListenerService`（两 handler 均 no-op）**

```bash
git rm src/modules/funds-layer/workflow/fee-accrual-listener.service.ts
```
`funds-layer.module.ts`：删其 import + providers 注册。

- [ ] **Step 4: V7 `FiatFeeCollectionWorkflowService` 仅删死方法、保留类**

`fiat-fee-collection-workflow.service.ts`：删除 `onFiatWithdrawalSucceeded` 整个方法（含 `@OnEvent`）及 `WithdrawEvents` import。**保留类与其余成员**（`fiat-settlement-workflow` 仍注入它）。删后类可能只剩构造函数 — 可接受，不动 V7 其他逻辑。

- [ ] **Step 5: 编译验证无断引用**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

- [ ] **Step 6: e2e + commit**

Run: `npm run demo:all && npm run verify:coa`
Expected: 三流 SUCCESS；verify:coa ALL PASS。
```bash
git add -A && git commit -m "chore(withdraw): delete EVT_* namespace + two neutered V7 no-op handlers"
```

---

## Task 8: V4 充值 — 堵控制器裸绕过 + source 闸

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

- [ ] **Step 1: 写失败测试（ADMIN_API 不得直推 SUCCESS）**

```typescript
it('rejects ADMIN_API direct transition into SUCCESS (must go through workflow)', async () => {
  // arrange a COMPLIANCE_PENDING deposit
  await expect(
    service.updateStatus(id, { action: DepositTransactionAction.APPROVE }, { actor: { actorType: 'ADMIN', actorId: 'a1' }, sourcePlatform: 'ADMIN_API' }),
  ).rejects.toThrow(/WORKFLOW_ONLY|workflow/i);
});
```

- [ ] **Step 2: 跑确认失败**

Run: `npx jest deposit-transactions.service.spec -t "rejects ADMIN_API" -v`
Expected: FAIL（当前无闸，直接放行）。

- [ ] **Step 3: domain 加 source 闸**

在 `DepositTransactionsService.updateStatus()` 计算出 `nextStatus` 后、写库前加（对齐 V5 `assertStatusUpdateSourceAllowed`）：
```typescript
    const isAdminApi = options?.sourcePlatform === 'ADMIN_API';
    const ACCOUNTING_TERMINALS = new Set([
      DepositTransactionStatus.SUCCESS,   // STEP_2 入账，必须走 workflow
    ]);
    if (isAdminApi && ACCOUNTING_TERMINALS.has(nextStatus)) {
      throw new BadRequestException({
        code: 'DEPOSIT_APPROVE_WORKFLOW_ONLY',
        message: 'Deposit progression that posts to TigerBeetle must go through DepositWorkflowService, not direct admin status patch.',
        details: { nextStatus },
      });
    }
```

- [ ] **Step 4: workflow 暴露 admin 命名动作（route 目标）**

在 `DepositWorkflowService` 新增薄方法（approve 复用已有 `approveDeposit`；reject/freeze 走 domain updateStatus + 审计，**不做尚未设计的 TB 反向记账**，仅状态+审计）：
```typescript
  async adminReject(depositId: string, reason: string, actor: { actorId: string; actorRole?: string }) {
    const updated = await this.depositService.updateStatus(depositId,
      { action: DepositTransactionAction.REJECT, reason },
      { actor: { actorType: 'ADMIN', actorId: actor.actorId, actorRole: actor.actorRole }, sourcePlatform: 'ADMIN_API' });
    await this.recordStateTransitionAudit(updated, '', updated.status, reason || 'Admin reject');
    return updated;
  }
  async adminFreeze(depositId: string, reason: string, actor: { actorId: string; actorRole?: string }) {
    const updated = await this.depositService.updateStatus(depositId,
      { action: DepositTransactionAction.FREEZE, reason },
      { actor: { actorType: 'ADMIN', actorId: actor.actorId, actorRole: actor.actorRole }, sourcePlatform: 'ADMIN_API' });
    await this.recordStateTransitionAudit(updated, '', updated.status, reason || 'Admin freeze');
    return updated;
  }
```

- [ ] **Step 5: 控制器 `@Patch(':id/status')` 路由到 workflow**

`deposit-transactions.controller.ts:98-105`：注入 `DepositWorkflowService`，按 action 分派：APPROVE→`workflow.approveDeposit(id)`；REJECT→`workflow.adminReject(...)`；FREEZE→`workflow.adminFreeze(...)`；其余非记账状态动作仍可走 `service.updateStatus`（此时 source 闸已兜底）。删除文件内 `// TODO: Route ...` 注释。

- [ ] **Step 6: 跑测试通过 + e2e**

Run:
```bash
npx jest deposit-transactions.service.spec -v && npm run demo:deposit && npm run verify:coa
```
Expected: 单测 PASS；充值流 SUCCESS；verify:coa ALL PASS。

- [ ] **Step 7: commit**
```bash
git add -A && git commit -m "fix(deposit): close admin status-patch bypass; route accounting actions through workflow + source guard"
```

---

## Task 9: V4 充值 — Payin 归类 ingestion-adapter

**Files:**
- Modify: `src/modules/asset-treasury/payins/payins.service.ts`

- [ ] **Step 1: 加定位声明注释**

在 `PayinsService` 类上方加：
```typescript
/**
 * INGESTION / ADAPTER LAYER — inbound rail detection.
 *
 * PayinsService detects on-chain / bank inbound transfers and normalises them
 * into internal domain events (`payin.created`, `payin.status.changed`) consumed
 * by DepositWorkflowService. Per backend-platform rules, the ingestion/adapter
 * layer MAY emit internal events and record detection audit (PAYIN_CREATED + rail
 * state transitions) — this is NOT a pure domain service and the audit it writes
 * is rail-detection evidence, consistent with the SumsubIngestion pattern.
 */
```

- [ ] **Step 2: 编译 + commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。
```bash
git add -A && git commit -m "docs(payin): classify PayinsService as ingestion/adapter layer (audit is detection evidence)"
```

---

## Task 10: 全量回归 + 收尾

**Files:** 无

- [ ] **Step 1: 全量编译**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误。

- [ ] **Step 2: 全量单测**

Run: `npx jest src/modules/trading src/modules/asset-treasury --silent`
Expected: PASS（含新增 releaseLock / deposit source 闸用例）。

- [ ] **Step 3: 全 e2e + 记账恒等**

Run: `npm run demo:all && npm run verify:coa`
Expected: 充值/兑换/提现三流 SUCCESS；verify:coa ALL PASS。

- [ ] **Step 4: P6 漏洞手验（关键）**

构造一笔提现走到 PAYOUT_PENDING，触发 payout FAILED（admin simulate 或脚本），断言：
- 提现单 → FAILED；
- TB 两笔 pending 已 void；
- 客户 CLIENT_PAYABLE 可用额回到锁前；
- 审计有 `WITHDRAW_LOCK_RELEASED`。
（可写成临时脚本或 e2e 用例；结果贴回报告。）

- [ ] **Step 5: 死代码/残留终检**

Run:
```bash
grep -rn "WithdrawWorkflowOrchestrator\|WithdrawTransactionWorkflowService\|WithdrawEvents\|voidWithdrawPending" src --include="*.ts" | grep -v ".spec.ts"
```
Expected: 空（除 `EVT_WITHDRAWAL_SUCCESS__*` 内联字符串若保留外，无任何已删符号残留）。

- [ ] **Step 6: 最终 commit**
```bash
git add -A && git commit -m "test(v4v5): full regression green + P6 stuck-balance manual verification"
```

---

## Self-Review（plan 对 spec 覆盖核对）

- spec §4.1 建单+锁上提 → Task 3+4 ✅
- spec §4.2 domain 瘦身 → Task 3(insertRecord)+4(删 create)+7(去 EVT) ✅
- spec §4.3 吸收 orchestrator → Task 6 ✅
- spec §4.4 releaseLock 堵 P6 → Task 5 ✅
- spec §4.5 删死代码 → Task 1 ✅
- spec §5 事件清理（含两 V7 死 handler）→ Task 7 ✅
- spec §6.1 V4 控制器闸 → Task 8 ✅
- spec §6.2 payin 归类 → Task 9 ✅
- spec §7 验收闸 → Task 10 ✅
- spec §8 顺序 → Task 0→10 与 §8 一致 ✅

**类型/命名一致性：** `createWithdrawal` / `insertRecord` / `setPendingIds` / `releaseLock` / `compensatePayout` / `adminReject` / `adminFreeze` / `WITHDRAW_LOCK_RELEASED` 全计划统一。

**待实施时确认的小项（非阻塞）：** `deriveWithdrawType` 在 workflow 内的获取方式（复制私有 or domain 暴露）——Task 4 Step 1 已标注，实施者二选一即可。
