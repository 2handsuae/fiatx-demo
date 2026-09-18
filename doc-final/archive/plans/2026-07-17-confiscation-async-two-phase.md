# 没收异步两阶段（Confiscation Async Two-Phase）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把没收从"同步一把梭"改为异步两阶段：审批通过→`CONFISCATING`+建 legSeq=2 资金单+两腿 PENDING 锁定；ops 手动步进资金单→CONFIRMED 时两腿 POST 结算(失败自动重试 3 次,再败停 CONFISCATING 等人工)→CONFISCATED。

**Architecture:** 拆 D7 的 `executeConfiscation` 为 `startConfiscation`(挂 `onConfiscationDecided`：pending+CONFISCATING+funds order CREATED) + `settleConfiscation`(挂 `handleFundsOrderChanged` 的 legSeq===2 && CONFIRMED：post+CONFISCATED，带 3 重试)。两阶段记账复用 `executePendingTransfer/postPendingTransfer`(swap/withdraw 现成)。资金单步进复用现成 `POST /admin/funds-orders/:no/advance` ⚡ 面板，无新端点。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle 两阶段(pending/post) + `@nestjs/event-emitter`。

## Global Constraints

- 先账后状态：post 成功才翻 CONFISCATED（铁律，不变）。
- Rule 5：deposit 表写入只经 `depositService.updateStatus/markConfiscated`，workflow 不直写。
- `CONFISCATING` 承诺态只进不退（除人工）；失败不 void 不回退，停 CONFISCATING。
- 两阶段记账 pending/post 用同一 `deterministicTransferId(sourceType, sourceNo, eventCode, attempt)` 配对（否则 post 找不到 pending）。source = `('DEPOSIT_CONFISCATION', deposit.depositNo, eventCode, attempt)`。
- 幂等：settle 前 deposit 已 CONFISCATED → no-op；startConfiscation 遇已存在 legSeq=2 funds order → 复用不重建。
- jest node18；worktree `.claude/worktrees/transaction-limits/Exchange_js`，self 栈在跑。
- 设计 spec：`doc-final/superpowers/specs/2026-07-16-deposit-min-limit-design.md` §10。

**关键锚点（已核实）：**
- `deposit-workflow.service.ts → onConfiscationDecided()`（~L565，现调 executeConfiscation）｜ `executeConfiscation()`（~L?，D7 同步版，本轮拆）｜ `handleFundsOrderChanged()`（~L84，现 `if(event.legSeq!==1) return;`）
- `deposit-transactions.service.ts → getNextStatus()`（状态机，~L280-330）｜ `updateStatus()` 的 `ACCOUNTING_TERMINALS` 守卫（~L245）
- 两阶段：`accounting.service.ts → executePendingTransfer({debitAccountId,creditAccountId,amount,ledger,code,timeout:0,evidence,tx?,legIndex})` / `postPendingTransfer({pendingTransferId,amount,evidence,tx?})`；`deterministicTransferId(prefix,no,eventCode,attempt)`（`accounting/tigerbeetle/utils/tb-id.util.ts`）
- 参照实现：`swap-transactions/swap-leg-accounting.ts`（pendingLeg/postLeg）、`withdraw-workflow.service.ts → onPayoutLegConfirmed()`（CONFIRMED 触发 post）
- 事件：`DomainEventNames.FUNDS_ORDER_STATUS_CHANGED`（`FundsOrderStatusChangedEvent` 含 `fundsOrderId/legSeq/status`）
- 前端：`admin-web/src/pages/DepositTransactionDetail.tsx`、`components/ui/StatusPill.tsx`、`DepositTransactionList.tsx`；`utils/getDepositStatusBadgeClass`（或 status 色映射）

---

### Task 1: 状态机 — CONFISCATING 中间态 + 两步转移 + 守卫

