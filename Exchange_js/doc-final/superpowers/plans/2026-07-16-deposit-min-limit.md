# 充值最低限额（Deposit Below-Min）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 低于 min 的充值：建单但客户面隐藏 → L1 挂起 → admin 两按钮（PASS 豁免 / Confiscate as fee 审批没收，第二资金单两腿记账 → CONFISCATED 终态）。

**Architecture:** 写模型零扭曲——detected() 出生落 `limitHoldReason='BELOW_MIN'` 标；客户读面服务端过滤；`checkAutoApproval` 加闸（与 trading-ready 挂起同款）。没收走 V1 审批引擎（新 actionType，单步 OPS_OFFICER），批准后挂 deposit 下建 legSeq=2 INTERNAL 资金单，CLEAR 记两腿（Step1 反向 + FIRM_FEE 确权），deposit → CONFISCATED。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle + V1 审批引擎 + React admin。

**执行环境：** 沿用 worktree `.claude/worktrees/transaction-limits/`（分支 `feat/transaction-limits`，叠在金额限额工作之上）。self 栈在跑（API 3120）。jest 用默认 shell（node18）。

**设计 spec：** `doc-final/superpowers/specs/2026-07-16-deposit-min-limit-design.md`

**关键锚点（已核实）：**
- `deposit-transactions.service.ts → detected()`（~L405，建 deposit+payin 资金单；`wallet.asset` 已 include）
- `deposit-workflow.service.ts → checkAutoApproval()`（~L176-234，链式闸：status→kyt→TR→客户合规→trading-ready；trading-ready 挂起打审计的样式在 L209-228）｜ `executeDepositAccounting()`（~L477-546，TB 记账+evidence 的照抄模板）｜ `approveDeposit()`（~L236）
- 客户端点：`deposit-transactions.controller.ts` `@Get('my')`（L46-49）+ `@Get(':id')`（L94）——过滤点
- 审批 actionType 配置：`approval.constants.ts`（~L327 起，`steps:[{stepNo:1,roles:['OPS_OFFICER']}], timeoutHours:48, allowCancel:true` 内联样式）；发射器模板 `asset-treasury/transaction-limits/transaction-limit-creation-approval.service.ts`（17 行 ApprovalHandlerBase 子类）；decided 事件名推导 `workflow.<workflowType小写kebab>.decided`
- 限额规则读取：`TransactionLimitRulesService.getSingleRule('DEPOSIT', assetId)`（transaction-limits 模块已 export）
- 三视图投影：`clearing-settle/reconciliation/data-source/funds-order-source.repo.ts`
- 资金单引擎：`funds-orders/funds-order.service.ts → create()/advance()`；INTERNAL 走 OUT 迁移表；CONFIRMED 自动铸 externalRef

---

### Task 1: Schema — limitHoldReason 列 + CONFISCATED 枚举

**Files:**
- Modify: `prisma/schema.prisma`（DepositTransaction 模型）
- Modify: `src/modules/trading/deposit-transactions/dto/`（状态枚举所在 dto 文件，grep `enum DepositTransactionStatus` 定位）

- [ ] **Step 1: schema 加列**（DepositTransaction 模型内，`statusHistory` 附近）

```prisma
  limitHoldReason      String?               // 'BELOW_MIN' — L1 金额挂起原因(客户面隐藏依据)
```

- [ ] **Step 2: TS 枚举加终态**（status 列是 String，DB 无枚举约束；只改 TS）

```typescript
  CONFISCATED = 'CONFISCATED',   // below-min 没收终态(经审批,两腿记账后)
```

- [ ] **Step 3: 迁移**

```bash
npx prisma migrate dev --name deposit_limit_hold_reason
```
Expected: `ALTER TABLE deposit_transactions ADD COLUMN limitHoldReason TEXT;`，无 reset。

