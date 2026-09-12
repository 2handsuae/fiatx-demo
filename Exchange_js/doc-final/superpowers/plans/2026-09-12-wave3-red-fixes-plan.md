# 波三 · 业务红项修复 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉三四五幕体检判红的两族缺口（充值冻结留痕、提现 tipping-off）+ 六条小真账 + 审计页实体跳转（甲案）+ 客户端横幅按业主五规则重排。

**Architecture:** 全部为既有服务/页面的定点修改，零 schema 变更、零新审计码、零新状态机边。Spec：`doc-final/superpowers/specs/2026-09-12-wave3-red-fixes-spec.md`（§12 勘误已并入本 plan 前提）。

**Tech Stack:** NestJS + Prisma + jest（后端）；React + vitest（client-web）；admin-web 组件无法单测（.spec.tsx 静默不跑），一律 tsc + preview 截图验证。

## Global Constraints

- **总纲铁律**（子代理 prompt 必带项目 CLAUDE.md §0–§5 要点）：操作必留痕｜门不可绕｜各管各的｜状态只能沿边走｜钱动必过账｜对外用业务键。演示系统，禁做：幂等/去重/重试/并发锁/防御性校验/性能优化。
- **执行环境**：worktree `.claude/worktrees/wave3_red_fixes/`（树名下划线，判例），分支 `feat/wave3-red-fixes`。所有命令在 `<worktree>/Exchange_js/` 下执行。
- **Node 20**（本机 shell 默认 node18）：每个 Bash 会话先 `export PATH="$(ls -d "$HOME/.nvm/versions/node"/v20* | tail -1)/bin:$PATH"`。
- **jest**：在 Exchange_js 根下跑；worktree 内必须先 `export DATABASE_URL="file:/tmp/exchange_js_wt_wave3_red_fixes/dev.db"`（缺它=假红，判例）；不接管道尾（zsh 吞退出码，判例）。首次跑前 `npx prisma generate`。
- **随手闸**（每个任务收尾必跑，全绿才 commit）：`npx tsc --noEmit -p tsconfig.json`；动了 admin-web 加 `cd admin-web && npx tsc -b --noEmit && cd ..`；动了 client-web 加 `cd client-web && npx tsc -b --noEmit && cd ..` 与 `npm run test:client`。
- **悬案纪律**：动 swap workflow 的任务（Task 5/7）期间若跑 demo:all 判红，**先按 BACKLOG §A 取证姿势抓现场再 reset**。
- **模型分层**（派发时执行）：任务执行与任务级评审 → sonnet；**Task 1 与 Task 5 的评审升档 opus**（动审计链/动 swap workflow 入口）；终审 → 省略 model 字段走继承（Fable）。
- 测试的绿必须来自行为；禁止「扫源码文本」型断言。行号为 2026-09-12 实测，执行时以现场为准（函数名定位优先）。

---

### Task 0: 环境就位

**Files:** 无代码改动。

- [ ] **Step 1**: 用 superpowers:using-git-worktrees 建 worktree `.claude/worktrees/wave3_red_fixes/`，分支 `feat/wave3-red-fixes`（基于 main）。
- [ ] **Step 2**: worktree 的 Exchange_js 下：`npm ci --no-audit --no-fund 2>&1 | tail -3`（若 node_modules 缺）；`npx prisma generate`；`bash scripts/stack.sh reset self` 从零建库（DB 落 `/tmp/exchange_js_wt_wave3_red_fixes/dev.db`）。
- [ ] **Step 3**: 验证闸能红能绿：`npx tsc --noEmit -p tsconfig.json` 应 0 错误退出。

---

### Task 1: 充值冻结留痕五连缺（A 族）【评审升档 opus】

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:1409`（findNonTerminalByOwner 的 select）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:1112`（同名方法 select）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:246-263`（evaluateL1 enforcement 分支）
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`、`deposit-transactions.service.spec.ts`、`withdraw-transactions.service.spec.ts`

**Interfaces:** 无对外接口变化；审计码复用现役 `DEPOSIT_FROZEN`（INHERIT，correlationId 从单上继承）。

- [ ] **Step 1: 写失败测试（evaluateL1 冻结分支留痕）** — 在 `deposit-workflow.service.spec.ts` 按该文件既有 mock 风格新增（evaluateL1 是 private，用 `(service as any).evaluateL1(depositId, ownerId)` 驱动）：

```ts
it('evaluateL1 enforcement freeze writes DEPOSIT_FROZEN audit inheriting correlationId', async () => {
  customerAccessService.resolve.mockResolvedValue({ blocked: new Set(['DEPOSIT']) });
  customerRestrictionsService.listOpen.mockResolvedValue([
    { restrictionNo: 'RST1', scopes: ['ALL'], releasePolicy: 'MLRO_APPROVAL' },
  ]);
  depositService.findOne.mockResolvedValue({
    id: 'd1', depositNo: 'DEP1', status: 'COMPLIANCE_PENDING',
    correlationId: 'corr-1', ownerNo: 'CU1', assetId: null, limitHoldReason: null,
  });
  l1Gate.evaluate.mockResolvedValue({ verdict: 'FAIL', checks: [], holdReason: null });
  depositService.updateStatus.mockResolvedValue(undefined);
  depositService.saveL1Snapshot.mockResolvedValue(undefined);

  await (service as any).evaluateL1('d1', 'owner-1');

  expect(depositService.updateStatus).toHaveBeenCalled();
  expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'DEPOSIT_FROZEN', correlationId: 'corr-1', primarySubjectNo: 'DEP1' }),
  );
});
```

- [ ] **Step 2: 跑测试确认失败** — `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "evaluateL1 enforcement"`，预期 FAIL（recordSystem 未被以 DEPOSIT_FROZEN 调用）。
- [ ] **Step 3: 实现** — `evaluateL1` 的 enforcement 分支，在 `updateStatus(FREEZE)` 之后、`return` 之前插入（照 `markL1Hold` 的 depositAudit 用法，系统动作不传 actor 走 recordSystem；BACKLOG 记载的修法）：

```ts
        // 铁律①：三分支（冻/标/放行）中独漏冻结这半边的审计（BACKLOG 五连缺路径二）。
        // 复用现役 DEPOSIT_FROZEN 码；correlationId 由 depositAudit 从单上继承（INHERIT）。
        await this.depositAudit(deposit, {
          action: 'DEPOSIT_FROZEN',
          fromStatus: deposit.status,
          toStatus: DepositTransactionStatus.FROZEN,
          reason: 'Frozen by L1 gate — customer DEPOSIT capability is restricted (enforcement)',
          metadata: { source: 'L1_GATE', blockers: depositBlockers.map((row) => row.restrictionNo) },
        });
```

- [ ] **Step 4: select 补 correlationId ×2** — 两处 `findNonTerminalByOwner` 的 select 行（deposit `:1409` / withdraw `:1112`）各加一个字段，对齐 swap 域 `:945` 注释精神：

```ts
      select: { id: true, depositNo: true, ownerType: true, ownerId: true, status: true, traceId: true, correlationId: true },
```
```ts
      select: { id: true, withdrawNo: true, ownerType: true, ownerId: true, status: true, traceId: true, correlationId: true },
```

- [ ] **Step 5: 写失败测试（select 带 correlationId）** — 两个 service spec 各加一条（mock prisma，断言查询参数——这是断言行为构造的查询，不是扫源码）：