**Files:**
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts`（枚举 + action）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（getNextStatus 转移表 + TERMINAL/守卫集）
- Test: `deposit-transactions.service.spec.ts`

**Interfaces:**
- Produces: `DepositTransactionStatus.CONFISCATING='CONFISCATING'`；`DepositTransactionAction.CONFISCATE_START='confiscate_start'`、`CONFISCATE_SETTLE='confiscate_settle'`（`CONFISCATE` 保留给 FROZEN→CONFISCATED 制裁路径）；转移 `COMPLIANCE_PENDING --confiscate_start--> CONFISCATING`、`CONFISCATING --confiscate_settle--> CONFISCATED`。

- [ ] **Step 1: 枚举加中间态 + 两 action**（dto 文件）

```typescript
// DepositTransactionStatus 枚举加:
  CONFISCATING = 'CONFISCATING',   // 没收在途(pending 已锁,等资金单 CONFIRMED post)
// DepositTransactionAction 枚举加:
  CONFISCATE_START = 'confiscate_start',   // COMPLIANCE_PENDING → CONFISCATING
  CONFISCATE_SETTLE = 'confiscate_settle', // CONFISCATING → CONFISCATED
```

- [ ] **Step 2: 失败测试**（deposit-transactions.service.spec，`updateStatus (State Machine)` describe 内）

```typescript
    it('COMPLIANCE_PENDING → CONFISCATING via confiscate_start', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.CONFISCATE_START });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFISCATING' }) }),
      );
    });
    it('CONFISCATING → CONFISCATED via confiscate_settle', async () => {
      setupMock(DepositTransactionStatus.CONFISCATING);
      await service.updateStatus(mockId, { action: DepositTransactionAction.CONFISCATE_SETTLE });
      expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFISCATED' }) }),
      );
    });
    it('blocks ADMIN_API from directly reaching CONFISCATING (workflow-only)', async () => {
      setupMock(DepositTransactionStatus.COMPLIANCE_PENDING);
      await expect(
        service.updateStatus(mockId, { action: DepositTransactionAction.CONFISCATE_START },
          { sourcePlatform: 'ADMIN_API', actor: { actorType: 'ADMIN', actorId: 'a1' } }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'DEPOSIT_APPROVE_WORKFLOW_ONLY' }) });
    });
```

- [ ] **Step 3: 跑测试确认失败** → **Step 4: 实现**（getNextStatus）
  - 在 `getNextStatus` 的 `COMPLIANCE_PENDING` 分支加 `[DepositTransactionAction.CONFISCATE_START]: DepositTransactionStatus.CONFISCATING`。
  - 加 `CONFISCATING` 源态分支 `{ [DepositTransactionAction.CONFISCATE_SETTLE]: DepositTransactionStatus.CONFISCATED }`。
  - **移除** D7 加的 `COMPLIANCE_PENDING --confiscate--> CONFISCATED` 直达臂（被两步取代）；保留 `FROZEN --confiscate--> CONFISCATED`（制裁路径不动）。
  - `CONFISCATING` **不入** TERMINAL 集（非终态）；`CONFISCATED` 仍终态。
  - `ACCOUNTING_TERMINALS` 守卫集：`new Set([SUCCESS, CONFISCATED, CONFISCATING])` —— PATCH(isAdminApi) 到 CONFISCATING/CONFISCATED 均抛 `DEPOSIT_APPROVE_WORKFLOW_ONLY`（workflow 走非 ADMIN_API 不受影响）。
  - ⚠️ D7 的旧测试 `blocks ADMIN_API from directly reaching CONFISCATED` 用 `action: CONFISCATE`——现 COMPLIANCE_PENDING+CONFISCATE 无臂，会因"无效转移"先抛。改该测试用 `CONFISCATE_START`（上面 Step 2 已覆盖 CONFISCATING 拦截），或断言无效转移异常。二选一，保持绿。

- [ ] **Step 5: 全绿 + commit**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts --no-coverage && npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions
git commit -m "feat(confisc-async): CONFISCATING 中间态 + confiscate_start/settle 两步转移 + 守卫扩容"
```

---