- [ ] **Step 4: tsc + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add prisma src/modules/trading/deposit-transactions
git commit -m "feat(deposit-min): limitHoldReason 列 + CONFISCATED 状态枚举"
```

---

### Task 2: 种子 — DEPOSIT SINGLE 规则（min=100，无上限）

**Files:**
- Modify: `prisma/seed.business.ts → seedTransactionLimitRules()`

- [ ] **Step 1: A 段循环补 DEPOSIT 行**（现循环 `['WITHDRAWAL','SWAP']` 建 min+max；DEPOSIT 单独 push，只 min）

```typescript
  // DEPOSIT: 只有下限(min=100 原生币种),无上限(maxAmount 空=∞) — 2026-07-16 deposit-min spec
  for (const a of assets) {
    rules.push({ ruleNo: no(), gateType: 'SINGLE', operationType: 'DEPOSIT', assetId: a.id, minAmount: '100' });
  }
```
（放在现 WITHDRAWAL/SWAP 循环之后、CUMULATIVE 段之前。）

- [ ] **Step 2: 重灌验证**（worktree DB）

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_transaction_limits/dev.db" TB_ADDRESS="127.0.0.1:3123" npx ts-node prisma/seed.ts --mode=business 2>&1 | grep 'transaction limit rules'
```
Expected: `✔ Seeded 15 transaction limit rules`（13+2）。upsert 幂等，重跑不炸。

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.business.ts
git commit -m "feat(deposit-min): 种子 DEPOSIT SINGLE 行(每资产 min=100,无上限)"
```

---

### Task 3: 出生落标 + L1 闸（TDD）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts → detected()`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts`（import `TransactionLimitRulesModule`——即 asset-treasury 的 TransactionLimitsModule，app.module 里别名 `TransactionLimitRulesModule`，看 withdraw module 怎么 import 照抄）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts → checkAutoApproval()`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`DEPOSIT_HELD_NOT_TRADING_READY` 旁边加）
- Test: 各自 spec 文件（照 `checkAutoApproval` 现有 describe 的 mock 样式）

- [ ] **Step 1: 审计常量**

```typescript
  DEPOSIT_HELD_BELOW_MIN: 'DEPOSIT_HELD_BELOW_MIN',   // L1 金额下限挂起(不自动放行)
  DEPOSIT_LIMIT_WAIVED: 'DEPOSIT_LIMIT_WAIVED',       // 运营豁免 below-min(PASS)
```
（放 `AuditActions` 里 `DEPOSIT_HELD_NOT_TRADING_READY` 同组；确认该常量实际在哪个对象就加哪个。）

- [ ] **Step 2: 失败测试——detected() 落标**（在 deposit-transactions.service 的 spec；mock `TransactionLimitRulesService.getSingleRule`）

```typescript
  it('detected(): amount < DEPOSIT SINGLE min → deposit born with limitHoldReason=BELOW_MIN', async () => {
    limitRules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-x', minAmount: new Prisma.Decimal('100'), maxAmount: null });
    await service.detected({ assetId: 'a1', toWalletId: 'w1', amount: '5' });
    expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ limitHoldReason: 'BELOW_MIN' }) }),
    );
  });

  it('detected(): amount >= min → no hold flag', async () => {
    limitRules.getSingleRule.mockResolvedValue({ ruleNo: 'TLR-x', minAmount: new Prisma.Decimal('100'), maxAmount: null });
    await service.detected({ assetId: 'a1', toWalletId: 'w1', amount: '100' });
    expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ limitHoldReason: undefined }) }),
    );
  });

  it('detected(): no DEPOSIT rule → no hold flag', async () => {
    limitRules.getSingleRule.mockResolvedValue(null);
    await service.detected({ assetId: 'a1', toWalletId: 'w1', amount: '5' });
    expect(prisma.depositTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ limitHoldReason: undefined }) }),
    );
  });
```
（现有 spec 的 prisma/服务 mock 底座沿用；构造器加 mock 后旧用例的 `new Service(...)` 位置参数要跟着补——同 Task5/6 处理兄弟 spec 的先例。）