```ts
it('findNonTerminalByOwner selects correlationId so INHERIT audit codes can inherit', async () => {
  const findMany = jest.fn().mockResolvedValue([]);
  (service as any).prisma = { depositTransaction: { findMany } }; // withdraw 侧同款换表名
  await service.findNonTerminalByOwner('owner-1');
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ select: expect.objectContaining({ correlationId: true }) }),
  );
});
```

- [ ] **Step 6: 全部跑绿** — `npx jest src/modules/trading/deposit-transactions src/modules/trading/withdraw-transactions --silent`；再跑闸①。
- [ ] **Step 7: `.catch` 链路验证前置记录** — 本任务不改 `onCustomerRestrictionOpened`（它的调用因 Step 4 不再被 INHERIT 校验拒收）；「真落库」的实证放 Task 14 拉链（花名册 #7 广播路径 / #10 L1 直判路径按单号查 `DEPOSIT_FROZEN`）。在 commit message 里注明。
- [ ] **Step 8: Commit** — `git add <上述4文件> && git commit -m "fix(波三A): 充值冻结留痕五连缺——select补correlationId×2 + evaluateL1冻结分支补DEPOSIT_FROZEN审计"`

---

### Task 2: 提现 tipping-off 三处 · 后端（B 族）

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（常量区 + findAll + findAllForCustomer + toCustomerWithdrawView）
- Modify: `src/modules/trading/withdraw-transactions/dto/`（WithdrawTransactionQueryDto 加 `bucket?: string`，照 deposit 侧 DTO 的 bucket 字段写法）
- Test: `withdraw-transactions.service.spec.ts`

**Interfaces:**
- Produces: `GET /client/withdraw-transactions` 接受 `bucket` 参数（PROCESSING/ACTION_REQUIRED/SUCCESS/REJECTED/FAILED/RETURNED）；客户面响应 status 只可能是白名单六值之一（其余收敛为 `COMPLIANCE_PENDING`）。Task 3 前端依赖此契约。

- [ ] **Step 1: 写失败测试**（三条，withdraw-transactions.service.spec.ts，按既有 mock 风格）：

```ts
it('toCustomerWithdrawView collapses FROZEN to COMPLIANCE_PENDING and nulls completedAt', async () => {
  // 经 findAllForCustomer 驱动：mock findAll 返回一条 FROZEN 行
  jest.spyOn(service, 'findAll').mockResolvedValue({
    items: [{ id: 'w1', withdrawNo: 'WDR1', status: 'FROZEN', amount: '1', feeAmount: '0', netAmount: '1',
      createdAt: new Date(), completedAt: new Date(), txHash: null, referenceNo: null, toAddress: null, toIban: null, asset: null }],
    total: 1,
  } as any);
  const out = await service.findAllForCustomer('c1', {} as any);
  expect(out.items[0].status).toBe('COMPLIANCE_PENDING');
  expect(out.items[0].completedAt).toBeNull();
});

it('findAllForCustomer ignores raw status param (freeze oracle closed)', async () => {
  const spy = jest.spyOn(service, 'findAll').mockResolvedValue({ items: [], total: 0 } as any);
  await service.findAllForCustomer('c1', { status: 'FROZEN' } as any);
  expect(spy).toHaveBeenCalledWith(expect.anything(), { customerScope: true });
  // findAll 内部断言见下一条
});

it('findAll drops status under customerScope and maps bucket instead', async () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  (service as any).prisma = { withdrawTransaction: { findMany, count } };
  await service.findAll({ status: 'FROZEN', bucket: 'PROCESSING' } as any, { customerScope: true });
  const where = findMany.mock.calls[0][0].where;
  expect(where.status).toBeUndefined();
  expect(where.NOT).toBeDefined(); // PROCESSING 桶 = 补集
});
```

- [ ] **Step 2: 确认失败** — `npx jest src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts --silent`，三条全 FAIL。
- [ ] **Step 3: 实现常量**（文件顶部、既有 import 之后，镜像 deposit 侧 `:62-114` 的桶+白名单双设计；PROCESSING 必须补集式——新状态默认落回"处理中"）：

```ts
// 客户面筛选桶（波三B，镜像 deposit CUSTOMER_BUCKETS）：客户端只发桶名，
// 原始状态码不再出现在客户可见的任何 option/query 里。PROCESSING = 补集，
// 未来新增状态默认收进"处理中"，不会漏出去。
const WITHDRAW_ACTION_REQUIRED_WHERE = { status: 'ACTION_PENDING' };
const WITHDRAW_SUCCESS_WHERE = { status: 'SUCCESS' };
const WITHDRAW_REJECTED_WHERE = { status: 'REJECTED' };
const WITHDRAW_FAILED_WHERE = { status: 'FAILED' };
const WITHDRAW_RETURNED_WHERE = { status: 'RETURNED' };
export const WITHDRAW_CUSTOMER_BUCKETS: Record<string, any> = {
  PROCESSING: { NOT: { OR: [WITHDRAW_ACTION_REQUIRED_WHERE, WITHDRAW_SUCCESS_WHERE, WITHDRAW_REJECTED_WHERE, WITHDRAW_FAILED_WHERE, WITHDRAW_RETURNED_WHERE] } },
  ACTION_REQUIRED: WITHDRAW_ACTION_REQUIRED_WHERE,
  SUCCESS: WITHDRAW_SUCCESS_WHERE,
  REJECTED: WITHDRAW_REJECTED_WHERE,
  FAILED: WITHDRAW_FAILED_WHERE,
  RETURNED: WITHDRAW_RETURNED_WHERE,
};
// 客户面 status 白名单（镜像 deposit CUSTOMER_STATUS_PASSTHROUGH 的白名单哲学：
// 宁可错杀不可放过——不在名单里的态一律收敛成 COMPLIANCE_PENDING）。
const WITHDRAW_CUSTOMER_STATUS_PASSTHROUGH = new Set<string>([
  'COMPLIANCE_PENDING', 'ACTION_PENDING', 'SUCCESS', 'REJECTED', 'FAILED', 'RETURNED',
]);
const WITHDRAW_CUSTOMER_COMPLETED_STATUSES = new Set<string>(['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED']);
```

- [ ] **Step 4: 实现 findAll/findAllForCustomer/toCustomerWithdrawView**：

```ts
  async findAll(query: WithdrawTransactionQueryDto, options?: { customerScope?: boolean }) {
    const { ..., status, bucket, ... } = query;   // 解构补 bucket
    ...
    // 评审 Important 1(a) 同款（照 deposit :232-239 注释）：customerScope 下
    // 静默忽略 status——?status=FROZEN 是冻结预言机；不报错，报错也是探测面。
    if (status && !options?.customerScope) where.status = Array.isArray(status) ? { in: status } : status;
    ...
    if (options?.customerScope && bucket) {
      const bucketWhere = WITHDRAW_CUSTOMER_BUCKETS[bucket];
      if (bucketWhere) Object.assign(where, bucketWhere);
    }
```
```ts
  async findAllForCustomer(customerId: string, query: WithdrawTransactionQueryDto) {
    const result = await this.findAll({ ...query, ownerId: customerId }, { customerScope: true });
    ...
```
```ts
  private toCustomerWithdrawStatus(status: string): string {
    return WITHDRAW_CUSTOMER_STATUS_PASSTHROUGH.has(status) ? status : 'COMPLIANCE_PENDING';
  }
  private toCustomerWithdrawView(item: any) {
    const customerStatus = this.toCustomerWithdrawStatus(item.status);
    return {
      ...
      status: customerStatus,
      completedAt: WITHDRAW_CUSTOMER_COMPLETED_STATUSES.has(customerStatus) ? item.completedAt : null,
      ...
```
（toCustomerWithdrawView 的 JSDoc 同步补一段：status/completedAt 已白名单收敛，2026-09-12 波三B。）另核 `findOne`/其余 `findAll` 调用方：admin 调用不传 options，行为不变。DTO 加 `bucket?: string`（照 deposit DTO 同名字段的装饰器写法）。