### Task 2: startConfiscation — 审批通过 → pending 锁两腿 + CONFISCATING + 资金单 CREATED

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（`onConfiscationDecided` 改调 `startConfiscation`；新 `startConfiscation`，由 D7 `executeConfiscation` 拆出上半）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（若需 `markConfiscating` 写方法；或复用 updateStatus）
- Test: `deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `CONFISCATE_START`/`CONFISCATING`。
- Produces: `startConfiscation(deposit, approvalNo)` — 建 legSeq=2 funds order(**initialStatus=CREATED**)、两腿 executePendingTransfer、deposit→CONFISCATING、审计 `DEPOSIT_CONFISCATION_STARTED`。

- [ ] **Step 1: 审计常量**（`audit-actions.constant.ts` AuditActions）

```typescript
  DEPOSIT_CONFISCATION_STARTED: 'DEPOSIT_CONFISCATION_STARTED',   // 没收在途开始(pending+CONFISCATING)
```

- [ ] **Step 2: 失败测试**（deposit-workflow.service.spec，参照现有 onConfiscationDecided 测试的 mock 底座）

```typescript
    it('startConfiscation: creates CREATED legSeq2 funds order, pends 2 legs, → CONFISCATING', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'COMPLIANCE_PENDING', limitHoldReason: 'BELOW_MIN' }));
      fundsOrders.findByParent.mockResolvedValue([]);
      fundsOrders.create.mockResolvedValue({ id: 'fo2', fundsOrderNo: 'FO-2', legSeq: 2, status: 'CREATED' });
      systemWalletResolver.resolve.mockResolvedValue({ id: 'firmFee', address: null, iban: null });
      accountingService.resolveTbAccountId.mockResolvedValue('acct');
      await service.startConfiscation(baseDeposit({ status:'COMPLIANCE_PENDING', limitHoldReason:'BELOW_MIN' }), 'APR-1');
      // 资金单 CREATED(不 auto-CLEAR)
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, initialStatus: 'CREATED' }));
      expect(fundsOrders.advance).not.toHaveBeenCalled();
      // 两腿 pending(非 executeTransfer)
      expect(accountingService.executePendingTransfer).toHaveBeenCalledTimes(2);
      expect(accountingService.executeTransfer).not.toHaveBeenCalled();
      // deposit → CONFISCATING
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        expect.any(String), expect.objectContaining({ action: DepositTransactionAction.CONFISCATE_START }),
      );
    });