- [ ] **Step 3: 跑测试确认失败** → **Step 4: 实现**——`detected()` 里 `depositNo` 生成之后、create 之前：

```typescript
    // L1 金额下限判定(出生落标——deposit 是被动入金,低于 min 不拒绝,建单+隐藏+挂起)
    let limitHoldReason: string | undefined;
    const singleRule = await this.limitRulesService.getSingleRule('DEPOSIT', input.assetId);
    if (singleRule?.minAmount && new Prisma.Decimal(input.amount).lt(new Prisma.Decimal(singleRule.minAmount))) {
      limitHoldReason = 'BELOW_MIN';
    }
```
create 的 data 里加 `limitHoldReason,`。构造器注入 `private readonly limitRulesService: TransactionLimitRulesService`，module import。

- [ ] **Step 5: 失败测试——checkAutoApproval 闸**（deposit-workflow spec 的 `checkAutoApproval` describe 里加）

```typescript
    it('holds when limitHoldReason=BELOW_MIN — audits DEPOSIT_HELD_BELOW_MIN, never approves', async () => {
      depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: 'BELOW_MIN' }));
      await service.checkAutoApproval('dep-1');
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_HELD_BELOW_MIN' }),
      );
      expect(approveSpy).not.toHaveBeenCalled();
    });
```
（`baseDeposit`/`approveSpy` 按该 describe 现有工具函数适配。）

- [ ] **Step 6: 实现闸**——`checkAutoApproval` 里 status 检查之后、kytStatus 检查**之前**（金额闸最先，L2 都不看）：

```typescript
    if (deposit.limitHoldReason === 'BELOW_MIN') {
      this.logger.warn(`Auto-approval hold: deposit ${depositId} below minimum amount — awaiting ops disposition`);
      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_HELD_BELOW_MIN,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: 'Deposit held: amount below configured minimum (BELOW_MIN)',
        metadata: { depositNo: deposit.depositNo, amount: String(deposit.amount) },
        sourcePlatform: 'SYSTEM',
        requestId: `DEPOSIT_HELD_BELOW_MIN_${deposit.depositNo}_${randomUUID()}`,
      });
      return;
    }
```
⚠️ `requestId` 每次唯一（Task 4 金额限额轮的审计幂等教训——不带会静默去重丢审计）。

- [ ] **Step 7: 全绿 + commit**

```bash
npx jest src/modules/trading/deposit-transactions --no-coverage && npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions src/modules/audit-logging
git commit -m "feat(deposit-min): detected 出生落标 + checkAutoApproval BELOW_MIN 闸(审计带唯一 requestId) (TDD)"
```

---

### Task 4: 客户面服务端过滤（列表 + 详情）（TDD）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（findMy 链路 + 单条查询）
- Test: 对应 spec

- [ ] **Step 1: 先读 controller `@Get('my')`（L46-49）与 `@Get(':id')`（L94）各自调的 service 方法**，确认过滤要落的准确函数（列表 where 拼装处 + 详情返回处）。

- [ ] **Step 2: 失败测试**

```typescript
  it('customer list: BELOW_MIN deposits are filtered out server-side', async () => {
    await service.findMyList('cust-1', {} as any);   // ← 用实际方法名
    expect(prisma.depositTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ limitHoldReason: null }) }),
    );
  });

  it('customer detail: BELOW_MIN deposit → NotFound (treated as non-existent)', async () => {
    prisma.depositTransaction.findUnique.mockResolvedValue({ id: 'd1', ownerId: 'cust-1', limitHoldReason: 'BELOW_MIN' });
    await expect(service.findOneForCustomer('d1', 'cust-1')).rejects.toThrow(NotFoundException);  // ← 实际方法名
  });
```