- [ ] **Step 5: 跑绿** — Step 2 命令三条全 PASS；`npx jest src/modules/trading/withdraw-transactions --silent` 全绿；闸①。
- [ ] **Step 6: Commit** — `git commit -m "fix(波三B): 提现tipping-off后端两处——客户面status/completedAt白名单收敛 + customerScope忽略status改走bucket补集"`

---

### Task 3: 提现 tipping-off · 客户端 bucket 筛选（B 族前端）

**Files:**
- Modify: `client-web/src/pages/Withdraw.tsx:100-118`（HISTORY_STATUS_FILTERS）、`:244`（fetchHistory 参数）、`:551`（option value）

**Interfaces:**
- Consumes: Task 2 的 `bucket` 参数契约。

- [ ] **Step 1: 改筛选组定义**（照 Deposit.tsx `:138-165` 的 bucket 间接式；label 仍走 getWithdrawStatusView 保证与徽章文案一致）：

```tsx
/** 桶名间接式（波三B，照 Deposit.tsx 同名常量）：option value 只暴露桶名，
 *  原始后端状态码（FROZEN/MANUAL_CHECKING…）不再出现在客户可见的 DOM 里。 */
const HISTORY_STATUS_FILTERS: Array<{ label: string; bucket: string }> = [
  { label: getWithdrawStatusView('COMPLIANCE_PENDING').label, bucket: 'PROCESSING' },
  { label: getWithdrawStatusView('ACTION_PENDING').label, bucket: 'ACTION_REQUIRED' },
  { label: getWithdrawStatusView('SUCCESS').label, bucket: 'SUCCESS' },
  { label: getWithdrawStatusView('REJECTED').label, bucket: 'REJECTED' },
  { label: getWithdrawStatusView('FAILED').label, bucket: 'FAILED' },
  { label: getWithdrawStatusView('RETURNED').label, bucket: 'RETURNED' },
];
```

- [ ] **Step 2: fetchHistory 与 option** — `if (historyStatus) params.append('bucket', historyStatus);`（原 `status` 行替换）；option 改 `<option key={filter.bucket} value={filter.bucket}>`。
- [ ] **Step 3: 闸③ + vitest** — `cd client-web && npx tsc -b --noEmit && cd .. && npm run test:client`。
- [ ] **Step 4: 渲染验证** — worktree 栈 `bash scripts/stack.sh up`，client 页 `/withdraw` 历史 tab：筛选下拉切 PROCESSING 出单、DevTools Elements 里 option value 无任何原始状态码；截图落 `.superpowers/sdd/shots/wave3-b-withdraw-bucket.png`。
- [ ] **Step 5: Commit** — `git commit -m "fix(波三B): 提现客户端筛选改bucket间接式——DOM里不再出现原始状态码"`

---

### Task 4: D6 三弧 kind 分弧

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:493-511`（linkedFundOrders 映射）
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx:71-78`（interface）、`:711`（cap 文案）
- Test: `deposit-transactions.service.spec.ts`

**Interfaces:**
- Produces: `linkedFundOrders[].kind` 值域扩为 `'PAYIN' | 'CONFISCATION' | 'RETURN' | 'SEIZE'`（legSeq 2/3/4 精确映射）。

- [ ] **Step 1: 写失败测试**：

```ts
it('linkedFundOrders maps legSeq 2/3/4 to CONFISCATION/RETURN/SEIZE', async () => {
  // 按该 spec 既有 findOne 测试的 mock 方式喂一条带 4 个 fundsOrders 的 deposit
  // （legSeq 1..4），断言：
  const kinds = result.linkedFundOrders.map((o: any) => o.kind);
  expect(kinds).toEqual(['PAYIN', 'CONFISCATION', 'RETURN', 'SEIZE']);
});
```

- [ ] **Step 2: 确认失败**（legSeq 3/4 现落 CONFISCATION）。
- [ ] **Step 3: 后端实现** — 映射块替换（fallback 保持旧行为，未知 legSeq 仍归 CONFISCATION）：

```ts
    // D6（波三）：三条弧分弧——2=没收 / 3=退回 / 4=上缴，不再一律标 CONFISCATION。
    const KIND_BY_LEG_SEQ: Record<number, 'CONFISCATION' | 'RETURN' | 'SEIZE'> = {
      2: 'CONFISCATION', 3: 'RETURN', 4: 'SEIZE',
    };
    const linkedFundOrders: Array<{
      kind: 'PAYIN' | 'CONFISCATION' | 'RETURN' | 'SEIZE';
      no: string; id: string; status: string; amount: string;
      role: 'principal' | 'fee';
    }> = fundsOrders.map((fo: any) => {
      const isConfiscationLeg = fo.legSeq != null && fo.legSeq > 1;
      const kind = isConfiscationLeg ? (KIND_BY_LEG_SEQ[fo.legSeq] ?? 'CONFISCATION') : 'PAYIN';
      return { kind, no: fo.fundsOrderNo, id: fo.id, status: fo.status, amount: String(fo.amount), role: isConfiscationLeg ? 'fee' : 'principal' };
    });
```

- [ ] **Step 4: 前端实现** — interface `kind` 联合加 `'RETURN' | 'SEIZE'`；cap 三元改查表：

```tsx
cap={({ CONFISCATION: 'Fee · Confiscation', RETURN: 'Principal · Return', SEIZE: 'Principal · Seizure' } as Record<string, string>)[o.kind] ?? 'Principal · Payin'}
```

- [ ] **Step 5: 跑绿** — jest 该目录 + 闸①②。截图归 Task 14 走查（roster #10 SEIZED 单详情）。
- [ ] **Step 6: Commit** — `git commit -m "fix(波三D6): linkedFundOrders三弧分弧 2→CONFISCATION/3→RETURN/4→SEIZE + 详情页cap文案"`

---

### Task 5: E1 冻人标识 + resumeLeg 门控 · 后端【评审升档 opus】

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（constructor 注入 + findAll + findOneForAdmin）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:1728-1743`（resumeLeg 入口）
- Test: `swap-transactions.service.spec.ts`、`swap-workflow.service.spec.ts`

**Interfaces:**
- Produces: admin `findAll`/`findOneForAdmin` 响应带 `ownerRestricted: boolean`（**仅 admin 路径**；customerScope 一律不带——它派生自含 SILENT 的 blocked，漏给客户即 tipping-off）。`resumeLeg` 对受限客户抛 `SWAP_CUSTOMER_RESTRICTED`。

- [ ] **Step 1: 写失败测试**：

```ts
// swap-workflow.service.spec.ts（照 :2689 附近既有 capability-gate 测试的 mock 风格）
it('resumeLeg refuses while the owner is restricted (E1 gate, CLI path included)', async () => {
  customerAccessService.resolve.mockResolvedValue({ blocked: new Set(['SWAP']) });
  // 喂一个 PROCESSING swap + FAILED leg 的常规 resume 场景
  await expect(service.resumeLeg('SWP1', 2, 'OP1')).rejects.toThrow('SWAP_CUSTOMER_RESTRICTED');
});