```
（`FundsOrderStatus`/`FundsOrderAction` 现值：initialStatus 用 `FundsOrderStatus.CREATED`。mock `accountingService.executePendingTransfer` 加进 spec 的 accounting mock。）

- [ ] **Step 3: 跑测试确认失败** → **Step 4: 实现 `startConfiscation`**（拆 D7 executeConfiscation 上半；两腿改 pending）

```typescript
  // onConfiscationDecided 的 APPROVED 分支 + 漂移前置校验之后:
  //   await this.startConfiscation(deposit, event.approvalNo);   // 取代 executeConfiscation

  private async startConfiscation(deposit: any, approvalNo?: string) {
    const asset = deposit.asset;
    const ledger = asset.tbLedgerId;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
    const customerWalletRef = deposit.toWalletId ?? null;
    const firmFeeWallet = await this.systemWalletResolver.resolve(deposit.assetId, 'F_FEE');

    // legSeq=2 funds order, CREATED(可步进,不 auto-CLEAR); 幂等复用
    const [existing] = await this.fundsOrders.findByParent({ depositTransactionId: deposit.id }, { legSeq: 2 });
    if (!existing) {
      await this.fundsOrders.create({
        depositTransactionId: deposit.id, legSeq: 2,
        initialStatus: FundsOrderStatus.CREATED,        // ← 原 CONFIRMED 改 CREATED
        assetId: deposit.assetId, amount: String(deposit.amount), netAmount: String(deposit.amount),
        fromWalletId: deposit.toWalletId ?? null, fromAddress: deposit.toAddress ?? undefined, fromIban: deposit.toIban ?? undefined,
        toWalletId: firmFeeWallet.id, toAddress: firmFeeWallet.address ?? undefined, toIban: firmFeeWallet.iban ?? undefined,
        traceId: deposit.traceId || undefined,
      });
    }
    // 两腿 PENDING 锁定(attempt=1); eventCode 与 settle 的 post 对齐
    const suspenseId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: deposit.ownerId });
    const clientAssetId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });
    const firmAssetId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger, ownerType: 'SYSTEM' });
    const firmFeeId = await this.accountingService.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_FEE, ledger, ownerType: 'SYSTEM' });
    // 腿1 pending: DR SUSPENSE / CR CLIENT_ASSET
    await this.accountingService.executePendingTransfer({
      debitAccountId: suspenseId, creditAccountId: clientAssetId, amount: amountBigint, ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_SUSPENSE_TO_ASSET, timeout: 0, legIndex: 1,
      evidence: { sourceType:'DEPOSIT', sourceNo: deposit.depositNo, eventCode:'CONFISCATE_REVERSE_SUSPENSE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType:'SYSTEM', actorId:'SYSTEM',
        memo:'Below-min confiscation reverse suspense (pending)', debitWalletRef: customerWalletRef, creditWalletRef: customerWalletRef, isExternalCrossing: false },
    });
    // 腿2 pending: DR FIRM_ASSET / CR FIRM_FEE
    await this.accountingService.executePendingTransfer({
      debitAccountId: firmAssetId, creditAccountId: firmFeeId, amount: amountBigint, ledger,
      code: TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_FIRM_FEE, timeout: 0, legIndex: 1,
      evidence: { sourceType:'DEPOSIT', sourceNo: deposit.depositNo, eventCode:'CONFISCATE_FIRM_FEE',
        debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_ASSET], creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.FIRM_FEE],
        assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType:'SYSTEM', actorId:'SYSTEM',
        memo:'Below-min confiscation fee income (pending)', debitWalletRef: null, creditWalletRef: firmFeeWallet.id, isExternalCrossing: false },
    });
    // deposit → CONFISCATING (Rule 5, 非 ADMIN_API)
    await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.CONFISCATE_START, reason: 'Below-min confiscation started (funds in transit)' });
    await this.auditLogsService.recordSystem({ action: AuditActions.DEPOSIT_CONFISCATION_STARTED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
      workflowType: 'DEPOSIT_CONFISCATION', traceId: deposit.traceId || undefined, result: AuditResult.SUCCESS,
      metadata: { depositNo: deposit.depositNo, amount: String(deposit.amount), approvalNo }, requestId: `DEPOSIT_CONFISCATION_STARTED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM' });
  }
```

- [ ] **Step 5: 全绿 + commit**

```bash
npx jest src/modules/trading/deposit-transactions --no-coverage && npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions src/modules/audit-logging
git commit -m "feat(confisc-async): startConfiscation——审批通过 pending 锁两腿 + CONFISCATING + 资金单 CREATED"
```

---

### Task 3: settleConfiscation — 资金单 CONFIRMED 触发 post 结算(3 重试) → CONFISCATED

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（扩 `handleFundsOrderChanged` legSeq===2 分支 + 新 `settleConfiscation`）
- Test: `deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `CONFISCATE_SETTLE`；Task 2 的 pending（同 eventCode/attempt）。
- Produces: `settleConfiscation(deposit, fundsOrderId)` — 两腿 postPendingTransfer(deterministicTransferId 配 Task 2 的 pending)、成功→CONFISCATED、失败重试 3 次、3 败停 CONFISCATING+FAILED 审计。

- [ ] **Step 1: 失败测试**

```typescript
    it('handleFundsOrderChanged: legSeq2 CONFIRMED → settle posts 2 legs → CONFISCATED', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATING' }));
      accountingService.postPendingTransfer.mockResolvedValue(undefined);
      await service.handleFundsOrderChanged({ fundsOrderId:'fo2', depositTransactionId:'dep-1', legSeq:2, status:'CONFIRMED' } as any);
      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(2);
      expect(depositService.updateStatus).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: DepositTransactionAction.CONFISCATE_SETTLE }));
    });
    it('settle: post fails 3× → stays CONFISCATING + FAILED audit (no status change)', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATING' }));
      accountingService.postPendingTransfer.mockRejectedValue(new Error('TB down'));
      await service.settleConfiscation(baseDeposit({ status:'CONFISCATING' }), 'fo2');
      expect(accountingService.postPendingTransfer).toHaveBeenCalledTimes(3);   // 重试 3 次(第一腿失败即整体重试)
      expect(depositService.updateStatus).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: DepositTransactionAction.CONFISCATE_SETTLE }));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPOSIT_CONFISCATION_FAILED' }));
    });
    it('settle idempotent: deposit already CONFISCATED → no-op', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ status: 'CONFISCATED' }));
      await service.handleFundsOrderChanged({ fundsOrderId:'fo2', depositTransactionId:'dep-1', legSeq:2, status:'CONFIRMED' } as any);
      expect(accountingService.postPendingTransfer).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: 跑测试确认失败** → **Step 3: 实现**