- [ ] **Step 3: 实现**——客户视角的列表 where 加 `limitHoldReason: null`；客户视角详情若 `limitHoldReason != null` 抛 `NotFoundException`（**按不存在处理**，不泄露存在性）。⚠️ 只动**客户视角**方法；admin 列表/详情**不过滤**。若列表/详情共用一个方法靠参数分流，用 ownerType/来源判断加条件。

- [ ] **Step 4: 全绿 + commit**

```bash
npx jest src/modules/trading/deposit-transactions --no-coverage && npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions
git commit -m "feat(deposit-min): 客户面服务端过滤 BELOW_MIN(列表隐藏+详情按不存在) (TDD)"
```

---

### Task 5: PASS（豁免）端点

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（新方法 `waiveLimitHold`）
- Modify: admin 路由所在 controller（`deposit-transactions.controller.ts`，看现有 admin 动作端点如 adminApprove/adminFreeze 挂哪就挂哪）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（新路由挂现有充值写权限组——grep 现有 deposit admin POST 路由用什么权限组，沿用）
- Test: workflow spec

- [ ] **Step 1: 失败测试**

```typescript
  it('waiveLimitHold: clears flag, audits DEPOSIT_LIMIT_WAIVED, re-runs checkAutoApproval', async () => {
    depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: 'BELOW_MIN', status: 'COMPLIANCE_PENDING' }));
    await service.waiveLimitHold('dep-1', adminActor);
    expect(depositService.clearLimitHold).toHaveBeenCalledWith('dep-1');   // service 层写方法(Rule 5)
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DEPOSIT_LIMIT_WAIVED' }), expect.anything(),
    );
  });

  it('waiveLimitHold: rejects when deposit has no hold', async () => {
    depositService.findOne.mockResolvedValue(baseDeposit({ limitHoldReason: null }));
    await expect(service.waiveLimitHold('dep-1', adminActor)).rejects.toThrow(BadRequestException);
  });
```

- [ ] **Step 2: 实现**
  - `deposit-transactions.service.ts` 加写方法 `clearLimitHold(id)`（update `limitHoldReason: null`）——workflow 不直写表（Rule 5）。
  - workflow `waiveLimitHold(depositId, actor)`: findOne → 无 hold/非 COMPLIANCE_PENDING 抛 BadRequest → `clearLimitHold` → `recordByActor`（action `DEPOSIT_LIMIT_WAIVED`，metadata 带 depositNo/amount，requestId 唯一）→ `await this.checkAutoApproval(depositId)`（摘标后重跑全部闸——豁免金额线不豁免合规）。
  - controller：`POST /deposit-transactions/:id/waive-limit`（admin guard 样式照抄旁边的 admin 动作端点；用业务键还是 id 以旁边端点为准，保持一致）。
  - rbac.catalog：路由注册（权限组沿用现有 deposit 写组）。

- [ ] **Step 3: 全绿 + commit**

```bash
npx jest src/modules/trading/deposit-transactions --no-coverage && npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions src/modules/identity
git commit -m "feat(deposit-min): PASS 豁免端点——摘标+审计+重跑闸(不豁免合规)"
```

---

### Task 6: 没收审批管道（actionType + 发射器 + 发起端点）

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（actionType + 配置 + 注册数组）
- Create: `src/modules/trading/deposit-transactions/deposit-confiscation-approval.service.ts`（发射器，17 行）
- Modify: `deposit-workflow.service.ts`（`initiateConfiscation`）+ controller + rbac.catalog + audit 常量
- Modify: `deposit-transactions.module.ts`（发射器进 providers）
- Test: workflow spec

- [ ] **Step 1: 审批常量三件套**（approval.constants.ts，照 TRANSACTION_LIMIT_CREATION 三处样式：L63 区 actionType 定义、L327 区配置、L387 区注册数组）