// swap-transactions.service.spec.ts
it('admin findAll derives ownerRestricted; customerScope path never carries it', async () => {
  const findMany = jest.fn().mockResolvedValue([{ id: 's1', ownerId: 'o1' }, { id: 's2', ownerId: 'o2' }]);
  const count = jest.fn().mockResolvedValue(2);
  (service as any).prisma = { swapTransaction: { findMany, count } };
  customerAccessService.resolve.mockImplementation(async (oid: string) => ({
    blocked: new Set(oid === 'o1' ? ['SWAP'] : []),
  }));
  const adminOut = await service.findAll({} as any);
  expect(adminOut.items.map((i: any) => i.ownerRestricted)).toEqual([true, false]);
  const customerOut = await service.findAll({} as any, { customerScope: true });
  expect(customerOut.items[0].ownerRestricted).toBeUndefined();
});
```

- [ ] **Step 2: 确认失败**。
- [ ] **Step 3: 注入 + findAll 派生** — constructor 加 `private readonly customerAccessService: CustomerAccessService`（import 自 `../../identity/customers/customer-access.service`；模块已 import CustomersModule，DI 可达）。`findAll` 的 `return { items, total }` 前插：

```ts
    // E1（2026-09-12 定案）：管理台标「人被冻」——派生不落库。「被冻」是客户
    // 属性不是单属性，读时派生随解冻自动消失，零状态同步。blocked 含 SILENT，
    // 只许 admin 面出现；customerScope 一律不带（tipping-off）。
    if (!options?.customerScope) {
      const ownerIds = [...new Set(items.map((i: any) => i.ownerId).filter(Boolean))] as string[];
      const restrictedOwners = new Set<string>();
      for (const ownerId of ownerIds) {
        const access = await this.customerAccessService.resolve(ownerId);
        if (access.blocked.has('SWAP')) restrictedOwners.add(ownerId);
      }
      for (const it of items as any[]) it.ownerRestricted = restrictedOwners.has(it.ownerId);
    }
```
（注意：`findAll` 现签名已带 `options?: { customerScope?: boolean }`，`:266`。）`findOneForAdmin` 的 return 改：

```ts
    const access = await this.customerAccessService.resolve(item.ownerId);
    return { ...item, sumsubDetail, materialRequests, ownerRestricted: access.blocked.has('SWAP') };
```

- [ ] **Step 4: resumeLeg 门控** — `:1730` status 检查之后插入：

```ts
      // E1（2026-09-12 业主定案：原地冻是正解）：冻人期间 Resume = 替被冻客户动钱，
      // 命令行路同样要过这道门（铁律②）。解除限制后断言自然放行。
      const access = await this.customerAccessService.resolve(swap.ownerId, client);
      if (access.blocked.has('SWAP')) {
        throw new BadRequestException(
          'SWAP_CUSTOMER_RESTRICTED: customer SWAP capability is restricted — resume is blocked until the restriction is lifted',
        );
      }
```
（swap-workflow 已有 `customerAccessService` 注入，`:189`。同文件另有 `customerAccess` 重复注入同一服务——**不动**，登记见 Task 13 交付备注。）

- [ ] **Step 5: 跑绿** — `npx jest src/modules/trading/swap-transactions --silent` + 闸①。
- [ ] **Step 6: Commit** — `git commit -m "feat(波三E1): 管理台派生ownerRestricted标识 + resumeLeg入口冻人断言——原地冻定案落地"`

---

### Task 6: E1 管理台徽章 · 前端

**Files:**
- Modify: `admin-web/src/pages/SwapTransactionList.tsx:29-53`（interface）、`:415-417`（徽章格）
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`（详情提示条，落点在页顶状态区/needsReview 提示附近，执行时按现场定）

**Interfaces:**
- Consumes: Task 5 的 `ownerRestricted`。

- [ ] **Step 1: 列表页** — interface 加 `ownerRestricted?: boolean;`；`:415-417` 徽章格改（两旗可并存，都渲染）：

```tsx
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      {item.ownerRestricted && <AdminBadge value="CUSTOMER_FROZEN" />}
                      {item.needsReview && <AdminBadge value="NEEDS_REVIEW" />}
                      {!item.ownerRestricted && !item.needsReview && <span className="text-adm-t3">—</span>}
                    </span>
                  </td>
```
（先确认 AdminBadge 对未知 value 有兜底样式；若按值配色，为 `CUSTOMER_FROZEN` 配红。）

- [ ] **Step 2: 详情页** — detail 接口加 `ownerRestricted?: boolean;`，状态区插提示条：

```tsx
          {data.ownerRestricted && (
            <div className="border-l-4 border-l-adm-red bg-adm-red/[0.04] px-4 py-3 font-mono text-[11px] text-adm-red">
              CUSTOMER FROZEN — this swap's owner is under an active restriction. Leg resume is refused by the API until the restriction is lifted; do not attempt recovery on this order.
            </div>
          )}
```

- [ ] **Step 3: 闸②**；渲染验证归 Task 14（roster #13 FRANK 兑换单列表徽章 + 详情提示）。
- [ ] **Step 4: Commit** — `git commit -m "feat(波三E1): 兑换列表/详情CUSTOMER_FROZEN徽章——冻人与技术卡单分开标识"`

---

### Task 7: E3 operator 语义化 + E5 SLA 重提推窗

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（markStatus opts + statusHistory + 新方法 extendComplianceSla）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（4 个 markStatus 调用点）
- Modify: `src/modules/swap-sumsub/swap-sla.service.ts`（1 个调用点 + resubmit 分支）
- Test: `swap-transactions.service.spec.ts`、`src/modules/swap-sumsub/swap-sla.service.spec.ts`

**Interfaces:**
- Produces: `markStatus(swapId, action, tx, opts?)` 的 opts 扩为 `{ rejectReason?; operator?: string }`（缺省 `'SYSTEM'`）；`SwapTransactionsService.extendComplianceSla(swapId): Promise<void>`。

- [ ] **Step 1: 写失败测试**：

```ts
// swap-transactions.service.spec.ts
it('markStatus stamps opts.operator into statusHistory (defaults SYSTEM)', async () => {
  // 按既有 markStatus 测试的 tx mock 风格，调 markStatus(..., { operator: 'SLA_SWEEP' })
  // 断言 update 收到的 statusHistory JSON 末条 operator === 'SLA_SWEEP'；
  // 不传 operator 时 === 'SYSTEM'。
});

// swap-sla.service.spec.ts
it('resubmit branch pushes the SLA window after a successful re-submit (E5)', async () => {
  // stale 候选带 sumsubTxnIdOut: null；mock workflow.submitSumsubTxnOut resolves；
  expect(swapService.extendComplianceSla).toHaveBeenCalledWith(swap.id);
});
```

- [ ] **Step 2: 确认失败**。
- [ ] **Step 3: markStatus 实现**：

```ts
    opts?: { rejectReason?: SwapRejectReason; operator?: string },
    ...
    statusHistory.push({
      status: next,
      timestamp: new Date().toISOString(),
      // E3（波三）：时间线写清是哪条机制在动单——语义标签照充值域 L1_GATE 先例，
      // 不假装有人；真人驱动的路径将来传真名即可。
      operator: opts?.operator ?? 'SYSTEM',
      note: `Swap settlement status → ${next}`,
    });
```