```typescript
  // handleFundsOrderChanged 头部现有 `if (event.legSeq !== 1) return;` 改为分流:
  //   if (event.legSeq === 2) { await this.onConfiscationLegChanged(event); return; }
  //   if (event.legSeq !== 1) return;   // 其余非 payin 忽略
  private async onConfiscationLegChanged(event: FundsOrderStatusChangedEvent) {
    if (event.status !== FundsOrderStatus.CONFIRMED) return;        // 只在 CONFIRMED 结算
    const deposit = await this.depositService.findOne(event.depositTransactionId!);
    if (deposit.status !== DepositTransactionStatus.CONFISCATING) return;   // 幂等(已 CONFISCATED/其它)
    await this.settleConfiscation(deposit, event.fundsOrderId);
  }

  private async settleConfiscation(deposit: any, fundsOrderId: string) {
    const asset = deposit.asset;
    const amountBigint = this.decimalToBigint(deposit.amount, asset.decimals);
    const pend1 = deterministicTransferId('DEPOSIT', deposit.depositNo, 'CONFISCATE_REVERSE_SUSPENSE', 1);
    const pend2 = deterministicTransferId('DEPOSIT', deposit.depositNo, 'CONFISCATE_FIRM_FEE', 1);
    const MAX = 3;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      try {
        await this.accountingService.postPendingTransfer({ pendingTransferId: pend1, amount: amountBigint,
          evidence: { sourceType:'DEPOSIT', sourceNo: deposit.depositNo, eventCode:'CONFISCATE_REVERSE_SUSPENSE', assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType:'SYSTEM', actorId:'SYSTEM' } });
        await this.accountingService.postPendingTransfer({ pendingTransferId: pend2, amount: amountBigint,
          evidence: { sourceType:'DEPOSIT', sourceNo: deposit.depositNo, eventCode:'CONFISCATE_FIRM_FEE', assetCurrency: asset.currency, traceId: deposit.traceId || deposit.id, actorType:'SYSTEM', actorId:'SYSTEM' } });
        await this.depositService.updateStatus(deposit.id, { action: DepositTransactionAction.CONFISCATE_SETTLE, reason: 'Below-min confiscation settled' });
        await this.auditLogsService.recordSystem({ action: AuditActions.DEPOSIT_CONFISCATION_EXECUTED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
          workflowType: 'DEPOSIT_CONFISCATION', result: AuditResult.SUCCESS, metadata: { depositNo: deposit.depositNo, fundsOrderId }, requestId: `DEPOSIT_CONFISCATION_EXECUTED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM' });
        return;
      } catch (err: any) {
        this.logger.error(`Confiscation settle attempt ${attempt}/${MAX} for ${deposit.depositNo} failed: ${err.message}`);
        if (attempt === MAX) {
          await this.auditLogsService.recordSystem({ action: AuditActions.DEPOSIT_CONFISCATION_FAILED, entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
            entityId: deposit.id, entityNo: deposit.depositNo, entityOwnerType: deposit.ownerType, entityOwnerId: deposit.ownerId,
            workflowType: 'DEPOSIT_CONFISCATION', result: AuditResult.FAILED, reason: `Settle failed after ${MAX} retries — manual intervention required (deposit stays CONFISCATING)`,
            metadata: { depositNo: deposit.depositNo, fundsOrderId, error: err.message }, requestId: `DEPOSIT_CONFISCATION_FAILED_${deposit.depositNo}_${randomUUID()}`, sourcePlatform: 'SYSTEM' });
          return;   // 停 CONFISCATING,不回退,不 rethrow(事件 handler 里静默停)
        }
      }
    }
  }