```typescript
  DEPOSIT_CONFISCATION: 'DEPOSIT_CONFISCATION',
  // 配置区：
  [ApprovalActionTypes.DEPOSIT_CONFISCATION]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
```
workflowType 用 audit 常量 `DEPOSIT_CONFISCATION`（下一步加）→ decided 事件名 = `workflow.deposit-confiscation.decided`。

- [ ] **Step 2: 审计常量**（audit-actions.constant.ts；workflowType 表加 `DEPOSIT_CONFISCATION`，动作加三打点）

```typescript
  DEPOSIT_CONFISCATION_REQUESTED: 'DEPOSIT_CONFISCATION_REQUESTED',
  DEPOSIT_CONFISCATION_EXECUTED: 'DEPOSIT_CONFISCATION_EXECUTED',
  DEPOSIT_CONFISCATION_FAILED: 'DEPOSIT_CONFISCATION_FAILED',
```

- [ ] **Step 3: 发射器**——整文件照抄 `transaction-limit-creation-approval.service.ts`（ApprovalHandlerBase 子类,17 行）,换 actionType=DEPOSIT_CONFISCATION / workflowType=DEPOSIT_CONFISCATION。providers 注册,grep 确认全仓只注册一次。

- [ ] **Step 4: `initiateConfiscation(depositId, dto{reason}, actor)`**（workflow;失败测试先行——校验 hold 在+状态对→approvalsService.createAndSubmit→审计 REQUESTED）

```typescript
  // 校验: limitHoldReason==='BELOW_MIN' && status===COMPLIANCE_PENDING,否则 BadRequest
  // 防重: approvalsService.list({actionType: DEPOSIT_CONFISCATION, entityRef: deposit.id, status: PENDING, take:1}) → 有则 ConflictException(Task3 金额限额轮 FIX-1b 同款)
  // createAndSubmit({ actionType, entityRef: deposit.id, traceId, objectSnapshot: {
  //   depositNo, amount: String(deposit.amount), assetId: deposit.assetId,
  //   basis: 'T&C below-minimum deposit handling fee',    // ← 合同授权依据,spec 硬性要求
  // }}, { reason: dto.reason, traceId }, actor)
  // recordByActor DEPOSIT_CONFISCATION_REQUESTED(requestId 唯一)
```
controller：`POST /deposit-transactions/:id/confiscate`（admin guard + rbac 注册同 Task 5）。

- [ ] **Step 5: 全绿 + commit**

```bash
npx jest src/modules/trading/deposit-transactions --no-coverage && npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions src/modules/governance src/modules/audit-logging src/modules/identity
git commit -m "feat(deposit-min): 没收审批管道——actionType/发射器/发起端点(带 T&C 依据快照+防重)"
```

---

### Task 7: 没收执行（decided handler → 资金单两腿 → CONFISCATED）+ 投影修正

**Files:**
- Modify: `deposit-workflow.service.ts`（`@OnEvent('workflow.deposit-confiscation.decided')` handler + `executeConfiscation` 私有方法）
- Modify: `deposit-transactions.service.ts`（写方法 `markConfiscated`）
- Modify: `clearing-settle/reconciliation/data-source/funds-order-source.repo.ts`（三视图修正）
- Test: workflow spec + repo spec（若有）

- [ ] **Step 1: 三视图投影修正**（先做——独立且防没收单串台）：payin 视图加 `legSeq: 1` 约束；internal 视图加 deposit legSeq>1 分支：

```typescript
// payin  = depositTransactionId≠null 且 legSeq===1        (原来只查 depositTransactionId≠null → 没收单会被误认 payin)
// internal += (depositTransactionId≠null 且 legSeq>1)      (照抄 withdraw legSeq>1 分类)
```
读该 repo 现有 where 拼法照改；有 spec 就补两用例（没收单入 internal 不入 payin）。

- [ ] **Step 2: 失败测试——decided handler**