- [ ] **Step 4: 五个调用点传标签**（复现清单：`grep -n "markStatus(" src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/swap-sumsub/swap-sla.service.ts | grep -v "//"`）：
  - swap-workflow `:759` KYT_APPROVED → `{ operator: 'SUMSUB_KYT' }`（该调用现无 opts 参数，补第四参）
  - swap-workflow `:800` KYT_REJECTED → opts 加 `operator: 'SUMSUB_KYT'`
  - swap-workflow `:1129` FREEZE（裁决处置冻结）→ opts 加 `operator: 'SUMSUB_KYT'`
  - swap-workflow `:1648` SUCCESS → `{ operator: 'LEG_SETTLEMENT' }`
  - swap-workflow `:1831` FREEZE（冻人广播）→ opts 加 `operator: 'RESTRICTION_BROADCAST'`
  - swap-sla `:84` SLA_BREACH → opts 加 `operator: 'SLA_SWEEP'`
- [ ] **Step 5: E5 实现** — swap-transactions.service 新增（挨着 `resolveSlaFields`）：

```ts
  /** E5（波三）：补提交成功后把 COMPLIANCE_PENDING 的 SLA 窗口重新拉满——
   *  此刻 slaDeadline 已是过去时，不推的话 30 秒后下一轮 sweep 直接判超时拒单，
   *  Sumsub 实际只拿到 30 秒而不是完整窗口。 */
  async extendComplianceSla(swapId: string): Promise<void> {
    await (this.prisma as any).swapTransaction.update({
      where: { id: swapId },
      data: this.resolveSlaFields(SwapTransactionStatus.COMPLIANCE_PENDING),
    });
  }
```
swap-sla.service resubmit 分支（`:75-81`）：

```ts
        if (!swap.sumsubTxnIdOut) {
          await this.workflow.submitSumsubTxnOut(swap.id);
          // E5：重提成功 → 死线拉满一个完整窗口（三域「计的是在这个状态待了多久」模型归队）。
          await this.swapService.extendComplianceSla(swap.id);
          resubmitted += 1;
          continue;
        }
```

- [ ] **Step 6: 跑绿** — `npx jest src/modules/trading/swap-transactions src/modules/swap-sumsub --silent` + 闸①。
- [ ] **Step 7: Commit** — `git commit -m "fix(波三E3/E5): markStatus时间线operator语义化（六写点标签）+ SLA重提推满窗口"`

---

### Task 8: D8 审批深链 + I2 keyword 接通（含 swap 列表）

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx:695`、`WithdrawTransactionDetail.tsx:572`（审批卡 navigate）
- Modify: `admin-web/src/pages/DepositTransactionList.tsx:90`、`WithdrawTransactionList.tsx:86`、`SwapTransactionList.tsx:89`（keyword 消费）
- Modify: `admin-web/src/pages/approvalEntityRoutes.ts:6-8`（过时注释）

**Interfaces:**
- Produces: 三张交易列表页接受 `?keyword=<单号>` 深链并预填单号筛选——Task 9 的审计跳转与既有审批回链共同消费。

- [ ] **Step 1: 深链** — 两处审批卡 `onClick={() => navigate(\`/admin/governance/approvals/${a.approvalNo}\`)}`（路由 `governance/approvals/:approvalNo` 已按业务号收参，投影自带 approvalNo，零后端改动——spec §12 勘误 2）。
- [ ] **Step 2: keyword** — 三张列表页 useState 初始化各改一行（keyword 语义 = 单号，退位给显式参数）：

```tsx
    depositNo: (searchParams.get('depositNo') ?? searchParams.get('keyword'))?.trim() ?? '',
```
（withdraw 用 withdrawNo、swap 用 swapNo，同型。）

- [ ] **Step 3: 注释同步** — approvalEntityRoutes.ts 头注释「当前 3 张列表页尚未消费该 query 参数」改为已消费（波三 I2）。
- [ ] **Step 4: 闸②**；点击链验证归 Task 14（充值详情审批卡 → 审批详情页渲染出该单）。
- [ ] **Step 5: Commit** — `git commit -m "fix(波三D8/I2): 审批卡深链approvalNo + 三列表页接通?keyword=单号预填"`

---

### Task 9: 审计页实体跳转（甲案）+ 幽灵字段清理

**Files:**
- Create: `admin-web/src/pages/auditEntityRoutes.ts`
- Modify: `admin-web/src/pages/AuditLogsPage.tsx`（interface + Entity 两列）、`AuditLogDetailPage.tsx`（interface + Entity 区 + sidebar :414）
- Modify: `src/modules/audit-logging/dto/audit-log.dto.ts:100-102`、`src/modules/audit-logging/audit-logs.service.ts`（mapEvent :333-335 + :13 死 import）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts:1-33`（删 AuditModules）、`src/modules/identity/customers/customers.service.ts:9`、`src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:23`、`audit-logs.service.spec.ts:11`（删死 import）

**Interfaces:**
- Produces: `AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE: Record<string, (no: string) => string>`；审计 DTO 不再含 `entityType/entityId/entityNo`（三字段 2026-08-25 表重建后恒 undefined，生产 JSON 里本就不存在——删除对线上响应零变化）。

- [ ] **Step 1: 消费方普查（负结论纪律）** — `grep -rn "entityType\|entityId\b\|entityNo" admin-web/src scripts test src --include="*.ts" --include="*.tsx" | grep -v spec | grep -v "AuditEntityTypes\|entityOwnerNo\|entityRef"`，逐条确认除两审计页 + DTO/mapEvent 外无消费方（若 scripts/verify-audit.ts 等命中，先改它们同款切 primarySubjectType 再删）。
- [ ] **Step 2: 后端清理** — DTO 删三字段；mapEvent 删三行（`entityType: raw.entityType` 等；**保留** `entityOwnerNo` 等有列支撑的映射——对照 `prisma/schema.prisma:411-414` 组 F 注释逐字段核）；删 `AuditModules` 常量与 4 个死 import。闸① + `npx jest src/modules/audit-logging --silent`。
- [ ] **Step 3: 路由映射表** — 新建 `admin-web/src/pages/auditEntityRoutes.ts`：

```ts
/* 审计页实体跳转（波三F，业主拍甲案）：按 primarySubjectType 把 primarySubjectNo
   （业务号，铁律⑥）映射到详情/列表路由。逐条对照 App.tsx 现状路由实证；交易三单
   详情路由仍收内部 id（波五换键），走「列表页 + ?keyword=」（I2 已接通）。
   映射缺席 = 保持纯文本——照 approvalEntityRoutes 的纪律，不硬造。
   FUNDS_ORDER 不在 AuditEntityTypes 常量里但真实落库（push-order/advance-workflow
   两处字面量），必须收编。 */
export const AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE: Record<string, (no: string) => string> = {
  DEPOSIT_TRANSACTION: (no) => `/admin/trading/deposits?keyword=${no}`,
  WITHDRAW_TRANSACTION: (no) => `/admin/trading/withdrawals?keyword=${no}`,
  SWAP_TRANSACTION: (no) => `/admin/trading/swaps?keyword=${no}`,
  SWAP_QUOTE: (no) => `/admin/trading/swap-quotes/${no}`,
  WITHDRAW_QUOTE: (no) => `/admin/trading/withdraw-quotes/${no}`,
  CUSTOMER: (no) => `/admin/customers/${no}`,
  APPROVAL_CASE: (no) => `/admin/governance/approvals/${no}`,
  FUNDS_ORDER: (no) => `/admin/funds-orders/${no}`,
  INCIDENT: (no) => `/admin/governance/incidents/${no}`,
  ASSET: (no) => `/admin/assets/${no}`,
  TRANSACTION_LIMIT_POLICY: (no) => `/admin/assets/transaction-limits/${no}`,
  WALLET: (no) => `/admin/custody/wallets/${no}`,
  WITHDRAWAL_ADDRESS: (no) => `/admin/custody/withdrawal-addresses/${no}`,
  INTERNAL_TRANSFER: (no) => `/admin/treasury/internal-transfers/${no}`,
  ADMIN_USER: (no) => `/admin/iam/members/${no}`,
  RECONCILIATION_RUN_V8: (no) => `/admin/reconciliation/runs/${no}`,
  RECONCILIATION_CASE: (no) => `/admin/reconciliation/cases/${no}`,
  RECON_ADJUSTMENT: (no) => `/admin/reconciliation/adjustments/${no}`,
};
```
（费率档 / COA / TB_ACCOUNT / ONBOARDING / AUTH / CONFIG 等 subjectNo 形态与路由键未证一致——刻意不映射，留纯文本。）

- [ ] **Step 4: 列表页** — interface 加 `primarySubjectType?: string | null;`（`entityType` 字段删）；Entity Type 列渲染 `{item.primarySubjectType ?? <span className="text-adm-t3">—</span>}`；Entity No 列（行本身 onClick 跳审计详情，格内链接必须 stopPropagation）：

```tsx
                    <td className="px-3 py-2.5 font-mono text-[11px] text-adm-amber">
                      {item.primarySubjectNo ? (
                        AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE[item.primarySubjectType ?? ''] ? (
                          <span
                            className="cursor-pointer text-adm-blue hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE[item.primarySubjectType!]!(item.primarySubjectNo!));
                            }}
                          >
                            {item.primarySubjectNo}
                          </span>
                        ) : (
                          item.primarySubjectNo
                        )
                      ) : (
                        <span className="text-adm-t3">—</span>
                      )}
                    </td>