```
⚠️ `postPendingTransfer` 幂等：TB post 同一 pendingTransferId 二次是 no-op/幂等（确认 accounting.service 行为；若非幂等,重试前先查 pending 是否已 posted）。settle 前的 `status===CONFISCATING` 门 + deposit 已 CONFISCATED no-op 保证不双 post。

- [ ] **Step 4: 全绿 + commit**

```bash
npx jest src/modules/trading/deposit-transactions --no-coverage && npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions
git commit -m "feat(confisc-async): settleConfiscation——资金单 CONFIRMED post 结算(3 重试,再败停 CONFISCATING)"
```

---

### Task 4: 前端 — CONFISCATING 徽章 + 处置区文案

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`（CONFISCATING 徽章 + 处置区在 CONFISCATING 时提示"没收在途,ops 步进资金单"）
- Modify: `admin-web/src/components/ui/StatusPill.tsx`（CONFISCATING 色）
- Modify: `admin-web/src/pages/DepositTransactionList.tsx`（状态色支持 CONFISCATING）

- [ ] **Step 1: StatusPill 加 CONFISCATING**（进行中色,如 amber `bg-amber-500/15 text-amber-400`，区别于 CONFISCATED 的红终态）；deposit list/detail 的 status 色映射同加。
- [ ] **Step 2: Detail 处置区**：`isBelowMinPending`（COMPLIANCE_PENDING+BELOW_MIN）显 PASS/Confiscate 两钮不变；新增：`status==='CONFISCATING'` 时显一条只读提示"Confiscation in transit — advance the linked funds order to settle"（不显处置钮，两腿已 pending）。Linked Funds Orders 的没收单在 CONFISCATING 期间就可见（Fix 2 已就位，展示 CREATED→...→CONFIRMED 进度）。
- [ ] **Step 3: admin-web tsc** `cd admin-web && npx tsc --noEmit` → 0 错。
- [ ] **Step 4: commit** `git add admin-web/src && git commit -m "feat(confisc-async): CONFISCATING 徽章(进行中色)+详情在途提示"`

---

### Task 5: e2e + 回归 + 文档同步

**Files:**
- Modify: `doc-final/reference/truth/v4-deposit.md`、`funds-orders.md`、`BACKLOG.md`

- [ ] **Step 1: e2e（协调者跑 self 栈）**
  1. 注入 below-min → admin Confiscate → 审批通过 → deposit=**CONFISCATING**（不再直接 CONFISCATED）；详情见没收资金单 CREATED + 两腿 pending 流水
  2. ⚡ `POST /admin/funds-orders/<FO no>/advance` 逐步 SUBMIT→CONFIRM → deposit 变 **CONFISCATED**（post 结算）
  3. `verify:coa` 四式恒等：CONFISCATING(pending) 态 **与** CONFISCATED(post) 态**都不破**（pending 锁定不改 posted 余额；post 后 FIRM +费用）
- [ ] **Step 2: 回归** `tsc 0` / `jest 净新 0`（真基线 2 wallet suites）/ `demo:all` 不劣于基线
- [ ] **Step 3: 文档**——truth v4-deposit（没收改异步两阶段 CONFISCATING/pending-post/3 重试）、funds-orders（deposit legSeq=2 两阶段）、BACKLOG（settle 真异步 backoff/cron 重试、CONFISCATING 卡住的"一键重试 settle" ops 动作 两笔账）
- [ ] **Step 4: commit** `git add doc-final && git commit -m "docs(confisc-async): truth v4/funds-orders + BACKLOG 同步没收异步两阶段"`

---

## 验收总清单
- [ ] CONFISCATING 中间态 + 两步转移 + PATCH 拦截（守卫含 CONFISCATING/CONFISCATED）
- [ ] 审批通过 → CONFISCATING + 两腿 pending + 资金单 CREATED（不 auto-CLEAR）
- [ ] 资金单 CONFIRMED → post 两腿 → CONFISCATED；post 失败重试 3 次；3 败停 CONFISCATING + FAILED 审计
- [ ] 幂等：已 CONFISCATED no-op；pending 已存在不重锁
- [ ] verify:coa 在 pending 态与 post 态都全平；tsc 0 / jest 净新 0 / demo:all 不劣
- [ ] 前端 CONFISCATING 进行中徽章 + 在途提示；truth×2 + BACKLOG 同步