```typescript
  it('confiscation APPROVED: creates legSeq=2 INTERNAL funds order, books 2 legs, deposit → CONFISCATED', async () => { /* mock 链路,断言 fundsOrders.create({depositTransactionId, legSeq:2,...}) + accounting 两次 executeTransfer + markConfiscated + EXECUTED 审计 */ });
  it('confiscation DECLINED: deposit unchanged (stays COMPLIANCE_PENDING, hold intact)', async () => { /* 断言零写入 */ });
  it('decided event with foreign entityRef → graceful no-op', async () => { /* 共存路由,金额限额轮同款 */ });
```

- [ ] **Step 3: 实现 handler + executeConfiscation**

```typescript
// @OnEvent('workflow.deposit-confiscation.decided', { async: true })
// entityRef → findUnique deposit,null 安全退出;非 APPROVED 审计后 return
// executeConfiscation(deposit):
//   1) 解析钱包: fromWallet = deposit.toWalletId(客户托管钱包);
//      toWallet = 该资产的公司钱包 —— grep withdraw fee 腿怎么解析 firm 钱包(withdraw-workflow 建 fee 腿处/system-wallet util),照抄
//   2) fundsOrders.create({ depositTransactionId: deposit.id, legSeq: 2, direction:'INTERNAL',
//        assetId, amount, fromWalletId, toWalletId, memo:'Below-min confiscation as fee' })
//      然后 advance 逐步驱到 CLEARED(INTERNAL 走 OUT 迁移表;CONFIRMED 时引擎自动铸 externalRef 供对账镜像)
//   3) CLEAR 后记两腿(照抄 executeDepositAccounting L477-546 的 账户解析+executeTransfer+writeEvidence 样式):
//      腿1: DR DEPOSIT_SUSPENSE(CUSTOMER) / CR CLIENT_ASSET(SYSTEM)   ← Step1 精确反向,eventCode 'CONFISCATION_REVERSE_SUSPENSE'
//      腿2: DR FIRM_ASSET / CR FIRM_FEE                                ← eventCode 'CONFISCATION_FEE_INCOME'
//      evidence 带 walletRef/externalRef(资金单的)——逐钱包对账两侧有行
//   4) depositService.markConfiscated(deposit.id)(status→CONFISCATED+statusHistory,Rule 5 走 service 写)
//   5) recordSystem DEPOSIT_CONFISCATION_EXECUTED(金额/币种/basis/fundsOrderNo,requestId 唯一)
//   任一步失败 → DEPOSIT_CONFISCATION_FAILED 审计 + 抛(deposit 留 COMPLIANCE_PENDING 可重发起;记账失败不许推状态——铁律)
```
⚠️ 记账成功才推 CONFISCATED（先账后状态,同 approveDeposit 的顺序纪律）。

- [ ] **Step 4: 全绿 + commit**

```bash
npx jest src/modules/trading/deposit-transactions src/modules/clearing-settle --no-coverage && npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions src/modules/clearing-settle
git commit -m "feat(deposit-min): 没收执行——legSeq2 资金单+两腿记账(Step1反向+FIRM_FEE)+CONFISCATED + 三视图修正"
```

---