```

- [ ] **Step 5: 详情页** — interface 同步（删 entityType 加 primarySubjectType）；Entity 区 `:332` 类型行与 `:335` 单号行同款改（单号可跳则渲染成链接）；sidebar `:414` 改读 primarySubjectType。
- [ ] **Step 6: 闸①②**；跳转实测归 Task 14（按类型抽点：DEP 单→列表预填、审批号→审批详情、客户号→客户详情、FUNDS_ORDER→资金单详情）。
- [ ] **Step 7: Commit** — `git commit -m "feat(波三F): 审计页实体跳转甲案——primarySubjectType路由映射表 + 幽灵字段entityType/Id/No与AuditModules死码清除"`

---

### Task 10: 横幅重排 · 后端翻面

**Files:**
- Modify: `src/modules/identity/customers/customer-access.service.ts:14-22`（DisclosedRestrictionView + resolve 填 null）
- Modify: `src/modules/identity/customers/customer-restrictions.client.controller.ts:40-52`（回填 status）
- Modify: `src/modules/identity/profile-banners/profile-banners.service.ts`（getBannersFor 翻面）
- Test: `src/modules/identity/profile-banners/profile-banners.service.spec.ts`

**Interfaces:**
- Produces: `DisclosedRestrictionView` 加 `claimedMaterialStatus: 'PENDING_SUBMISSION' | 'SUBMITTED' | null`；profile-banners 的合并方向 = **留条子行、按钮借材料**（业主 2026-09-12 定案）；材料行只发无条子的（绑订单与否不再排除——Overview/Profile 是全量面）。

- [ ] **Step 1: 写失败测试**（profile-banners.service.spec，按既有 mock 风格）：

```ts
it('claimed restriction surfaces as RESTRICTION banner borrowing the material CTA (翻面)', async () => {
  materialRequests.listLiveByCustomer.mockResolvedValue([
    { requestNo: 'MRQ1', restrictionNo: 'RST1', status: 'PENDING_SUBMISSION', orderDomain: null, orderRef: null, materialType: 'PROOF_OF_ADDRESS', reason: 'expired' },
  ]);
  customerAccessService.resolve.mockResolvedValue({ disclosed: [
    { restrictionNo: 'RST1', cause: 'MATERIAL_EXPIRED', scopes: ['WITHDRAW'], label: 'Account restricted', reason: 'PoA expired', openedAt: '...', claimedByMaterialRequestNo: null },
  ] });
  const banners = await service.getBannersFor('c1');
  const restriction = banners.find((b) => b.type === 'RESTRICTION');
  expect(restriction?.ctaPath).toBe('/verification/MRQ1');
  expect(banners.some((b) => b.id === 'material-request:MRQ1')).toBe(false); // 材料行让位
});

it('order-bound unclaimed material now appears (Overview/Profile 全量面)', async () => {
  materialRequests.listLiveByCustomer.mockResolvedValue([
    { requestNo: 'MRQ2', restrictionNo: null, status: 'PENDING_SUBMISSION', orderDomain: 'SWAP', orderRef: 'SWP1', materialType: 'SOURCE_OF_FUNDS', reason: 'kyt' },
  ]);
  customerAccessService.resolve.mockResolvedValue({ disclosed: [] });
  const banners = await service.getBannersFor('c1');
  expect(banners.some((b) => b.id === 'material-request:MRQ2')).toBe(true);
});
```

- [ ] **Step 2: 确认失败**（现行为：claimed 条子 skip、绑单材料 skip）。
- [ ] **Step 3: DisclosedRestrictionView + 端点** — interface 加 `claimedMaterialStatus: 'PENDING_SUBMISSION' | 'SUBMITTED' | null;`，`resolve()` push 处补 `claimedMaterialStatus: null,`（同 :108 的回填注释精神）；controller：

```ts
    const claimedBy = new Map(
      live.filter((r) => r.restrictionNo).map((r) => [r.restrictionNo as string, { requestNo: r.requestNo, status: r.status }]),
    );
    return access.disclosed.map((row) => {
      const claim = claimedBy.get(row.restrictionNo);
      return {
        ...row,
        claimedByMaterialRequestNo: claim?.requestNo ?? null,
        claimedMaterialStatus: (claim?.status as 'PENDING_SUBMISSION' | 'SUBMITTED' | undefined) ?? null,
      };
    });
```

- [ ] **Step 4: profile-banners 翻面** — getBannersFor 中段替换（`DOCUMENT_CTA_CAUSES` 常量随之删除——其死路由 CTA bug 一并消亡，spec §12 勘误 5）：

```ts
    const requests = await this.materialRequests.listLiveByCustomer(customerId);
    const claimedBy = new Map(
      requests.filter((r) => r.restrictionNo).map((r) => [r.restrictionNo as string, r]),
    );

    const access = await this.customerAccessService.resolve(customerId);
    for (const restriction of access.disclosed) {
      // 2026-09-12 业主定案（波三§8）：条子+材料合并形态翻面——留条子那条（先说
      // 「你受限了」+原因），按钮借绑定材料的；材料已提交则改说审核中。
      const claim = claimedBy.get(restriction.restrictionNo);
      const submitted = claim?.status === 'SUBMITTED';
      banners.push({
        id: `banner-restriction-${restriction.restrictionNo}`,
        type: 'RESTRICTION',
        severity: restriction.scopes.includes('ALL') ? 'BLOCKING' : 'WARNING',
        title: restriction.label,
        description: submitted ? `${restriction.reason} — material submitted, under review.` : restriction.reason,
        ctaLabel: claim && !submitted ? 'Submit material' : null,
        ctaPath: claim && !submitted ? `/verification/${claim.requestNo}` : null,
        dismissible: false,
      });
    }

    for (const r of requests) {
      // 材料行只发没绑条子的（绑了的已并进条子形态行）；绑订单与否不再排除——
      // Overview/Profile 是全量面（业主定案矩阵，推翻 2026-08-18 G6 的该分支）。
      if (r.restrictionNo !== null) continue;
      banners.push({
        id: `material-request:${r.requestNo}`,
        type: 'MATERIAL_REFRESH',
        severity: 'INFO',
        title: `${formatMaterialName(r.materialType)} needs refreshing`,
        description: r.reason,
        materialType: r.materialType,
        ctaLabel: r.status === 'SUBMITTED' ? null : 'Verify now',
        ctaPath: r.status === 'SUBMITTED' ? null : `/verification/${r.requestNo}`,
        dismissible: true,
      });
    }
```

- [ ] **Step 5: 跑绿** — `npx jest src/modules/identity --silent` + 闸①。
- [ ] **Step 6: Commit** — `git commit -m "feat(波三G): 横幅合并形态翻面——条子行借材料CTA/材料行只发无条子的/死路由CTA随DOCUMENT_CTA_CAUSES退役 + restrictions端点回填claimedMaterialStatus"`

---

### Task 11: 横幅重排 · 前端三页 + Overview

**Files:**
- Modify: `client-web/src/hooks/useCustomerProfile.ts:9-18`（DisclosedRestrictionView 加 claimedMaterialStatus）
- Modify: `client-web/src/components/RestrictionBanner.tsx`（capability 过滤 + 合并 CTA + refreshProfile 钩子移植 + 文件头注释重写）
- Modify: `client-web/src/components/PendingActionBanner.tsx`（domain 过滤 + 注释更新）
- Modify: `client-web/src/pages/Deposit.tsx`（新挂两横幅 + 口径补充行）、`Withdraw.tsx:470-471`、`Swap.tsx:589-590`、`DashboardOverview.tsx:17,148`、`CustomerProfile.tsx:211-216`（注释）

**Interfaces:**
- Consumes: Task 10 的 claimedMaterialStatus。
- Produces: `<RestrictionBanner capability supplement?>`（capability 必填）；`<PendingActionBanner domain>`（domain 必填）。展示矩阵 = spec §8 表格，逐格执行。

- [ ] **Step 1: RestrictionBanner 改造**（文件头两段注释必须重写——现注释断言「已认领的行不在这儿出」「一律不带 CTA」，翻面后为失真注释）：

```tsx
export function RestrictionBanner({ capability, supplement }: {
  /** 本页对应的交易能力——只渲染 scopes 命中本能力（或 ALL）的条子（业主 2026-09-12 矩阵）。 */
  capability: 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
  /** 页面级补充行（如充值页「入金仍会到账」口径），逐条横幅尾部渲染。 */
  supplement?: string;
}) {
  const [rows, setRows] = useState<DisclosedRestrictionView[]>([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useAuth();
  const hadScopedRef = useRef(false);
  // load() 同现状（fetch /client/me/restrictions，失败清空）；load 之后：
  //   scoped 过滤 + 「有→无」时 refreshProfile（限制解除当场解禁本页按钮——
  //   该钩子自 PendingActionBanner 移植：blocking 材料行翻面后不再在那边渲染，
  //   钩子必须跟着限制行走，否则解冻后按钮要整页刷新才解禁）。
  const scoped = rows.filter((r) => r.scopes.includes(capability) || r.scopes.includes('ALL'));
  useEffect(() => {
    const has = scoped.length > 0;
    if (hadScopedRef.current && !has) void refreshProfile?.();
    hadScopedRef.current = has;
  }, [scoped.length]);
  if (!scoped.length) return null;
  return (
    <div className="space-y-2 mb-4">
      {scoped.map((row) => (
        <div key={row.restrictionNo} className="border-l-4 border-l-fx-rust bg-fx-rust/[0.04] px-4 py-3 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <AlertCircle size={14} className="shrink-0 mt-[1px] text-fx-rust" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-rust mb-1">{row.label}</div>
              <p className="font-sans text-[12px] text-fx-dune leading-snug break-words">{row.reason}</p>
              <div className="mt-1 font-mono text-[10px] text-fx-dust tabular-nums">{row.scopes.join(' · ')}</div>
              {supplement && <p className="mt-1 font-sans text-[11px] text-fx-dust leading-snug">{supplement}</p>}
            </div>
          </div>
          {/* 合并形态（业主 2026-09-12 定案）：绑了材料的条子在这儿出、按钮借材料的；
              已提交改说审核中；没绑材料的按定义无自助动作，维持 Contact support。 */}
          {row.claimedByMaterialRequestNo ? (
            row.claimedMaterialStatus === 'SUBMITTED' ? (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-dust">Submitted · under review</span>
            ) : (
              <button
                onClick={() => navigate(`/verification/${row.claimedByMaterialRequestNo}?from=${encodeURIComponent(location.pathname)}`)}
                className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
              >
                Submit material
              </button>
            )
          ) : (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-dust">Contact support</span>
          )}
        </div>
      ))}
    </div>
  );
}
```
（保留 fetch-on-mount + visibilitychange 与「宁可少显示不可多显示」错误处理；**保留**「本组件只渲染后端给的行、禁止本地推导 tipping-off 判定」的文件头戒律段，只改与翻面矛盾的两段。）

- [ ] **Step 2: PendingActionBanner 改造** — 加必填 `domain: 'DEPOSIT' | 'WITHDRAW'` prop；过滤改：

```tsx
      // 波三G（业主矩阵，推翻 2026-08-18 G6 两点）：本组件只剩「没绑条子 + 绑本域
      // 订单」的材料行——绑条子的已并进 RestrictionBanner 的条子形态；单独材料
      // （无单无条子）收拢到 Overview/Profile（ProfileBannerStack）。
      const visible = Array.isArray(data)
        ? data.filter((r) => !r.blocking && r.orderDomain === domain)
        : [];
```
（`hadBlockingRef`/refreshProfile 段随之删除——已移植进 RestrictionBanner；头注释同步改写。）

- [ ] **Step 3: 四个页面挂载**（顺序统一：条子在上、材料在下——受限是因、材料是解法）：
  - `Deposit.tsx`：header 块（`:771`）与 Main Card（`:773`）之间插：

```tsx
      <RestrictionBanner
        capability="DEPOSIT"
        supplement="Funds you send will still arrive. Once received, this deposit will be held under the restriction and processed after it is lifted."
      />
      <PendingActionBanner domain="DEPOSIT" />
```
（补 import；supplement 措辞即 decisions 2026-09-09 口径——不说「动作被禁」，不置灰任何按钮。）
  - `Withdraw.tsx:470-471` → `<RestrictionBanner capability="WITHDRAW" />` 与 `<PendingActionBanner domain="WITHDRAW" />`（顺序对调）。
  - `Swap.tsx:589-590` → 只留 `<RestrictionBanner capability="SWAP" />`，删 PendingActionBanner 挂载与 import（兑换订单材料的客户端唯一入口 = Overview/Profile，业主确认）。
  - `DashboardOverview.tsx`：`:17` import 与 `:148` 挂载改 `ProfileBannerStack`（Overview 与 Profile 统一为合成栈，单独材料从此在 Overview 可见——矩阵规则 2）。
  - `CustomerProfile.tsx:211-216` 注释改写（引用波三矩阵而非 G6）。
- [ ] **Step 4: 闸③ + vitest** — client tsc + `npm run test:client`（若有横幅相关既有断言随行为更新）。
- [ ] **Step 5: 渲染验证（⑤闸，本任务专项截图）** — worktree 栈起，quick-login 种子客户：
  - Ivy（DISCLOSED 条子 + 材料主线）：充值页横幅（含补充行）、命中域页 vs 未命中域页（按 Ivy 条子 scopes 验证按域过滤）、Overview 合成栈、Profile 同款——落 `.superpowers/sdd/shots/wave3-g-banner-*.png`
  - Frank（SANCTION=SILENT）：充值/提现/兑换/Overview 四页**零横幅、与普通客户逐字相同**（tipping-off 反证）——`wave3-g-tippingoff-frank-*.png`
- [ ] **Step 6: Commit** — `git commit -m "feat(波三G): 横幅矩阵落地——三页按域过滤/充值页新挂含口径补充行/兑换页撤材料横幅/Overview换合成栈/refreshProfile钩子随限制行迁移"`

---

### Task 12: 顺手项三件（波二承接）

**Files:**
- Modify: `src/modules/trading/pricing-center/pricing-engine.service.ts:43-56,273-301`、`src/modules/trading/pricing-center/types/pricing.types.ts:132-149`
- Modify: `admin-web/src/pages/SwapQuoteDetail.tsx:72-77,288-291`
- Modify: `doc-final/BACKLOG.md`（头部计数）

- [ ] **Step 1: 删死码** — `buildWithdrawalQuote` 方法 + 私有 `WithdrawalQuoteBuildInput` + `pricing.types.ts` 的 `WithdrawalPricingResult`（三者全仓引用已复现仅定义处；删前重跑复现命令 `grep -rn "buildWithdrawalQuote\|WithdrawalQuoteBuildInput\|WithdrawalPricingResult" src --include="*.ts"` 确认；`CalculatedFeeLine` 有其他消费者，**保留**）。闸①。
- [ ] **Step 2: SWP 链接** — SwapQuoteDetail 接口 `swapTransaction` 加 `id: string;`（后端 include 全行、运行时已带）；`:288-291` 单元格照 WithdrawQuoteDetail `:256-261` 模板：

```tsx
                    <td className="px-3 py-2 font-mono text-[11px] text-adm-t2">
                      {linkedSwap.swapNo ? (
                        <Link to={`/admin/trading/swaps/${linkedSwap.id}`} className="text-adm-blue hover:underline">
                          {linkedSwap.swapNo}
                        </Link>
                      ) : ('—')}
                    </td>
```
（补 `import { Link } from 'react-router-dom';` 若缺。）闸②。
- [ ] **Step 3: BACKLOG 计数** — 数 `grep -c "^- \[ \]" doc-final/BACKLOG.md` 与头部「共 N 条」对账改齐（若头部行含 ⭐ 计数口径，按其口径重数）。
- [ ] **Step 4: Commit** — `git commit -m "chore(波三顺手): buildWithdrawalQuote死码删除 + 兑换报价详情SWP号成链 + BACKLOG头部计数对账"`

---

### Task 13: 文档收口 + BACKLOG 销账

**Files:** `doc-final/modules/`（v4/v5/v6 + 审计相关篇，按 `modules/overview.md` 索引定位）、`doc-final/decisions.md`、`doc-final/BACKLOG.md`、`doc-final/demo/script.md`、`doc-final/demo/data.md`（如横幅涉及演示步骤）

- [ ] **Step 1: decisions.md 三条**（2026-09-12）：①横幅五规则矩阵 + 合并形态翻面（含推翻 2026-08-18 G6 两点，兑换订单详情页不展示）②E1 兑换冻人处置定案 = 原地冻（继续/退回两案否决及理由；Resume 门控落后端入口，2026-08-22「不给前端按钮」裁定维持）③审计页实体跳转甲案（映射缺席留纯文本纪律）。
- [ ] **Step 2: modules 同步** — v4：冻结留痕五连缺已修（evaluateL1 分支补审计）+ 充值页横幅；v5：tipping-off 三防线已建（白名单/customerScope/bucket，§4.6 镜像达成）；v6：E1 标识与 Resume 门控、operator 语义标签、SLA 重提推窗；审计篇：实体跳转 + entityType 幽灵字段清除。对照各篇现有行文只改涉及节，全文扫计数类断言（判例：文档同步要全文扫计数）。
- [ ] **Step 3: BACKLOG 销账** — §D：冻结留痕族五条、三弧 kind、审批深链、充值横幅；§E：E1 分旗、operator 'SYSTEM'、resubmit 宽限；§F：⭐ tipping-off（Q1 订单级折叠**不销**，波五）；§I：keyword 死参数。每条移入「本轮销账（2026-09-12 波三红项修复）」节，一行注明修法落点。
- [ ] **Step 4: demo 两文件** — script.md：第三幕充值页补「受限客户看到横幅（不拦动作）」步骤、第七幕拉链步骤补「按 #7/#10 单号查 DEPOSIT_FROZEN + 点单号跳回单据」；data.md：Ivy/Frank 在横幅矩阵下的预期可见面。
- [ ] **Step 5: 交付备注（不修只记）** — swap-workflow 的 CustomerAccessService 双重注入（`:176`/`:189` 同服务两参数名）系既有技术债，本波未动——在收尾报告向业主提一句，不进 BACKLOG（纯代码整洁项）。
- [ ] **Step 6: Commit** — `git commit -m "docs(波三): modules四篇+decisions三定案+BACKLOG销账12条+demo剧本横幅与拉链步骤"`

---

### Task 14: 收尾闸（主会话执行，不派子代理）

- [ ] **Step 1: 三闸 tsc** 全绿（后端/admin/client）；`npx jest src/modules/trading src/modules/swap-sumsub src/modules/identity src/modules/audit-logging --silent` 全绿；`npm run test:client` 全绿。
- [ ] **Step 2: 重铺 + demo:all** — `bash scripts/stack.sh reset self && bash scripts/on-stack.sh self demo:all`，花名册 29/29 全绿 + **后端日志零 `Failed to write DEPOSIT_FROZEN audit`**（A 族修复的直接判据）。判红 → 悬案纪律：先取证再 reset。
- [ ] **Step 3: verify:coa** — `bash scripts/on-stack.sh self verify:coa` 恒等式全绿。
- [ ] **Step 4: 第七幕拉链实证（岔口④定案：拉链到底）** — 管理台审计页按 #7（DEP…广播冻结）与 #10（DEP…L1 直判，statusHistory 有 `COMPLIANCE_PENDING→FROZEN`）单号实查：`DEPOSIT_FROZEN` 在链上、与该单其余事件同旅程号；顺手点单号链接跳回充值列表预填（F+I2 咬合验证）。截图 `wave3-final-chain-*.png`。**查不到即不过。**
- [ ] **Step 5: 走查截图收官** — #13 FRANK 兑换单：列表 CUSTOMER_FROZEN 徽章 + 详情提示条；#10 SEIZED 详情 Linked Funds Orders 三弧文案；审批卡深链点进审批详情；横幅矩阵组图（Task 11 已拍，复核归档）；tipping-off 反证组图。全部落 `.superpowers/sdd/shots/`。
- [ ] **Step 6: 终审** — 派终审评审（省略 model 走 Fable 继承），逐条问「spec 每条承诺的代码在哪」（判例：承诺没代码不产生 diff）。
- [ ] **Step 7: 合并** — superpowers:finishing-a-development-branch；合并后主树：重启后端 + `npm run db:base:sync`（无新 RBAC 端点，但按 §10 规矩执行）；无 schema 变更，主栈不强制 reset；CHANGELOG 一行。