### Task 8: 前端 — admin 处置按钮 + 列表标识（客户端零改动,已服务端过滤）

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`（COMPLIANCE_PENDING && limitHoldReason==='BELOW_MIN' 时显示两按钮）
- Modify: `admin-web/src/pages/DepositTransactionList.tsx`（BELOW_MIN 徽章列/标记）

- [ ] **Step 1: Detail 页处置区**——照该页现有动作按钮样式（如 approve/freeze 按钮区）加：
  - **PASS (Waive Min-Limit)** → `POST /deposit-transactions/:id/waive-limit` → 成功 toast + 刷新
  - **Confiscate as Fee** → 确认弹窗（显示金额/币种 + 固定依据文案 "Per T&C: below-minimum deposit handling fee" + reason 输入）→ `POST /deposit-transactions/:id/confiscate` → toast "Submitted for approval — {approvalNo}"
  - 状态徽章支持 `CONFISCATED`（终态色,照 REJECTED 样式）
- [ ] **Step 2: List 页**——`limitHoldReason==='BELOW_MIN'` 的行加小徽章（AdminBadge value="BELOW MIN"）。
- [ ] **Step 3: 双端 tsc**

```bash
cd admin-web && npx tsc --noEmit && cd ../client-web && npx tsc --noEmit && cd ..
```
- [ ] **Step 4: Commit**（渲染截图验收由主会话协调者做——项目铁律）

```bash
git add admin-web/src
git commit -m "feat(deposit-min): admin 处置按钮(PASS/Confiscate)+BELOW_MIN 标识"
```

---

### Task 9: e2e 验收 + 回归 + 文档同步

**Files:**
- Modify: `doc-final/reference/truth/v4-deposit.md` / `v3-financial-config.md` / `funds-orders.md`
- Modify: `doc-final/BACKLOG.md` / `doc-final/reference/roadmap.md`

- [ ] **Step 1: e2e（self 栈实测,协调者亲自跑）**
  1. 小额充值(5 AED)→ 客户列表**不出现**、直连详情 404;admin 列表带 BELOW MIN 标
  2. payin CONFIRMED → Step1 记账 → COMPLIANCE_PENDING 卡住(审计 DEPOSIT_HELD_BELOW_MIN)
  3. 路径A: PASS → 摘标 → 走 L2 模拟 → SUCCESS 入账
  4. 路径B(另一笔): Confiscate → 审批单 → 批准 → 资金单列表见没收单 → 账本两腿流水 → deposit=CONFISCATED
  5. `verify:coa` ALL PASS(没收后四式仍平);该客户钱包 recon 平
- [ ] **Step 2: 回归**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest --no-coverage 2>&1 | tail -5      # 失败数==基线(3 suites/5 tests pre-existing),净新 0
DATABASE_URL="file:/tmp/exchange_js_wt_transaction_limits/dev.db" TB_ADDRESS="127.0.0.1:3123" npx ts-node -r tsconfig-paths/register scripts/demo-all.ts   # 不劣于基线 7/8(demo 金额≫100 不触发)
```
- [ ] **Step 3: 文档五处**——truth v4（BELOW_MIN 挂起/两按钮/CONFISCATED 治理化/客户面过滤/legSeq2 资金单）、v3（DEPOSIT 限额行现状）、funds-orders（deposit legSeq>1 投影 + 没收腿）、BACKLOG（勾/记：原路退回、计数冻结、自动没收 cron 三笔账;PATCH CONFISCATE 半截桥已治理化可勾）、roadmap V4（"已记账异常终态 TB 回退"P0 标注部分兑现——没收路径的 Step1 反向已落）。
- [ ] **Step 4: Commit**

```bash
git add doc-final
git commit -m "docs(deposit-min): truth v4/v3/funds-orders + BACKLOG + roadmap 同步 below-min 落地"
```

---

## 验收总清单

- [ ] 小额充值建单+出生落标;客户列表/详情双隐藏(服务端);admin 可见带标
- [ ] Step1 记账照常;checkAutoApproval 卡住不进 L2(审计带唯一 requestId)
- [ ] PASS: 摘标→重跑闸→L2→SUCCESS(豁免金额不豁免合规)
- [ ] Confiscate: 审批(OPS_OFFICER,快照带 T&C 依据)→legSeq2 资金单→两腿(Step1 反向+FIRM_FEE)→CONFISCATED;先账后状态
- [ ] 三视图: 没收单入 internal 不入 payin;verify:coa 四式平;逐钱包对账平
- [ ] tsc 0 / jest 净新 0 / demo:all 不劣于基线
- [ ] truth×3+BACKLOG+roadmap 同步
