# 平账二期 · 内部划转单（认损补款 / 退汇垫款）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地平账二期 spec（`doc-final/superpowers/specs/2026-09-03-internal-transfer-order-design.md`）：第四类订单「内部划转单」只做公司 → 客户两条路（认损补款 / 退汇垫款），法币两腿经结算户、加密币一腿，模拟托管方回单，客户池核销解锁为「认损」，成因表退一条，演示场景 16/17，搭车修开户登记补零与注资流水。

**Architecture:** 新主体 `InternalTransfer` 落 `src/modules/asset-treasury/internal-transfers/`（实体服务：迁移表 / 建行 / 读投影 / 运营户余额闸；工作流：审批接线、腿事件、分录；审批 handler；控制器）。对账域出两样东西：「模拟托管方回单」写入口（腿提交时写外部账单行）与案件读面回挂（`COMPENSATION` / `ADVANCE` 两种 nextStep + 划转状态）。调账域放开客户池认损（新成因码 `UNEXPLAINED_CLIENT_LOSS`，只许 REDUCE）。资金单加第四种父键。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle ｜ React（admin-web / client-web）｜ jest（单测 + e2e）｜ vitest（client-web）｜ ts-node 脚本

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - 全部工作在 worktree `.claude/worktrees/recon-wave2`（分支 `recon-wave2`）里做，用 **self 栈**：`bash scripts/stack.sh up`；需要库的脚本一律 `bash scripts/on-stack.sh self <script>`；**绝不碰 main 栈**
  - 本机 shell 默认 node18，每条 npm / npx / ts-node 命令前先 `export PATH="$(ls -d "$HOME/.nvm/versions/node/v20"*/bin | tail -1):$PATH"`；管道尾不接 `tail`（会吞退出码）
  - 账簿判断一律 `=== 'FIRM'`（`reconciliation_cases.book` 真值是 `'CUSTOMER'`，B 批承接 Task 4）；`reconciliation_adjustments.book` 存 `'CLIENT' | 'FIRM'`，两张表口径不同，不要混
  - 新审计码四属性出生即冻结、每条 `recordByActor` / `recordSystem` 带显式 `requestId`；对外识别一律业务键（`transferNo` / `caseNo` / `adjustmentNo` / `customerNo` / `walletNo` / `fundsOrderNo`），HTTP 响应、审批 `objectSnapshot`、审计主对象不得出现 UUID
  - 动钱一律 `AccountingService.executeTransfer` 同步直调；不新增科目；转账码只用 81 / 82 / 83；`assetCurrency` 传 `asset.currency`（不是 `asset.code`）；`ledger` 按 `TB_LEDGERS[asset.currency]`
  - 新 e2e 用**测试自建的独立客户**（承接记录点名），不碰 Bob / Alice / Grace 的余额
  - 不做：幂等 / 重试 / 补偿 / 并发锁 / 通知 / F_LIQ 退役 / 公司池调拨 / 手续费归集 / 法币腿 2 失败后的自动退回 / 追索
  - 每个任务收尾按下方「本任务过哪几条」逐条对照交付清单；随手闸三处 tsc 每个任务都跑：
    ```bash
    npx tsc --noEmit -p tsconfig.json
    cd admin-web && npx tsc -b --noEmit && cd ..
    cd client-web && npx tsc -b --noEmit && cd ..
    ```
  - 提交信息不带任何署名 / attribution 行

---

## 任务总览与顺序

| # | 任务 | 交付物 |
|---|---|---|
| 1 | 搭车①：开户登记账户号补零 | `bigintToRegistryHex` + 单测；e2e 夹具规避删除 |
| 2 | 地基一：迁移 + 资金单第四父键 | `internal_transfers` 表、`funds_orders.internalTransferId`、`FundsOrderService` 四处 |
| 3 | 地基二：名册登记 | 转账码 81–83、审批类型 + 策略、审计七码（新域 TREASURY）、权限组四处 + 五条路由 + 两桶、verify-rbac 表、前端权限码镜像 |
| 4 | 客户池认损解锁 + 成因表 21→20 | `UNEXPLAINED_CLIENT_LOSS`、四锁改口、读面 nextStep、`FIRM_TRANSFER_UNTRACKED` 退役、手册 |
| 5 | 划转单主体 | dto / 迁移表 / `InternalTransferService` + 单测 |
| 6 | 模拟托管方回单 | `SimulatedCustodianStatementService` + 单测 |
| 7 | 划转工作流 + 审批 handler + 模块 | `InternalTransferWorkflowService` / `InternalTransferApprovalService` / `InternalTransfersModule` + 单测 |
| 8 | 控制器 + 案件读面回挂 | 五端点、S7 白名单清空、`COMPENSATION` / `ADVANCE`、列表徽标、退汇守卫文案 |
| 9 | e2e 全链 | `test/recon-internal-transfer.e2e-spec.ts` |
| 10 | 搭车②：注资写进流水凭证 | `seed.business.ts` |
| 11 | 演示脚本：场景 16 / 17 + 铺场闸 | `scripts/recon-demo.ts` + `demo/*` 三篇 |
| 12 | 管理台：案件页 + 列表徽标 + 发起弹层 | 截图四张 |
| 13 | 管理台：划转单列表 / 详情 + 路由 + 侧栏 + 审批回链 + 资金单筛选 | 截图三张 |
| 14 | 客户端：对账单行文案 | 截图一张 + vitest |
| 15 | 文档收口 | `v7-treasury.md` 新篇 + 各篇 + decisions/CHANGELOG/BACKLOG + 三期承接 |
| 16 | 收尾闸 + 合并准备 | 全部闸门 + 第六幕 16/17 走查 |

依赖：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16（严格串行；11 之前要先 10，因为 11 要重铺）。

---

### Task 1: 搭车①——开户登记账户号补零（写侧根治）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/utils/tb-id.util.ts`
- Modify: `src/modules/accounting/tigerbeetle/accounting.service.ts:63`
- Modify: `src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts`
- Modify: `test/recon-supplement.e2e-spec.ts:570-596`（删夹具里的补零规避循环）

**Interfaces:**
- Produces: `bigintToRegistryHex(value: bigint): string`（32 位补零十六进制，`tb_account_registry.tbAccountId` 唯一写法）

- [ ] **Step 1: 写失败的单测**

在 `src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts` 末尾追加：

```ts
import { bigintToRegistryHex, hexToBigint } from './tb-id.util';

describe('bigintToRegistryHex —— 注册表账户号恒 32 位（平账二期搭车①）', () => {
  it('十六进制首位为 0 的 u128 也补到 32 位，且数值不变', () => {
    const id = BigInt('0x0abc0000000000000000000000000001'); // 首位 0 → 裸 toString(16) 只有 31 位
    const hex = bigintToRegistryHex(id);
    expect(hex).toHaveLength(32);
    expect(hex.startsWith('0')).toBe(true);
    expect(hexToBigint(hex)).toBe(id);
  });
  it('已是 32 位的不动', () => {
    const id = BigInt('0xfabc0000000000000000000000000001');
    expect(bigintToRegistryHex(id)).toBe(id.toString(16));
  });
});
```

- [ ] **Step 2: 跑单测确认红**

Run: `npx jest src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts`
Expected: FAIL —— `bigintToRegistryHex is not a function`

- [ ] **Step 3: 实现**

`tb-id.util.ts` 在 `bigintToHex` 之后加：

```ts
/**
 * 注册表专用：`tb_account_registry.tbAccountId` 一律 32 位补零十六进制。
 * 种子路径（prisma/seed-tb.helper.ts）用 SHA256 取前 32 位天然定长；动态开户
 * （AccountingService.createAccounts）此前用裸 bigintToHex，u128 首位为 0 时只有
 * 31 位，对账引擎按 32 位 join 落空、该账户流水静默消失（BACKLOG 2026-09-04 条）。
 * 一处改完整类问题连根拔；读侧 padTbId 补丁保留不动。
 */
export function bigintToRegistryHex(value: bigint): string {
  return bigintToHex(value).padStart(32, '0');
}
```

`accounting.service.ts` 第 7 行 import 加 `bigintToRegistryHex`；第 63 行 `tbAccountId: bigintToHex(accountId),` 改为 `tbAccountId: bigintToRegistryHex(accountId),`。

- [ ] **Step 4: 删 e2e 夹具里的规避**

`test/recon-supplement.e2e-spec.ts` 的 `provisionCustomerTbAccounts()`：删掉 `const registered = await ...` 起到循环结束的 6 行（`registered` / `for (const row of registered)` / `if (String(row.tbAccountId).length < 32)` / `update` 那段），并把该函数 JSDoc 里「Task 12 收口轮当场复现的一处真实缺口……」整段注释改成一句：`// 注册表账户号补零已在 AccountingService.createAccounts 写侧根治（平账二期 Task 1），夹具不再规避。`

- [ ] **Step 5: 跑单测确认绿 + tsc**

Run: `npx jest src/modules/accounting/tigerbeetle` → PASS；`npx tsc --noEmit -p tsconfig.json` → 0 错

- [ ] **Step 6: Commit**

```bash
git add src/modules/accounting/tigerbeetle/utils/tb-id.util.ts src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts src/modules/accounting/tigerbeetle/accounting.service.ts test/recon-supplement.e2e-spec.ts
git commit -m "fix(accounting): 开户登记账户号写侧补零到 32 位——对账引擎 join 不再随机落空；e2e 夹具规避删除（平账二期 Task 1）"
```

本任务过哪几条：无持久状态新码；改了后端 → tsc ①。

---

### Task 2: 地基一——迁移 + 资金单第四父键

**Files:**
- Modify: `prisma/schema.prisma`（新 model `InternalTransfer`；`FundsOrder` + `internalTransferId`；`Asset` 加反向关系）
- Create: `prisma/migrations/<timestamp>_recon_w2_internal_transfers/migration.sql`（由 prisma 生成）
- Modify: `src/modules/funds-orders/dto/funds-order.dto.ts`
- Modify: `src/modules/funds-orders/funds-order.service.ts`（`parentOf` / `directionOf` / `create` / `findByParent` / `parentFkWhere` / `findAllForAdmin` / `findOneByNoForAdmin`）
- Modify: `src/modules/funds-orders/dto/funds-orders-admin-query.dto.ts`
- Modify: `src/common/events/domain-events.constants.ts`
- Create: `src/modules/funds-orders/funds-order.internal-transfer-parent.spec.ts`

**Interfaces:**
- Produces: `CreateFundsOrderInput.internalTransferId?: string`；`FundsOrderService.findByParent({ internalTransferId })`；`directionOf` 对 `internalTransferId` 返回 `'INTERNAL'`（走出金那套走法表）；admin 列表 `parent: 'internal-transfer'`，行上 `transferNo`

- [ ] **Step 1: schema**

`prisma/schema.prisma` 在 `model FundsOrder` 之前加：

```prisma
// 平账二期（2026-09-05）：第四类订单——公司 → 客户的补款 / 垫款。
// 订单层金额按三域惯例存元；账本分录与外部账单最小单位。
model InternalTransfer {
  id                   String    @id @default(uuid())
  transferNo           String    @unique
  purpose              String    // CLIENT_COMPENSATION | CLIENT_ADVANCE
  assetId              String
  amount               Decimal   // 元
  fromWalletId         String    // 运营户 F_OPS 在该网络的地址行
  viaWalletId          String?   // 法币：结算户 F_SET 行；加密币 null
  toWalletId           String    // 客户在该网络的收款行 = 案子的钱包
  customerId           String
  customerNo           String
  status               String    @default("PENDING_APPROVAL") // PENDING_APPROVAL | EXECUTING | SUCCESS | FAILED | REJECTED | CANCELLED
  reason               String
  sourceCaseNo         String
  sourceAdjustmentNo   String?   // 补款：认损调账单号
  sourceExternalLineId String?   // 垫款：被退汇的那条账单行（内部 id，任何界面不得展示）
  approvalNo           String?
  failureReasonCode    String?   // INSUFFICIENT_FIRM_BALANCE | LEG_FAILED | POSTING_FAILED
  failureNote          String?
  executedAt           DateTime?
  settledAt            DateTime?
  traceId              String
  createdByUserId      String
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  asset       Asset        @relation(fields: [assetId], references: [id])
  fundsOrders FundsOrder[] @relation("InternalTransferFundsOrders")

  @@index([status])
  @@index([sourceCaseNo])
  @@index([sourceAdjustmentNo])
  @@index([sourceExternalLineId])
  @@map("internal_transfers")
}
```

`model FundsOrder`：在 `withdrawTransactionId String?` 后加 `internalTransferId    String?`；在 `withdrawTransaction   WithdrawTransaction? ...` 后加 `internalTransfer      InternalTransfer?      @relation("InternalTransferFundsOrders", fields: [internalTransferId], references: [id], onDelete: Cascade)`；`@@unique([swapTransactionId, legSeq, attempt])` 后加 `@@unique([internalTransferId, legSeq, attempt])` 与 `@@index([internalTransferId])`。

`model Asset` 关系区加一行 `internalTransfers InternalTransfer[]`。

- [ ] **Step 2: 生成迁移并 generate**

先确认 worktree 的栈已起（`.env` 里有本树的 `DATABASE_URL`）：`bash scripts/stack.sh up`。然后：

```bash
npx prisma migrate dev --create-only --name recon_w2_internal_transfers
npx prisma generate
```

打开生成的 `prisma/migrations/*_recon_w2_internal_transfers/migration.sql` 核对：含 `CREATE TABLE "internal_transfers"`、`funds_orders` 的 `internalTransferId` 列（SQLite 加带外键的列会走 RedefineTables 重建 `funds_orders`，属正常）、两个唯一索引。不写任何 backfill。再 `npx prisma migrate deploy` 让本树库跟上。

- [ ] **Step 3: 写失败的单测**

新建 `src/modules/funds-orders/funds-order.internal-transfer-parent.spec.ts`：

```ts
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FundsOrderService } from './funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from './dto/funds-order.dto';

/** 平账二期 Task 2：资金单第四种父键 internalTransferId。
 *  最小假 prisma：只实现 create() / advance() 真正碰到的两个委托。 */
function makePrisma(assetType: 'FIAT' | 'CRYPTO') {
  const rows = new Map<string, any>();
  return {
    rows,
    asset: { findUnique: jest.fn(async () => ({ id: 'asset-1', type: assetType })) },
    fundsOrder: {
      create: jest.fn(async ({ data }: any) => { const row = { id: `fo-${rows.size + 1}`, ...data }; rows.set(row.id, row); return row; }),
      findUnique: jest.fn(async ({ where }: any) => { const row = rows.get(where.id); return row ? { ...row, asset: { type: assetType } } : null; }),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row; }),
    },
    $transaction: async (fn: any) => fn(this),
  } as any;
}

describe('FundsOrderService —— 内部划转单父键（平账二期 Task 2）', () => {
  it('create 接受 internalTransferId 作为唯一父键，并把它带进事件的 parent', async () => {
    const prisma = makePrisma('FIAT');
    const emitter = new EventEmitter2();
    const events: any[] = [];
    emitter.on('funds_order.status.changed', (e) => events.push(e));
    const svc = new FundsOrderService(prisma, emitter);
    const row = await svc.create({ internalTransferId: 'itr-1', assetId: 'asset-1', amount: '900', fromWalletId: 'w-ops', toWalletId: 'w-set' });
    expect(row.internalTransferId).toBe('itr-1');
    expect(row.status).toBe(FundsOrderStatus.CREATED);
    expect(events[0].parent).toEqual({ depositTransactionId: undefined, withdrawTransactionId: undefined, swapTransactionId: undefined, internalTransferId: 'itr-1' });
  });

  it('两个父键同时给 → 400（恰好一个）', async () => {
    const svc = new FundsOrderService(makePrisma('FIAT'), new EventEmitter2());
    await expect(svc.create({ internalTransferId: 'itr-1', depositTransactionId: 'dep-1', assetId: 'asset-1', amount: '1' } as any)).rejects.toThrow(/exactly one parent/);
  });

  it('内部划转腿走出金那套走法表：法币 CREATED --SUBMIT--> SUBMITTED --CONFIRM--> CONFIRMED', async () => {
    const prisma = makePrisma('FIAT');
    prisma.$transaction = async (fn: any) => fn(prisma);
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const row = await svc.create({ internalTransferId: 'itr-1', assetId: 'asset-1', amount: '900' });
    expect((await svc.advance(row.id, FundsOrderAction.SUBMIT, 'E2E')).status).toBe(FundsOrderStatus.SUBMITTED);
    expect((await svc.advance(row.id, FundsOrderAction.CONFIRM, 'E2E')).status).toBe(FundsOrderStatus.CONFIRMED);
  });

  it('findByParent 按 internalTransferId 过滤', async () => {
    const prisma = makePrisma('FIAT');
    prisma.fundsOrder.findMany = jest.fn(async ({ where }: any) => [{ where }]);
    const svc = new FundsOrderService(prisma, new EventEmitter2());
    const [r] = await svc.findByParent({ internalTransferId: 'itr-9' }, { legSeq: 2 });
    expect(r.where).toEqual({ internalTransferId: 'itr-9', legSeq: 2 });
  });
});
```

- [ ] **Step 4: 跑单测确认红**

Run: `npx jest src/modules/funds-orders/funds-order.internal-transfer-parent.spec.ts`
Expected: FAIL（`exactly one parent FK (deposit/withdraw/swap)` 把 internalTransferId 当没给；事件 parent 缺键）

- [ ] **Step 5: 实现**

`dto/funds-order.dto.ts` 的 `CreateFundsOrderInput`：注释「三者恰好一个非空」改「四者恰好一个非空」，加 `internalTransferId?: string;`。

`funds-order.service.ts`：

```ts
  private parentOf(row: { depositTransactionId?: string | null; withdrawTransactionId?: string | null; swapTransactionId?: string | null; internalTransferId?: string | null }) {
    return {
      depositTransactionId: row.depositTransactionId ?? undefined,
      withdrawTransactionId: row.withdrawTransactionId ?? undefined,
      swapTransactionId: row.swapTransactionId ?? undefined,
      internalTransferId: row.internalTransferId ?? undefined,
    };
  }

  private directionOf(row: { depositTransactionId?: string | null; withdrawTransactionId?: string | null; swapTransactionId?: string | null; internalTransferId?: string | null; legSeq?: number | null }): FundsOrderDirection {
    if (row.depositTransactionId) return (row.legSeq ?? 1) > 1 ? 'INTERNAL' : 'IN';
    if (row.withdrawTransactionId) return 'OUT';
    // 平账二期：内部划转腿（公司 → 客户）从 CREATED 出生，沿出金那套走法表走全程
    //（getTransitionMap 对非 IN 方向一律落 OUT 表，crypto 5 跳 / fiat 4 跳）。
    if (row.internalTransferId) return 'INTERNAL';
    return 'INTERNAL'; // swap
  }
```

`create()`：`const fks = [input.depositTransactionId, input.withdrawTransactionId, input.swapTransactionId, input.internalTransferId].filter(Boolean);`，报错文案改 `'FundsOrder requires exactly one parent FK (deposit/withdraw/swap/internal-transfer)'`，`data` 里 `swapTransactionId: ...` 后加 `internalTransferId: input.internalTransferId ?? null,`。

`findByParent()`：参数类型加 `internalTransferId?: string`，where 里加 `...(parent.internalTransferId && { internalTransferId: parent.internalTransferId }),`。

`parentFkWhere()` 与 `findAllForAdmin()` 的 `parent` 类型都加 `'internal-transfer'`，switch 加 `case 'internal-transfer': return { internalTransferId: { not: null } };`；`findAllForAdmin` 的 include 加 `internalTransfer: { select: { transferNo: true } }`，`items` 映射加 `transferNo: row.internalTransfer?.transferNo ?? null,`；`findOneByNoForAdmin` 的 include 加 `internalTransfer: { select: { id: true, transferNo: true, status: true } }`。

`dto/funds-orders-admin-query.dto.ts`：enum 与 `@IsIn` 数组加 `'internal-transfer'`，类型联合加 `| 'internal-transfer'`。

`src/common/events/domain-events.constants.ts` 的 `FUNDS_ORDER_STATUS_CHANGED`：`subscribers` 加 `'InternalTransferWorkflowService'`，payload 字符串里 `parent: {depositTransactionId?, withdrawTransactionId?, swapTransactionId?, internalTransferId?}`。

- [ ] **Step 6: 跑单测确认绿 + 全目录 + tsc**

Run: `npx jest src/modules/funds-orders` → 全绿；`npx tsc --noEmit -p tsconfig.json` → 0 错

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/funds-orders src/common/events/domain-events.constants.ts
git commit -m "feat(funds-orders): 内部划转单表 + 资金单第四父键 internalTransferId（沿出金走法表）；admin 列表父单筛选加 internal-transfer（平账二期 Task 2）"
```

本任务过哪几条：改 schema（一个迁移、无 backfill）；新事件（无新事件，只扩负载并登记订阅方）；改了后端 → tsc ①。

---

### Task 3: 地基二——名册登记（转账码 / 审批 / 审计 / 权限）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts`
- Create: `src/modules/audit-logging/constants/internal-transfer-audit-codes.spec.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `scripts/verify-rbac.ts`
- Modify: `admin-web/src/rbac/permissions.ts`

**Interfaces:**
- Produces: `TB_TRANSFER_CODES.INTERNAL_TRANSFER_OPS_TO_SET = 81` / `INTERNAL_TRANSFER_FIRM_OUT = 82` / `INTERNAL_TRANSFER_CLIENT_IN = 83`；`ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL`（CFO 单步 48h 可撤）；`AuditActions.INTERNAL_TRANSFER_REQUESTED | _CANCELLED | _REJECTED | _EXECUTION_STARTED | _LEG_POSTED | _SETTLED | _FAILED`（域 `TREASURY`，名册 `V7_TREASURY_AUDIT_ACTIONS`）；权限组 `INTERNAL_TRANSFER_READ` / `INTERNAL_TRANSFER_WRITE`；前端码 `PERMISSIONS.INTERNAL_TRANSFERS_READ` / `INTERNAL_TRANSFER_DETAIL_READ` / `INTERNAL_TRANSFER_COMPENSATION_WRITE` / `INTERNAL_TRANSFER_ADVANCE_WRITE` / `INTERNAL_TRANSFER_CANCEL`

- [ ] **Step 1: 写失败的单测（审计七码四属性）**

新建 `src/modules/audit-logging/constants/internal-transfer-audit-codes.spec.ts`：

```ts
import { AuditActions, V7_TREASURY_AUDIT_ACTIONS, CONTRACT_ACTION_DOMAINS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

const N = AuditCorrelationMode.NONE;
const I = AuditCorrelationMode.INHERIT;

describe('平账二期 · 内部划转单审计七码（spec §10）', () => {
  it('七码全在 V7 财资名册，域 TREASURY 已入合同', () => {
    expect(CONTRACT_ACTION_DOMAINS).toContain('TREASURY');
    expect(Object.keys(V7_TREASURY_AUDIT_ACTIONS).sort()).toEqual([
      'INTERNAL_TRANSFER_CANCELLED', 'INTERNAL_TRANSFER_EXECUTION_STARTED', 'INTERNAL_TRANSFER_FAILED',
      'INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_REJECTED', 'INTERNAL_TRANSFER_REQUESTED', 'INTERNAL_TRANSFER_SETTLED',
    ]);
    for (const k of Object.keys(V7_TREASURY_AUDIT_ACTIONS)) expect((AuditActions as any)[k]).toBe(k);
  });
  it('四属性冻结：提交起旅程 NONE，其余继承；批准 / 拒绝带审批因果', () => {
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_REQUESTED).toEqual({ domain: 'TREASURY', correlationMode: N, requiredFields: ['amount', 'reason'], requiresCausation: false });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_CANCELLED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_REJECTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_EXECUTION_STARTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_LEG_POSTED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['amount'], requiresCausation: false });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_SETTLED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['amount', 'effectiveDate'], requiresCausation: false });
    expect(V7_TREASURY_AUDIT_ACTIONS.INTERNAL_TRANSFER_FAILED).toEqual({ domain: 'TREASURY', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false });
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `npx jest src/modules/audit-logging/constants/internal-transfer-audit-codes.spec.ts` → FAIL（`V7_TREASURY_AUDIT_ACTIONS` 不存在）

- [ ] **Step 3: 转账码**

`tb-transfer-codes.constant.ts` 在 `RECON_ADJUSTMENT: 80,` 之后加：

```ts
  // ── 平账·划转(81–83)（二期，2026-09-05）：内部划转单（公司 → 客户）三种腿分录。
  // 形状与兑换买入腿同源（32 OPS_TO_SET / 33 SET_TO_ASSET / 34 BUY_CLIENT），父单换成划转单：
  //   法币腿 1：运营户 → 结算户；法币腿 2 / 加密币腿 1：公司放出 + 客户收到（一步两笔，任一失败整步失败）。
  INTERNAL_TRANSFER_OPS_TO_SET: 81, // DR FIRM_OPS / CR FIRM_SET（法币腿 1）
  INTERNAL_TRANSFER_FIRM_OUT: 82,   // DR FIRM_SET(法币腿 2) 或 FIRM_OPS(加密币腿 1) / CR FIRM_ASSET
  INTERNAL_TRANSFER_CLIENT_IN: 83,  // DR CLIENT_ASSET / CR CLIENT_PAYABLE(客户)
```

- [ ] **Step 4: 审批类型 + 策略**

`approval.constants.ts`：`ApprovalActionTypes` 在 `WITHDRAW_RETURN_CLAIM` 后加

```ts
  // 平账二期（2026-09-05）：内部划转单（公司 → 客户补款 / 垫款），纯资金件 → CFO 单步；金库提、CFO 批
  INTERNAL_TRANSFER_APPROVAL: 'INTERNAL_TRANSFER_APPROVAL',
```

策略表在 `[ApprovalActionTypes.WITHDRAW_RETURN_CLAIM]: ...` 后加

```ts
  [ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL]: { steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true },
```

`V1_APPROVAL_ACTION_TYPES` 在 `ApprovalActionTypes.RECON_ADJUSTMENT_POST,` 后加 `ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL,`。

- [ ] **Step 5: 审计七码 + 新域**

`audit-actions.constant.ts`：
1. `AuditActions` 平面表在 `RECON_AGING_TIMEOUT_SIMULATED: 'RECON_AGING_TIMEOUT_SIMULATED',` 之后加：
```ts
  // ── 平账二期（2026-09-05）：内部划转单（V7 财资名册，域 TREASURY）──
  INTERNAL_TRANSFER_REQUESTED: 'INTERNAL_TRANSFER_REQUESTED',
  INTERNAL_TRANSFER_CANCELLED: 'INTERNAL_TRANSFER_CANCELLED',
  INTERNAL_TRANSFER_REJECTED: 'INTERNAL_TRANSFER_REJECTED',
  INTERNAL_TRANSFER_EXECUTION_STARTED: 'INTERNAL_TRANSFER_EXECUTION_STARTED',
  INTERNAL_TRANSFER_LEG_POSTED: 'INTERNAL_TRANSFER_LEG_POSTED',
  INTERNAL_TRANSFER_SETTLED: 'INTERNAL_TRANSFER_SETTLED',
  INTERNAL_TRANSFER_FAILED: 'INTERNAL_TRANSFER_FAILED',
```
2. `CONTRACT_ACTION_DOMAINS` 改为 `[...V1_ACTION_DOMAINS, 'DEPOSIT', 'WITHDRAW', 'SWAP', 'RECON', 'CUSTOMER', 'TREASURY'] as const`。
3. 在 `V2_CUSTOMER_AUDIT_ACTIONS` 之后加新名册：
```ts
/**
 * V7 财资名册（平账二期，2026-09-05）——内部划转单七码。主对象一律 INTERNAL_TRANSFER · transferNo，
 * 子主体：客户 OWNER、对账案 RELATED、认损调账单 RELATED（仅补款）、审批单 INSTRUMENT。
 * REQUESTED 起划转单自己的旅程（NONE），其余继承（INHERIT）；批准 / 拒绝由审批裁决驱动带因果。
 * 划转单是公司自己的钱在动，故域是 TREASURY 不是 RECON——案子只是入口，主体是财资件。
 */
export const V7_TREASURY_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  INTERNAL_TRANSFER_REQUESTED:         { domain: 'TREASURY', correlationMode: N, requiredFields: ['amount', 'reason'], requiresCausation: false },
  INTERNAL_TRANSFER_CANCELLED:         { domain: 'TREASURY', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  INTERNAL_TRANSFER_REJECTED:          { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  INTERNAL_TRANSFER_EXECUTION_STARTED: { domain: 'TREASURY', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  INTERNAL_TRANSFER_LEG_POSTED:        { domain: 'TREASURY', correlationMode: I, requiredFields: ['amount'], requiresCausation: false },
  INTERNAL_TRANSFER_SETTLED:           { domain: 'TREASURY', correlationMode: I, requiredFields: ['amount', 'effectiveDate'], requiresCausation: false },
  INTERNAL_TRANSFER_FAILED:            { domain: 'TREASURY', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },
};
```
4. 找到本文件把各名册合成机器校验总表的地方（`grep -n "V2_CUSTOMER_AUDIT_ACTIONS" src/modules/audit-logging/constants/audit-actions.constant.ts`，在 spread 合并处），把 `...V7_TREASURY_AUDIT_ACTIONS` 加进去，位置紧跟 `...V2_CUSTOMER_AUDIT_ACTIONS`。
5. `audit-vocabulary-closure.spec.ts`：import 加 `V7_TREASURY_AUDIT_ACTIONS`，`REGISTRIES` 加一行 `V7_TREASURY_AUDIT_ACTIONS,`；文件头注释与三个 `it` 名里的「六册」改「七册」。
6. `requiredFields` 只列 `AuditLogEvent` 真有的顶层列（写 plan 时已对 `prisma/schema.prisma` 核过：`amount` / `reason` / `reasonCode` / `approvalNo` / `effectiveDate` / `fromStatus` / `toStatus` 是列；`purpose` / `fundsOrderNo` / `sourceCaseNo` **不是**，它们落 metadata）——V8 名册 `RECON_ADJUSTMENT_POSTED` 的注释写明过这条规矩。

- [ ] **Step 6: 权限四处 + 五条路由 + 两桶 + S7 白名单 + verify-rbac 表**

`rbac.catalog.ts`：
1. `PermissionGroup` 联合类型在 `| 'RECON_DISPOSITION_WRITE'` 后加 `| 'INTERNAL_TRANSFER_READ'` `| 'INTERNAL_TRANSFER_WRITE'`。
2. 路由表在 `route('GET', '/admin/reconciliation/cases/:caseNo/supplement-candidates', ...)` 之后加：
```ts
  // ─── 平账二期 · 内部划转单（2026-09-05）：公司 → 客户的补款 / 垫款，入口在案子上 ───
  route('POST', '/admin/internal-transfers/compensation', 'Initiate a client compensation transfer from a posted client-loss write-off', ['INTERNAL_TRANSFER_WRITE']),
  route('POST', '/admin/internal-transfers/advance', 'Initiate a client advance transfer to cover a clawback shortfall', ['INTERNAL_TRANSFER_WRITE']),
  route('POST', '/admin/internal-transfers/:transferNo/cancel', 'Cancel a pending internal transfer (maker only)', ['INTERNAL_TRANSFER_WRITE']),
  route('GET', '/admin/internal-transfers', 'List internal transfers', ['INTERNAL_TRANSFER_READ']),
  route('GET', '/admin/internal-transfers/:transferNo', 'Get internal transfer detail', ['INTERNAL_TRANSFER_READ']),
```
3. Treasury 域桶数组在 `treasury.manage_limits` 那个对象之后加：
```ts
      {
        key: 'treasury.view_transfers',
        label: 'View internal transfers',
        description: 'Browse company → client compensation / advance transfers and their funds-order legs',
        groups: ['INTERNAL_TRANSFER_READ'],
      },
      {
        key: 'treasury.act_client_funding',
        label: 'Fund a client (compensation / advance)',
        description: 'Initiate or cancel a company → client transfer from a reconciliation case — CFO signs it off',
        groups: ['INTERNAL_TRANSFER_WRITE'],
      },
```
4. 职务持有：`SENIOR_MANAGEMENT_OFFICER` / `INTERNAL_AUDITOR` / `CFO` / `OPS_OFFICER` 四个数组各在 `'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ'...` 那一行末尾追加 `'INTERNAL_TRANSFER_READ',`；`TREASURY_OFFICER` 在 `'RECON_CASE_READ', 'RECON_ADJUSTMENT_WRITE',` 之后加一行：
```ts
    // 平账二期：补款 / 垫款开单归金库——maker（金库）≠ checker（CFO），verify:rbac S5 守着；READ 走到列表 / 详情入口。
    'INTERNAL_TRANSFER_READ', 'INTERNAL_TRANSFER_WRITE',
```
5. 文件里凡写着「12 域 54 桶 / 62 个权限组」的头注释改成「12 域 56 桶 / 64 个权限组」（`grep -n "54 桶\|62 个" src/modules/identity/access-control/rbac.catalog.ts`）。

`scripts/verify-rbac.ts`：`MAKER_GROUP_BY_POLICY` 在 `WITHDRAW_RETURN_CLAIM: 'WITHDRAW_RETURN_CLAIM_WRITE',` 后加 `INTERNAL_TRANSFER_APPROVAL: 'INTERNAL_TRANSFER_WRITE',`；`S7_PENDING_DEAD_ROWS` 改为（控制器在 Task 8 落地后清空）：
```ts
// 平账二期（2026-09-05，Task 3/8）：五条 route() 与 Task 3 一起登记、Task 8 落地控制器后清空——
// 与 B 批「暂未出生」同类，不是腐烂死行。
const S7_PENDING_DEAD_ROWS = new Set<string>([
  'api.post.admin_internal_transfers_compensation',
  'api.post.admin_internal_transfers_advance',
  'api.post.admin_internal_transfers_transferno_cancel',
  'api.get.admin_internal_transfers',
  'api.get.admin_internal_transfers_transferno',
]);
```

`admin-web/src/rbac/permissions.ts` 在 `RECON_REATTRIBUTION_CANDIDATES_READ` 之后加：
```ts
  // 平账二期（2026-09-05）：内部划转单——五个码精确镜像 rbac.catalog.ts route() 的 buildPermissionCode 派生值
  INTERNAL_TRANSFERS_READ: 'api.get.admin_internal_transfers',
  INTERNAL_TRANSFER_DETAIL_READ: 'api.get.admin_internal_transfers_transferno',
  INTERNAL_TRANSFER_COMPENSATION_WRITE: 'api.post.admin_internal_transfers_compensation',
  INTERNAL_TRANSFER_ADVANCE_WRITE: 'api.post.admin_internal_transfers_advance',
  INTERNAL_TRANSFER_CANCEL: 'api.post.admin_internal_transfers_transferno_cancel',
```

- [ ] **Step 7: 同步库 + 管理台审计域筛选**

```bash
bash scripts/on-stack.sh self db:base:sync
```
（策略 `INTERNAL_TRANSFER_APPROVAL` 由 `seedGovernanceApprovalBaseline` 从 `DEFAULT_APPROVAL_POLICIES` upsert 进库；权限字典同步。）

`grep -n "'RECON'" admin-web/src/pages/AuditLogsPage.tsx`：若审计页的域筛选是枚举出来的（有 `'RECON'` 字面量的下拉选项），加 `'TREASURY'`（标签「Treasury / 财资」）；没有则跳过。

- [ ] **Step 8: 跑测试 + 三处 tsc + verify:rbac**

```bash
npx jest src/modules/audit-logging src/modules/governance src/modules/accounting/tigerbeetle/constants
npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit)
bash scripts/on-stack.sh self verify:rbac
```
Expected：jest 全绿（含封册守则「七册」）；tsc 0 错；`verify:rbac` 全绿（S5 新策略行 maker 金库 ≠ checker CFO；S7 五行在白名单；前后端权限码双向差集为空）。verify:rbac 会写探针数据，按 `baseline.md` 的顺序它必须排在重铺之前——本任务在 worktree 的 self 库上跑，后续 Task 11 会重铺。

- [ ] **Step 9: Commit**

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants src/modules/identity/access-control/rbac.catalog.ts scripts/verify-rbac.ts admin-web/src/rbac/permissions.ts admin-web/src/pages/AuditLogsPage.tsx
git commit -m "feat(名册): 内部划转单地基——转账码 81–83、审批类型 INTERNAL_TRANSFER_APPROVAL（CFO 单步）、审计七码入 V7 财资名册（新域 TREASURY）、权限组两个四处齐 + 五条路由 + 两桶、verify-rbac 表（平账二期 Task 3）"
```

本任务过哪几条：新增审计动作码（7，四属性冻结）｜ 新增审批策略（`MAKER_GROUP_BY_POLICY` +1）｜ 新增权限组（2，四处齐）｜ 新增 admin 端点（登记 + sync；控制器 Task 8）｜ 改了后端 + 前端常量 → tsc ①②。

---

### Task 4: 客户池认损解锁 + 成因表 21 → 20

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts:510-527`
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts:184-189`
- Modify: `test/recon-aging-write-off.e2e-spec.ts:516-534`（反例③改口）
- Modify: `doc-final/reference/recon-cause-handbook.md`（删 `FIRM_TRANSFER_UNTRACKED` 节 + 版本行）

**Interfaces:**
- Produces: `ReasonCode` 新成员 `'UNEXPLAINED_CLIENT_LOSS'`（book CLIENT，只 REDUCE，family WRITE_OFF）；`resolveWriteOff(facts)` 的 `reasonCode` 按 `facts.book` 返回 `'UNEXPLAINED_WRITE_OFF' | 'UNEXPLAINED_CLIENT_LOSS'`；读面 `nextStep.kind` 联合加 `'CLIENT_SURPLUS' | 'COMPENSATION' | 'ADVANCE'`（后两种字段由 Task 8 填）；`CauseCode` 去掉 `'FIRM_TRANSFER_UNTRACKED'`，`DeferredTarget` 去掉 `'INTERNAL_TRANSFER'`

- [ ] **Step 1: 写失败的单测（成因表 + 认损判定）**

`cause-registry.spec.ts`：
- 「我有外无 × 公司」用例（第 17-21 行）的期望数组去掉 `'FIRM_TRANSFER_UNTRACKED'`，只剩 `['FIRM_MISBOOKED', 'UNEXPLAINED']`；
- 「21 码分完」用例名与断言改 20；「成因码 21 个」用例的 `toHaveLength(21)` 改 `20`；
- `resolveWriteOff` 那个 describe 里追加：
```ts
    it('客户池：成因码是 UNEXPLAINED_CLIENT_LOSS，方向仍按「让内部等于外部」', () => {
      const r = resolveWriteOff({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1, internalDirection: 'IN', deltaAmount: '-7500000' });
      expect(r).toEqual({ reasonCode: 'UNEXPLAINED_CLIENT_LOSS', family: 'WRITE_OFF', direction: 'REDUCE', amountMinor: '7500000' });
      const inc = resolveWriteOff({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN', externalAmount: '100' });
      expect(inc.reasonCode).toBe('UNEXPLAINED_CLIENT_LOSS');
      expect(inc.direction).toBe('INCREASE'); // 方向照算；「客户池不许 INCREASE」由 adjustment.service 与读面拦，不在纯函数里拦
    });
    it('公司池仍是 UNEXPLAINED_WRITE_OFF', () => {
      expect(resolveWriteOff({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM', internalDirection: 'IN', internalAmount: '7' }).reasonCode).toBe('UNEXPLAINED_WRITE_OFF');
    });
```
- 新增一条：
```ts
  it('FIRM_TRANSFER_UNTRACKED 已退役（二期不做公司池调拨，出口永远点不通）', () => {
    expect((CAUSE_REGISTRY as any).FIRM_TRANSFER_UNTRACKED).toBeUndefined();
  });
```

`adjustment.service.spec.ts` 在 `createDraft 两道闸` 那个 describe 里追加三条（沿用该 describe 已有的 mock 组装方式——`grep -n "new AdjustmentService(" src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts` 找到构造写法与 prisma mock 形状，按同款写）：
```ts
  it('客户池认损·放行：超期 + 调查中 + 小额 + REDUCE + 码 UNEXPLAINED_CLIENT_LOSS → 建单', async () => {
    const { svc, prisma } = makeSvc({
      kase: { caseNo: 'REC-C1', status: 'OPEN', book: 'CUSTOMER', assetCode: 'USDT-TRON', walletRef: 'w-1', ownerNo: 'CU-1', slaBreached: true, businessDate: '2026-09-05' },
      disposition: { dispositionNo: 'RCD-1', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null },
      asset: { currency: 'USDT', decimals: 6 },
    });
    const r = await svc.createDraft({ caseNo: 'REC-C1', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '7500000', effectiveDate: '2026-09-05', explainedFlowId: 'f-1', reasonInternal: 'x', reasonCustomer: 'x' } as any, treasury);
    expect(r.adjustmentNo).toMatch(/^ADJ/);
    expect(prisma.reconciliationAdjustment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ book: 'CLIENT', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE' }) }));
  });
  it('客户池·多出来的钱（INCREASE）→ 400 指路补录', async () => {
    const { svc } = makeSvc({ kase: { caseNo: 'REC-C2', status: 'OPEN', book: 'CUSTOMER', assetCode: 'AED', walletRef: 'w-2', ownerNo: 'CU-2', slaBreached: true, businessDate: '2026-09-05' }, disposition: { dispositionNo: 'RCD-2', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null }, asset: { currency: 'AED', decimals: 2 } });
    await expect(svc.createDraft({ caseNo: 'REC-C2', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'INCREASE', amount: '100', effectiveDate: '2026-09-05', explainedExternalLineId: 'x-1', reasonInternal: 'x', reasonCustomer: 'x' } as any, treasury)).rejects.toThrow(/补录/);
  });
  it('客户池拿公司池的码 / 公司池拿客户池的码 → 400', async () => {
    const { svc } = makeSvc({ kase: { caseNo: 'REC-C3', status: 'OPEN', book: 'CUSTOMER', assetCode: 'AED', walletRef: 'w-3', ownerNo: 'CU-3', slaBreached: true, businessDate: '2026-09-05' }, disposition: { dispositionNo: 'RCD-3', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null }, asset: { currency: 'AED', decimals: 2 } });
    await expect(svc.createDraft({ caseNo: 'REC-C3', reasonCode: 'UNEXPLAINED_WRITE_OFF', direction: 'REDUCE', amount: '100', effectiveDate: '2026-09-05', explainedFlowId: 'f-3', reasonInternal: 'x', reasonCustomer: 'x' } as any, treasury)).rejects.toThrow(/客户池查无果认损/);
  });
```
（`makeSvc` / `treasury` 若该文件没有同名工厂，就按其既有 mock 写法新建一个：prisma 需要 `reconciliationCase.findUnique`、`reconciliationDisposition.findFirst`、`asset.findUnique`、`customerMain.findUnique`（返回 `{ id: 'uuid-cu' }`）、`reconciliationAdjustment.create`（回显 data 并给 `adjustmentNo`）；`auditLogs.recordByActor` / `dispositions.linkAdjustment` 用 `jest.fn()`；`approvals` / `accounting` 传 `{}`。）

- [ ] **Step 2: 跑确认红**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition` → 新用例 FAIL（成因表仍 21、`UNEXPLAINED_CLIENT_LOSS` 未知成因码、客户池仍被「二期」拒）

- [ ] **Step 3: 成因码 + 注册表**

`adjustment-rules.ts`：`ReasonCode` 联合加 `| 'UNEXPLAINED_CLIENT_LOSS'`；`REASON_SPECS` 在 `UNEXPLAINED_WRITE_OFF` 之后加：
```ts
  // 平账二期（spec §7.1）：客户池查无果认损——托管里真少了钱，先让账跟着外面走（客户余额下降），
  // 再由公司补款划转补齐；只许 REDUCE（托管里多出来的走补录，不许核销进客户余额）。
  UNEXPLAINED_CLIENT_LOSS:    { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: '平台调整',     internalLabel: '客户池查无果认损', family: 'WRITE_OFF' },
```

`cause-registry.ts`：
- `DeferredTarget` 删 `| 'INTERNAL_TRANSFER'         // 二期内部划转` 那一行；
- `CauseCode` 联合里 `| 'FIRM_MISBOOKED' | 'FIRM_TRANSFER_UNTRACKED'` 改为 `| 'FIRM_MISBOOKED'`；
- `CAUSE_REGISTRY` 删 `FIRM_TRANSFER_UNTRACKED: {...}` 整行，并在文件头注释追加一行：`// 平账二期（2026-09-05）：退役 FIRM_TRANSFER_UNTRACKED（二期不做公司池调拨，「留档·二期内部划转」永远点不通；同格误记 → 冲销、查不出 → 挂起已分完），21 → 20。`
- `resolveWriteOff` 返回类型与三处 `reasonCode` 改为按 book 取：
```ts
export function resolveWriteOff(facts: WriteOffFacts): {
  reasonCode: 'UNEXPLAINED_WRITE_OFF' | 'UNEXPLAINED_CLIENT_LOSS'; family: 'WRITE_OFF'; direction: 'REDUCE' | 'INCREASE'; amountMinor: string;
} {
  // 平账二期：客户池另立成因码（分录同为借应付 / 贷资产池，但审批文案、客户可见标签、守卫都不同）
  const reasonCode = facts.book === 'FIRM' ? 'UNEXPLAINED_WRITE_OFF' : 'UNEXPLAINED_CLIENT_LOSS';
  const abs = (s: string | undefined) => (s ?? '0').replace(/^-/, '');
  if (facts.matchType === 'AMOUNT_MISMATCH') {
    const direction: 'REDUCE' | 'INCREASE' = signedDeltaSign(facts) === -1 ? 'REDUCE' : 'INCREASE';
    return { reasonCode, family: 'WRITE_OFF', direction, amountMinor: abs(facts.deltaAmount) };
  }
  if (facts.matchType === 'ORPHAN_INTERNAL') {
    const direction: 'REDUCE' | 'INCREASE' = facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE';
    return { reasonCode, family: 'WRITE_OFF', direction, amountMinor: abs(facts.internalAmount) };
  }
  const direction: 'REDUCE' | 'INCREASE' = facts.externalDirection === 'IN' ? 'INCREASE' : 'REDUCE';
  return { reasonCode, family: 'WRITE_OFF', direction, amountMinor: abs(facts.externalAmount) };
}
```

- [ ] **Step 4: 调账守卫与文案**

`adjustment.service.ts`：
1. `createDraft` 里 `if (dto.reasonCode === 'UNEXPLAINED_WRITE_OFF') {` 改为 `if (dto.reasonCode === 'UNEXPLAINED_WRITE_OFF' || dto.reasonCode === 'UNEXPLAINED_CLIENT_LOSS') {`。
2. `assertWriteOffAllowed` 的前提③整段（`if (book !== 'FIRM') { throw ... 二期划转 }`）替换为：
```ts
    // ③ 账簿 × 成因码配对（平账二期解锁客户池）：公司池走 UNEXPLAINED_WRITE_OFF，客户池走
    //    UNEXPLAINED_CLIENT_LOSS；客户池只许「托管里少了」（REDUCE）——多出来的钱不能核销进客户
    //    余额，那是绕充值合规闸往客户钱包塞钱，查清归属后走补录。
    const expectedReason = book === 'FIRM' ? 'UNEXPLAINED_WRITE_OFF' : 'UNEXPLAINED_CLIENT_LOSS';
    if (dto.reasonCode !== expectedReason) {
      throw new BadRequestException(book === 'FIRM'
        ? '公司池查无果走「查无果核销」（UNEXPLAINED_WRITE_OFF），不能用客户池认损码'
        : '客户池查无果走「客户池查无果认损」（UNEXPLAINED_CLIENT_LOSS），不能用公司池核销码');
    }
    if (book !== 'FIRM' && dto.direction !== 'REDUCE') {
      throw new BadRequestException('客户池多出来的钱不能核销进客户余额：查清归属后走补录（充值域），不走认损');
    }
```
   同时更新该方法 JSDoc 第③条为「账簿 × 成因码配对；客户池只许 REDUCE」。
3. `describeImpact`：在 `if (row.reasonCode === 'UNEXPLAINED_WRITE_OFF') {` 分支之前加：
```ts
    // 平账二期（spec §7.1）：客户池认损——审批人要读到「谁的钱包、少了多少、客户余额跟着降、随后公司补款」。
    if (row.reasonCode === 'UNEXPLAINED_CLIENT_LOSS') {
      const majorAmount = bigintToDecimal(BigInt(row.amount), decimals).toFixed(decimals);
      return `客户池查无果认损：客户 ${row.ownerNo ?? '(未知)'} 钱包 ${extra?.walletNo ?? '(未知)'} ${row.assetCode} 差额 ${majorAmount} 认损，客户余额相应减少；`
           + `案件 ${row.caseNo ?? '(未知)'} 已超期 ${extra?.agedDays ?? '?'} 天；查证结论：${extra?.findingNote ?? row.reasonInternal}；认损后由公司补款划转补齐`;
    }
```
4. `submit()` 里 `if (row.reasonCode === 'UNEXPLAINED_WRITE_OFF') {`（查钱包号 / 超期天数 / 查证结论那段）改为两码都进：`if (row.reasonCode === 'UNEXPLAINED_WRITE_OFF' || row.reasonCode === 'UNEXPLAINED_CLIENT_LOSS') {`。

- [ ] **Step 5: 读面 nextStep**

`dto/reconciliation.dto.ts` 的 `nextStep` 类型改为：
```ts
  nextStep?: {
    kind: 'WRITE_OFF' | 'INCIDENT_DEFERRED' | 'CLIENT_SURPLUS' | 'COMPENSATION' | 'ADVANCE';
    reasonCode?: 'UNEXPLAINED_WRITE_OFF' | 'UNEXPLAINED_CLIENT_LOSS'; direction?: 'REDUCE' | 'INCREASE';
    amount?: string;          // 最小单位整数字符串（WRITE_OFF：核销 / 认损额；COMPENSATION：补款额；ADVANCE：差额）
    effectiveDate?: string;   // = 案件业务日（WRITE_OFF）
    adjustmentNo?: string;    // COMPENSATION：来源认损单
    externalLineId?: string;  // ADVANCE：被退汇的账单行（隐藏锚，不上页面）
    customerNo?: string | null; walletNo?: string | null;
    available?: string; lineAmount?: string; // ADVANCE：客户可用 / 账单行金额（最小单位）
  };
```
（`TRANSFER_DEFERRED` 退役。）

`reconciliation-query.service.ts` 第 510-527 行的超期解锁块整段替换为：
```ts
      // 平账 A 批（spec §2.6）+ 二期（spec §7.1）：超期解锁——判据全在服务端。
      // 公司池：小额 → 核销，大额 → 事故（三期）；客户池：小额且「托管里少了」→ 认损，
      // 多出来的 → 指路补录，大额 → 事故。
      if (kase.status === 'OPEN' && kase.slaBreached && d && d.outlet === 'HOLD_INVESTIGATING' && !d.adjustmentNo) {
        const wo = resolveWriteOff({
          matchType: r.matchType as any, book: caseBook,
          deltaSign: r.deltaAmount != null ? ((r.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1) : undefined,
          internalDirection: r.internalFlow?.direction, externalDirection: r.externalLine?.direction,
          internalAmount: r.internalFlow?.amount, externalAmount: r.externalLine?.amount, deltaAmount: r.deltaAmount,
        });
        if (caseBook === 'CLIENT' && wo.direction === 'INCREASE') {
          r.nextStep = { kind: 'CLIENT_SURPLUS' };
        } else if (!isSmallAmount(caseCurrency, BigInt(wo.amountMinor))) {
          r.nextStep = { kind: 'INCIDENT_DEFERRED' };
        } else {
          r.nextStep = { kind: 'WRITE_OFF', reasonCode: wo.reasonCode, direction: wo.direction, amount: wo.amountMinor, effectiveDate: kase.businessDate };
        }
      }
```

- [ ] **Step 6: e2e 反例③改口 + 手册**

`test/recon-aging-write-off.e2e-spec.ts` 反例③（`it('反例③：客户池超期 + 调查中 → 核销 400，读面给「待二期划转」'`）改为：
```ts
  it('反例③（二期改口）：客户池超期 + 调查中——拿公司池码 400；拿客户池认损码 REDUCE 放行建单', async () => {
    const customer = await makeCustomer('EX3');
    const wallet = await createCustomerWallet({ ownerId: customer.id, ownerNo: customer.customerNo, network: 'AED_ZAND', walletRole: 'C_VIBAN', iban: `AE-E2E-${randomUUID().slice(0, 8)}` });
    const kase = await createFixtureCase({ walletRef: wallet.id, book: 'CLIENT', ownerNo: customer.customerNo });
    await (prisma as any).reconciliationCase.update({ where: { id: kase.id }, data: { slaBreached: true, slaDeadline: new Date(Date.now() - 1000) } });
    const flowId = `flow-fixture-${randomUUID()}`;
    await (prisma as any).reconciliationDisposition.create({
      data: {
        dispositionNo: generateReferenceNo('RCD'), caseNo: kase.caseNo, walletRef: wallet.id, businessDate: TODAY,
        explainedFlowId: flowId, matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', causeCode: 'UNEXPLAINED', outlet: 'HOLD_INVESTIGATING',
        findingNote: 'e2e fixture', createdByUserId: 'E2E',
      },
    });
    const treasury = makeActor('E2E_TREASURY_C', 'TREASURY_OFFICER');
    const base = { caseNo: kase.caseNo, direction: 'REDUCE', amount: '7', effectiveDate: TODAY, explainedFlowId: flowId, reasonInternal: 'x', reasonCustomer: 'x' };
    await expect(adjustments.createDraft({ ...base, reasonCode: 'UNEXPLAINED_WRITE_OFF' } as any, treasury)).rejects.toThrow(/客户池查无果认损/);
    const { adjustmentNo } = await adjustments.createDraft({ ...base, reasonCode: 'UNEXPLAINED_CLIENT_LOSS' } as any, treasury);
    expect((await adjustmentRow(adjustmentNo)).book).toBe('CLIENT');
  });
```

`doc-final/reference/recon-cause-handbook.md`：删掉 `#### \`FIRM_TRANSFER_UNTRACKED\` —— 公司调拨已记账、无资金单跟踪` 整节（到下一个 `####` 之前）；同格 `UNEXPLAINED` 那节「查证怎么做」里的「和内部调拨单据」删掉；文件顶部引言块末尾加一句 `> 2026-09-05 平账二期：退役「公司调拨已记账、无资金单跟踪」（21 → 20 码），理由见 decisions 同日条。`；四、速查表若列了 21，改 20。

- [ ] **Step 7: 跑测试 + tsc**

```bash
npx jest src/modules/clearing-settle/reconciliation
npx tsc --noEmit -p tsconfig.json
```
Expected：全绿；tsc 0 错（`TRANSFER_DEFERRED` / `INTERNAL_TRANSFER` 字面量的引用点全部消失——若前端 `ReconciliationCasesDetailPage.tsx` 报错，那是 Task 12 的活，此处后端 tsc 只看 ①）。

- [ ] **Step 8: Commit**

```bash
git add src/modules/clearing-settle/reconciliation test/recon-aging-write-off.e2e-spec.ts doc-final/reference/recon-cause-handbook.md
git commit -m "feat(recon): 客户池核销解锁为「认损」——成因码 UNEXPLAINED_CLIENT_LOSS 只许 REDUCE、多出来的指路补录；FIRM_TRANSFER_UNTRACKED 退役 21→20；读面 nextStep 去 TRANSFER_DEFERRED（平账二期 Task 4）"
```

本任务过哪几条：退役业务动作（成因菜单项随注册表消失，前端「待二期划转」文案 Task 12 删）｜ 新增业务动作（认损：前端入口 Task 12）｜ 改了后端 → tsc ①。

---

### Task 5: 划转单主体——dto / 迁移表 / `InternalTransferService`

**Files:**
- Create: `src/modules/asset-treasury/internal-transfers/dto/internal-transfer.dto.ts`
- Create: `src/modules/asset-treasury/internal-transfers/constants/internal-transfer-transitions.constant.ts`
- Create: `src/modules/asset-treasury/internal-transfers/internal-transfer.service.ts`
- Create: `src/modules/asset-treasury/internal-transfers/internal-transfer.service.spec.ts`

**Interfaces:**
- Produces: `InternalTransferStatus`（六态）｜ `InternalTransferPurpose`｜ `InternalTransferService.assertTransition / create / findByNo / findBlockingBySource / transition / assertFirmOpsBalance / list / getView`｜ `InternalTransferView`（对外投影，零 UUID）｜ `CreateInternalTransferInput`
- Consumes: `AccountingService.resolveTbAccountId / lookupBalance`（既有）；`generateReferenceNo('ITR')`

- [ ] **Step 1: dto**

`dto/internal-transfer.dto.ts`：

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 六态（spec §3）：出生即待审批；不设草稿态、不设「已批准」中间态。 */
export enum InternalTransferStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export const INTERNAL_TRANSFER_PURPOSES = ['CLIENT_COMPENSATION', 'CLIENT_ADVANCE'] as const;
export type InternalTransferPurpose = (typeof INTERNAL_TRANSFER_PURPOSES)[number];
export type InternalTransferFailureReason = 'INSUFFICIENT_FIRM_BALANCE' | 'LEG_FAILED' | 'POSTING_FAILED';

export class InitiateCompensationDto {
  @ApiProperty() @IsString() @IsNotEmpty() adjustmentNo!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class InitiateAdvanceDto {
  @ApiProperty() @IsString() @IsNotEmpty() caseNo!: string;
  @ApiProperty({ description: '被退汇的账单行（隐藏锚，来自案件读面 nextStep.externalLineId）' }) @IsString() @IsNotEmpty() externalLineId!: string;
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class CancelInternalTransferDto {
  @ApiProperty() @IsString() @IsNotEmpty() reason!: string;
}
export class InternalTransferListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional({ enum: INTERNAL_TRANSFER_PURPOSES }) @IsOptional() @IsIn(INTERNAL_TRANSFER_PURPOSES as unknown as string[]) purpose?: InternalTransferPurpose;
  @ApiPropertyOptional() @IsOptional() @IsString() customerNo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceCaseNo?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) skip?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) take?: number;
}

/** 对外投影（铁律⑥）：没有 id / walletId / customerId / externalLineId，只有业务键。 */
export interface InternalTransferLegView {
  fundsOrderNo: string; legSeq: number; status: string;
  fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null;
}
export interface InternalTransferView {
  transferNo: string; purpose: InternalTransferPurpose; status: string;
  customerNo: string; assetCode: string; currency: string; decimals: number;
  amount: string; // 元，按资产精度定位
  reason: string; sourceCaseNo: string; sourceAdjustmentNo: string | null; sourceExternalRef: string | null;
  approvalNo: string | null; failureReasonCode: string | null; failureNote: string | null;
  fromWalletNo: string | null; viaWalletNo: string | null; toWalletNo: string | null;
  createdBy: string; createdAt: string; executedAt: string | null; settledAt: string | null;
  legs: InternalTransferLegView[];
}
export interface CreateInternalTransferInput {
  purpose: InternalTransferPurpose; assetId: string; amountMajor: string;
  fromWalletId: string; viaWalletId: string | null; toWalletId: string;
  customerId: string; customerNo: string; reason: string; sourceCaseNo: string;
  sourceAdjustmentNo?: string | null; sourceExternalLineId?: string | null;
  traceId?: string | null; createdByUserId: string;
}
```

- [ ] **Step 2: 迁移表**

`constants/internal-transfer-transitions.constant.ts`：

```ts
import { InternalTransferStatus as S } from '../dto/internal-transfer.dto';

/** 六态六边（spec §3）。终态零出边；执行中不许撤回（钱已在路上）。 */
export const INTERNAL_TRANSFER_TRANSITIONS: Record<string, readonly string[]> = {
  [S.PENDING_APPROVAL]: [S.EXECUTING, S.FAILED, S.REJECTED, S.CANCELLED],
  [S.EXECUTING]: [S.SUCCESS, S.FAILED],
  [S.SUCCESS]: [],
  [S.FAILED]: [],
  [S.REJECTED]: [],
  [S.CANCELLED]: [],
};

/** 「未走完或已成功」——同一来源上再开一张时要查的集合（出生守卫②）。失败 / 拒绝 / 撤回后可重发。 */
export const INTERNAL_TRANSFER_BLOCKING_STATUSES: readonly string[] = [S.PENDING_APPROVAL, S.EXECUTING, S.SUCCESS];
```

- [ ] **Step 3: 写失败的单测**

`internal-transfer.service.spec.ts`：

```ts
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferStatus as S } from './dto/internal-transfer.dto';

describe('InternalTransferService（平账二期 Task 5）', () => {
  const svc = (prisma: any = {}, accounting: any = {}) => new InternalTransferService(prisma, accounting);

  describe('六态六边', () => {
    it.each([
      [S.PENDING_APPROVAL, S.EXECUTING], [S.PENDING_APPROVAL, S.FAILED], [S.PENDING_APPROVAL, S.REJECTED], [S.PENDING_APPROVAL, S.CANCELLED],
      [S.EXECUTING, S.SUCCESS], [S.EXECUTING, S.FAILED],
    ])('%s → %s 放行', (from, to) => { expect(() => svc().assertTransition(from, to)).not.toThrow(); });
    it.each([
      [S.EXECUTING, S.CANCELLED], [S.EXECUTING, S.REJECTED], [S.PENDING_APPROVAL, S.SUCCESS],
      [S.SUCCESS, S.FAILED], [S.FAILED, S.EXECUTING], [S.REJECTED, S.EXECUTING], [S.CANCELLED, S.PENDING_APPROVAL],
    ])('%s → %s 拒', (from, to) => { expect(() => svc().assertTransition(from, to)).toThrow(/非法状态迁移/); });
  });

  describe('assertFirmOpsBalance —— 运营户贷方常态净额（贷 − 借 − 待过账借）≥ 金额', () => {
    const accounting = (creditsPosted: bigint, debitsPosted: bigint, debitsPending = 0n) => ({
      resolveTbAccountId: jest.fn(async () => 1n),
      lookupBalance: jest.fn(async () => ({ creditsPosted, debitsPosted, debitsPending, creditsPending: 0n })),
    });
    it('够 → 放行', async () => {
      await expect(svc({}, accounting(100_000_000_000n, 571_811_000n)).assertFirmOpsBalance('USDT', 7_500_000n)).resolves.toBeUndefined();
    });
    it('不够 → 400，文案带可用 / 需要', async () => {
      await expect(svc({}, accounting(1_000n, 0n)).assertFirmOpsBalance('AED', 2_000n)).rejects.toThrow(/余额不足.*可用 1000.*需要 2000/);
    });
    it('待过账的借方也算占用', async () => {
      await expect(svc({}, accounting(3_000n, 0n, 2_000n)).assertFirmOpsBalance('AED', 1_500n)).rejects.toThrow(/余额不足/);
    });
    it('币种不在账本 → 400', async () => {
      await expect(svc({}, accounting(1n, 0n)).assertFirmOpsBalance('BTC', 1n)).rejects.toThrow(/不支持的币种/);
    });
  });

  describe('findBlockingBySource —— 未走完或已成功都挡，失败 / 拒绝 / 撤回不挡', () => {
    it('查询条件含且仅含三种状态', async () => {
      const prisma = { internalTransfer: { findFirst: jest.fn(async ({ where }: any) => where) } };
      const where = await svc(prisma).findBlockingBySource({ sourceAdjustmentNo: 'ADJ-1' });
      expect(where).toEqual({ sourceAdjustmentNo: 'ADJ-1', status: { in: ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS'] } });
    });
  });

  describe('getView —— 铁律⑥', () => {
    it('投影不含任何内部 id；金额按精度定位；腿参考号按资产类型取', async () => {
      const row = {
        id: 'uuid-itr', transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: 'SUCCESS', customerId: 'uuid-cu', customerNo: 'CU1',
        asset: { code: 'USDT-TRON', currency: 'USDT', decimals: 6 }, amount: '7.5', reason: 'r', sourceCaseNo: 'REC1',
        sourceAdjustmentNo: 'ADJ1', sourceExternalLineId: 'uuid-line', approvalNo: 'APR1', failureReasonCode: null, failureNote: null,
        fromWalletId: 'uuid-w1', viaWalletId: null, toWalletId: 'uuid-w2', createdByUserId: 'ADM1',
        createdAt: new Date('2026-09-05T00:00:00Z'), executedAt: null, settledAt: null,
      };
      const prisma = {
        internalTransfer: { findUnique: jest.fn(async () => row) },
        fundsOrder: { findMany: jest.fn(async () => [{ fundsOrderNo: 'FO1', legSeq: 1, status: 'CLEARED', txHash: '0xabc', referenceNo: null, fromWallet: { walletNo: 'WA1' }, toWallet: { walletNo: 'WA2' }, asset: { type: 'CRYPTO' } }]) },
        wallet: { findMany: jest.fn(async () => [{ id: 'uuid-w1', walletNo: 'WA1' }, { id: 'uuid-w2', walletNo: 'WA2' }]) },
        externalStatementLine: { findUnique: jest.fn(async () => ({ externalRef: 'BANK-REF-9' })) },
      };
      const view = await svc(prisma).getView('ITR1');
      const json = JSON.stringify(view);
      for (const forbidden of ['uuid-itr', 'uuid-cu', 'uuid-line', 'uuid-w1', 'uuid-w2']) expect(json).not.toContain(forbidden);
      expect(view).toMatchObject({ transferNo: 'ITR1', amount: '7.500000', fromWalletNo: 'WA1', viaWalletNo: null, toWalletNo: 'WA2', sourceExternalRef: 'BANK-REF-9', legs: [{ fundsOrderNo: 'FO1', externalRef: '0xabc' }] });
    });
  });
});
```

- [ ] **Step 4: 跑确认红**

Run: `npx jest src/modules/asset-treasury/internal-transfers` → FAIL（模块不存在）

- [ ] **Step 5: 实现服务**

`internal-transfer.service.ts`：

```ts
// 平账二期 · 内部划转单主体（spec §3）：建行 / 迁移表 / 读投影 / 运营户余额闸。
// 铁律③：本服务只写 internal_transfers；资金单、账本、审批、审计全在 workflow 编排。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { INTERNAL_TRANSFER_BLOCKING_STATUSES, INTERNAL_TRANSFER_TRANSITIONS } from './constants/internal-transfer-transitions.constant';
import { CreateInternalTransferInput, InternalTransferListQueryDto, InternalTransferStatus, InternalTransferView } from './dto/internal-transfer.dto';

@Injectable()
export class InternalTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
  ) {}

  assertTransition(from: string, to: string): void {
    const allowed = INTERNAL_TRANSFER_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) throw new BadRequestException(`内部划转单非法状态迁移：${from} → ${to}`);
  }

  async create(input: CreateInternalTransferInput) {
    return (this.prisma as any).internalTransfer.create({
      data: {
        transferNo: generateReferenceNo('ITR'),
        purpose: input.purpose,
        assetId: input.assetId,
        amount: new Prisma.Decimal(input.amountMajor),
        fromWalletId: input.fromWalletId,
        viaWalletId: input.viaWalletId,
        toWalletId: input.toWalletId,
        customerId: input.customerId,
        customerNo: input.customerNo,
        status: InternalTransferStatus.PENDING_APPROVAL,
        reason: input.reason,
        sourceCaseNo: input.sourceCaseNo,
        sourceAdjustmentNo: input.sourceAdjustmentNo ?? null,
        sourceExternalLineId: input.sourceExternalLineId ?? null,
        traceId: input.traceId ?? randomUUID(),
        createdByUserId: input.createdByUserId,
      },
      include: { asset: true },
    });
  }

  async findByNo(transferNo: string) {
    const row = await (this.prisma as any).internalTransfer.findUnique({ where: { transferNo }, include: { asset: true } });
    if (!row) throw new NotFoundException(`内部划转单不存在：${transferNo}`);
    return row;
  }

  /** 同一来源上「未走完或已成功」的划转单——出生守卫②。 */
  async findBlockingBySource(source: { sourceAdjustmentNo?: string; sourceExternalLineId?: string }) {
    return (this.prisma as any).internalTransfer.findFirst({
      where: { ...source, status: { in: [...INTERNAL_TRANSFER_BLOCKING_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async transition(transferNo: string, to: InternalTransferStatus, patch: Record<string, unknown> = {}) {
    const row = await this.findByNo(transferNo);
    this.assertTransition(row.status, to);
    return (this.prisma as any).internalTransfer.update({ where: { transferNo }, data: { status: to, ...patch }, include: { asset: true } });
  }

  /** 出生守卫③ / 批准时复核：运营户该币种可用（贷 − 借 − 待过账借）≥ 金额（最小单位）。 */
  async assertFirmOpsBalance(currency: string, amountMinor: bigint): Promise<void> {
    const ledger = TB_LEDGERS[currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new BadRequestException(`不支持的币种：${currency}`);
    const opsId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' });
    const bal = await this.accounting.lookupBalance(opsId);
    const available = bal.creditsPosted - bal.debitsPosted - bal.debitsPending;
    if (available < amountMinor) {
      throw new BadRequestException(
        `运营户 ${currency} 余额不足（可用 ${available.toString()}，需要 ${amountMinor.toString()}，最小单位）——公司不能拿没有的钱补客户`,
      );
    }
  }

  async list(q: InternalTransferListQueryDto): Promise<{ items: InternalTransferView[]; total: number }> {
    const where: any = {
      ...(q.status && { status: q.status }),
      ...(q.purpose && { purpose: q.purpose }),
      ...(q.customerNo && { customerNo: q.customerNo }),
      ...(q.sourceCaseNo && { sourceCaseNo: q.sourceCaseNo }),
    };
    const skip = Number(q.skip ?? 0);
    const take = Number(q.take ?? 20);
    const [rows, total] = await Promise.all([
      (this.prisma as any).internalTransfer.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { asset: true } }),
      (this.prisma as any).internalTransfer.count({ where }),
    ]);
    const items = await Promise.all(rows.map((r: any) => this.toView(r, [])));
    return { items, total };
  }

  async getView(transferNo: string): Promise<InternalTransferView> {
    const row = await this.findByNo(transferNo);
    const legs = await (this.prisma as any).fundsOrder.findMany({
      where: { internalTransferId: row.id },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
      include: { fromWallet: { select: { walletNo: true } }, toWallet: { select: { walletNo: true } }, asset: { select: { type: true } } },
    });
    return this.toView(row, legs);
  }

  /** 铁律⑥：投影里没有任何 id / walletId / customerId / externalLineId。 */
  private async toView(row: any, legs: any[]): Promise<InternalTransferView> {
    const ids = [row.fromWalletId, row.viaWalletId, row.toWalletId].filter(Boolean);
    const wallets = (await (this.prisma as any).wallet.findMany({ where: { id: { in: ids } }, select: { id: true, walletNo: true } })) as Array<{ id: string; walletNo: string | null }>;
    const noOf = (id: string | null) => (id ? (wallets.find((w) => w.id === id)?.walletNo ?? null) : null);
    const sourceLine = row.sourceExternalLineId
      ? await (this.prisma as any).externalStatementLine.findUnique({ where: { id: row.sourceExternalLineId }, select: { externalRef: true } })
      : null;
    return {
      transferNo: row.transferNo, purpose: row.purpose, status: row.status,
      customerNo: row.customerNo, assetCode: row.asset.code, currency: row.asset.currency, decimals: row.asset.decimals,
      amount: new Prisma.Decimal(row.amount).toFixed(row.asset.decimals),
      reason: row.reason, sourceCaseNo: row.sourceCaseNo, sourceAdjustmentNo: row.sourceAdjustmentNo ?? null,
      sourceExternalRef: sourceLine?.externalRef ?? null,
      approvalNo: row.approvalNo ?? null, failureReasonCode: row.failureReasonCode ?? null, failureNote: row.failureNote ?? null,
      fromWalletNo: noOf(row.fromWalletId), viaWalletNo: noOf(row.viaWalletId), toWalletNo: noOf(row.toWalletId),
      createdBy: row.createdByUserId, createdAt: row.createdAt.toISOString(),
      executedAt: row.executedAt ? row.executedAt.toISOString() : null,
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
      legs: legs.map((l: any) => ({
        fundsOrderNo: l.fundsOrderNo, legSeq: l.legSeq, status: l.status,
        fromWalletNo: l.fromWallet?.walletNo ?? null, toWalletNo: l.toWallet?.walletNo ?? null,
        externalRef: (l.asset?.type ?? 'CRYPTO').toUpperCase() === 'CRYPTO' ? (l.txHash ?? null) : (l.referenceNo ?? null),
      })),
    };
  }
}
```

- [ ] **Step 6: 跑确认绿 + tsc**

Run: `npx jest src/modules/asset-treasury/internal-transfers` → PASS；`npx tsc --noEmit -p tsconfig.json` → 0 错

- [ ] **Step 7: Commit**

```bash
git add src/modules/asset-treasury/internal-transfers
git commit -m "feat(internal-transfers): 划转单主体——六态六边迁移表、建行、零 UUID 投影、运营户余额闸（平账二期 Task 5）"
```

本任务过哪几条：新状态 / 新结局（显式迁移表；计时：不要）｜ 涉及金额（订单层元、闸最小单位）｜ 对外识别（投影零 UUID）｜ tsc ①。

---

### Task 6: 模拟托管方回单（对账域写入口）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/simulation/simulated-custodian-statement.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/simulation/simulated-custodian-statement.service.spec.ts`
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`（providers + exports）

**Interfaces:**
- Produces: `SimulatedCustodianStatementService.recordLegMovement(input: LegMovementInput): Promise<{ outLineId; inLineId; cutoffDate }>`——写出方 OUT、入方 IN 两行 `external_statement_lines`（dedupKey `SIM-<资金单号>-<钱包 id>`，`currency` = `asset.code`），并把两钱包当日 `external_balances` 收盘 ∓ 金额；当日无余额行时以引擎算出的内部余额为基准建行
- Consumes: `WalletBalanceCheckerService.checkBalance`（既有）

- [ ] **Step 1: 写失败的单测**

```ts
import { Prisma } from '@prisma/client';
import { SimulatedCustodianStatementService } from './simulated-custodian-statement.service';

describe('SimulatedCustodianStatementService（平账二期 Task 6）', () => {
  const wallets: Record<string, any> = { 'w-ops': { ownerType: 'PLATFORM' }, 'w-cust': { ownerType: 'CUSTOMER' } };
  const make = () => {
    const upserts: any[] = []; const updates: any[] = []; const creates: any[] = [];
    const prisma: any = {
      wallet: { findUnique: jest.fn(async ({ where }: any) => wallets[where.id] ?? null) },
      externalStatementLine: { upsert: jest.fn(async (args: any) => { upserts.push(args); return { id: `line-${upserts.length}` }; }) },
      externalBalance: {
        findUnique: jest.fn(async ({ where }: any) => (where.source_accountRef_cutoffDate.accountRef === 'w-ops' ? { id: 'eb-ops', closingBalance: new Prisma.Decimal('100000000000'), lineCount: 3 } : null)),
        update: jest.fn(async (args: any) => { updates.push(args); return {}; }),
        create: jest.fn(async (args: any) => { creates.push(args); return {}; }),
      },
    };
    const balanceChecker: any = { checkBalance: jest.fn(async () => ({ internal: { total: 2_992_500_000n }, coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU1' })) };
    return { svc: new SimulatedCustodianStatementService(prisma, balanceChecker), prisma, upserts, updates, creates, balanceChecker };
  };
  const at = new Date('2026-09-05T10:00:00.000Z');

  it('写两行：出方 OUT（公司账簿）、入方 IN（客户账簿），同参考号，dedupKey 按资金单号 + 钱包', async () => {
    const { svc, upserts } = make();
    const r = await svc.recordLegMovement({ fundsOrderNo: 'FO1', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'USDT-TRON', assetType: 'CRYPTO', amountMinor: 7_500_000n, externalRef: '0xleg1', at, description: 'sim' });
    expect(r.cutoffDate).toBe('2026-09-05');
    expect(upserts.map((u) => u.where.dedupKey)).toEqual(['SIM-FO1-w-ops', 'SIM-FO1-w-cust']);
    expect(upserts[0].create).toMatchObject({ source: 'HEXTRUST', accountRef: 'w-ops', subAccount: 'w-ops', book: 'FIRM', currency: 'USDT-TRON', direction: 'OUT', externalRef: '0xleg1' });
    expect(upserts[1].create).toMatchObject({ source: 'HEXTRUST', accountRef: 'w-cust', book: 'CLIENT', direction: 'IN', externalRef: '0xleg1' });
    expect(upserts[0].create.amount.toString()).toBe('7500000');
  });

  it('出方已有当日余额行 → 收盘减；入方没有 → 以引擎内部余额 + 本笔建行', async () => {
    const { svc, updates, creates, balanceChecker } = make();
    await svc.recordLegMovement({ fundsOrderNo: 'FO1', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'USDT-TRON', assetType: 'CRYPTO', amountMinor: 7_500_000n, externalRef: '0xleg1', at, description: 'sim' });
    expect(updates[0].data.closingBalance.toString()).toBe('99992500000');
    expect(creates[0].data).toMatchObject({ source: 'HEXTRUST', accountRef: 'w-cust', currency: 'USDT-TRON', book: 'CLIENT', cutoffDate: '2026-09-05', walletRef: 'w-cust', coaCode: 'L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE', ownerNo: 'CU1' });
    expect(creates[0].data.closingBalance.toString()).toBe('3000000000');
    expect(balanceChecker.checkBalance).toHaveBeenCalledWith({ walletRef: 'w-cust', externalClosing: 0n, cutoff: at });
  });

  it('法币走银行来源 ZAND', async () => {
    const { svc, upserts } = make();
    await svc.recordLegMovement({ fundsOrderNo: 'FO2', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'AED', assetType: 'FIAT', amountMinor: 90_000n, externalRef: 'BANK-1', at, description: 'sim' });
    expect(upserts[0].create.source).toBe('ZAND');
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `npx jest src/modules/clearing-settle/reconciliation/simulation` → FAIL（文件不存在）

- [ ] **Step 3: 实现**

```ts
// 模拟托管方回单（平账二期 spec §4）：内部划转腿一提交，托管方 / 银行的对账单上就该有这两行。
// 这是本波唯一的新演示装置（demo/simulated-externals.md 登记）——除此之外的外部账单仍只由
// recon:demo 铸。铺场脚本 pass / break 两模式都先清空外部账单再从账本流水重铸，划转结清后的
// 流水会被一并重铸，所以不会同一笔两行；代价是「铺场时不得有在途划转」（recon-demo.ts 前置闸）。
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { toBusinessDate } from '../../../accounting/tigerbeetle/utils/business-date.util';
import { WalletBalanceCheckerService } from '../engine/v2/wallet-balance-checker.service';

export interface LegMovementInput {
  fundsOrderNo: string;
  fromWalletId: string;
  toWalletId: string;
  /** external_statement_lines.currency / external_balances.currency 存 asset.code（全仓惯例，B 批实证） */
  assetCode: string;
  assetType: 'CRYPTO' | 'FIAT';
  amountMinor: bigint;
  externalRef: string;
  at: Date;
  description: string;
}

type Book = 'CLIENT' | 'FIRM';

@Injectable()
export class SimulatedCustodianStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balanceChecker: WalletBalanceCheckerService,
  ) {}

  async recordLegMovement(input: LegMovementInput): Promise<{ outLineId: string; inLineId: string; cutoffDate: string }> {
    const source = input.assetType === 'CRYPTO' ? 'HEXTRUST' : 'ZAND';
    const cutoffDate = toBusinessDate(input.at);
    const out = await this.writeLine(input, source, input.fromWalletId, 'OUT');
    const inn = await this.writeLine(input, source, input.toWalletId, 'IN');
    await this.bumpClosing(input, source, cutoffDate, input.fromWalletId, -input.amountMinor, out.book);
    await this.bumpClosing(input, source, cutoffDate, input.toWalletId, input.amountMinor, inn.book);
    return { outLineId: out.id, inLineId: inn.id, cutoffDate };
  }

  private async walletBook(walletId: string): Promise<Book> {
    const w = await (this.prisma as any).wallet.findUnique({ where: { id: walletId }, select: { ownerType: true } });
    if (!w) throw new NotFoundException(`钱包不存在：${walletId}`);
    return w.ownerType === 'CUSTOMER' ? 'CLIENT' : 'FIRM';
  }

  private async writeLine(input: LegMovementInput, source: string, walletId: string, direction: 'IN' | 'OUT'): Promise<{ id: string; book: Book }> {
    const book = await this.walletBook(walletId);
    const dedupKey = `SIM-${input.fundsOrderNo}-${walletId}`;
    const data = {
      source, accountRef: walletId, subAccount: walletId, book, currency: input.assetCode, direction,
      amount: new Prisma.Decimal(input.amountMinor.toString()), externalRef: input.externalRef,
      datetime: input.at, description: input.description,
    };
    const row = await (this.prisma as any).externalStatementLine.upsert({
      where: { dedupKey }, update: data, create: { ...data, dedupKey }, select: { id: true },
    });
    return { id: row.id as string, book };
  }

  private async bumpClosing(input: LegMovementInput, source: string, cutoffDate: string, walletId: string, deltaMinor: bigint, book: Book): Promise<void> {
    const delta = new Prisma.Decimal(deltaMinor.toString());
    const where = { source_accountRef_cutoffDate: { source, accountRef: walletId, cutoffDate } };
    const eb = await (this.prisma as any).externalBalance.findUnique({ where });
    if (eb) {
      await (this.prisma as any).externalBalance.update({
        where: { id: eb.id },
        data: { closingBalance: new Prisma.Decimal(eb.closingBalance).plus(delta), lineCount: (eb.lineCount ?? 0) + 1 },
      });
      return;
    }
    // 当日无余额行（e2e 或铺场之前）：以引擎算出的内部余额为基准，「托管方与我们一致，只差这一笔」。
    const check = await this.balanceChecker.checkBalance({ walletRef: walletId, externalClosing: 0n, cutoff: input.at });
    await (this.prisma as any).externalBalance.create({
      data: {
        source, accountRef: walletId, currency: input.assetCode, book, cutoffDate,
        closingBalance: new Prisma.Decimal(check.internal.total.toString()).plus(delta),
        openingBalance: new Prisma.Decimal(0), asOfAt: input.at, status: 'INGESTED',
        walletRef: walletId, coaCode: check.coaCode, ownerNo: check.ownerNo, lineCount: 1,
      },
    });
  }
}
```

`reconciliation.module.ts`：import 该服务；`providers` 加 `SimulatedCustodianStatementService`；`exports` 改为 `[WalletReconRunService, CaseAgingService, DispositionService, SupplementEvidenceService, SimulatedCustodianStatementService]`，并在 imports 注释处加一行「平账二期：模拟托管方回单——划转工作流在腿提交时调用」。

- [ ] **Step 4: 跑确认绿 + tsc**

Run: `npx jest src/modules/clearing-settle/reconciliation/simulation` → PASS；`npx tsc --noEmit -p tsconfig.json` → 0 错

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/simulation src/modules/clearing-settle/reconciliation/reconciliation.module.ts
git commit -m "feat(recon): 模拟托管方回单——划转腿提交时写两行外部账单并增减当日收盘，对账域导出（平账二期 Task 6）"
```

本任务过哪几条：改页面或种子（无）；本装置登记 `demo/simulated-externals.md`（Task 15）；tsc ①。

---

### Task 7: 划转工作流 + 审批 handler + 模块装配

**Files:**
- Create: `src/modules/asset-treasury/internal-transfers/internal-transfer-approval.service.ts`
- Create: `src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.ts`
- Create: `src/modules/asset-treasury/internal-transfers/internal-transfers.module.ts`
- Modify: `src/app.module.ts`
- Create: `src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.spec.ts`

**Interfaces:**
- Produces: `InternalTransferWorkflowService.initiateCompensation({ adjustmentNo, reason }, actor)` / `initiateAdvance({ caseNo, externalLineId, reason }, actor)` / `cancel(transferNo, { reason }, actor)`（都返回 `{ transferNo, approvalNo?, status }`）；`@OnEvent('workflow.internal-transfer.decided')` / `@OnEvent(FUNDS_ORDER_STATUS_CHANGED)` 两个订阅
- Consumes: Task 5 主体、Task 6 回单、`ApprovalsService.createAndSubmit / cancel`、`FundsOrderService.create / findById / advance / resolveExternalRef`、`SystemWalletResolver.resolve`、`SupplementEvidenceService.assertClaimable`、`AccountingService.executeTransfer / resolveTbAccountId / getCustomerAvailableBalance`

- [ ] **Step 1: 审批 handler**

`internal-transfer-approval.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

/** 平账二期：内部划转单审批（CFO 单步）。裁决后派生 `workflow.internal-transfer.decided`，由 InternalTransferWorkflowService 接。 */
@Injectable()
export class InternalTransferApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL;
  readonly workflowType = AuditBusinessWorkflowTypes.INTERNAL_TRANSFER;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

- [ ] **Step 2: 写失败的单测（工作流）**

`internal-transfer-workflow.service.spec.ts`：

```ts
import { ConflictException } from '@nestjs/common';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { InternalTransferStatus as S } from './dto/internal-transfer.dto';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';

const USDT = { id: 'a-usdt', code: 'USDT-TRON', currency: 'USDT', decimals: 6, type: 'CRYPTO' };
const AED = { id: 'a-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
const treasury = { actorType: 'ADMIN' as const, userId: 'uuid-tre', userNo: 'ADM-TRE', roleCodes: ['TREASURY_OFFICER'] };

function makeWorkflow(o: Partial<Record<'adjustment' | 'asset' | 'wallet' | 'disposition' | 'transferRow', any>> = {}) {
  const adjustment = o.adjustment ?? { adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', book: 'CLIENT', ownerId: 'uuid-cu', ownerNo: 'CU1', walletRef: 'w-cust', assetCode: 'USDT-TRON', amount: '7500000', caseNo: 'REC1', traceId: 'trace-1' };
  const asset = o.asset ?? USDT;
  const transferRow = o.transferRow ?? { id: 'uuid-itr', transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: S.PENDING_APPROVAL, amount: '7.5', assetId: asset.id, asset, fromWalletId: 'w-ops', viaWalletId: asset.type === 'FIAT' ? 'w-set' : null, toWalletId: 'w-cust', customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r', sourceCaseNo: 'REC1', sourceAdjustmentNo: 'ADJ1', sourceExternalLineId: null, traceId: 'trace-1', approvalNo: 'APR1' };
  const walletsById: Record<string, any> = {
    'w-ops': { id: 'w-ops', ownerId: null, address: 'Tops', iban: 'AE-OPS', walletNo: 'WA-OPS' },
    'w-set': { id: 'w-set', ownerId: null, address: null, iban: 'AE-SET', walletNo: 'WA-SET' },
    'w-cust': { id: 'w-cust', ownerId: 'uuid-cu', address: 'Tcust', iban: 'AE-CUST', walletNo: 'WA-CUST' },
  };
  const prisma: any = {
    reconciliationAdjustment: { findUnique: jest.fn(async () => adjustment) },
    reconciliationDisposition: { findFirst: jest.fn(async () => o.disposition ?? null) },
    asset: { findUnique: jest.fn(async () => asset) },
    wallet: { findUnique: jest.fn(async ({ where }: any) => walletsById[where.id] ?? null) },
    internalTransfer: { update: jest.fn(async () => transferRow), findUnique: jest.fn(async () => transferRow) },
    fundsOrder: { update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })) },
  };
  const transfers: any = {
    findBlockingBySource: jest.fn(async () => null),
    assertFirmOpsBalance: jest.fn(async () => undefined),
    create: jest.fn(async (input: any) => ({ ...transferRow, ...input, amount: input.amountMajor })),
    findByNo: jest.fn(async () => transferRow),
    transition: jest.fn(async (_no: string, to: string, patch: any) => ({ ...transferRow, status: to, ...patch })),
  };
  const approvals: any = { createAndSubmit: jest.fn(async () => ({ approvalNo: 'APR1' })), cancel: jest.fn(async () => ({})) };
  const accounting: any = {
    getCustomerAvailableBalance: jest.fn(async () => ({ available: 30_000n, held: 0n, total: 30_000n })),
    resolveTbAccountId: jest.fn(async ({ code }: any) => BigInt(code)),
    executeTransfer: jest.fn(async () => ({ tbTransferId: 1n })),
  };
  const auditLogs: any = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
  const fundsOrders: any = {
    create: jest.fn(async (input: any) => ({ id: `fo-${input.legSeq}`, fundsOrderNo: `FO${input.legSeq}`, ...input })),
    findById: jest.fn(async (id: string) => ({ id, fundsOrderNo: id === 'fo-1' ? 'FO1' : 'FO2', legSeq: id === 'fo-1' ? 1 : 2, amount: '7.5', txHash: null, referenceNo: null, createdAt: new Date(), fromWalletId: id === 'fo-1' ? 'w-ops' : 'w-set', toWalletId: id === 'fo-1' && asset.type === 'FIAT' ? 'w-set' : 'w-cust' })),
    advance: jest.fn(async () => ({})),
    resolveExternalRef: jest.fn((row: any) => (row.asset?.type === 'CRYPTO' ? row.txHash ?? null : row.referenceNo ?? null)),
  };
  const systemWallets: any = { resolve: jest.fn(async (_assetId: string, vault: string) => (vault === 'F_OPS' ? walletsById['w-ops'] : walletsById['w-set'])) };
  const supplementEvidence: any = { assertClaimable: jest.fn(async () => ({ externalLineId: 'line-1', caseNo: 'REC2', walletId: 'w-cust', ownerId: 'uuid-cu', ownerNo: 'CU1', assetId: 'a-aed', currency: 'AED', assetType: 'FIAT', decimals: 2, amountMinor: '120000', amountMajor: '1200.00', externalRef: 'BANK-CLAW', businessDate: '2026-09-05' })) };
  const custodianStatement: any = { recordLegMovement: jest.fn(async () => ({ outLineId: 'l1', inLineId: 'l2', cutoffDate: '2026-09-05' })) };
  const wf = new InternalTransferWorkflowService(prisma, transfers, approvals, accounting, auditLogs, fundsOrders, systemWallets, supplementEvidence, custodianStatement);
  return { wf, prisma, transfers, approvals, accounting, auditLogs, fundsOrders, systemWallets, supplementEvidence, custodianStatement, transferRow };
}

describe('InternalTransferWorkflowService（平账二期 Task 7）', () => {
  describe('initiateCompensation —— 出生守卫', () => {
    it('认损单未落账 → 400', async () => {
      const { wf } = makeWorkflow({ adjustment: { adjustmentNo: 'ADJ1', status: 'PENDING_APPROVAL', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', book: 'CLIENT' } });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/还没落账/);
    });
    it('不是客户池认损单 → 400', async () => {
      const { wf } = makeWorkflow({ adjustment: { adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_WRITE_OFF', book: 'FIRM' } });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/不是客户池认损单/);
    });
    it('同一认损单已有未走完 / 已成功的划转单 → 409', async () => {
      const { wf, transfers } = makeWorkflow();
      transfers.findBlockingBySource.mockResolvedValueOnce({ transferNo: 'ITR0', status: 'SUCCESS' });
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toBeInstanceOf(ConflictException);
    });
    it('运营户余额不够 → 400（守卫来自主体）', async () => {
      const { wf, transfers } = makeWorkflow();
      transfers.assertFirmOpsBalance.mockRejectedValueOnce(new Error('运营户 USDT 余额不足'));
      await expect(wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: 'r' }, treasury)).rejects.toThrow(/余额不足/);
    });
    it('正路径：加密币一腿（无中转）、金额 = 认损额、送 CFO 审批、审计 REQUESTED、快照零 UUID', async () => {
      const { wf, transfers, approvals, auditLogs } = makeWorkflow();
      const r = await wf.initiateCompensation({ adjustmentNo: 'ADJ1', reason: '认赔' }, treasury);
      expect(r).toEqual({ transferNo: 'ITR1', approvalNo: 'APR1', status: 'PENDING_APPROVAL' });
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'CLIENT_COMPENSATION', amountMajor: '7.500000', fromWalletId: 'w-ops', viaWalletId: null, toWalletId: 'w-cust', customerNo: 'CU1', sourceAdjustmentNo: 'ADJ1', sourceCaseNo: 'REC1' }));
      const snapshot = approvals.createAndSubmit.mock.calls[0][0];
      expect(snapshot.actionType).toBe('INTERNAL_TRANSFER_APPROVAL');
      expect(snapshot.entityRef).toBe('ITR1');
      expect(JSON.stringify(snapshot.objectSnapshot)).not.toMatch(/uuid-|w-ops|w-cust/);
      expect(snapshot.objectSnapshot.impact).toContain('补款 7.500000 USDT');
      expect(auditLogs.recordByActor.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_REQUESTED', actionDomain: 'TREASURY', primarySubjectNo: 'ITR1', amount: '7.500000' });
      expect(auditLogs.recordByActor.mock.calls[0][0].requestId).toMatch(/^INTERNAL_TRANSFER_REQUESTED_ITR1_/);
    });
  });

  describe('initiateAdvance', () => {
    const disposition = { dispositionNo: 'RCD1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_BOUNCE', supplementNo: null };
    it('可用余额够扣 → 400 不需要垫款', async () => {
      const { wf, accounting } = makeWorkflow({ disposition, asset: AED });
      accounting.getCustomerAvailableBalance.mockResolvedValueOnce({ available: 120_000n, held: 0n, total: 120_000n });
      await expect(wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: 'r' }, treasury)).rejects.toThrow(/不需要垫款/);
    });
    it('未定性为退汇 → 400', async () => {
      const { wf } = makeWorkflow({ disposition: { ...disposition, deferredTarget: 'SUPPLEMENT_DEPOSIT' }, asset: AED });
      await expect(wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: 'r' }, treasury)).rejects.toThrow(/入金被退汇/);
    });
    it('正路径：法币两腿（经结算户）、金额 = 退汇 1200 − 可用 300 = 900', async () => {
      const { wf, transfers, approvals } = makeWorkflow({ disposition, asset: AED });
      const r = await wf.initiateAdvance({ caseNo: 'REC2', externalLineId: 'line-1', reason: '垫' }, treasury);
      expect(r.status).toBe('PENDING_APPROVAL');
      expect(transfers.assertFirmOpsBalance).toHaveBeenCalledWith('AED', 90_000n);
      expect(transfers.create).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'CLIENT_ADVANCE', amountMajor: '900.00', fromWalletId: 'w-ops', viaWalletId: 'w-set', toWalletId: 'w-cust', sourceExternalLineId: 'line-1', sourceCaseNo: 'REC2' }));
      expect(approvals.createAndSubmit.mock.calls[0][0].objectSnapshot.impact).toContain('垫付 900.00 AED');
    });
  });

  describe('onDecided', () => {
    const decided = (decision: any) => ({ decision, actionType: 'INTERNAL_TRANSFER_APPROVAL', entityRef: 'ITR1', approvalId: 'uuid-apr', approvalNo: 'APR1', traceId: 'trace-1', workflowType: 'INTERNAL_TRANSFER', metadata: {} });
    it('拒绝 → REJECTED + 审计带审批因果', async () => {
      const { wf, transfers, auditLogs } = makeWorkflow();
      await wf.onDecided(decided('DECLINED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'REJECTED', expect.anything());
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_REJECTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
    });
    it('撤回裁决不处理（撤回由 cancel() 自己收口）', async () => {
      const { wf, transfers } = makeWorkflow();
      await wf.onDecided(decided('CANCELLED') as any);
      expect(transfers.transition).not.toHaveBeenCalled();
    });
    it('批准但运营户余额不够 → FAILED(INSUFFICIENT_FIRM_BALANCE)，不建资金单', async () => {
      const { wf, transfers, fundsOrders } = makeWorkflow();
      transfers.assertFirmOpsBalance.mockRejectedValueOnce(new Error('运营户 USDT 余额不足'));
      await wf.onDecided(decided('APPROVED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE' }));
      expect(fundsOrders.create).not.toHaveBeenCalled();
    });
    it('批准 → 建腿 1（加密币：运营户 → 客户）→ EXECUTING + 审计 EXECUTION_STARTED', async () => {
      const { wf, transfers, fundsOrders, auditLogs } = makeWorkflow();
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ internalTransferId: 'uuid-itr', legSeq: 1, initialStatus: 'CREATED', amount: '7.5', fromWalletId: 'w-ops', toWalletId: 'w-cust', fromAddress: 'Tops', toAddress: 'Tcust' }));
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'EXECUTING', expect.objectContaining({ executedAt: expect.any(Date) }));
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_EXECUTION_STARTED', approvalNo: 'APR1', causationId: 'uuid-apr' });
    });
    it('批准 → 法币腿 1 是 运营户 → 结算户', async () => {
      const { wf, fundsOrders } = makeWorkflow({ asset: AED });
      await wf.onDecided(decided('APPROVED') as any);
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 1, fromWalletId: 'w-ops', toWalletId: 'w-set', fromIban: 'AE-OPS', toIban: 'AE-SET' }));
    });
  });

  describe('handleFundsOrderChanged', () => {
    const executing = (asset: any) => ({ id: 'uuid-itr', transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: S.EXECUTING, amount: '7.5', assetId: asset.id, asset, fromWalletId: 'w-ops', viaWalletId: asset.type === 'FIAT' ? 'w-set' : null, toWalletId: 'w-cust', customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r', sourceCaseNo: 'REC1', sourceAdjustmentNo: 'ADJ1', sourceExternalLineId: null, traceId: 'trace-1', approvalNo: 'APR1' });
    const evt = (legSeq: number, newStatus: string) => ({ fundsOrderId: `fo-${legSeq}`, fundsOrderNo: `FO${legSeq}`, parent: { internalTransferId: 'uuid-itr' }, legSeq, attempt: 1, oldStatus: null, newStatus });

    it('不是划转腿的事件直接忽略', async () => {
      const { wf, custodianStatement } = makeWorkflow();
      await wf.handleFundsOrderChanged({ ...evt(1, 'SUBMITTED'), parent: { withdrawTransactionId: 'w' } } as any);
      expect(custodianStatement.recordLegMovement).not.toHaveBeenCalled();
    });
    it('SUBMITTED：提交那一步就铸参考号（加密币 txHash），随后模拟托管方写两行', async () => {
      const { wf, prisma, custodianStatement } = makeWorkflow({ transferRow: executing(USDT) });
      await wf.handleFundsOrderChanged(evt(1, 'SUBMITTED') as any);
      expect(prisma.fundsOrder.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'fo-1' }, data: { txHash: expect.stringMatching(/^0x/) } }));
      expect(custodianStatement.recordLegMovement).toHaveBeenCalledWith(expect.objectContaining({ fundsOrderNo: 'FO1', fromWalletId: 'w-ops', toWalletId: 'w-cust', assetCode: 'USDT-TRON', assetType: 'CRYPTO', amountMinor: 7_500_000n, externalRef: expect.stringMatching(/^0x/) }));
    });
    it('CONFIRMED · 法币腿 1：借运营户 / 贷结算户（81）→ 清算 → 建腿 2（结算户 → 客户）', async () => {
      const row = { ...executing(AED), amount: '900' };
      const { wf, accounting, fundsOrders, transfers } = makeWorkflow({ transferRow: row, asset: AED });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '900', txHash: null, referenceNo: 'BANK-1', createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-set' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(1);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({ code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_OPS_TO_SET, amount: 90_000n, evidence: expect.objectContaining({ sourceType: 'INTERNAL_TRANSFER', sourceNo: 'ITR1', eventCode: 'INTERNAL_TRANSFER_OPS_TO_SET', debitWalletRef: 'w-ops', creditWalletRef: 'w-set', isExternalCrossing: true, externalRef: 'BANK-1', assetCurrency: 'AED' }) });
      expect(fundsOrders.advance).toHaveBeenCalledWith('fo-1', 'CLEAR', 'INTERNAL_TRANSFER_WORKFLOW');
      expect(fundsOrders.create).toHaveBeenCalledWith(expect.objectContaining({ legSeq: 2, fromWalletId: 'w-set', toWalletId: 'w-cust' }));
      expect(transfers.transition).not.toHaveBeenCalled();
    });
    it('CONFIRMED · 最后一腿（加密币腿 1）：公司放出（82）+ 客户收到（83，事件码按用途）→ SUCCESS + 审计 LEG_POSTED / SETTLED', async () => {
      const { wf, accounting, fundsOrders, transfers, auditLogs } = makeWorkflow({ transferRow: executing(USDT) });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer).toHaveBeenCalledTimes(2);
      expect(accounting.executeTransfer.mock.calls[0][0]).toMatchObject({ code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_FIRM_OUT, amount: 7_500_000n, evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_FIRM_OUT', debitWalletRef: 'w-ops', creditWalletRef: 'w-ops' }) });
      expect(accounting.executeTransfer.mock.calls[1][0]).toMatchObject({ code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN, amount: 7_500_000n, evidence: expect.objectContaining({ eventCode: 'INTERNAL_TRANSFER_COMPENSATION_IN', debitWalletRef: 'w-cust', creditWalletRef: 'w-cust', externalRef: '0xleg' }) });
      expect(accounting.resolveTbAccountId).toHaveBeenCalledWith(expect.objectContaining({ code: 100, ownerType: 'CUSTOMER', ownerUuid: 'uuid-cu' }));
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'SUCCESS', expect.objectContaining({ settledAt: expect.any(Date) }));
      expect(auditLogs.recordSystem.mock.calls.map((c: any) => c[0].action)).toEqual(['INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_SETTLED']);
    });
    it('垫款的客户侧事件码是 INTERNAL_TRANSFER_ADVANCE_IN', async () => {
      const { wf, accounting, fundsOrders } = makeWorkflow({ transferRow: { ...executing(USDT), purpose: 'CLIENT_ADVANCE' } });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(accounting.executeTransfer.mock.calls[1][0].evidence.eventCode).toBe('INTERNAL_TRANSFER_ADVANCE_IN');
    });
    it('落账抛错 → 审计 FAILED(POSTING_FAILED)，不清算、不 SUCCESS、不重试', async () => {
      const { wf, accounting, fundsOrders, transfers, auditLogs } = makeWorkflow({ transferRow: executing(USDT) });
      fundsOrders.findById.mockResolvedValueOnce({ id: 'fo-1', fundsOrderNo: 'FO1', legSeq: 1, amount: '7.5', txHash: '0xleg', referenceNo: null, createdAt: new Date(), fromWalletId: 'w-ops', toWalletId: 'w-cust' });
      accounting.executeTransfer.mockRejectedValueOnce(new Error('TB down'));
      await wf.handleFundsOrderChanged(evt(1, 'CONFIRMED') as any);
      expect(fundsOrders.advance).not.toHaveBeenCalled();
      expect(transfers.transition).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem.mock.calls[0][0]).toMatchObject({ action: 'INTERNAL_TRANSFER_FAILED', reasonCode: 'POSTING_FAILED', outcome: 'FAILED' });
    });
    it('FAILED · 法币腿 2：订单 FAILED(LEG_FAILED)，备注写清款项停在结算户', async () => {
      const { wf, transfers } = makeWorkflow({ transferRow: executing(AED), asset: AED });
      await wf.handleFundsOrderChanged(evt(2, 'FAILED') as any);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'FAILED', expect.objectContaining({ failureReasonCode: 'LEG_FAILED', failureNote: expect.stringContaining('结算户') }));
    });
  });

  describe('cancel', () => {
    it('待批可撤：先撤审批单再翻 CANCELLED + 审计', async () => {
      const { wf, approvals, transfers, auditLogs } = makeWorkflow();
      const r = await wf.cancel('ITR1', { reason: '开错' }, treasury);
      expect(approvals.cancel).toHaveBeenCalledWith('APR1', { reason: '开错' }, treasury);
      expect(transfers.transition).toHaveBeenCalledWith('ITR1', 'CANCELLED', expect.objectContaining({ failureNote: '开错' }));
      expect(r.status).toBe('CANCELLED');
      expect(auditLogs.recordByActor.mock.calls[0][0].action).toBe('INTERNAL_TRANSFER_CANCELLED');
    });
    it('执行中不许撤', async () => {
      const { wf } = makeWorkflow({ transferRow: { transferNo: 'ITR1', status: S.EXECUTING, asset: USDT } });
      await expect(wf.cancel('ITR1', { reason: 'x' }, treasury)).rejects.toThrow(/不能撤回/);
    });
  });
});
```

- [ ] **Step 3: 跑确认红**

Run: `npx jest src/modules/asset-treasury/internal-transfers` → FAIL（workflow 不存在）

- [ ] **Step 4: 实现工作流**

`internal-transfer-workflow.service.ts`：

```ts
// 平账二期 · 内部划转单工作流（spec §3–§6）。铁律③：只调各主体服务方法，不直写别人的表
//（读案子 / 调账单 / 定性 / 钱包 / 资产是横向读，放行）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { fakeBankRef, fakeChainTxHash } from '../../../common/utils/fake-external-refs.util';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { toBusinessDate } from '../../accounting/tigerbeetle/utils/business-date.util';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditBusinessWorkflowTypes, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditCategory, AuditOutcome, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { SystemWalletResolver } from '../../funds-layer/domain/system-wallet-resolver.service';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { FundsOrderAction, FundsOrderStatus } from '../../funds-orders/dto/funds-order.dto';
import { SimulatedCustodianStatementService } from '../../clearing-settle/reconciliation/simulation/simulated-custodian-statement.service';
import { SupplementEvidenceService, minorToMajor } from '../../clearing-settle/reconciliation/disposition/supplement-evidence.service';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferStatus } from './dto/internal-transfer.dto';

interface FundsOrderStatusChangedEvent {
  fundsOrderId: string; fundsOrderNo: string;
  parent: { depositTransactionId?: string; withdrawTransactionId?: string; swapTransactionId?: string; internalTransferId?: string };
  legSeq: number; attempt: number; oldStatus: string | null; newStatus: string; traceId?: string;
}

const majorToMinor = (amount: Prisma.Decimal | string, decimals: number): bigint =>
  BigInt(new Prisma.Decimal(amount).mul(new Prisma.Decimal(10).pow(decimals)).toFixed(0));

@Injectable()
export class InternalTransferWorkflowService {
  private readonly logger = new Logger(InternalTransferWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InternalTransferService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
    private readonly fundsOrders: FundsOrderService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly supplementEvidence: SupplementEvidenceService,
    private readonly custodianStatement: SimulatedCustodianStatementService,
  ) {}

  // ── 发起（金库，案子上点）────────────────────────────────────────────────

  /** 认损补款：来源 = 已落账的客户池认损调账单；金额锁定 = 认损额。 */
  async initiateCompensation(dto: { adjustmentNo: string; reason: string }, actor: ApprovalActorContext) {
    const adj = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo: dto.adjustmentNo } });
    if (!adj) throw new NotFoundException(`调账单不存在：${dto.adjustmentNo}`);
    if (adj.status !== 'POSTED') throw new BadRequestException(`认损单 ${dto.adjustmentNo} 还没落账（${adj.status}），先让账说真话再补款`);
    if (adj.reasonCode !== 'UNEXPLAINED_CLIENT_LOSS' || adj.book !== 'CLIENT') throw new BadRequestException(`调账单 ${dto.adjustmentNo} 不是客户池认损单，不能补款`);
    if (!adj.ownerId || !adj.ownerNo || !adj.walletRef) throw new BadRequestException(`认损单 ${dto.adjustmentNo} 缺客户或钱包信息`);
    const blocking = await this.transfers.findBlockingBySource({ sourceAdjustmentNo: dto.adjustmentNo });
    if (blocking) throw new ConflictException(`认损单 ${dto.adjustmentNo} 已有划转单 ${blocking.transferNo}（${blocking.status}），不能再开`);
    const asset = await (this.prisma as any).asset.findUnique({ where: { code: adj.assetCode } });
    if (!asset) throw new NotFoundException(`资产不存在：${adj.assetCode}`);
    const wallet = await (this.prisma as any).wallet.findUnique({ where: { id: adj.walletRef }, select: { id: true, ownerId: true } });
    if (!wallet || wallet.ownerId !== adj.ownerId) throw new BadRequestException('认损单的钱包不属于该客户');
    const amountMinor = BigInt(adj.amount);
    await this.transfers.assertFirmOpsBalance(asset.currency, amountMinor);
    const route = await this.resolveRoute(asset, wallet.id);
    const amountMajor = minorToMajor(adj.amount, asset.decimals);
    const row = await this.transfers.create({
      purpose: 'CLIENT_COMPENSATION', assetId: asset.id, amountMajor, ...route,
      customerId: adj.ownerId, customerNo: adj.ownerNo, reason: dto.reason, sourceCaseNo: adj.caseNo,
      sourceAdjustmentNo: adj.adjustmentNo, traceId: adj.traceId ?? null, createdByUserId: actor.userNo ?? actor.userId,
    });
    const impact = `向客户 ${adj.ownerNo} 补款 ${amountMajor} ${asset.currency}（认损单 ${adj.adjustmentNo}，对账案 ${adj.caseNo}）；公司运营户相应减少`;
    return this.submitForApproval({ ...row, asset }, impact, dto.reason, actor, { sourceAdjustmentNo: adj.adjustmentNo });
  }

  /** 退汇垫款：来源 = 定性为「入金被退汇」且尚未认领的账单行；金额锁定 = 账单行 − 客户可用。 */
  async initiateAdvance(dto: { caseNo: string; externalLineId: string; reason: string }, actor: ApprovalActorContext) {
    const disp = await (this.prisma as any).reconciliationDisposition.findFirst({ where: { caseNo: dto.caseNo, explainedExternalLineId: dto.externalLineId } });
    if (!disp || disp.outlet !== 'SUPPLEMENT' || disp.deferredTarget !== 'SUPPLEMENT_BOUNCE') throw new BadRequestException('只有定性为「入金被退汇」的账单行才需要垫款——先定性');
    if (disp.supplementNo) throw new BadRequestException(`这条账单行已转补单 ${disp.supplementNo}，不需要垫款`);
    const line = await this.supplementEvidence.assertClaimable({ caseNo: dto.caseNo, externalLineId: dto.externalLineId, dispositionNo: disp.dispositionNo, kind: 'SUPPLEMENT_BOUNCE' });
    const available = (await this.accounting.getCustomerAvailableBalance(line.ownerId, line.currency)).available;
    const shortfall = BigInt(line.amountMinor) - available;
    if (shortfall <= 0n) throw new BadRequestException('客户可用余额已够扣，不需要垫款，直接认领退汇');
    const blocking = await this.transfers.findBlockingBySource({ sourceExternalLineId: dto.externalLineId });
    if (blocking) throw new ConflictException(`这条账单行已有垫款单 ${blocking.transferNo}（${blocking.status}），不能再开`);
    const asset = await (this.prisma as any).asset.findUnique({ where: { id: line.assetId } });
    if (!asset) throw new NotFoundException(`资产不存在：${line.assetId}`);
    await this.transfers.assertFirmOpsBalance(asset.currency, shortfall);
    const route = await this.resolveRoute(asset, line.walletId);
    const amountMajor = minorToMajor(shortfall.toString(), asset.decimals);
    const row = await this.transfers.create({
      purpose: 'CLIENT_ADVANCE', assetId: asset.id, amountMajor, ...route,
      customerId: line.ownerId, customerNo: line.ownerNo ?? line.ownerId, reason: dto.reason, sourceCaseNo: dto.caseNo,
      sourceExternalLineId: dto.externalLineId, traceId: null, createdByUserId: actor.userNo ?? actor.userId,
    });
    const impact = `为客户 ${line.ownerNo ?? '-'} 垫付 ${amountMajor} ${asset.currency} 退汇差额（对账案 ${dto.caseNo}，账单行 ${line.externalRef ?? '-'}；`
      + `客户可用 ${minorToMajor(available.toString(), asset.decimals)}、退汇 ${line.amountMajor}）；垫款须三期追索`;
    return this.submitForApproval({ ...row, asset }, impact, dto.reason, actor, { externalRef: line.externalRef ?? null });
  }

  /** 出方运营户 + 中转结算户（法币）+ 入方客户钱包——提交时解析落库，批准时不再查。 */
  private async resolveRoute(asset: any, toWalletId: string) {
    const from = await this.systemWallets.resolve(asset.id, 'F_OPS');
    const via = asset.type === 'FIAT' ? await this.systemWallets.resolve(asset.id, 'F_SET') : null;
    return { fromWalletId: from.id as string, viaWalletId: (via?.id as string | undefined) ?? null, toWalletId };
  }

  private async submitForApproval(row: any, impact: string, reason: string, actor: ApprovalActorContext, extra: Record<string, unknown>) {
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL,
        entityRef: row.transferNo,
        traceId: row.traceId,
        // 铁律⑥：快照零 UUID——审批页把 objectSnapshot 原样渲染
        objectSnapshot: {
          transferNo: row.transferNo, purpose: row.purpose, customerNo: row.customerNo,
          amount: new Prisma.Decimal(row.amount).toFixed(row.asset.decimals), currency: row.asset.currency,
          sourceCaseNo: row.sourceCaseNo, ...extra, impact,
        },
      },
      { reason: impact, traceId: row.traceId },
      actor,
    );
    await (this.prisma as any).internalTransfer.update({ where: { transferNo: row.transferNo }, data: { approvalNo: approval.approvalNo } });
    await this.transferAudit({ ...row, approvalNo: approval.approvalNo }, {
      action: AuditActions.INTERNAL_TRANSFER_REQUESTED, reason, approvalNo: approval.approvalNo,
      metadata: { impact, sourceExternalRef: (extra as any).externalRef ?? null }, actor,
    });
    return { transferNo: row.transferNo as string, approvalNo: approval.approvalNo as string, status: InternalTransferStatus.PENDING_APPROVAL };
  }

  // ── 撤回（金库，待批时）────────────────────────────────────────────────

  async cancel(transferNo: string, dto: { reason: string }, actor: ApprovalActorContext) {
    const row = await this.transfers.findByNo(transferNo);
    if (row.status !== InternalTransferStatus.PENDING_APPROVAL) throw new BadRequestException(`划转单 ${transferNo} 已在 ${row.status}，钱已在路上或已了结，不能撤回`);
    if (row.approvalNo) await this.approvals.cancel(row.approvalNo, { reason: dto.reason } as any, actor);
    const updated = await this.transfers.transition(transferNo, InternalTransferStatus.CANCELLED, { failureNote: dto.reason });
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_CANCELLED, reason: dto.reason, fromStatus: row.status, toStatus: updated.status, actor });
    return { transferNo, status: updated.status as string };
  }

  // ── 审批裁决 ──────────────────────────────────────────────────────────

  @OnEvent('workflow.internal-transfer.decided', { async: true })
  async onDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'CANCELLED') return; // 撤回由 cancel() 自己收口（它先撤审批单再翻状态）
    let row: any;
    try { row = await this.transfers.findByNo(event.entityRef); } catch (err) { if (err instanceof NotFoundException) return; throw err; }
    if (row.status !== InternalTransferStatus.PENDING_APPROVAL) return;

    if (event.decision !== 'APPROVED') {
      const note = event.decision === 'EXPIRED' ? '审批超时' : (event.decisionReason ?? 'CFO 拒绝');
      const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.REJECTED, { failureNote: note });
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_REJECTED, reason: note, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    // 批准时再查一次运营户余额（提交查一次、批准查一次——与 B 批退汇同一纪律）
    const amountMinor = majorToMinor(row.amount, row.asset.decimals);
    try {
      await this.transfers.assertFirmOpsBalance(row.asset.currency, amountMinor);
    } catch (err) {
      const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.FAILED, { failureReasonCode: 'INSUFFICIENT_FIRM_BALANCE', failureNote: (err as Error).message });
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'INSUFFICIENT_FIRM_BALANCE', reason: (err as Error).message, approvalNo: event.approvalNo, causationId: event.approvalId, fromStatus: row.status, toStatus: updated.status });
      return;
    }

    const leg = await this.createLeg(row, 1);
    const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.EXECUTING, { executedAt: new Date() });
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_EXECUTION_STARTED, reason: 'CFO 批准，第一腿资金单建立', approvalNo: event.approvalNo, causationId: event.approvalId, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  /** 腿 1：法币 运营户 → 结算户 / 加密币 运营户 → 客户；腿 2（法币）：结算户 → 客户。资金单在此诞生（spec §4）。 */
  private async createLeg(row: any, legSeq: 1 | 2) {
    const isFiat = row.asset.type === 'FIAT';
    const fromId = legSeq === 1 ? row.fromWalletId : row.viaWalletId;
    const toId = isFiat && legSeq === 1 ? row.viaWalletId : row.toWalletId;
    const [from, to] = await Promise.all([
      (this.prisma as any).wallet.findUnique({ where: { id: fromId } }),
      (this.prisma as any).wallet.findUnique({ where: { id: toId } }),
    ]);
    return this.fundsOrders.create({
      internalTransferId: row.id, legSeq, initialStatus: FundsOrderStatus.CREATED,
      assetId: row.assetId, amount: String(row.amount), netAmount: String(row.amount),
      fromWalletId: from?.id ?? null, fromAddress: from?.address ?? null, fromIban: from?.iban ?? null,
      toWalletId: to?.id ?? null, toAddress: to?.address ?? null, toIban: to?.iban ?? null,
      traceId: row.traceId ?? undefined,
    });
  }

  // ── 腿事件 ───────────────────────────────────────────────────────────

  @OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
  async handleFundsOrderChanged(event: FundsOrderStatusChangedEvent) {
    if (!event.parent.internalTransferId) return;
    const row = await (this.prisma as any).internalTransfer.findUnique({ where: { id: event.parent.internalTransferId }, include: { asset: true } });
    if (!row) return;
    const leg = await this.fundsOrders.findById(event.fundsOrderId);
    if (!leg) return;
    switch (event.newStatus) {
      case FundsOrderStatus.SUBMITTED: await this.onLegSubmitted(row, leg); break;
      case FundsOrderStatus.CONFIRMED: await this.onLegConfirmed(row, leg); break;
      case FundsOrderStatus.FAILED:
      case FundsOrderStatus.TIMEOUT: await this.onLegFailed(row, leg, event.newStatus); break;
      default: break;
    }
  }

  /** 提交那一步就铸参考号（镜像行与落账同号，对账 Pass 1 精确配对），随后模拟托管方写两行对账单。 */
  private async onLegSubmitted(row: any, leg: any) {
    const isCrypto = (row.asset.type ?? 'CRYPTO').toUpperCase() === 'CRYPTO';
    const patch = isCrypto
      ? (leg.txHash ? {} : { txHash: fakeChainTxHash(leg.fundsOrderNo) })
      : (leg.referenceNo ? {} : { referenceNo: fakeBankRef(leg.fundsOrderNo, leg.createdAt ?? new Date()) });
    if (Object.keys(patch).length) await (this.prisma as any).fundsOrder.update({ where: { id: leg.id }, data: patch });
    const stamped = { ...leg, ...patch }; // 不依赖 update 的返回形状——真 Prisma 回整行，mock 未必
    const externalRef = this.fundsOrders.resolveExternalRef({ ...stamped, asset: row.asset }) ?? stamped.fundsOrderNo;
    await this.custodianStatement.recordLegMovement({
      fundsOrderNo: stamped.fundsOrderNo, fromWalletId: stamped.fromWalletId, toWalletId: stamped.toWalletId,
      assetCode: row.asset.code, assetType: isCrypto ? 'CRYPTO' : 'FIAT',
      amountMinor: majorToMinor(stamped.amount, row.asset.decimals), externalRef, at: new Date(),
      description: `Simulated custodian statement — internal transfer ${row.transferNo} leg ${stamped.legSeq}`,
    });
  }

  /** 先账后状态：分录先落，再收口清算；法币腿 1 落完建腿 2；最后一腿落完订单 SUCCESS。落账失败：停在原地，不重试。 */
  private async onLegConfirmed(row: any, leg: any) {
    if (row.status !== InternalTransferStatus.EXECUTING) return;
    const isFiat = row.asset.type === 'FIAT';
    const finalLeg = !isFiat || leg.legSeq === 2;
    try {
      if (isFiat && leg.legSeq === 1) await this.postOpsToSet(row, leg);
      else await this.postFinalLeg(row, leg);
    } catch (err) {
      await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'POSTING_FAILED', reason: `腿 ${leg.legSeq} 落账失败：${(err as Error).message}——订单停在执行中、腿停在已确认，不重试`, fundsOrderNo: leg.fundsOrderNo });
      return;
    }
    await this.fundsOrders.advance(leg.id, FundsOrderAction.CLEAR, 'INTERNAL_TRANSFER_WORKFLOW');
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_LEG_POSTED, reason: `腿 ${leg.legSeq} 已确认，分录落账并清算`, fundsOrderNo: leg.fundsOrderNo, metadata: { legSeq: leg.legSeq } });
    if (!finalLeg) { await this.createLeg(row, 2); return; }
    const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.SUCCESS, { settledAt: new Date() });
    await this.transferAudit(row, {
      action: AuditActions.INTERNAL_TRANSFER_SETTLED,
      reason: row.purpose === 'CLIENT_COMPENSATION' ? '补款到账，客户余额复位' : '垫款到账，客户可用余额足以认领退汇',
      fromStatus: row.status, toStatus: updated.status,
    });
  }

  private async onLegFailed(row: any, leg: any, newStatus: string) {
    if (row.status !== InternalTransferStatus.EXECUTING) return;
    const note = row.asset.type === 'FIAT' && leg.legSeq === 2
      ? `腿 2 ${newStatus}：款项停在结算户，财资人工处理（腿 1 已落账，账与钱一致）`
      : `腿 ${leg.legSeq} ${newStatus}：钱没动，可重新发起`;
    const updated = await this.transfers.transition(row.transferNo, InternalTransferStatus.FAILED, { failureReasonCode: 'LEG_FAILED', failureNote: note });
    await this.transferAudit(row, { action: AuditActions.INTERNAL_TRANSFER_FAILED, outcome: AuditOutcome.FAILED, reasonCode: 'LEG_FAILED', reason: note, fundsOrderNo: leg.fundsOrderNo, fromStatus: row.status, toStatus: updated.status });
  }

  // ── 分录（spec §5）────────────────────────────────────────────────────

  private async accounts(row: any) {
    const ledger = TB_LEDGERS[row.asset.currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new NotFoundException(`资产 ${row.asset.code} 解析不出账本 ledger（currency=${row.asset.currency}）`);
    const sys = (code: number) => this.accounting.resolveTbAccountId({ code, ledger, ownerType: 'SYSTEM' });
    return {
      ledger,
      firmOps: () => sys(TB_ACCOUNT_CODES.FIRM_OPS),
      firmSet: () => sys(TB_ACCOUNT_CODES.FIRM_SET),
      firmAsset: () => sys(TB_ACCOUNT_CODES.FIRM_ASSET),
      clientAsset: () => sys(TB_ACCOUNT_CODES.CLIENT_ASSET),
      clientPayable: () => this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: row.customerId }),
    };
  }

  private evidence(row: any, leg: any, eventCode: string, debitCode: number, creditCode: number, debitWalletRef: string, creditWalletRef: string) {
    return {
      sourceType: 'INTERNAL_TRANSFER', sourceNo: row.transferNo, eventCode, traceId: row.traceId,
      debitCode: TB_CODE_TO_COA[debitCode], creditCode: TB_CODE_TO_COA[creditCode],
      assetCurrency: row.asset.currency, // ⚠ currency 不是 code（USDT-TRON vs USDT）
      actorType: 'SYSTEM', actorId: 'INTERNAL_TRANSFER_WORKFLOW',
      memo: `${row.purpose === 'CLIENT_COMPENSATION' ? '补款' : '垫付'} ${row.transferNo} leg ${leg.legSeq}（对账案 ${row.sourceCaseNo}）`,
      debitWalletRef, creditWalletRef,
      externalRef: this.fundsOrders.resolveExternalRef({ ...leg, asset: row.asset }),
      isExternalCrossing: true,
    };
  }

  /** 法币腿 1：借 运营户 / 贷 结算户（81）——出方运营户行、入方结算户行；公司资产总量不变。 */
  private async postOpsToSet(row: any, leg: any) {
    const a = await this.accounts(row);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    await this.accounting.executeTransfer({
      debitAccountId: await a.firmOps(), creditAccountId: await a.firmSet(), amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_OPS_TO_SET,
      evidence: this.evidence(row, leg, 'INTERNAL_TRANSFER_OPS_TO_SET', TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FIRM_SET, row.fromWalletId, row.viaWalletId),
    });
  }

  /** 最后一腿（法币腿 2 / 加密币腿 1）：公司放出（82）+ 客户收到（83），一步两笔，任一失败整步失败。 */
  private async postFinalLeg(row: any, leg: any) {
    const a = await this.accounts(row);
    const amount = majorToMinor(leg.amount, row.asset.decimals);
    const isFiat = row.asset.type === 'FIAT';
    const firmCode = isFiat ? TB_ACCOUNT_CODES.FIRM_SET : TB_ACCOUNT_CODES.FIRM_OPS;
    const firmWallet = isFiat ? row.viaWalletId : row.fromWalletId;
    await this.accounting.executeTransfer({
      debitAccountId: isFiat ? await a.firmSet() : await a.firmOps(), creditAccountId: await a.firmAsset(), amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_FIRM_OUT,
      evidence: this.evidence(row, leg, 'INTERNAL_TRANSFER_FIRM_OUT', firmCode, TB_ACCOUNT_CODES.FIRM_ASSET, firmWallet, firmWallet),
    });
    // 客户侧事件码按用途分——客户端对账单靠它显示「平台补款 / 平台垫付」（spec §11）
    const clientEvent = row.purpose === 'CLIENT_COMPENSATION' ? 'INTERNAL_TRANSFER_COMPENSATION_IN' : 'INTERNAL_TRANSFER_ADVANCE_IN';
    await this.accounting.executeTransfer({
      debitAccountId: await a.clientAsset(), creditAccountId: await a.clientPayable(), amount, ledger: a.ledger,
      code: TB_TRANSFER_CODES.INTERNAL_TRANSFER_CLIENT_IN,
      evidence: this.evidence(row, leg, clientEvent, TB_ACCOUNT_CODES.CLIENT_ASSET, TB_ACCOUNT_CODES.CLIENT_PAYABLE, row.toWalletId, row.toWalletId),
    });
  }

  // ── 审计（七码共用信封）──────────────────────────────────────────────

  private async transferAudit(row: any, patch: {
    action: string; reason?: string; outcome?: AuditOutcome; reasonCode?: string;
    fromStatus?: string; toStatus?: string; approvalNo?: string; causationId?: string; fundsOrderNo?: string;
    metadata?: Record<string, unknown>; actor?: ApprovalActorContext;
  }): Promise<void> {
    const subjects: AuditSubjectInput[] = [
      { subjectType: AuditEntityTypes.INTERNAL_TRANSFER, subjectNo: row.transferNo, subjectRole: AuditSubjectRole.PRIMARY },
      { subjectType: 'CUSTOMER', subjectNo: row.customerNo, subjectRole: AuditSubjectRole.OWNER },
      { subjectType: 'RECONCILIATION_CASE', subjectNo: row.sourceCaseNo, subjectRole: AuditSubjectRole.RELATED },
    ];
    if (row.sourceAdjustmentNo) subjects.push({ subjectType: AuditEntityTypes.RECON_ADJUSTMENT, subjectNo: row.sourceAdjustmentNo, subjectRole: AuditSubjectRole.RELATED });
    if (patch.approvalNo) subjects.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: patch.approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
    if (patch.fundsOrderNo) subjects.push({ subjectType: 'FUNDS_ORDER', subjectNo: patch.fundsOrderNo, subjectRole: AuditSubjectRole.RELATED });
    const decimals = row.asset?.decimals ?? 0;
    const input: any = {
      action: patch.action, actionDomain: 'TREASURY', category: AuditCategory.BUSINESS,
      workflowType: AuditBusinessWorkflowTypes.INTERNAL_TRANSFER,
      primarySubjectType: AuditEntityTypes.INTERNAL_TRANSFER, primarySubjectNo: row.transferNo,
      ownerCustomerNo: row.customerNo, subjects,
      outcome: patch.outcome, reasonCode: patch.reasonCode, reason: patch.reason,
      fromStatus: patch.fromStatus, toStatus: patch.toStatus,
      approvalNo: patch.approvalNo, causationId: patch.causationId,
      amount: new Prisma.Decimal(row.amount).toFixed(decimals),
      effectiveDate: toBusinessDate(new Date()),
      // REQUESTED 起划转单自己的旅程（NONE，不传 correlationId）；其余继承（INHERIT）
      ...(patch.action === AuditActions.INTERNAL_TRANSFER_REQUESTED ? {} : { correlationId: row.traceId }),
      requestId: `${patch.action}_${row.transferNo}_${randomUUID()}`,
      metadata: { transferNo: row.transferNo, purpose: row.purpose, sourceCaseNo: row.sourceCaseNo, sourceAdjustmentNo: row.sourceAdjustmentNo ?? null, fundsOrderNo: patch.fundsOrderNo ?? null, ...(patch.metadata ?? {}) },
      sourcePlatform: patch.actor ? 'ADMIN' : 'SYSTEM',
    };
    if (patch.actor) {
      const display = patch.actor.userNo ?? patch.actor.userId;
      await this.auditLogs.recordByActor(input, { actorType: 'ADMIN', actorNo: display, actorDisplayName: display, actorRolesAtTime: patch.actor.roleCodes ?? [] });
    } else {
      await this.auditLogs.recordSystem(input);
    }
  }
}
```

⚠ `AuditLogsService.assertActionSpec` 对 INHERIT 码会校验 `correlationId` 非空——`traceId` 在 `create()` 里恒有值（认损单的 traceId 或 `randomUUID()`），所以这里能直接传；若真校验还要求别的（跑 e2e 时报 `correlation` 类错误），照 `adjustment.service.spec.ts:439` 那条用例的读法调整，不要改成静默吞。

- [ ] **Step 5: 模块 + AppModule**

`internal-transfers.module.ts`：

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';
import { FundsLayerModule } from '../../funds-layer/funds-layer.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { ReconciliationModule } from '../../clearing-settle/reconciliation/reconciliation.module';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { InternalTransferApprovalService } from './internal-transfer-approval.service';
import { InternalTransferController } from './internal-transfer.controller';

/**
 * 平账二期 · 内部划转单（第四类订单）：公司 → 客户的补款 / 垫款。
 * 依赖对账域两样东西：SupplementEvidenceService（垫款查账单行）、SimulatedCustodianStatementService（腿提交时写回单）；
 * 对账读面反过来查本表时直接走 Prisma（同 resolveSupplementRef 读业务域表的先例），不引本模块，避免环。
 */
@Module({
  imports: [PrismaModule, AuditLogsModule, TigerBeetleModule, FundsOrdersModule, FundsLayerModule, ApprovalsModule, ReconciliationModule],
  controllers: [InternalTransferController],
  providers: [InternalTransferService, InternalTransferWorkflowService, InternalTransferApprovalService],
  exports: [InternalTransferService],
})
export class InternalTransfersModule {}
```

（`InternalTransferController` 在 Task 8 建；本任务先建一个空壳文件让模块能编译：

```ts
import { Controller } from '@nestjs/common';
@Controller('admin/internal-transfers')
export class InternalTransferController {}
```
Task 8 用完整实现覆盖它。）

`src/app.module.ts`：import 行加 `import { InternalTransfersModule } from './modules/asset-treasury/internal-transfers/internal-transfers.module';`，`imports: [...]` 里在 `ReconciliationModule,` 之后加 `InternalTransfersModule,`。

- [ ] **Step 6: 跑确认绿 + tsc + 开机考**

```bash
npx jest src/modules/asset-treasury/internal-transfers
npx tsc --noEmit -p tsconfig.json
bash scripts/stack.sh up      # self 栈重启，看后端起得来（AppModule 装配无环、无缺 provider）
```
Expected：jest 全绿；tsc 0 错；`stack.sh status` 显示 self 后端 up。

- [ ] **Step 7: Commit**

```bash
git add src/modules/asset-treasury/internal-transfers src/app.module.ts
git commit -m "feat(internal-transfers): 划转工作流——补款 / 垫款发起送 CFO、批准建腿、提交写回单、确认落账（81/82/83）并清算、失败三种原因码；审批 handler + 模块装配（平账二期 Task 7）"
```

本任务过哪几条：任何持久状态变化（七码审计 + requestId）｜ 动了钱（同步直调；资金单 1:1；不新增科目；`verify:coa` 在 Task 9 后跑）｜ 该走 maker-checker（`INTERNAL_TRANSFER_APPROVAL` 正门）｜ 涉及金额 ｜ 对外识别 ｜ tsc ①。

---

### Task 8: 控制器 + 案件读面回挂 + 退汇守卫文案

**Files:**
- Modify: `src/modules/asset-treasury/internal-transfers/internal-transfer.controller.ts`（替换 Task 7 的空壳）
- Modify: `scripts/verify-rbac.ts`（`S7_PENDING_DEAD_ROWS` 清空）
- Create: `src/modules/clearing-settle/reconciliation/disposition/funding-next-step.ts`
- Create: `src/modules/clearing-settle/reconciliation/disposition/funding-next-step.spec.ts`
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts`（`FlowComparisonRow.transfer`；列表行 `pendingFunding`）
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`（getCase 回挂；listCases 徽标）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:2020`（守卫文案）

**Interfaces:**
- Produces: 五端点（见 Task 3 路由）；`FlowComparisonRow.transfer?: { transferNo; purpose; status } | null`；`nextStep.kind = 'COMPENSATION' | 'ADVANCE'`；列表行 `pendingFunding: { kind: 'COMPENSATION' | 'ADVANCE'; status: 'PENDING' | 'IN_PROGRESS' } | null`；纯函数 `deriveFundingNextStep(facts)`

- [ ] **Step 1: 写失败的单测（纯函数）**

`funding-next-step.spec.ts`：

```ts
import { deriveFundingNextStep } from './funding-next-step';

describe('deriveFundingNextStep（平账二期 Task 8）', () => {
  const base = { book: 'CLIENT' as const, customerNo: 'CU1', walletNo: 'WA1' };
  const postedLoss = { adjustmentNo: 'ADJ1', status: 'POSTED', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', amount: '7500000' };

  it('认损已落账、无划转单 → 待补款', () => {
    expect(deriveFundingNextStep({ ...base, adjustment: postedLoss }).nextStep).toEqual({ kind: 'COMPENSATION', adjustmentNo: 'ADJ1', amount: '7500000', customerNo: 'CU1', walletNo: 'WA1' });
  });
  it('认损未落账 → 无', () => {
    expect(deriveFundingNextStep({ ...base, adjustment: { ...postedLoss, status: 'PENDING_APPROVAL' } }).nextStep).toBeUndefined();
  });
  it('公司池核销不是补款来源', () => {
    expect(deriveFundingNextStep({ ...base, book: 'FIRM', adjustment: { ...postedLoss, reasonCode: 'UNEXPLAINED_WRITE_OFF' } }).nextStep).toBeUndefined();
  });
  it('已有划转单在走 / 已成功 → 只回挂状态，不再给按钮', () => {
    const r = deriveFundingNextStep({ ...base, adjustment: postedLoss, transfer: { transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: 'EXECUTING' } });
    expect(r.transfer).toEqual({ transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status: 'EXECUTING' });
    expect(r.nextStep).toBeUndefined();
  });
  it('划转单失败 / 拒绝 / 撤回 → 回挂状态且按钮回来', () => {
    for (const status of ['FAILED', 'REJECTED', 'CANCELLED']) {
      const r = deriveFundingNextStep({ ...base, adjustment: postedLoss, transfer: { transferNo: 'ITR1', purpose: 'CLIENT_COMPENSATION', status } });
      expect(r.transfer?.status).toBe(status);
      expect(r.nextStep?.kind).toBe('COMPENSATION');
    }
  });
  it('退汇行余额不足 → 待垫款，金额 = 账单行 − 可用', () => {
    const r = deriveFundingNextStep({ ...base, bounce: { externalLineId: 'line-1', lineAmountMinor: 120_000n, availableMinor: 30_000n, supplementNo: null } });
    expect(r.nextStep).toEqual({ kind: 'ADVANCE', amount: '90000', externalLineId: 'line-1', customerNo: 'CU1', walletNo: 'WA1', available: '30000', lineAmount: '120000' });
  });
  it('余额够扣 / 已转补单 → 无', () => {
    expect(deriveFundingNextStep({ ...base, bounce: { externalLineId: 'line-1', lineAmountMinor: 120_000n, availableMinor: 120_000n, supplementNo: null } }).nextStep).toBeUndefined();
    expect(deriveFundingNextStep({ ...base, bounce: { externalLineId: 'line-1', lineAmountMinor: 120_000n, availableMinor: 0n, supplementNo: 'DEP1' } }).nextStep).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition/funding-next-step.spec.ts` → FAIL

- [ ] **Step 3: 纯函数**

`funding-next-step.ts`：

```ts
// 平账二期（spec §7.2 / §7.3）：案件行上的「补款 / 垫款」下一步——纯函数，读面喂事实。
export interface FundingTransferRef { transferNo: string; purpose: string; status: string }
export interface FundingFacts {
  book: 'CLIENT' | 'FIRM';
  customerNo: string | null; walletNo: string | null;
  adjustment?: { adjustmentNo: string; status: string; reasonCode: string; amount: string } | null;
  transfer?: FundingTransferRef | null;
  bounce?: { externalLineId: string; lineAmountMinor: bigint; availableMinor: bigint; supplementNo: string | null } | null;
}
export type FundingNextStep =
  | { kind: 'COMPENSATION'; adjustmentNo: string; amount: string; customerNo: string | null; walletNo: string | null }
  | { kind: 'ADVANCE'; amount: string; externalLineId: string; customerNo: string | null; walletNo: string | null; available: string; lineAmount: string };

const TERMINAL_FAIL = new Set(['FAILED', 'REJECTED', 'CANCELLED']);

export function deriveFundingNextStep(f: FundingFacts): { nextStep?: FundingNextStep; transfer?: FundingTransferRef } {
  const out: { nextStep?: FundingNextStep; transfer?: FundingTransferRef } = {};
  if (f.transfer) out.transfer = { transferNo: f.transfer.transferNo, purpose: f.transfer.purpose, status: f.transfer.status };
  const noLiveTransfer = !f.transfer || TERMINAL_FAIL.has(f.transfer.status);
  if (f.book !== 'CLIENT') return out;
  if (f.adjustment && f.adjustment.status === 'POSTED' && f.adjustment.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' && noLiveTransfer) {
    out.nextStep = { kind: 'COMPENSATION', adjustmentNo: f.adjustment.adjustmentNo, amount: f.adjustment.amount, customerNo: f.customerNo, walletNo: f.walletNo };
    return out;
  }
  if (f.bounce && !f.bounce.supplementNo && noLiveTransfer) {
    const shortfall = f.bounce.lineAmountMinor - f.bounce.availableMinor;
    if (shortfall > 0n) {
      out.nextStep = { kind: 'ADVANCE', amount: shortfall.toString(), externalLineId: f.bounce.externalLineId, customerNo: f.customerNo, walletNo: f.walletNo, available: f.bounce.availableMinor.toString(), lineAmount: f.bounce.lineAmountMinor.toString() };
    }
  }
  return out;
}
```

- [ ] **Step 4: 读面接线**

`dto/reconciliation.dto.ts`：`FlowComparisonRow` 加
```ts
  // 平账二期：这条差异行牵出的划转单（补款 / 垫款）回挂——只在客户账簿行上出现
  transfer?: { transferNo: string; purpose: string; status: string } | null;
```
若列表行有独立类型，加 `pendingFunding: { kind: 'COMPENSATION' | 'ADVANCE'; status: 'PENDING' | 'IN_PROGRESS' } | null`（没有独立类型则只在 `listCases` 返回体上加字段）。

`reconciliation-query.service.ts`：
1. 构造函数注入 `AccountingService`（`import { AccountingService } from '../../../accounting/tigerbeetle/accounting.service';`；`ReconciliationModule` 已 import `TigerBeetleModule`）。
2. import `deriveFundingNextStep` from `../disposition/funding-next-step`。
3. `getCase()`：把下方的 `caseAdjustments` 查询整段**上移**到 `// ── 平账一期半（spec §3/§8）：行注解` 之前（变量名不变），并在其后加：
```ts
    // 平账二期（spec §7.2/§7.3）：补款 / 垫款回挂——读本案的划转单（直查 internal_transfers，
    // 与 resolveSupplementRef 读业务域表同款先例），按来源锚回贴到行上。
    const adjustmentByNo = new Map(caseAdjustments.map((a) => [a.adjustmentNo, a]));
    const caseTransfers = (await (this.prisma as any).internalTransfer.findMany({
      where: { sourceCaseNo: kase.caseNo }, orderBy: { createdAt: 'desc' },
      select: { transferNo: true, purpose: true, status: true, sourceAdjustmentNo: true, sourceExternalLineId: true },
    })) as Array<{ transferNo: string; purpose: string; status: string; sourceAdjustmentNo: string | null; sourceExternalLineId: string | null }>;
    const transferByAdjustment = new Map<string, (typeof caseTransfers)[number]>();
    const transferByLine = new Map<string, (typeof caseTransfers)[number]>();
    for (const t of caseTransfers) { // 最新在前，只留每个来源最新的一张
      if (t.sourceAdjustmentNo && !transferByAdjustment.has(t.sourceAdjustmentNo)) transferByAdjustment.set(t.sourceAdjustmentNo, t);
      if (t.sourceExternalLineId && !transferByLine.has(t.sourceExternalLineId)) transferByLine.set(t.sourceExternalLineId, t);
    }
    const walletOwner = kase.walletRef && !kase.walletRef.startsWith('XREF:')
      ? await (this.prisma as any).wallet.findUnique({ where: { id: kase.walletRef }, select: { walletNo: true, ownerId: true } })
      : null;
    let availableMinorCache: bigint | null = null;
    const availableMinor = async (): Promise<bigint> => {
      if (availableMinorCache === null) {
        availableMinorCache = walletOwner?.ownerId ? (await this.accounting.getCustomerAvailableBalance(walletOwner.ownerId, caseCurrency)).available : 0n;
      }
      return availableMinorCache;
    };
```
   （`caseCurrency` 在下面几行才声明——把 `assetRow` / `caseCurrency` 那两句也一并上移到这段之前。）
4. 行循环里，紧接超期解锁块之后加：
```ts
      // 平账二期：补款 / 垫款——案子 RESOLVED 之后也要给（认损让案子愈了，补款是对客户的交代）
      if (d && caseBook === 'CLIENT') {
        const adj = d.adjustmentNo ? (adjustmentByNo.get(d.adjustmentNo) ?? null) : null;
        const bounce = d.outlet === 'SUPPLEMENT' && d.deferredTarget === 'SUPPLEMENT_BOUNCE' && r.externalLine?.id
          ? { externalLineId: r.externalLine.id, lineAmountMinor: BigInt(r.externalLine.amount), availableMinor: await availableMinor(), supplementNo: d.supplementNo ?? null }
          : null;
        const transfer = (d.adjustmentNo ? transferByAdjustment.get(d.adjustmentNo) : undefined) ?? (r.externalLine?.id ? transferByLine.get(r.externalLine.id) : undefined) ?? null;
        const funding = deriveFundingNextStep({
          book: 'CLIENT', customerNo: kase.ownerNo ?? null, walletNo: walletOwner?.walletNo ?? null,
          adjustment: adj ? { adjustmentNo: adj.adjustmentNo, status: adj.status, reasonCode: adj.reasonCode, amount: adj.amount } : null,
          transfer, bounce,
        });
        if (funding.transfer) r.transfer = funding.transfer;
        if (funding.nextStep) r.nextStep = funding.nextStep;
      }
```
5. `listCases()`：在 `decorated` 之前加徽标计算：
```ts
    // 平账二期：列表徽标——待补款 / 待垫款 / 进行中，金库一眼找到活
    const lossAdjustments = caseNos.length
      ? ((await (this.prisma as any).reconciliationAdjustment.findMany({ where: { caseNo: { in: caseNos }, status: 'POSTED', reasonCode: 'UNEXPLAINED_CLIENT_LOSS' }, select: { caseNo: true, adjustmentNo: true } })) as Array<{ caseNo: string; adjustmentNo: string }>)
      : [];
    const bounceDispositions = caseNos.length
      ? ((await (this.prisma as any).reconciliationDisposition.findMany({ where: { caseNo: { in: caseNos }, outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_BOUNCE', supplementNo: null }, select: { caseNo: true, explainedExternalLineId: true, walletRef: true } })) as Array<{ caseNo: string; explainedExternalLineId: string | null; walletRef: string }>)
      : [];
    const liveTransfers = caseNos.length
      ? ((await (this.prisma as any).internalTransfer.findMany({ where: { sourceCaseNo: { in: caseNos }, status: { in: ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS'] } }, select: { sourceCaseNo: true, purpose: true, status: true, sourceAdjustmentNo: true, sourceExternalLineId: true } })) as Array<{ sourceCaseNo: string; purpose: string; status: string; sourceAdjustmentNo: string | null; sourceExternalLineId: string | null }>)
      : [];
    const fundingByCase = new Map<string, { kind: 'COMPENSATION' | 'ADVANCE'; status: 'PENDING' | 'IN_PROGRESS' }>();
    for (const a of lossAdjustments) {
      const t = liveTransfers.find((x) => x.sourceAdjustmentNo === a.adjustmentNo);
      if (t?.status === 'SUCCESS') continue;
      fundingByCase.set(a.caseNo, { kind: 'COMPENSATION', status: t ? 'IN_PROGRESS' : 'PENDING' });
    }
    for (const b of bounceDispositions) {
      if (!b.explainedExternalLineId || fundingByCase.has(b.caseNo)) continue;
      const t = liveTransfers.find((x) => x.sourceExternalLineId === b.explainedExternalLineId);
      if (t?.status === 'SUCCESS') continue;
      if (t) { fundingByCase.set(b.caseNo, { kind: 'ADVANCE', status: 'IN_PROGRESS' }); continue; }
      const line = await (this.prisma as any).externalStatementLine.findUnique({ where: { id: b.explainedExternalLineId }, select: { amount: true } });
      const wallet = await (this.prisma as any).wallet.findUnique({ where: { id: b.walletRef }, select: { ownerId: true } });
      const row = rows.find((r: any) => r.caseNo === b.caseNo);
      const currency = row ? (await (this.prisma as any).asset.findUnique({ where: { code: row.assetCode }, select: { currency: true } }))?.currency : null;
      if (!line || !wallet?.ownerId || !currency) continue;
      const available = (await this.accounting.getCustomerAvailableBalance(wallet.ownerId, currency)).available;
      if (BigInt(line.amount.toString()) > available) fundingByCase.set(b.caseNo, { kind: 'ADVANCE', status: 'PENDING' });
    }
```
   `decorated` 的返回对象里加 `pendingFunding: fundingByCase.get(r.caseNo) ?? null,`。

`deposit-workflow.service.ts` `assertClawbackBalance` 的文案：`待二期公司垫款与三期追索` 改为 `先由金库在案子上「发起垫款」补足差额再认领`。

- [ ] **Step 5: 控制器（覆盖空壳）+ 清空 S7 白名单**

`internal-transfer.controller.ts`：

```ts
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferWorkflowService } from './internal-transfer-workflow.service';
import { CancelInternalTransferDto, InitiateAdvanceDto, InitiateCompensationDto, InternalTransferListQueryDto } from './dto/internal-transfer.dto';

/** 平账二期 · 内部划转单端点。发起 / 撤回归金库（INTERNAL_TRANSFER_WRITE），列表 / 详情归 READ；写动作全在 workflow。 */
@ApiTags('Admin - Internal Transfers (平账二期·内部划转单)')
@ApiBearerAuth()
@Controller('admin/internal-transfers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class InternalTransferController {
  constructor(
    private readonly workflow: InternalTransferWorkflowService,
    private readonly transfers: InternalTransferService,
  ) {}

  /** 同 adjustment.controller.ts：整个 actor（UUID + userNo + roleCodes）往下传，SoD 自审拦截才比得上。 */
  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return { actorType: 'ADMIN', userId: user.userId || user.sub, userNo: user.userNo, role: user.role, roleCodes: user.roleCodes || (user.role ? [user.role] : []) };
  }

  @Post('compensation')
  @ApiOperation({ summary: '发起补款（来源 = 已落账的客户池认损调账单）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/internal-transfers/compensation'))
  compensation(@Body() dto: InitiateCompensationDto, @Req() req: any) {
    return this.workflow.initiateCompensation(dto, this.buildActor(req));
  }

  @Post('advance')
  @ApiOperation({ summary: '发起垫款（来源 = 定性为退汇且余额不足的账单行）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/internal-transfers/advance'))
  advance(@Body() dto: InitiateAdvanceDto, @Req() req: any) {
    return this.workflow.initiateAdvance(dto, this.buildActor(req));
  }

  @Post(':transferNo/cancel')
  @ApiOperation({ summary: '撤回待批的划转单（仅开单人）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/internal-transfers/:transferNo/cancel'))
  cancel(@Param('transferNo') transferNo: string, @Body() dto: CancelInternalTransferDto, @Req() req: any) {
    return this.workflow.cancel(transferNo, dto, this.buildActor(req));
  }

  @Get()
  @ApiOperation({ summary: '划转单列表' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/internal-transfers'))
  list(@Query() q: InternalTransferListQueryDto) {
    return this.transfers.list(q);
  }

  @Get(':transferNo')
  @ApiOperation({ summary: '划转单详情（含资金单腿）' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/internal-transfers/:transferNo'))
  detail(@Param('transferNo') transferNo: string) {
    return this.transfers.getView(transferNo);
  }
}
```

`scripts/verify-rbac.ts`：`S7_PENDING_DEAD_ROWS` 恢复为 `new Set<string>([])`，注释改成「平账二期 Task 8（2026-09-05）落地五条控制器后清空——白名单再次为空」。

- [ ] **Step 6: 跑测试 + tsc + verify:rbac + 真 HTTP 冒烟**

```bash
npx jest src/modules/clearing-settle/reconciliation src/modules/asset-treasury/internal-transfers src/modules/trading/deposit-transactions
npx tsc --noEmit -p tsconfig.json
bash scripts/stack.sh up
bash scripts/on-stack.sh self verify:rbac
```
Expected：全绿；`verify:rbac` S7 白名单为空仍绿（五条路由都有真实端点）。再用 `treasury@fiatx.com` / `123456` 登录 self 栈拿 token 打 `GET /admin/internal-transfers` 期望 200 `{ items: [], total: 0 }`；用 `auditor@` 打 `POST /admin/internal-transfers/compensation` 期望 403（内审零 Act）。端口看 `.stackports`。

- [ ] **Step 7: Commit**

```bash
git add src/modules/asset-treasury/internal-transfers src/modules/clearing-settle/reconciliation src/modules/trading/deposit-transactions/deposit-workflow.service.ts scripts/verify-rbac.ts
git commit -m "feat(recon+internal-transfers): 五条划转端点上线、S7 白名单清空；案件读面回挂补款 / 垫款下一步与划转状态（RESOLVED 后仍给补款）、列表待补款 / 待垫款徽标；退汇余额不足文案指路垫款（平账二期 Task 8）"
```

本任务过哪几条：新增 admin 端点（5，登记 + sync + 重启已在 Task 3；本任务真端点落地）｜ 改了交易三域（充值域一句文案）｜ 对外识别（`externalLineId` 只作隐藏锚随 nextStep 下发，不渲染）｜ tsc ①。

---

### Task 9: e2e 全链——认损 → 补款（加密币一腿）/ 垫款 → 认领（法币两腿）/ 拒绝路径

**Files:**
- Create: `test/recon-internal-transfer.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 4–8 全部；夹具照 `test/recon-supplement.e2e-spec.ts`（真 AppModule 零 mock、独立客户、`maxWorkers: 1` 串行）

**前置（self 栈）**：`bash scripts/stack.sh reset self && bash scripts/stack.sh up && bash scripts/on-stack.sh self demo:setup`（共用库那 6 个套件同款前置；本文件不依赖 demo:all 的花名册，只要种子资产 + 客户地址行能开）。

- [ ] **Step 1: 建文件——引导段 + 夹具**

文件头（polyfill / dotenv / import）照 `test/recon-supplement.e2e-spec.ts:1-42` 逐字抄，再加下面这些 import：

```ts
import { ConflictException } from '@nestjs/common';
import { AdjustmentService } from '../src/modules/clearing-settle/reconciliation/disposition/adjustment.service';
import { CaseAgingService } from '../src/modules/clearing-settle/reconciliation/workflow/case-aging.service';
import { CaseAgingSweepService } from '../src/modules/clearing-settle/reconciliation/sweep/case-aging-sweep.service';
import { ReconciliationQueryService } from '../src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service';
import { InternalTransferWorkflowService } from '../src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service';
import { FundsOrderAction } from '../src/modules/funds-orders/dto/funds-order.dto';
import { toBusinessDate } from '../src/modules/accounting/tigerbeetle/utils/business-date.util';
```

`describe` 开头：

```ts
/**
 * 平账二期（spec §14）e2e：认损 → 补款（加密币一腿）｜ 垫款 → 认领（法币两腿经结算户）｜ 拒绝路径。
 * 真 AppModule 零 mock；每条主链一个独立客户（承接记录点名）；与另外四份 recon e2e 串行。
 *
 * ⚠ 截止时刻用「现在」而不是 +3 天：模拟托管方回单把镜像行与当日余额都记在**当天**（toBusinessDate(now)），
 *   跑批若用 +3 天的截止就读不到那份余额——所以本文件所有 run 都是 runNow()，余额夹具默认 cutoffDate = TODAY。
 *   代价是本文件不能跨 UTC 零点跑（照实讲，与 baseline 的「种子在 UTC 18:00 前铺」同类约束）。
 * ⚠ 运营户（F_OPS）钱包的桶不断言：它带着 demo:setup / 别的套件的其它穿越流水、没有外部镜像，
 *   本来就不干净；主链只断言客户钱包的案子。
 */
describe('Recon internal transfer e2e (平账二期, Task 9)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let prisma: PrismaService;
  let dispositions: DispositionService; let adjustments: AdjustmentService; let caseAging: CaseAgingService; let agingSweep: CaseAgingSweepService;
  let reconQuery: ReconciliationQueryService; let walletRecon: WalletReconRunService; let approvalsService: ApprovalsService;
  let transferWf: InternalTransferWorkflowService; let fundsOrders: FundsOrderService; let tbEvidence: TbEvidenceService; let accounting: AccountingService;
  let signals: InboundTransferSignalsService; let depositWf: DepositWorkflowService; let deposits: DepositTransactionsService;
  let withdrawWf: WithdrawWorkflowService; let withdraws: WithdrawTransactionsService; let withdrawQuoteService: WithdrawQuoteService;
  let depositWallets: CustomerDepositWalletService;
  let aedAssetId: string; let aedCode: string; let aedDecimals: number; let aedNetwork: string;
  let usdtAssetId: string; let usdtCode: string; let usdtDecimals: number; let usdtNetwork: string;
  let TODAY: string; let testStartedAt: Date;
  const ops = () => makeActor('E2E_OPS', 'OPS_OFFICER');
  const cfo = () => makeActor('E2E_CFO', 'CFO');
  const treasury = () => makeActor('E2E_TREASURY', 'TREASURY_OFFICER');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.get(EventEmitter2).setMaxListeners(50);
    await app.init();
    prisma = app.get(PrismaService);
    dispositions = app.get(DispositionService); adjustments = app.get(AdjustmentService);
    caseAging = app.get(CaseAgingService); agingSweep = app.get(CaseAgingSweepService);
    reconQuery = app.get(ReconciliationQueryService); walletRecon = app.get(WalletReconRunService); approvalsService = app.get(ApprovalsService);
    transferWf = app.get(InternalTransferWorkflowService); fundsOrders = app.get(FundsOrderService);
    tbEvidence = app.get(TbEvidenceService); accounting = app.get(AccountingService);
    signals = app.get(InboundTransferSignalsService); depositWf = app.get(DepositWorkflowService); deposits = app.get(DepositTransactionsService);
    withdrawWf = app.get(WithdrawWorkflowService); withdraws = app.get(WithdrawTransactionsService); withdrawQuoteService = app.get(WithdrawQuoteService);
    depositWallets = app.get(CustomerDepositWalletService);
    TODAY = toBusinessDate(new Date()); testStartedAt = new Date();
    const aed = await (prisma as any).asset.findFirst({ where: { currency: 'AED' } });
    const usdt = await (prisma as any).asset.findFirst({ where: { currency: 'USDT' } });
    if (!aed?.tbLedgerId || !usdt?.tbLedgerId) throw new Error('Fixture assets AED/USDT not seeded — run `bash scripts/stack.sh reset self` first.');
    aedAssetId = aed.id; aedCode = aed.code; aedDecimals = aed.decimals; aedNetwork = aed.network;
    usdtAssetId = usdt.id; usdtCode = usdt.code; usdtDecimals = usdt.decimals; usdtNetwork = usdt.network;
  });
  afterAll(async () => { if (app) await app.close(); });
```

夹具：以下函数从 `test/recon-supplement.e2e-spec.ts` **逐字复制**（把 `E2E-SUPP` 前缀全部改成 `E2E-ITR`，`provisionCustomerTbAccounts` 用 Task 1 删过补零循环后的版本）：`makeActor`、`waitUntil`、`ensureDepositWallet`、`createIsolatedCustomer`、`provisionCustomerTbAccounts`、`ensureWithdrawalAddress`、`fundCustomerWallet`、`decimalToBigint`、`driveLegTransition`、`VERDICT_BY_WEBHOOK_TYPE` / `verdictArgsForButton` / `verdictArgs`、`makeSuccessfulFiatDeposit`、`makeSuccessfulFiatWithdraw`。再加本文件自己的：

```ts
  /** 本文件所有跑批都用「现在」当截止（见文件头 ⚠）。 */
  const runNow = () => walletRecon.run({ cutoff: new Date() });

  async function createExternalLine(opts: { walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; direction: 'IN' | 'OUT'; amount: bigint; externalRef: string; description?: string; source?: 'ZAND' | 'HEXTRUST' }): Promise<{ id: string }> {
    return (prisma as any).externalStatementLine.create({
      data: { source: opts.source ?? 'ZAND', accountRef: opts.walletId, subAccount: opts.walletId, book: opts.book, currency: opts.currency, direction: opts.direction, amount: opts.amount.toString(), externalRef: opts.externalRef, datetime: new Date(), description: opts.description ?? 'Incoming', dedupKey: `E2E-ITR-${randomUUID()}` },
      select: { id: true },
    });
  }
  async function upsertExternalBalance(opts: { walletId: string; currency: string; book: 'CLIENT' | 'FIRM'; closingBalance: bigint; source?: 'ZAND' | 'HEXTRUST' }): Promise<void> {
    const source = opts.source ?? 'ZAND';
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source, accountRef: opts.walletId, cutoffDate: TODAY } },
      create: { source, accountRef: opts.walletId, currency: opts.currency, book: opts.book, cutoffDate: TODAY, closingBalance: opts.closingBalance.toString(), walletRef: opts.walletId },
      update: { closingBalance: opts.closingBalance.toString() },
    });
  }
  const openCaseFor = (walletId: string) => (prisma as any).reconciliationCase.findFirst({ where: { walletRef: walletId, status: 'OPEN' } });
  const caseRow = (id: string) => (prisma as any).reconciliationCase.findUnique({ where: { id } });
  const adjRow = (adjustmentNo: string) => (prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
  const transferRow = (transferNo: string) => (prisma as any).internalTransfer.findUnique({ where: { transferNo } });
  const latestApprovalCase = (actionType: string, entityRef: string) => (prisma as any).approvalCase.findFirst({ where: { actionType, entityRef }, orderBy: { createdAt: 'desc' } });
  const auditSince = (action: string, subjectNo: string) => (prisma as any).auditLogEvent.findMany({ where: { action, primarySubjectNo: subjectNo, recordedAt: { gte: testStartedAt } } });
  const platformWallet = (vault: 'F_OPS' | 'F_SET', network: string) => (prisma as any).wallet.findFirst({ where: { vaultCode: vault, network, ownerType: 'PLATFORM', status: 'ACTIVE' } });
  async function waitForSimLines(fundsOrderNo: string, walletIds: string[]): Promise<void> {
    await waitUntil(async () => (await (prisma as any).externalStatementLine.count({ where: { dedupKey: { in: walletIds.map((w) => `SIM-${fundsOrderNo}-${w}`) } } })) === walletIds.length);
  }
  const rowByLine = async (caseNo: string, externalLineId: string) => (await reconQuery.getCase(caseNo)).flowComparison.find((r: any) => r.externalLine?.id === externalLineId)!;
  const rowByAdjustment = async (caseNo: string, adjustmentNo: string) => (await reconQuery.getCase(caseNo)).flowComparison.find((r: any) => r.explainedByAdjustmentNo === adjustmentNo)!;

  /** 把一个独立客户的 USDT 钱包推到「认损已落账、案子已愈、行上待补款」：主链 A 与拒绝路径 C 共用。 */
  async function driveClientLossToCompensationPending(tag: string) {
    const cust = await createIsolatedCustomer(tag);
    const wallet = await ensureDepositWallet(cust.id, usdtNetwork);
    const REF = `0xe2eloss${tag}${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await fundCustomerWallet({ walletId: wallet.id, ownerId: cust.id, assetId: usdtAssetId, ledger: TB_LEDGERS.USDT, currency: 'USDT', amount: 3_000_000_000n, tag, externalRef: REF, crossing: true });
    await createExternalLine({ walletId: wallet.id, currency: usdtCode, book: 'CLIENT', direction: 'IN', amount: 2_992_500_000n, externalRef: REF, source: 'HEXTRUST' });
    await upsertExternalBalance({ walletId: wallet.id, currency: usdtCode, book: 'CLIENT', closingBalance: 2_992_500_000n, source: 'HEXTRUST' });
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    expect(kase.book).toBe('CUSTOMER');
    const row0 = (await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    const disp = await dispositions.record(kase.caseNo, {
      matchType: 'AMOUNT_MISMATCH', explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      causeCode: 'UNEXPLAINED', findingNote: 'e2e：托管少 7.5 USDT，翻遍凭证查无可查', deltaSign: -1, internalDirection: 'IN', internalSourceType: 'DEPOSIT',
    } as any, ops());
    expect(disp.outlet).toBe('HOLD_INVESTIGATING');
    await caseAging.simulateTimeout(kase.caseNo, ops());
    expect(await agingSweep.checkAgingBreaches(new Date())).toBeGreaterThanOrEqual(1);
    const row1 = (await reconQuery.getCase(kase.caseNo)).flowComparison.find((r: any) => r.matchType === 'AMOUNT_MISMATCH')!;
    expect(row1.nextStep).toEqual({ kind: 'WRITE_OFF', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '7500000', effectiveDate: kase.businessDate });
    const woDto = {
      caseNo: kase.caseNo, reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'REDUCE', amount: '7500000', effectiveDate: kase.businessDate,
      explainedFlowId: row0.internalFlow!.id, explainedExternalLineId: row0.externalLine!.id,
      reasonInternal: 'e2e 客户池认损', reasonCustomer: '平台调整', dispositionNo: disp.dispositionNo,
    };
    await expect(adjustments.createDraft({ ...woDto, reasonCode: 'UNEXPLAINED_WRITE_OFF' } as any, treasury())).rejects.toThrow(/客户池查无果认损/);
    const { adjustmentNo } = await adjustments.createDraft(woDto as any, treasury());
    await adjustments.submit(adjustmentNo, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.RECON_ADJUSTMENT_POST, adjustmentNo);
    expect(JSON.parse(apr.objectSnapshot).impact).toContain('客户池查无果认损');
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve loss' }, cfo());
    await waitUntil(async () => (await adjRow(adjustmentNo)).status === 'POSTED');
    const ev = await tbEvidence.findBySource('RECON_ADJUSTMENT', adjustmentNo);
    expect(ev[0].debitCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE]);
    expect(ev[0].creditCode).toBe(TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET]);
    expect((await accounting.getCustomerAvailableBalance(cust.id, 'USDT')).available).toBe(2_992_500_000n);
    await runNow();
    expect((await caseRow(kase.id)).status).toBe('RESOLVED');
    // 案子愈了，行上还活着：待补款（spec §7.2）
    const row2 = await rowByAdjustment(kase.caseNo, adjustmentNo);
    expect(row2.nextStep).toMatchObject({ kind: 'COMPENSATION', adjustmentNo, amount: '7500000', customerNo: cust.customerNo });
    return { cust, wallet, kase, adjustmentNo };
  }
```

- [ ] **Step 2: 主链 A——认损 → 补款（加密币一腿），含撤回再发、在途桶、余额复位、七码里的六码**

```ts
  it('A · 认损 → 撤回再发 → CFO 批 → ⚡ 提交腿（镜像两行、在途不红）→ ⚡ 确认（82+83 落账、清算）→ SUCCESS、余额复位、案子愈', async () => {
    const { cust, wallet, kase, adjustmentNo } = await driveClientLossToCompensationPending('A');
    // 发起 → 同来源二次发起 409 → 撤回 → 再发起放行
    const first = await transferWf.initiateCompensation({ adjustmentNo, reason: '公司认赔' }, treasury());
    expect(first.status).toBe('PENDING_APPROVAL');
    await expect(transferWf.initiateCompensation({ adjustmentNo, reason: 'again' }, treasury())).rejects.toBeInstanceOf(ConflictException);
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).transfer).toMatchObject({ transferNo: first.transferNo, status: 'PENDING_APPROVAL' });
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).nextStep).toBeUndefined();
    await transferWf.cancel(first.transferNo, { reason: '开错' }, treasury());
    expect((await transferRow(first.transferNo)).status).toBe('CANCELLED');
    expect(await auditSince('INTERNAL_TRANSFER_CANCELLED', first.transferNo)).toHaveLength(1);
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).nextStep?.kind).toBe('COMPENSATION');
    const req = await transferWf.initiateCompensation({ adjustmentNo, reason: '公司认赔' }, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    const snapshot = JSON.parse(apr.objectSnapshot);
    expect(snapshot.impact).toContain('补款 7.500000 USDT');
    expect(JSON.stringify(snapshot)).not.toContain(wallet.id);
    // 批准 → 执行中，腿 1 = 运营户 TRON → 客户地址
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve compensation' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    await expect(transferWf.cancel(req.transferNo, { reason: 'late' }, treasury())).rejects.toThrow(/不能撤回/);
    const itr = await transferRow(req.transferNo);
    const opsW = await platformWallet('F_OPS', usdtNetwork);
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    expect(leg1.status).toBe('CREATED');
    expect([leg1.fromWalletId, leg1.toWalletId]).toEqual([opsW.id, wallet.id]);
    expect(itr.viaWalletId).toBeNull();
    // ⚡ 提交腿 → 模拟托管方写两行，参考号 = 腿 txHash
    await fundsOrders.advance(leg1.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg1.fundsOrderNo, [opsW.id, wallet.id]);
    const stamped = await fundsOrders.findById(leg1.id);
    expect(stamped.txHash).toMatch(/^0x/);
    const simIn = await (prisma as any).externalStatementLine.findUnique({ where: { dedupKey: `SIM-${leg1.fundsOrderNo}-${wallet.id}` } });
    expect(simIn).toMatchObject({ direction: 'IN', book: 'CLIENT', externalRef: stamped.txHash, currency: usdtCode });
    expect(simIn.amount.toString()).toBe('7500000');
    // 在途桶不红：客户钱包开一张 IN_TRANSIT 案
    await runNow();
    const transitCase = await openCaseFor(wallet.id);
    expect(transitCase.bucket).toBe('IN_TRANSIT');
    expect((await reconQuery.getCase(transitCase.caseNo)).flowComparison.find((r: any) => r.matchType === 'IN_TRANSIT')?.fundsOrderNo).toBe(leg1.fundsOrderNo);
    // ⚡ 确认 → 落账（82 + 83）→ 清算 → SUCCESS
    await fundsOrders.advance(leg1.id, FundsOrderAction.OBSERVE_CONFIRMING, 'E2E');
    await fundsOrders.advance(leg1.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'SUCCESS');
    const tev = await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo);
    expect(tev.map((e: any) => e.eventCode).sort()).toEqual(['INTERNAL_TRANSFER_COMPENSATION_IN', 'INTERNAL_TRANSFER_FIRM_OUT']);
    for (const e of tev) { expect(e.isExternalCrossing).toBe(true); expect(e.externalRef).toBe(stamped.txHash); expect(e.assetCode).toBe('USDT'); }
    expect((await fundsOrders.findById(leg1.id)).status).toBe('CLEARED');
    expect((await accounting.getCustomerAvailableBalance(cust.id, 'USDT')).available).toBe(3_000_000_000n);
    // 再对账：在途案自愈；行上回挂 SUCCESS，不再给按钮
    const run = await runNow();
    expect(run.status).not.toBe('INTERNAL_BREAK'); // 预门 = 两条恒等式（与 verify:coa 同式）
    expect((await caseRow(transitCase.id)).status).toBe('RESOLVED');
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).transfer).toMatchObject({ transferNo: req.transferNo, status: 'SUCCESS' });
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).nextStep).toBeUndefined();
    for (const action of ['INTERNAL_TRANSFER_REQUESTED', 'INTERNAL_TRANSFER_EXECUTION_STARTED', 'INTERNAL_TRANSFER_LEG_POSTED', 'INTERNAL_TRANSFER_SETTLED']) {
      expect(await auditSince(action, req.transferNo)).toHaveLength(1);
    }
    const settled = (await auditSince('INTERNAL_TRANSFER_SETTLED', req.transferNo))[0];
    expect(settled.actionDomain).toBe('TREASURY');
    expect(settled.correlationId).toBe(itr.traceId);
  });
```

- [ ] **Step 3: 主链 B——垫款 → 认领（法币两腿经结算户）**

```ts
  it('B · 退汇余额不足：读面给 ADVANCE → 认领 400 指路 → 垫款两腿（81 / 82+83）→ 可用够扣 → 认领退汇 CLAWED_BACK → 愈', async () => {
    const cust = await createIsolatedCustomer('B');
    const iban = `AE-E2E-ITR-WDADDR-${cust.customerNo}`;
    const { deposit, wallet } = await makeSuccessfulFiatDeposit('1200', cust.id, cust.customerNo);
    const w = await makeSuccessfulFiatWithdraw('900', cust, iban);           // 净 898 + 费 2 出去；账上剩 300，外部也剩 300
    expect(w.status).toBe('SUCCESS');
    const claw = `E2E-CLAW-${randomUUID()}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'OUT', amount: 120_000n, externalRef: claw, description: 'Return' });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 30_000n - 120_000n }); // 300 − 1200 = −900
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'BOUNCED_FUNDS', externalDirection: 'OUT', findingNote: '银行撤回，客户已花掉一部分' } as any, ops());
    expect(disp.deferredTarget).toBe('SUPPLEMENT_BOUNCE');
    const row0 = await rowByLine(kase.caseNo, line.id);
    expect(row0.nextStep).toMatchObject({ kind: 'ADVANCE', amount: '90000', externalLineId: line.id, available: '30000', lineAmount: '120000', customerNo: cust.customerNo });
    await expect(depositWf.initiateClawback(deposit.depositNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: 'x' }, ops())).rejects.toThrow(/发起垫款/);
    // 垫款：金额锁定 = 差额 900
    const req = await transferWf.initiateAdvance({ caseNo: kase.caseNo, externalLineId: line.id, reason: '先垫后扣' }, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    const snapshot = JSON.parse(apr.objectSnapshot);
    expect(snapshot.impact).toContain('垫付 900.00 AED');
    expect(snapshot).not.toHaveProperty('externalLineId');
    expect(snapshot.externalRef).toBe(claw);
    await approvalsService.approve(apr.approvalNo, { reason: 'e2e CFO approve advance' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    const itr = await transferRow(req.transferNo);
    const opsW = await platformWallet('F_OPS', aedNetwork); const setW = await platformWallet('F_SET', aedNetwork);
    expect(itr.viaWalletId).toBe(setW.id);
    // 腿 1：运营户 → 结算户
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    expect([leg1.fromWalletId, leg1.toWalletId]).toEqual([opsW.id, setW.id]);
    await fundsOrders.advance(leg1.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg1.fundsOrderNo, [opsW.id, setW.id]);
    await fundsOrders.advance(leg1.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 2 })).length === 1);
    expect((await fundsOrders.findById(leg1.id)).status).toBe('CLEARED');
    expect((await transferRow(req.transferNo)).status).toBe('EXECUTING');
    // 腿 2：结算户 → 客户 vIBAN
    const [leg2] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 2 });
    expect([leg2.fromWalletId, leg2.toWalletId]).toEqual([setW.id, wallet.id]);
    await fundsOrders.advance(leg2.id, FundsOrderAction.SUBMIT, 'E2E');
    await waitForSimLines(leg2.fundsOrderNo, [setW.id, wallet.id]);
    await fundsOrders.advance(leg2.id, FundsOrderAction.CONFIRM, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'SUCCESS');
    const tev = await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo);
    expect(tev.map((e: any) => e.eventCode).sort()).toEqual(['INTERNAL_TRANSFER_ADVANCE_IN', 'INTERNAL_TRANSFER_FIRM_OUT', 'INTERNAL_TRANSFER_OPS_TO_SET']);
    const opsToSet = tev.find((e: any) => e.eventCode === 'INTERNAL_TRANSFER_OPS_TO_SET');
    expect([opsToSet.debitWalletRef, opsToSet.creditWalletRef]).toEqual([opsW.id, setW.id]);
    expect((await accounting.getCustomerAvailableBalance(cust.id, 'AED')).available).toBe(120_000n);
    // 垫款到账：读面不再给 ADVANCE，回挂 SUCCESS；认领退汇走 B 批原路
    const row1 = await rowByLine(kase.caseNo, line.id);
    expect(row1.nextStep).toBeUndefined();
    expect(row1.transfer).toMatchObject({ transferNo: req.transferNo, purpose: 'CLIENT_ADVANCE', status: 'SUCCESS' });
    const clawReq = await depositWf.initiateClawback(deposit.depositNo, { externalLineId: line.id, caseNo: kase.caseNo, dispositionNo: disp.dispositionNo, reason: '银行撤回' }, ops());
    await approvalsService.approve(clawReq.approvalNo, { reason: 'e2e CFO approve clawback' }, cfo());
    await waitUntil(async () => (await deposits.findOne(deposit.id)).status === 'CLAWED_BACK');
    expect((await accounting.getCustomerAvailableBalance(cust.id, 'AED')).available).toBe(0n);
    await runNow();
    expect((await caseRow(kase.id)).status).toBe('RESOLVED');
  });
```

- [ ] **Step 4: 拒绝路径 C**

```ts
  it('C1 · 客户池多出来的钱：读面 CLIENT_SURPLUS，认损 INCREASE → 400 指路补录', async () => {
    const cust = await createIsolatedCustomer('C1');
    const wallet = await ensureDepositWallet(cust.id, aedNetwork);
    const ref = `E2E-SURPLUS-${randomUUID().slice(0, 8)}`;
    const line = await createExternalLine({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', direction: 'IN', amount: 5_000n, externalRef: ref });
    await upsertExternalBalance({ walletId: wallet.id, currency: 'AED', book: 'CLIENT', closingBalance: 5_000n });
    expect((await runNow()).status).toBe('BREAK');
    const kase = await openCaseFor(wallet.id);
    const disp = await dispositions.record(kase.caseNo, { explainedExternalLineId: line.id, matchType: 'ORPHAN_EXTERNAL', causeCode: 'UNEXPLAINED', externalDirection: 'IN', findingNote: 'e2e：多出来 50，查不出' } as any, ops());
    await caseAging.simulateTimeout(kase.caseNo, ops()); await agingSweep.checkAgingBreaches(new Date());
    expect((await rowByLine(kase.caseNo, line.id)).nextStep).toEqual({ kind: 'CLIENT_SURPLUS' });
    await expect(adjustments.createDraft({ caseNo: kase.caseNo, reasonCode: 'UNEXPLAINED_CLIENT_LOSS', direction: 'INCREASE', amount: '5000', effectiveDate: kase.businessDate, explainedExternalLineId: line.id, reasonInternal: 'x', reasonCustomer: 'x', dispositionNo: disp.dispositionNo } as any, treasury())).rejects.toThrow(/补录/);
  });

  it('C2 · 腿失败 → FAILED(LEG_FAILED)、零分录；按钮回来、可重新发起', async () => {
    const { kase, adjustmentNo } = await driveClientLossToCompensationPending('C2');
    const req = await transferWf.initiateCompensation({ adjustmentNo, reason: '认赔' }, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    await approvalsService.approve(apr.approvalNo, { reason: 'ok' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'EXECUTING');
    const itr = await transferRow(req.transferNo);
    const [leg1] = await fundsOrders.findByParent({ internalTransferId: itr.id }, { legSeq: 1 });
    await fundsOrders.advance(leg1.id, FundsOrderAction.FAIL, 'E2E');
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'FAILED');
    expect((await transferRow(req.transferNo)).failureReasonCode).toBe('LEG_FAILED');
    expect(await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo)).toHaveLength(0);
    expect((await auditSince('INTERNAL_TRANSFER_FAILED', req.transferNo))[0].reasonCode).toBe('LEG_FAILED');
    const row = await rowByAdjustment(kase.caseNo, adjustmentNo);
    expect(row.transfer).toMatchObject({ transferNo: req.transferNo, status: 'FAILED' });
    expect(row.nextStep?.kind).toBe('COMPENSATION');
    const again = await transferWf.initiateCompensation({ adjustmentNo, reason: '重发' }, treasury());
    expect(again.transferNo).not.toBe(req.transferNo);
  });

  it('C3 · CFO 拒绝 → REJECTED，无资金单无分录，按钮回来', async () => {
    const { kase, adjustmentNo } = await driveClientLossToCompensationPending('C3');
    const req = await transferWf.initiateCompensation({ adjustmentNo, reason: '认赔' }, treasury());
    const apr = await latestApprovalCase(ApprovalActionTypes.INTERNAL_TRANSFER_APPROVAL, req.transferNo);
    await approvalsService.reject(apr.approvalNo, { reason: 'e2e CFO reject' }, cfo());
    await waitUntil(async () => (await transferRow(req.transferNo)).status === 'REJECTED');
    const itr = await transferRow(req.transferNo);
    expect(await fundsOrders.findByParent({ internalTransferId: itr.id })).toHaveLength(0);
    expect(await tbEvidence.findBySource('INTERNAL_TRANSFER', req.transferNo)).toHaveLength(0);
    expect((await auditSince('INTERNAL_TRANSFER_REJECTED', req.transferNo))[0].approvalNo).toBe(apr.approvalNo);
    expect((await rowByAdjustment(kase.caseNo, adjustmentNo)).nextStep?.kind).toBe('COMPENSATION');
  });
});
```

（「批准时运营户余额不足 → FAILED」在 e2e 里造不出来——运营户有 10 万注资，认损额受小额线卡死 ≤ 30 USDT；这条由 Task 7 单测覆盖，本文件头注明。「非金库 403」由 `verify:rbac` S5 与 Task 8 真 HTTP 冒烟覆盖。）

- [ ] **Step 5: 跑 e2e**

```bash
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-internal-transfer'
```
Expected：5 passed。跑之前确认 self 栈起着、库刚 `reset self` + `demo:setup`。若 `assertActionSpec` 对 INHERIT 码报 correlation 错，按 Task 7 Step 4 末尾的说明改信封，不改 spec。

- [ ] **Step 6: 变异（三条，各自改回）**

1. 注掉 `internal-transfer-workflow.service.ts` `onDecided` 里批准后的 `assertFirmOpsBalance` 那段 try/catch → `npx jest src/modules/asset-treasury/internal-transfers` 必须红（Task 7 单测「批准但运营户余额不够 → FAILED」）。
2. 注掉 `postFinalLeg` 的第二笔 `executeTransfer`（客户侧 83）→ 重跑本 e2e 主链 A：`available` 复位断言必须红，且 `runNow().status` 可能变 `INTERNAL_BREAK`（客户侧恒等式破）——两者任一红即证明有杀伤力。
3. 铺场闸的变异在 Task 11。
改回后重跑绿。

- [ ] **Step 7: 四份既有 recon e2e + verify:coa**

```bash
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-'
bash scripts/on-stack.sh self verify:coa
```
Expected：五份文件全绿（旧四份 21/21 + 本文件 5）；`verify:coa` 两恒等式 + 负余额全过（划转的三种分录各自落过账）。

- [ ] **Step 8: Commit**

```bash
git add test/recon-internal-transfer.e2e-spec.ts
git commit -m "test(e2e): 内部划转全链——认损→补款（加密币一腿、在途桶、余额复位）、垫款→认领（法币两腿经结算户）、客户池多出来 400、腿失败 / CFO 拒绝后可重发（平账二期 Task 9）"
```

本任务过哪几条：动了钱 → `verify:coa` ✅｜ 改了交易三域（无）｜ 测试的绿来自行为（真 AppModule，无文本扫描断言）。

---

### Task 10: 搭车②——公司注资写进流水凭证

**Files:**
- Modify: `prisma/seed.business.ts`（`seedCapitalInjection` + import）

**Interfaces:**
- Produces: 每个币种一行 `tb_transfer_evidence`（`sourceType 'SEED_CAPITAL'`、`eventCode 'CAPITAL_INJECTION'`、`isExternalCrossing true`、walletRef = 该币种网络上的运营户行）+ 两行 `account_flows`；`recon:demo` 从此把注资当正常穿越流水镜像

- [ ] **Step 1: 改种子**

`prisma/seed.business.ts`：
1. 第 1 行 `import { PrismaClient } from '@prisma/client';` 改 `import { Prisma, PrismaClient } from '@prisma/client';`；`deterministicTransferId` 那行 import 改 `import { deterministicTransferId, bigintToHex } from '../src/modules/accounting/tigerbeetle/utils/tb-id.util';`。
2. `seedCapitalInjection` 里 `const assets = await prisma.asset.findMany({ where: { status: 'ACTIVE' }, select: { currency: true, decimals: true, code: true } });` 的 select 加 `network: true`。
3. 循环里 `transfers.push({...})` 之后记一份镜像素材：在函数顶部 `const transfers: any[] = [];` 旁加 `const evidenceRows: Array<{ asset: { currency: string; network: string }; transferId: bigint; amount: bigint; firmAssetId: string; firmOpsId: string }> = [];`，push 完 transfers 后加 `evidenceRows.push({ asset, transferId, amount, firmAssetId: firmAssetReg.tbAccountId, firmOpsId: firmOpsReg.tbAccountId });`。
4. 在 `console.log(\`  ✔ Capital injection: ...\`)` 之后、`finally` 之前加：

```ts
    // 平账二期搭车②（BACKLOG「资本注入少一行流水凭证」）：注资写进凭证与流水投影，
    // 对账页上运营户从此显示真实起点（此前只有 TB 转账、流水里查不到，外部余额页显示负数）。
    // 种子路径直写两表（与账户注册表同款、不经 Nest）；upsert 幂等；FIRM_ASSET 是聚合科目，
    // 引擎读侧本就丢弃聚合腿，walletRef 挂运营户行只为可追溯。
    for (const r of evidenceRows) {
      const opsWallet = await (prisma as any).wallet.findFirst({ where: { vaultCode: 'F_OPS', network: r.asset.network, ownerType: 'PLATFORM' }, select: { id: true } });
      if (!opsWallet) throw new Error(`注资凭证：找不到 ${r.asset.network} 上的运营户地址行——seedPlatformWallets 是否先跑？`);
      const tbTransferId = bigintToHex(r.transferId);
      const now = new Date();
      const shared = {
        sourceType: 'SEED_CAPITAL', sourceNo: r.asset.currency, eventCode: 'CAPITAL_INJECTION',
        amount: new Prisma.Decimal(r.amount.toString()), assetCode: r.asset.currency, transferType: 'POSTED',
        isExternalCrossing: true, externalRef: `SEED-CAPITAL-${r.asset.currency}`, effectiveDate: now.toISOString().slice(0, 10),
      };
      await (prisma as any).tbTransferEvidence.upsert({
        where: { tbTransferId }, update: {},
        create: {
          tbTransferId, ...shared, debitCode: 'A.FIRM_ASSET', creditCode: 'E.FIRM_OPS',
          debitTbAccountId: r.firmAssetId, creditTbAccountId: r.firmOpsId,
          traceId: `SEED_CAPITAL_${r.asset.currency}`, actorType: 'SYSTEM', actorId: 'RELEASE', memo: '公司注资（随版本装载）',
          debitWalletRef: opsWallet.id, creditWalletRef: opsWallet.id, createdAt: now,
        },
      });
      for (const [tbAccountId, direction] of [[r.firmAssetId, 'OUT'], [r.firmOpsId, 'IN']] as const) {
        await (prisma as any).accountFlow.upsert({
          where: { tbTransferId_tbAccountId: { tbTransferId, tbAccountId } }, update: {},
          create: { tbTransferId, tbAccountId, walletRef: opsWallet.id, direction, ...shared, createdAt: now },
        });
      }
    }
    console.log(`  ✔ Capital injection evidence: ${evidenceRows.length} evidence row(s) + ${evidenceRows.length * 2} flow row(s)`);
```

- [ ] **Step 2: 重铺验证**

```bash
bash scripts/stack.sh reset self && bash scripts/stack.sh up
sqlite3 "$(grep -o 'file:[^"]*' .env | head -1 | sed 's#file:##')" "SELECT sourceType, direction, walletRef IS NOT NULL, amount FROM account_flows WHERE sourceType='SEED_CAPITAL' ORDER BY assetCode, direction;"
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:demo-data
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self recon:demo:pass
```
Expected：4 行流水（AED IN/OUT、USDT IN/OUT，金额 10000000 / 100000000000）；`verify:coa` 全绿；`verify:demo-data` 全绿；`demo:all` 29/29；`recon:demo:pass` PASS（注资那笔被镜像成运营户一条 IN 行）。再看 `sqlite3 ... "SELECT closingBalance FROM external_balances WHERE coaCode='E.FIRM_OPS'"` 均为正数。

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.business.ts
git commit -m "feat(seed): 公司注资写进凭证与流水投影——运营户对账起点不再是负数（BACKLOG 资本注入少一行流水凭证；平账二期 Task 10）"
```

本任务过哪几条：改页面或种子（`data.md` 在 Task 11 一并改）｜ 动了钱（种子路径，`verify:coa` ✅）｜ tsc ①（种子在 tsconfig 覆盖内）。

---

### Task 11: 演示脚本——场景 16 / 17 + 铺场前置闸 + 三篇演示文档

**Files:**
- Modify: `scripts/recon-demo.ts`
- Modify: `doc-final/demo/script.md`（第六幕）
- Modify: `doc-final/demo/data.md`
- Modify: `doc-final/demo/baseline.md`

**Interfaces:**
- Produces: `recon:demo:break` → 17 场景 / 11 钱包；铺场闸 `assertNoOpenInternalTransfers`

- [ ] **Step 1: 铺场闸 + 场景 16 / 17**

`scripts/recon-demo.ts`：
1. 文件头注释：`inject 15 scenarios` 改 17；场景清单在 ⑮ 后加
```
//                    ⑯ 客户池小额查不出 认损 + 补款划转（二期开门，加密币一腿，Alice USDT）
//                    ⑰ 入金退汇·余额不足 垫款划转 + 退汇认领（二期开门，法币两腿，叠 Grace AED）
```
2. `clearStuckFixtureWithdraws` 之前加铺场闸：
```ts
/** 平账二期前置闸：铺场时不得有在途划转——pass / break 都先清空外部账单再从流水重铸，
 *  在途划转的镜像行会被清掉、而它的流水还没落，⚡ 确认后就成「我有外无」假破口。撞到当场报错。 */
async function assertNoOpenInternalTransfers(prisma: PrismaService): Promise<void> {
  const open = (await (prisma as any).internalTransfer.findMany({
    where: { status: { in: ['PENDING_APPROVAL', 'EXECUTING'] } }, select: { transferNo: true, status: true },
  })) as Array<{ transferNo: string; status: string }>;
  if (open.length === 0) return;
  throw new Error(
    `铺场前不得有在途内部划转单（${open.map((o) => `${o.transferNo}:${o.status}`).join(', ')}）——`
    + '先把它们结清（⚡ 推腿到 CONFIRMED）或撤回 / 拒绝，再铺场',
  );
}
```
   `main()` 里 `// Both pass and break start from a clean slate` 那句之前加 `await assertNoOpenInternalTransfers(prisma);`。
3. 槽位：`const KATE_NO = ...` 之后加 `const ALICE_NO = await emailToNo('demo_alice@example.com');`；槽位表末尾加
```ts
  const slotClientLoss    = planByOwnerAsset(ALICE_NO, 'USDT-TRON');  // ⑯ 客户池小额查不出（二期；B 批搬走 ⑭ 后空出的位）
  const slotAdvance       = slotShowcaseA;                            // ⑰ 入金退汇·余额不足（二期，叠展示位甲）
```
   `assertTargetWalletsClean` 数组加 `{ walletRef: slotClientLoss.walletRef, allowNonTerminal: false },`。
4. 场景 ⑮ 块之后、`return { cutoff: ... }` 之前加：

```ts
  // ── 场景 ⑯ — 客户池小额查不出 (BREAK / AMOUNT_MISMATCH / 客户账簿 / 加密币) ─────────
  // 二期：托管里真少了 7.5 USDT（≤ 小额线 30），翻遍凭证查无可查 → 定性查不出 → ⚡拨钟 → 金库「认损」
  // → CFO 批 → 重对账愈 → 「发起补款」→ CFO 批 → ⚡ 提交腿（在途不红）→ ⚡ 确认 → 余额复位。同 ⑩ 手法。
  {
    const line = (await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: slotClientLoss.walletRef, amount: { gt: 7_500_000 } }, orderBy: { datetime: 'asc' },
    })) as { id: string; amount: Prisma.Decimal; direction: string; externalRef: string | null } | null;
    if (!line) throw new Error('场景 16 需要 Alice USDT 钱包至少一条金额 > 7.5 USDT 的外部行（花名册 #1 3000 USDT）—— demo:all 是否跑过？');
    const s16Delta = D('-7500000'); // 分（6 位）：外部比内部少 7.5 USDT
    const newAmount = line.amount.plus(s16Delta);
    await (prisma as any).externalStatementLine.update({ where: { id: line.id }, data: { amount: newAmount } });
    const signed = line.direction === 'IN' ? s16Delta : s16Delta.negated();
    const prevClose = await bumpClosing(slotClientLoss, signed);
    scenarios.push({
      scenarioId: 16, rootCause: 'UNEXPLAINED',
      expectedLines: [{ walletRef: slotClientLoss.walletRef, lineType: 'AMOUNT_MISMATCH', amount: newAmount.toString(), externalRef: line.externalRef }],
      detail: { lineId: line.id, internalAmount: line.amount.toString(), externalAmount: newAmount.toString(), prevClosingBalance: prevClose },
    });
    wallets.push({
      walletRef: slotClientLoss.walletRef, scenarioIds: [16], expectedBucket: 'BREAK',
      bucketRationale: '一条外部行金额 −7.5 USDT 并压低同额收盘 → 残差 ≠ 0 → BREAK。处置 = 查不出 → 超期 → 客户池认损（金库开单、CFO 批）→ 愈 → 补款划转 → 余额复位',
      hasNonTerminalFundsOrder: false,
    });
  }

  // ── 场景 ⑰ — 入金被退汇·余额不足 (BREAK / ORPHAN_EXTERNAL / 客户账簿 / 法币) ─────────
  // 二期：银行扣回 Grace 最大一笔入金 6500（花名册 #3）；她此时账上约 4800——不管 ②③④⑮ 先做后做差额始终为正，
  // 认领退汇过不了余额闸 → 行上「余额不足，发起垫款」→ CFO 批 → ⚡ 两腿（运营户 → 结算户 → vIBAN）→ 再认领。叠展示位甲（一案五行）。
  // 不放 Kate：场景 ⑧ 改记会把 Jack 的 5000 记到她名下，怎么摆余额都够扣，演不出短缺。
  {
    const s17Amount = D('650000'); // 分 —— 6500.00 AED = 花名册 #3
    const original = await (prisma as any).depositTransaction.findFirst({
      where: { toWalletId: slotAdvance.walletRef, status: 'SUCCESS', amount: new Prisma.Decimal('6500') },
    });
    if (!original) throw new Error('场景 17 需要 Grace 有一笔 SUCCESS 的 6500 AED 充值（花名册 #3）—— demo:all 是否跑过？花名册 #3 是否改了？');
    const outRef = refFor(slotAdvance.currency, 'CLAWSHORT');
    const created = await (prisma as any).externalStatementLine.create({
      data: {
        source: sourceFor(slotAdvance.currency), accountRef: slotAdvance.walletRef, subAccount: slotAdvance.walletRef,
        book: slotAdvance.book, currency: slotAdvance.currency, direction: 'OUT', amount: s17Amount, externalRef: outRef,
        channelRef: original.referenceNo ?? null, datetime: cutoff,
        description: 'Demo bank return — largest deposit clawed back after the client already spent part of it',
        dedupKey: `DEMO-INJ-${cutoffDate}-${slotAdvance.walletRef}-s17-bounced-shortfall`,
      },
    });
    const prevClose = await bumpClosing(slotAdvance, s17Amount.negated());
    const grace = await (prisma as any).customerMain.findUnique({ where: { customerNo: GRACE_NO }, select: { id: true } });
    const available = (await accounting.getCustomerAvailableBalance(grace.id, 'AED')).available;
    console.log(`  场景 17：Grace AED 当刻可用 ${(Number(available) / 100).toFixed(2)}，退汇 6500.00，差额 ${((650000 - Number(available)) / 100).toFixed(2)}（铺场时点；演到 17 时以案件页显示为准）`);
    scenarios.push({
      scenarioId: 17, rootCause: 'BOUNCED_FUNDS',
      expectedLines: [{ walletRef: slotAdvance.walletRef, lineType: 'ORPHAN_EXTERNAL', amount: s17Amount.toString(), externalRef: outRef }],
      detail: { insertedExternalLineId: created.id, originalDepositNo: original.depositNo, prevClosingBalance: prevClose, closingBalanceDelta: s17Amount.negated().toString(), availableAtSeedMinor: available.toString() },
    });
    const showcaseA = wallets.find((w) => w.walletRef === slotShowcaseA.walletRef);
    if (!showcaseA) throw new Error('场景 17 要叠在展示位甲的钱包断言上，但没找到它——场景 ②③④ 的 wallets.push 是否还在？');
    showcaseA.scenarioIds.push(17);
    showcaseA.bucketRationale += '；⑰ 再加一条 OUT 幽灵行并压低同额收盘（6500 退汇），残差仍 ≠ 0 → BREAK';
  }
```
   （`accounting` 是 `injectScenarios` 的第五个参数，已由 `main()` 传入 `app.get(AccountingService)`；若该参数在函数签名里叫别的名字，按实际名字用。）

- [ ] **Step 2: 重铺 + 判据**

```bash
bash scripts/stack.sh reset self && bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self recon:demo:break
```
Expected：`demo:all` 29/29；`recon:demo:break` 打印 `scenarios 17/17 DETECTED`、`wallets 11/11 bucket OK`、`casesOpened 11/11`、identities OK、`ALL 17 SCENARIOS DETECTED PER MANIFEST`；场景 17 那行打印 Grace 当刻可用与差额（差额为正）。

- [ ] **Step 3: 铺场闸变异**

```bash
DB="$(grep -o 'file:[^"]*' .env | head -1 | sed 's#file:##')"
sqlite3 "$DB" "INSERT INTO internal_transfers (id, transferNo, purpose, assetId, amount, fromWalletId, toWalletId, customerId, customerNo, status, reason, sourceCaseNo, traceId, createdByUserId, createdAt, updatedAt) SELECT 'mut-itr', 'ITR-MUTANT', 'CLIENT_COMPENSATION', id, 1, 'w', 'w', 'c', 'CU', 'EXECUTING', 'mutation', 'REC-X', 't', 'u', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM assets LIMIT 1;"
bash scripts/on-stack.sh self recon:demo:break ; echo "exit=$?"
sqlite3 "$DB" "DELETE FROM internal_transfers WHERE id='mut-itr';"
```
Expected：脚本在铺场前报 `铺场前不得有在途内部划转单（ITR-MUTANT:EXECUTING）` 并非零退出；删掉后重跑 `recon:demo:break` 恢复 17/17。

- [ ] **Step 4: 三篇演示文档**

`doc-final/demo/script.md` 第六幕：
- 「造数」句与走查步骤 ② 的「15 个场景 / 10 张案子」改「17 个场景 / 11 张案子」，桶构成改「破口 8 ｜ 软标记 2 ｜ 在途 1」；步骤 ③ 「按场景号 1→15」改 1→17；
- 表格在「收尾」行之前插两行：

```
| 16 | 客户池小额查不出：认损 + 补款（二期） | Alice USDT 案那行「处置」→「查不出（已穷尽调查）」→ 说明写清查过什么 → 徽标「已定性 · 调查中」→ ⚡ 拨到超期 → 一分钟后刷新「超期」→ 切 `treasury@` 同一行「**认损**」→ 锁定视图（成因固定「客户池查无果认损」、方向 / 金额 7.5 / 生效日只读）→ 提审 → 切 `cfo@` 批（后果原话「客户池查无果认损：客户 CU… 差额 7.5 USDT 认损，客户余额相应减少……认损后由公司补款划转补齐」）→ 回案件页「重新对账」→ **RESOLVED**，那行「已解释 · ADJ…」旁出现「**发起补款 7.5 USDT**」→ `treasury@` 点开（客户 / 钱包 / 金额全预填、不可改）→ 填理由 → 提交 → `cfo@` 批 → 切 `ops_officer@` 资金单页找那张腿 ⚡ **SUBMIT** → 回案件页「重新对账」→ Alice USDT 与运营户 TRON 各开一张**在途**案（琥珀，不红）→ ⚡ OBSERVE_CONFIRMING → ⚡ CONFIRM → 划转单 SUCCESS → 「重新对账」两张在途案自愈 → 客户端登 Alice 看 USDT 对账单 | **两步都有单、都有人批**：认损让账跟着外面走（案子愈），补款是对客户的交代（余额复位）。客户端两行：−7.5「平台调整 · ADJ…」、+7.5「平台补款 · ITR…」 |
| 17 | 入金被退汇、余额不足：垫款 + 认领（二期，法币两腿） | Grace AED 案第五行 OUT 6500「处置」→「入金被退汇/回冲」→ 提交 → 行上显示「**余额不足 ≈X，发起垫款**」（不是「认领退汇」）→ 切 `treasury@` 点开（差额预填、不可改）→ 提交 → `cfo@` 批 → 切 `ops_officer@` 资金单页：腿 1（运营户 → 结算户）⚡ SUBMIT / CONFIRM → 腿 2 自动出现（结算户 → Grace vIBAN）⚡ SUBMIT / CONFIRM → 划转单 SUCCESS，Grace 余额 = 6500 → 回案件页，那行「认领退汇」回来 → `ops_officer@` 认领（候选原单唯一命中）→ `cfo@` 批 → 充值单 CLAWED BACK，Grace AED 归零 → 「重新对账」那行已匹配，整案看其它行 | **先垫后扣**：银行扣走的是 6500，她账上只剩约 4800，差额公司先垫、她欠公司（三期追索）。法币必须经结算户，所以是两腿；讲一句「结算户是过渡户，兑换的钱也这么走」 |
```
- 表格之后加两条注：
```
⚠️ **注③：二期两场景的账号切换**：定性 / ⚡ 拨钟 / ⚡ 推腿 / 认领退汇 = `ops_officer@`；认损开单 / 发起补款 / 发起垫款 / 撤回 = `treasury@`；批准 = `cfo@`。金库看到按钮，运营只看到「待补款」「余额不足，待金库垫款」的文字。
⚠️ **注④：铺场前不得有在途划转**：`recon:demo:break` 会先清空全部外部账单再从账本流水重铸，划转结清后的流水会被一并重铸；但一张还在路上的划转（待批 / 执行中）铺场会当场报错——先 ⚡ 推到确认或撤回。演划转在途的那几分钟里不要去重对账公司池的案子（在途会把同钱包的软标记案暂判为破口，结清即回）。同一天内演完 16 / 17；跨日照实讲，次日 cron 会把两侧一起收进去。
```
- 「已知缺口」段：「八件处置」改「九件处置（… / 补单 / **划转**）」；「二期内部划转（余额不足的退汇认领要等它垫款）」删；「15 条里能平 14 条」改「17 条里能平 16 条」。
- 第六幕开头「**第三句**」后加一句：「二期起补款 / 垫款也是三人分立：运营查证、金库开单发起、CFO 裁决。」

`doc-final/demo/data.md`：`recon:demo:pass / break` 那行改「**17 个破口场景 / 11 张案子**」「按处置家族排号 1→17」「**17/17 全检出**」，末尾加「；场景 16 处置 = 认损（金库开单、CFO 批）→ 补款划转（金库发起、CFO 批、⚡ 一腿）；场景 17 = 垫款划转（法币两腿经结算户）→ 认领退汇」。「本批数据」生成区不手改。

`doc-final/demo/baseline.md`：
- 「对账」行：`15/15 场景 + 10/10 钱包桶`（三处）改 `17/17 场景 + 11/11 钱包桶`，桶构成改 `break 8 / softFlag 2 / inTransit 1`，`casesOpened 11/11`，注明「2026-09-05 平账二期加 16（Alice USDT 认损 + 补款）/ 17（Grace AED 退汇余额不足 → 垫款）」；加一条「⚠️ 铺场前不得有在途划转（脚本前置闸会报错）」。
- 「账本」行注明「2026-09-05 起注资那笔已在流水里，运营户对账起点为正」。
- e2e 段的 recon 组文件清单加 `test/recon-internal-transfer.e2e-spec.ts  # 共用 dev.db，跑前先 demo:setup；截止用「现在」，不跨 UTC 零点跑`（若该段只列 11 个基线文件、recon 四份另列，就在 recon 那组加）。

- [ ] **Step 5: Commit**

```bash
git add scripts/recon-demo.ts doc-final/demo/script.md doc-final/demo/data.md doc-final/demo/baseline.md
git commit -m "feat(demo): 破口场景 16（Alice USDT 认损→补款）/ 17（Grace AED 退汇余额不足→垫款）+ 铺场前置闸「不得有在途划转」；第六幕剧本、数据字典、基线同步 17/17 + 11/11（平账二期 Task 11）"
```

本任务过哪几条：改页面或种子（`data.md` / `script.md` 同步 ✅）｜ 每轮收尾的判据落 `baseline.md` ✅。

---

### Task 12: 管理台——案件页认损 / 补款 / 垫款入口 + 列表徽标 + 发起弹层

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`
- Modify: `admin-web/src/pages/ReconciliationCasesListPage.tsx`
- Modify: `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx`
- Create: `admin-web/src/components/InternalTransferInitiateModal.tsx`
- Create（截图）: `doc-final/superpowers/plans/artifacts/2026-09-05-W2-loss-locked-view.png` / `-compensation-modal.png` / `-advance-button.png` / `-case-in-transit.png`

**Interfaces:**
- Consumes: Task 8 读面（`nextStep.kind` 五种、`transfer`、列表 `pendingFunding`）；Task 3 前端权限码
- Produces: `InternalTransferInitiateModal`（props `{ open, caseNo, row, assetCode, decimals, onClose, onDone }`）

**前置**：self 栈 `reset` + `demo:all` + `recon:demo:break`（Task 11 已铺 17/17）。

- [ ] **Step 1: 类型与权限**

`ReconciliationCasesDetailPage.tsx`：
1. `FlowComparisonRow` 的 `nextStep` 改为：
```ts
  nextStep?: {
    kind: 'WRITE_OFF' | 'INCIDENT_DEFERRED' | 'CLIENT_SURPLUS' | 'COMPENSATION' | 'ADVANCE';
    reasonCode?: 'UNEXPLAINED_WRITE_OFF' | 'UNEXPLAINED_CLIENT_LOSS'; direction?: 'REDUCE' | 'INCREASE'; amount?: string; effectiveDate?: string;
    adjustmentNo?: string; externalLineId?: string; customerNo?: string | null; walletNo?: string | null; available?: string; lineAmount?: string;
  };
  // 平账二期：这条差异行牵出的划转单（补款 / 垫款）回挂
  transfer?: { transferNo: string; purpose: string; status: string } | null;
```
2. 常量区加：
```ts
// 平账二期：划转单状态的人话（与 utils/internalTransferStatusMap.ts 同词，Task 13 建后改为 import）
const TRANSFER_STATUS_WORD: Record<string, string> = {
  PENDING_APPROVAL: '待 CFO 复核', EXECUTING: '执行中 · 钱在路上', SUCCESS: '已到账', FAILED: '失败', REJECTED: '已拒绝', CANCELLED: '已撤回',
};
```
3. 组件里 `canSupplement` 之后加：
```ts
  // 平账二期：补款 / 垫款发起归金库——持两个写码任一即可看到按钮；运营只看到指路文字。
  const canFundClient = hasAnyPermission([PERMISSIONS.INTERNAL_TRANSFER_COMPENSATION_WRITE, PERMISSIONS.INTERNAL_TRANSFER_ADVANCE_WRITE]);
  const [fundingRow, setFundingRow] = useState<FlowComparisonRow | null>(null);
```
4. import 加 `import InternalTransferInitiateModal from '../components/InternalTransferInitiateModal';`。

- [ ] **Step 2: 动作列**

在组件内（`sortedFlows` 之后）加渲染助手：

```tsx
  // 平账二期：行上的划转回挂 + 补款 / 垫款按钮。案子 RESOLVED 之后照样给（认损让案子愈了，补款是对客户的交代）。
  const renderFunding = (row: FlowComparisonRow) => (
    <>
      {row.transfer && (
        <span className="whitespace-nowrap font-mono text-[10px] text-adm-t2">
          {row.transfer.purpose === 'CLIENT_ADVANCE' ? '垫款' : '补款'}{' '}
          <Link to={`/admin/treasury/internal-transfers/${encodeURIComponent(row.transfer.transferNo)}`} className="text-adm-blue hover:underline">{row.transfer.transferNo}</Link>
          {' · '}{TRANSFER_STATUS_WORD[row.transfer.status] ?? row.transfer.status}
        </span>
      )}
      {(row.nextStep?.kind === 'COMPENSATION' || row.nextStep?.kind === 'ADVANCE') && kase && (
        canFundClient ? (
          <button type="button" onClick={() => setFundingRow(row)} className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline">
            <Plus size={10} />
            {row.nextStep.kind === 'COMPENSATION'
              ? `发起补款 ${formatAmount(row.nextStep.amount, kase.decimals)} ${kase.assetCode}`
              : `余额不足，发起垫款 ${formatAmount(row.nextStep.amount, kase.decimals)} ${kase.assetCode}`}
          </button>
        ) : (
          <span className="whitespace-nowrap font-mono text-[10px] text-adm-amber">
            {row.nextStep.kind === 'COMPENSATION' ? '待补款（金库发起）' : `余额不足 ${formatAmount(row.nextStep.amount, kase.decimals)}，待金库垫款`}
          </span>
        )
      )}
    </>
  );
```

动作列的改动（第 ~929-1020 行）：
- 分支 ①「已解释」把单独的 `<Link>` 包成 `<div className="flex flex-col gap-1">{link}{renderFunding(row)}</div>`（已解释行正是补款按钮的落点）；
- 分支 ④ 的 `flex-col` 里，SUPPLEMENT「发起补单」按钮的条件加 `&& row.nextStep?.kind !== 'ADVANCE'`（余额不足时不给「认领退汇」，给垫款）；
- WRITE_OFF 按钮文字改 `{row.nextStep.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? '认损' : '核销'}`，只读态文字改 `{row.nextStep.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? '超期 · 可认损' : '超期 · 可核销'}`；
- 删掉 `TRANSFER_DEFERRED` 那个 `<span>超期 · 待二期划转</span>` 分支，换成：
```tsx
                                {row.nextStep?.kind === 'CLIENT_SURPLUS' && (
                                  <span className="whitespace-nowrap font-mono text-[10px] text-adm-amber">超期 · 多出来的钱查清归属走补录</span>
                                )}
                                {renderFunding(row)}
```
- 弹层挂载：在 `<ReconciliationSupplementModal ... />` 旁加
```tsx
      <InternalTransferInitiateModal
        open={!!fundingRow} caseNo={kase.caseNo} row={fundingRow} assetCode={kase.assetCode} decimals={kase.decimals}
        onClose={() => setFundingRow(null)}
        onDone={() => { setFundingRow(null); void fetchCase(); }}
      />
```

- [ ] **Step 3: 发起弹层**

`admin-web/src/components/InternalTransferInitiateModal.tsx`：

```tsx
// admin-web/src/components/InternalTransferInitiateModal.tsx
// 平账二期（spec §8）：补款 / 垫款一个弹层。全部字段预填只读（金额不可改——多一分都是往客户钱包塞钱），
// 只填理由；提交打划转端点，返回单号 + 审批单号。externalLineId 只作隐藏锚，不上页面。
import { useState } from 'react';
import { adminFetch, AdminSessionError, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from './common/adminButtonStyles';
import { formatAmount } from '../pages/ReconciliationCasesDetailPage';

interface Props { open: boolean; caseNo: string; row: any | null; assetCode: string; decimals: number; onClose: () => void; onDone: () => void }

const InternalTransferInitiateModal = ({ open, caseNo, row, assetCode, decimals, onClose, onDone }: Props) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ transferNo: string; approvalNo: string } | null>(null);
  if (!open || !row?.nextStep) return null;
  const ns = row.nextStep;
  const isAdvance = ns.kind === 'ADVANCE';

  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const path = isAdvance ? '/admin/internal-transfers/advance' : '/admin/internal-transfers/compensation';
      const body = isAdvance
        ? { caseNo, externalLineId: ns.externalLineId, reason: reason.trim() }
        : { adjustmentNo: ns.adjustmentNo, reason: reason.trim() };
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}${path}`, { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) { setError(await getApiErrorMessage(res, '发起失败')); return; }
      setResult(await res.json());
    } catch (e) { if (e instanceof AdminSessionError) throw e; setError(e instanceof Error ? e.message : '发起失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] rounded-lg border border-adm-border bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold text-adm-t1">{isAdvance ? '发起垫款 · 退汇差额由公司先垫' : '发起补款 · 认损后公司补齐客户'}</h3>
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-adm-border bg-adm-hover/40 p-3 text-xs">
          <dt className="text-adm-t3">客户 / 钱包</dt><dd className="font-mono">{ns.customerNo ?? '—'} · {ns.walletNo ?? '—'}</dd>
          <dt className="text-adm-t3">金额（锁定，不可改）</dt><dd className="font-mono">{formatAmount(ns.amount, decimals)} {assetCode}</dd>
          {isAdvance ? (
            <><dt className="text-adm-t3">退汇 / 客户可用</dt><dd className="font-mono">{formatAmount(ns.lineAmount, decimals)} / {formatAmount(ns.available, decimals)}</dd></>
          ) : (
            <><dt className="text-adm-t3">来源认损单</dt><dd className="font-mono">{ns.adjustmentNo}</dd></>
          )}
          <dt className="text-adm-t3">对账案</dt><dd className="font-mono">{caseNo}</dd>
          <dt className="text-adm-t3">路线</dt><dd>{assetCode === 'AED' ? '运营户 → 结算户 → 客户 vIBAN（法币两腿）' : '运营户 → 客户地址（一腿）'}</dd>
        </dl>
        {result ? (
          <>
            <p className="text-xs text-adm-t2">已发起，等待 CFO 复核。划转单 <span className="font-mono">{result.transferNo}</span>，审批单 <span className="font-mono">{result.approvalNo}</span>。批准后到资金单页 ⚡ 推腿，回案子「重新对账」看在途与自愈。</p>
            <div className="mt-4 flex justify-end"><button type="button" onClick={onDone} className={adminButtonClass('modalConfirm')}>完成</button></div>
          </>
        ) : (
          <>
            <label className="mb-3 block text-xs">理由
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded border border-adm-border bg-adm-panel px-2 py-1 text-xs"
                placeholder={isAdvance ? '例：银行扣回 6500，客户已花掉部分，先垫后扣，垫款登记追索' : '例：托管差额查无可查，公司认赔补齐'} />
            </label>
            {error && <p className="mb-2 text-xs text-adm-red">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('modalCancel')}>取消</button>
              <button type="button" disabled={submitting || !reason.trim()} onClick={() => void submit()} className={adminButtonClass('modalConfirm')}>{submitting ? '提交中…' : '提交给 CFO'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InternalTransferInitiateModal;
```
（`adminButtonClass` 若没有 `modalCancel` 键，用 `adminButtonStyles.ts` 里既有的取消 / secondary 变体名：`grep -n "modal" admin-web/src/components/common/adminButtonStyles.ts`。）

- [ ] **Step 4: 调账弹层的认损文案 + 列表徽标**

`ReconciliationAdjustmentCreateModal.tsx`：`REASON_LABEL` 加 `UNEXPLAINED_CLIENT_LOSS: '客户池查无果认损',`；第 218-219 行改为
```ts
    setReasonInternal(locked?.writeOff ? `${locked.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? '客户池查无果认损' : '查无果核销'}：${locked.writeOff.findingNote}` : '');
    setReasonCustomer(locked?.writeOff ? (locked.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? '平台调整（托管差额认损，随后公司补款）' : '（公司侧核销，客户不可见）') : '');
```
锁定视图标题：`LOCKED_TITLE[locked.family]` 的取值处改为 `locked.family === 'WRITE_OFF' && locked.reasonCode === 'UNEXPLAINED_CLIENT_LOSS' ? '认损 · 让账跟着托管走，随后公司补款' : LOCKED_TITLE[locked.family]`。

`ReconciliationCasesListPage.tsx`：`ReconCase` 加 `pendingFunding: { kind: 'COMPENSATION' | 'ADVANCE'; status: 'PENDING' | 'IN_PROGRESS' } | null;`；定性进度那个 `<td>` 里在计数后加
```tsx
                      {kase.pendingFunding && (
                        <span className={`ml-1 inline-flex rounded border px-1 py-0.5 font-mono text-[9px] ${kase.pendingFunding.status === 'PENDING' ? 'border-adm-amber/40 bg-adm-amber/10 text-adm-amber' : 'border-adm-blue/40 bg-adm-blue/10 text-adm-blue'}`}>
                          {kase.pendingFunding.kind === 'COMPENSATION'
                            ? (kase.pendingFunding.status === 'PENDING' ? '待补款' : '补款中')
                            : (kase.pendingFunding.status === 'PENDING' ? '待垫款' : '垫款中')}
                        </span>
                      )}
```

- [ ] **Step 5: tsc + preview + 截图（闸⑤，永不豁免）**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
bash scripts/stack.sh up
```
用预览打开 self 栈管理台（端口看 `.stackports`），按第六幕 16 / 17 的步骤走到四个画面并截图落盘到 `doc-final/superpowers/plans/artifacts/`：
1. `2026-09-05-W2-loss-locked-view.png`：`treasury@` 在 Alice USDT 案（定性查不出 + ⚡拨钟超期后）点「认损」的锁定视图；
2. `2026-09-05-W2-compensation-modal.png`：认损 CFO 批完、重对账 RESOLVED 后，「发起补款 7.500000 USDT-TRON」弹层；
3. `2026-09-05-W2-advance-button.png`：Grace AED 案第五行定性退汇后的「余额不足，发起垫款 …」按钮（`treasury@` 视角）；
4. `2026-09-05-W2-case-in-transit.png`：补款腿 ⚡ SUBMIT 后重对账，Alice USDT 新开的在途案（琥珀）。
截图必须是渲染结果的物证；截不到就不算过（2026-09-02 那条「截图工具不落盘」的教训——落盘后 `ls -la` 确认文件大小 > 0）。

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/pages/ReconciliationCasesDetailPage.tsx admin-web/src/pages/ReconciliationCasesListPage.tsx admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx admin-web/src/components/InternalTransferInitiateModal.tsx doc-final/superpowers/plans/artifacts/2026-09-05-W2-*.png
git commit -m "feat(admin): 案件页客户池「认损」、认损后「发起补款」、退汇余额不足「发起垫款」+ 划转状态回挂；列表待补款 / 待垫款徽标；发起弹层（平账二期 Task 12）"
```

本任务过哪几条：新增业务动作（前端入口 ✅）｜ 退役业务动作（「待二期划转」文字删 ✅）｜ 改了前端 → 截图 ✅ ｜ tsc ②。

---

### Task 13: 管理台——划转单列表 / 详情 + 路由 + 侧栏 + 审批回链 + 资金单父单筛选

**Files:**
- Create: `admin-web/src/utils/internalTransferStatusMap.ts`
- Create: `admin-web/src/pages/InternalTransferList.tsx`
- Create: `admin-web/src/pages/InternalTransferDetail.tsx`
- Modify: `admin-web/src/App.tsx`（lazy import + 两条路由）
- Modify: `admin-web/src/components/DashboardLayout.tsx`（Custody 组加「Internal Transfers」）
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`（`ENTITY_ROUTE_BY_ACTION` +1）
- Modify: `admin-web/src/pages/FundsOrderList.tsx` / `FundsOrderDetail.tsx`（父单筛选 + 回链）
- Modify: `admin-web/src/components/ui/StatusPill.tsx`（`EXECUTING` 一色）
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（`TRANSFER_STATUS_WORD` 改 import）
- Create（截图）: `doc-final/superpowers/plans/artifacts/2026-09-05-W2-transfer-detail-in-transit.png` / `-case-resolved-after-settle.png` / `-approval-impact.png`

- [ ] **Step 1: 状态词表**

`admin-web/src/utils/internalTransferStatusMap.ts`：

```ts
// 平账二期：内部划转单的状态 / 用途人话。唯一真相在后端 dto/internal-transfer.dto.ts，这里只是展示词。
export const INTERNAL_TRANSFER_STATUS_LABEL: Record<string, string> = {
  PENDING_APPROVAL: '待 CFO 复核', EXECUTING: '执行中 · 钱在路上', SUCCESS: '已到账', FAILED: '失败', REJECTED: '已拒绝', CANCELLED: '已撤回',
};
export const INTERNAL_TRANSFER_PURPOSE_LABEL: Record<string, string> = {
  CLIENT_COMPENSATION: '补款 · 认损后公司补齐', CLIENT_ADVANCE: '垫款 · 退汇差额先垫后扣',
};
export const INTERNAL_TRANSFER_STATUSES = ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS', 'FAILED', 'REJECTED', 'CANCELLED'] as const;
```
`ReconciliationCasesDetailPage.tsx` 的 `TRANSFER_STATUS_WORD` 常量删掉，改 `import { INTERNAL_TRANSFER_STATUS_LABEL as TRANSFER_STATUS_WORD } from '../utils/internalTransferStatusMap';`。`StatusPill.tsx` 的 `STATUS_PILL_MAP` 加 `EXECUTING: 'bg-blue-100 text-blue-800',`。

- [ ] **Step 2: 列表页**

`InternalTransferList.tsx`（骨架照 `FundsOrderList.tsx`：`PageTitleBar` + 筛选条 + 表 + `Pagination`）：

```tsx
// admin-web/src/pages/InternalTransferList.tsx
// 平账二期：内部划转单列表（公司 → 客户补款 / 垫款）。入口只在案子上，这里是查与回看；金库 / CFO / 运营 / 内审 / 高管可读。
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { StatusPill } from '../components/ui/StatusPill';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { INTERNAL_TRANSFER_PURPOSE_LABEL, INTERNAL_TRANSFER_STATUSES, INTERNAL_TRANSFER_STATUS_LABEL } from '../utils/internalTransferStatusMap';

interface Item { transferNo: string; purpose: string; status: string; customerNo: string; assetCode: string; currency: string; amount: string; sourceCaseNo: string; sourceAdjustmentNo: string | null; createdAt: string }
const PAGE_SIZE = 20;

const InternalTransferList = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(1);
  const [status, setStatus] = useState(''); const [purpose, setPurpose] = useState(''); const [loading, setLoading] = useState(true);

  const fetchItems = async (nextPage = page, nextStatus = status, nextPurpose = purpose) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: String((nextPage - 1) * PAGE_SIZE), take: String(PAGE_SIZE) });
      if (nextStatus) params.set('status', nextStatus); if (nextPurpose) params.set('purpose', nextPurpose);
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-transfers?${params.toString()}`);
      if (!res.ok) { alert(await getApiErrorMessage(res, 'Failed to load internal transfers')); return; }
      const data = await res.json(); setItems(data.items ?? []); setTotal(data.total ?? 0); setPage(nextPage);
    } catch (e) { if (e instanceof AdminSessionError) return; console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { void fetchItems(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="flex h-full flex-col">
      <PageTitleBar title="Internal Transfers · 内部划转单" subtitle="公司 → 客户的补款 / 垫款；入口在对账案子上，这里只查与回看" meta={`${total} transfer(s)`}>
        <button type="button" onClick={() => void fetchItems(page)} className={adminIconButtonClass()} title="Refresh"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </PageTitleBar>
      <div className="flex gap-2 border-b border-adm-border px-5 py-2 text-xs">
        <select value={status} onChange={(e) => { setStatus(e.target.value); void fetchItems(1, e.target.value, purpose); }} className="rounded border border-adm-border bg-adm-panel px-2 py-1">
          <option value="">All statuses</option>
          {INTERNAL_TRANSFER_STATUSES.map((s) => <option key={s} value={s}>{INTERNAL_TRANSFER_STATUS_LABEL[s]}</option>)}
        </select>
        <select value={purpose} onChange={(e) => { setPurpose(e.target.value); void fetchItems(1, status, e.target.value); }} className="rounded border border-adm-border bg-adm-panel px-2 py-1">
          <option value="">All purposes</option>
          <option value="CLIENT_COMPENSATION">补款</option>
          <option value="CLIENT_ADVANCE">垫款</option>
        </select>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-adm-panel"><tr className="border-b border-adm-border text-left text-adm-t3">
            {['单号', '用途', '客户', '金额', '状态', '来源案', '来源认损单', '时间'].map((h) => <th key={h} className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide">{h}</th>)}
          </tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.transferNo} onClick={() => navigate(`/admin/treasury/internal-transfers/${encodeURIComponent(it.transferNo)}`)} className="cursor-pointer border-b border-adm-border/60 hover:bg-adm-hover/40">
                <td className="px-4 py-2 font-mono text-adm-blue">{it.transferNo}</td>
                <td className="px-4 py-2">{INTERNAL_TRANSFER_PURPOSE_LABEL[it.purpose] ?? it.purpose}</td>
                <td className="px-4 py-2 font-mono">{it.customerNo}</td>
                <td className="px-4 py-2 font-mono">{it.amount} {it.currency}</td>
                <td className="px-4 py-2"><StatusPill status={it.status} /></td>
                <td className="px-4 py-2 font-mono">{it.sourceCaseNo}</td>
                <td className="px-4 py-2 font-mono">{it.sourceAdjustmentNo ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-adm-t3">{new Date(it.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-adm-t3">还没有划转单——从对账案子上「发起补款 / 发起垫款」</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={(p) => void fetchItems(p)} />
    </div>
  );
};
export default InternalTransferList;
```
（`StatusPill` 的 props 若不是 `{ status }`，按 `admin-web/src/components/ui/StatusPill.tsx:60` 的真实签名传；`adminIconButtonClass` 的参数照 `FundsOrderList.tsx` 的用法。）

- [ ] **Step 3: 详情页**

`InternalTransferDetail.tsx`（骨架照 `ReconciliationAdjustmentDetailPage.tsx`）：

```tsx
// admin-web/src/pages/InternalTransferDetail.tsx
// 平账二期：划转单详情——来源（案号 / 认损单或账单行参考号）、客户、金额、状态、审批单回链、资金单腿卡片（法币两腿）、待批时金库可撤回。
// 铁律⑥：后端投影已无任何 UUID，本页类型里也不出现。
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { SidebarGroup, SidebarKV } from '../components/ui/SidebarPrimitives';
import { StatusPill } from '../components/ui/StatusPill';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { INTERNAL_TRANSFER_PURPOSE_LABEL, INTERNAL_TRANSFER_STATUS_LABEL } from '../utils/internalTransferStatusMap';

interface Leg { fundsOrderNo: string; legSeq: number; status: string; fromWalletNo: string | null; toWalletNo: string | null; externalRef: string | null }
interface Detail {
  transferNo: string; purpose: string; status: string; customerNo: string; assetCode: string; currency: string; decimals: number; amount: string;
  reason: string; sourceCaseNo: string; sourceAdjustmentNo: string | null; sourceExternalRef: string | null;
  approvalNo: string | null; failureReasonCode: string | null; failureNote: string | null;
  fromWalletNo: string | null; viaWalletNo: string | null; toWalletNo: string | null;
  createdBy: string; createdAt: string; executedAt: string | null; settledAt: string | null; legs: Leg[];
}

const InternalTransferDetail = () => {
  const { transferNo } = useParams<{ transferNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();
  const canCancel = hasPermission(PERMISSIONS.INTERNAL_TRANSFER_CANCEL);
  const [detail, setDetail] = useState<Detail | null>(null); const [loading, setLoading] = useState(true); const [cancelling, setCancelling] = useState(false);

  const fetchDetail = async () => {
    if (!transferNo) return; setLoading(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-transfers/${encodeURIComponent(transferNo)}`);
      if (res.ok) setDetail((await res.json()) as Detail);
      else { alert(await getApiErrorMessage(res, 'Failed to load internal transfer')); navigate('/admin/treasury/internal-transfers'); }
    } catch (e) { if (e instanceof AdminSessionError) return; console.error(e); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (transferNo) void fetchDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [transferNo]);

  const cancel = async () => {
    if (!detail) return;
    const reason = window.prompt('撤回理由（必填）'); if (!reason?.trim()) return;
    setCancelling(true);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/internal-transfers/${encodeURIComponent(detail.transferNo)}/cancel`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      if (!res.ok) { alert(await getApiErrorMessage(res, '撤回失败')); return; }
      await fetchDetail();
    } catch (e) { if (e instanceof AdminSessionError) return; console.error(e); }
    finally { setCancelling(false); }
  };

  if (loading && !detail) return <div className="flex min-h-[400px] flex-col items-center justify-center"><RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} /><p className="text-adm-t3">Loading internal transfer...</p></div>;
  if (!detail) return null;
  const route = detail.viaWalletNo ? `${detail.fromWalletNo} → ${detail.viaWalletNo} → ${detail.toWalletNo}` : `${detail.fromWalletNo} → ${detail.toWalletNo}`;

  return (
    <div className="flex h-full flex-col">
      <DetailPageHeader title="Internal Transfer · 内部划转单" subtitle={detail.transferNo} onBack={() => navigate('/admin/treasury/internal-transfers')} onRefresh={() => void fetchDetail()} refreshing={loading} backLabel="Internal Transfers">
        <StatusPill status={detail.status} />
        {detail.status === 'PENDING_APPROVAL' && canCancel && (
          <button type="button" disabled={cancelling} onClick={() => void cancel()} className={adminButtonClass('detailUtility')}>撤回 / Cancel</button>
        )}
      </DetailPageHeader>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <DetailCard title="划转" columns={3}>
            <InfoField label="用途" value={INTERNAL_TRANSFER_PURPOSE_LABEL[detail.purpose] ?? detail.purpose} />
            <InfoField label="客户" value={detail.customerNo} mono />
            <InfoField label="金额" value={`${detail.amount} ${detail.currency}`} mono accent />
            <InfoField label="路线" value={route} mono />
            <InfoField label="状态" value={INTERNAL_TRANSFER_STATUS_LABEL[detail.status] ?? detail.status} />
            <InfoField label="理由" value={detail.reason} />
            {detail.failureNote && <InfoField label="失败" value={`${detail.failureReasonCode ?? ''} ${detail.failureNote}`} highlight />}
          </DetailCard>
          <DetailCard title="来源" columns={3}>
            <InfoField label="对账案" value={detail.sourceCaseNo} mono link={`/admin/reconciliation/cases/${encodeURIComponent(detail.sourceCaseNo)}`} />
            {detail.sourceAdjustmentNo && <InfoField label="认损单" value={detail.sourceAdjustmentNo} mono link={`/admin/reconciliation/adjustments/${encodeURIComponent(detail.sourceAdjustmentNo)}`} />}
            {detail.sourceExternalRef && <InfoField label="退汇账单行参考号" value={detail.sourceExternalRef} mono />}
            <InfoField label="审批单" value={detail.approvalNo} mono link={detail.approvalNo ? `/admin/governance/approvals/${encodeURIComponent(detail.approvalNo)}` : undefined} />
          </DetailCard>
          <DetailCard title="资金单腿（⚡ 推进在资金单页）" columns={1}>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-adm-t3">{['腿', '资金单', '从 → 到', '状态', '参考号'].map((h) => <th key={h} className="px-2 py-1 font-mono text-[10px]">{h}</th>)}</tr></thead>
              <tbody>
                {detail.legs.map((l) => (
                  <tr key={l.fundsOrderNo} className="border-t border-adm-border/60">
                    <td className="px-2 py-1 font-mono">{l.legSeq}</td>
                    <td className="px-2 py-1 font-mono"><Link to={`/admin/funds-orders/${encodeURIComponent(l.fundsOrderNo)}`} className="text-adm-blue hover:underline">{l.fundsOrderNo}</Link></td>
                    <td className="px-2 py-1 font-mono">{l.fromWalletNo ?? '—'} → {l.toWalletNo ?? '—'}</td>
                    <td className="px-2 py-1"><StatusPill status={l.status} /></td>
                    <td className="px-2 py-1 font-mono text-adm-t3">{l.externalRef ?? '—'}</td>
                  </tr>
                ))}
                {detail.legs.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-adm-t3">批准后第一腿才诞生</td></tr>}
              </tbody>
            </table>
          </DetailCard>
        </div>
        <aside className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4">
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={`${detail.createdBy} · ${new Date(detail.createdAt).toLocaleString()}`} />
            <SidebarKV label="Executed" value={detail.executedAt ? new Date(detail.executedAt).toLocaleString() : '—'} />
            <SidebarKV label="Settled" value={detail.settledAt ? new Date(detail.settledAt).toLocaleString() : '—'} />
          </SidebarGroup>
        </aside>
      </div>
    </div>
  );
};
export default InternalTransferDetail;
```
（`InfoField` 的 `link` prop 形状按 `DetailPageComponents.tsx:106-130` 的真实签名传——若它要的是 `{ href }` 对象，照它；`SidebarKV` 的 props 照 `SidebarPrimitives.tsx:17`。）

- [ ] **Step 4: 路由 / 侧栏 / 审批回链 / 资金单**

`App.tsx`：lazy 区加 `const InternalTransferList = lazy(() => import('./pages/InternalTransferList'));` `const InternalTransferDetail = lazy(() => import('./pages/InternalTransferDetail'));`；第二棵路由树 `{/* custody */}` 段之后加
```tsx
            {/* 平账二期：内部划转单（公司 → 客户补款 / 垫款） */}
            <Route path="treasury/internal-transfers" element={withPermission(<InternalTransferList />, [PERMISSIONS.INTERNAL_TRANSFERS_READ])} />
            <Route path="treasury/internal-transfers/:transferNo" element={withPermission(<InternalTransferDetail />, [PERMISSIONS.INTERNAL_TRANSFER_DETAIL_READ])} />
```
`DashboardLayout.tsx` Custody 组 `children` 在 Withdrawal Addresses 之后加
```tsx
        {
          path: '/admin/treasury/internal-transfers',
          label: 'Internal Transfers',
          icon: <ArrowLeftRight size={13} />,
          requiredPermissions: [PERMISSIONS.INTERNAL_TRANSFERS_READ],
        },
```
（`ArrowLeftRight` 已在该文件的 lucide import 里；没有就加进去。）
`ApprovalDetailPage.tsx` 的 `ENTITY_ROUTE_BY_ACTION` 在 `RECON_ADJUSTMENT_POST` 后加 `INTERNAL_TRANSFER_APPROVAL: (r) => \`/admin/treasury/internal-transfers/${r}\`,`（注释「平账二期（entityRef = transferNo）」）。
`FundsOrderList.tsx`：`ParentType` 加 `'internal-transfer'`；`PARENT_TYPES` 加 `{ key: 'internal-transfer', label: 'Internal transfer' }`；`FundsOrderItem` 加 `transferNo?: string | null`；`parentOf` 加 `if (item.transferNo) return { kind: 'Internal transfer', no: item.transferNo };`；父单号渲染处若按 kind 拼链接，加 `Internal transfer → /admin/treasury/internal-transfers/:no`。`FundsOrderDetail.tsx`：类型加 `transferNo?: string | null`、`internalTransfer?: { transferNo: string; status: string } | null`；父单区块（第 150-175 行那组 `if (data.depositNo) ...`）加 `if (data.internalTransfer?.transferNo) { kind: 'Internal transfer', no, href: \`/admin/treasury/internal-transfers/${no}\` }`。

- [ ] **Step 5: tsc + 截图三张**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
bash scripts/stack.sh up
```
截图落盘：
1. `2026-09-05-W2-transfer-detail-in-transit.png`：补款划转详情，腿 1 SUBMITTED（资金单卡片在途）；
2. `2026-09-05-W2-case-resolved-after-settle.png`：⚡ CONFIRM 后重对账，Alice USDT 在途案 RESOLVED、行上「补款 ITR… · 已到账」；
3. `2026-09-05-W2-approval-impact.png`：审批中心 `INTERNAL_TRANSFER_APPROVAL` 详情页的后果原话 + 回链到划转单。
同时确认侧栏 Custody 组出现「Internal Transfers」、资金单列表筛选「Internal transfer」能筛出两条腿。

- [ ] **Step 6: Commit**

```bash
git add admin-web/src
git commit -m "feat(admin): 内部划转单列表 / 详情页、Custody 侧栏入口、审批回链、资金单父单筛选与回链（平账二期 Task 13）"
```

本任务过哪几条：新增业务动作（列表 / 详情 / 撤回入口 ✅）｜ 对外识别（页面只有业务号 ✅）｜ 改了前端 → 截图 ✅ ｜ tsc ②。

---

### Task 14: 客户端——对账单三种行的人话

**Files:**
- Create: `client-web/src/utils/statementSourceLabel.ts`
- Create: `client-web/src/utils/statementSourceLabel.spec.ts`
- Modify: `client-web/src/pages/DashboardOverview.tsx:463-480`
- Create（截图）: `doc-final/superpowers/plans/artifacts/2026-09-05-W2-client-statement.png`

- [ ] **Step 1: 写失败的 vitest**

`client-web/src/utils/statementSourceLabel.spec.ts`：

```ts
// client-web/src/utils/statementSourceLabel.spec.ts
import { statementSourceLabel } from './statementSourceLabel';

/** 平账二期（spec §11）：客户对账单三种平台发起的行——客户真经历过的余额变动，不藏，只换成人话。 */
describe('statementSourceLabel', () => {
  it('认损调账 → 平台调整', () => {
    expect(statementSourceLabel({ sourceType: 'RECON_ADJUSTMENT', eventCode: 'RECON_ADJUSTMENT_POSTED' })).toBe('平台调整');
  });
  it('补款 → 平台补款；垫款 → 平台垫付（按客户侧腿的事件码分）', () => {
    expect(statementSourceLabel({ sourceType: 'INTERNAL_TRANSFER', eventCode: 'INTERNAL_TRANSFER_COMPENSATION_IN' })).toBe('平台补款');
    expect(statementSourceLabel({ sourceType: 'INTERNAL_TRANSFER', eventCode: 'INTERNAL_TRANSFER_ADVANCE_IN' })).toBe('平台垫付');
  });
  it('其余不动：WITHDRAWAL 仍显示 WITHDRAW，其它原样', () => {
    expect(statementSourceLabel({ sourceType: 'WITHDRAWAL', eventCode: 'WITHDRAW_NET_POST' })).toBe('WITHDRAW');
    expect(statementSourceLabel({ sourceType: 'DEPOSIT', eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE' })).toBe('DEPOSIT');
    expect(statementSourceLabel({ sourceType: 'SWAP', eventCode: 'SWAP_BUY_CLIENT' })).toBe('SWAP');
  });
});
```

- [ ] **Step 2: 跑确认红**

Run: `npm run test:client` → FAIL（模块不存在）

- [ ] **Step 3: 实现 + 接线**

`client-web/src/utils/statementSourceLabel.ts`：

```ts
// 客户对账单「来源」列的人话（平账二期 spec §11）。唯一真相在账本 evidence 的 sourceType / eventCode；
// 这里只做展示映射：认损 = 平台调整；补款 / 垫款按客户侧腿的事件码分（后端 postFinalLeg 按用途铸）。
export function statementSourceLabel(row: { sourceType: string; eventCode: string }): string {
  if (row.sourceType === 'RECON_ADJUSTMENT') return '平台调整';
  if (row.sourceType === 'INTERNAL_TRANSFER') return row.eventCode === 'INTERNAL_TRANSFER_ADVANCE_IN' ? '平台垫付' : '平台补款';
  return row.sourceType === 'WITHDRAWAL' ? 'WITHDRAW' : row.sourceType;
}
```

`DashboardOverview.tsx`：import `statementSourceLabel`；对账单表格「类型」单元格里 `{row.sourceType === 'WITHDRAWAL' ? 'WITHDRAW' : row.sourceType}` 改 `{statementSourceLabel(row)}`，颜色分支加一档：`row.sourceType === 'RECON_ADJUSTMENT' || row.sourceType === 'INTERNAL_TRANSFER' ? 'text-fx-sage'`（放在 WITHDRAWAL 分支之后、默认 `text-fx-brass` 之前）。

- [ ] **Step 4: 跑绿 + tsc + 截图**

```bash
npm run test:client
cd client-web && npx tsc -b --noEmit && cd ..
```
预览 self 栈客户端，登 Alice（`demo_alice@example.com`，密码见 `demo/data.md`），打开 USDT 的对账单弹层，截 `2026-09-05-W2-client-statement.png`：能看到 −7.5「平台调整 · ADJ…」与 +7.5「平台补款 · ITR…」两行、余额复位。

- [ ] **Step 5: Commit**

```bash
git add client-web/src/utils/statementSourceLabel.ts client-web/src/utils/statementSourceLabel.spec.ts client-web/src/pages/DashboardOverview.tsx doc-final/superpowers/plans/artifacts/2026-09-05-W2-client-statement.png
git commit -m "feat(client): 对账单三种平台发起的行显示人话——平台调整 / 平台补款 / 平台垫付（平账二期 Task 14）"
```

本任务过哪几条：新字段 / 新状态到客户面（§11 已定：行可见、划转单不可见）｜ 改了前端 → 截图 ✅ ｜ tsc ③ ｜ `test:client` ✅。

---

### Task 15: 文档收口

**Files:**
- Create: `doc-final/modules/v7-treasury.md`
- Modify: `doc-final/modules/overview.md`、`v8-recon.md`、`funds-orders.md`、`accounting-coa.md`、`v4-deposit.md`
- Modify: `doc-final/demo/simulated-externals.md`
- Modify: `doc-final/BACKLOG.md`、`doc-final/CHANGELOG.md`
- Modify: `doc-final/superpowers/specs/2026-09-03-incident-register-design.md`（「承接上一波（二期）」段）
- Modify: `doc-final/superpowers/specs/2026-09-03-recon-settlement-waves-outline.md`（二期行状态）

- [ ] **Step 1: 新篇 `modules/v7-treasury.md`**

```markdown
# V7 · 财资（公司的钱怎么给客户）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-05（平账二期：内部划转单落地）
> 演示幕次：第六幕场景 16 / 17 ｜ 验收：第六幕走查（`demo/script.md`）+ `modules/v8-recon.md` §4

## 0. 一句话定位

管**公司自己的钱放进客户钱包**这件事。它是第四类订单（决策 2026-08-28）：有意图、有审批、有执行、有资金单跟着在途、有账本分录收口。二期只做公司 → 客户两条路：**认损补款**、**退汇垫款**；公司池之间的调拨不做（结算户是过渡户，兑换每笔进多少出多少）。

## 1. 业务叙事

**短缺 = 托管里的钱比账本记的少。** 两种：查不出的短缺（认损 + 补款）；退汇造成的短缺（先垫后扣）。两种都要**先让账说真话，再由公司真金白银补进去**——认损让案子愈，补款是对客户的交代；垫款金额锁定等于差额，先垫后扣，客户欠公司的三期追索。

**每一步真人开单、真人裁决。** 运营查证定性、金库在案子上发起、CFO 单步复核；金额不可改（多一分都是往客户钱包塞钱）。

**法币必须经结算户。** vIBAN 与运营户不能直转：运营户 → 结算户 → 客户 vIBAN 两腿，与兑换买入腿同一条物理路线；加密币一腿直达。

**钱在路上时对账不红。** 腿一提交，模拟托管方就写两行对账单；账本在腿确认时落账、同一参考号。对账在两钱包各找到一张没走完的资金单，落在途桶。

## 2. 状态机（六态六边）

`PENDING_APPROVAL → EXECUTING → SUCCESS`；`PENDING_APPROVAL → FAILED（批了运营户没钱）/ REJECTED（拒绝 / 超时）/ CANCELLED（金库撤回）`；`EXECUTING → FAILED（腿失败）`。不设草稿、不设「已批准」中间态、不计时。资金单腿：加密币一腿沿出金表 5 跳，法币两腿各 4 跳，腿 1 清算后腿 2 才诞生。

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 发起补款 | 金库（案件页，认损落账后） | CFO 单步 | 金额 = 认损额；同一认损单只能有一张未走完 / 已成功的划转单 |
| 发起垫款 | 金库（案件页，退汇行余额不足时） | CFO 单步 | 金额 = 账单行 − 客户可用；到账后「认领退汇」回来 |
| 撤回 | 金库（待批时） | — | 执行中不许撤 |
| ⚡ 推腿 | 运营（资金单页） | — | 提交写回单、确认落账 |
| 批准时余额复核 | 系统 | — | 运营户不够 → FAILED，不建资金单 |

## 4. 演示脚本

第六幕场景 16（Alice USDT：认损 → 补款，一腿）与 17（Grace AED：垫款 → 认领，两腿）——步骤在 `demo/script.md`。

## 5. 关键技术节点

- 主体 `asset-treasury/internal-transfers/internal-transfer.service.ts`（迁移表 / 建行 / 零 UUID 投影 / 运营户余额闸）｜ 工作流 `internal-transfer-workflow.service.ts`（发起 / 撤回 / `workflow.internal-transfer.decided` / `FUNDS_ORDER_STATUS_CHANGED`：提交写回单、确认落账 81/82/83 并清算、失败三种原因码）｜ 审批 `INTERNAL_TRANSFER_APPROVAL`（CFO 单步 48h 可撤）｜ 端点 `admin/internal-transfers/{compensation,advance,:no/cancel}` + 列表 / 详情
- 对账域：`reconciliation/simulation/simulated-custodian-statement.service.ts`（模拟托管方回单）｜ 读面 `disposition/funding-next-step.ts`（`COMPENSATION` / `ADVANCE`）
- 资金单第四父键 `internalTransferId`（沿出金走法表）｜ 转账码 81–83 ｜ 审计七码 `V7_TREASURY_AUDIT_ACTIONS`（域 TREASURY）｜ 权限 `INTERNAL_TRANSFER_READ / WRITE`（桶 `treasury.view_transfers` / `treasury.act_client_funding`）
- 表 `internal_transfers`；客户可见面：账本对账单行「平台补款 / 平台垫付」（客户侧腿事件码分）

## 6. 演示缺口（BACKLOG 有账）

- 公司池调拨（备付 / 归集）不做；手续费归集等报表层
- 法币腿 2 失败后款项停在结算户，人工处理，不做自动退回
- 追索三期：垫款只登记不入账，账上无应收科目
- 铺场前不得有在途划转（脚本前置闸）
```

- [ ] **Step 2: 既有各篇**

- `overview.md`：模块表 V7 行改「V7 财资 ｜ 公司自有资金 + 内部划转单（公司 → 客户补款 / 垫款，2026-09-05）｜ 公司的钱怎么给客户」；§4 首句「12 域 54 桶」改「12 域 56 桶」，Treasury 行加「｜ 查内部划转 / 发起补款 · 垫款」并改桶数；TREASURY_OFFICER 独有动作加「**发起补款 / 垫款**（案子上，2026-09-05 平账二期）」；CFO 裁决位加「补款 / 垫款划转」；**删掉**「例外」段里 `INTERNAL_TRANSFER_READ/WRITE` 那半句（那两个组 2026-09-02 已删、2026-09-05 重铸为真实桶）；§5 加一行「内部划转 `asset-treasury/internal-transfers/`」；§8 路由表加 `modules/v7-treasury.md`；头部 Last Verified 改 2026-09-05。
- `v8-recon.md`：§1 末尾加一段「**客户池的短缺（2026-09-05 平账二期立）**：查不出的小额短缺到线后走**认损**（分录同核销、只许托管里少了的方向），案子愈；随后金库在案子上「发起补款」、CFO 批、真转账补齐客户。退汇认领余额不够不再只是拒：行上直接给「发起垫款」，先垫后扣。两条都是第四类订单「内部划转单」，见 `modules/v7-treasury.md`」；§2 表加「案件计时」之后一行「**划转回挂**：认损落账后案子 RESOLVED 但行上「待补款」活着，直到补款 SUCCESS」；§3 表加三行（认损 / 发起补款 / 发起垫款，谁发起 / 谁裁决照 v7-treasury §3）并把「认领退汇」那行的「余额不够即拒、案子照旧红」改「余额不够给『发起垫款』」；§4 场景表加 16 / 17 两行、「已知口径」改 17/17 + 11/11、能平 16 条；§5 加「处置·划转（二期）：读面 `funding-next-step.ts`、回单 `simulation/simulated-custodian-statement.service.ts`、成因表 21 → 20（`FIRM_TRANSFER_UNTRACKED` 退役）」；§6 删「退汇认领余额不足只能拒」「客户池核销待二期划转」两条，「处置全集十件覆盖八件」改「九件（… / 补单 / **划转**）」。
- `funds-orders.md`：§2 走法表加「内部划转腿 ｜ 沿出金表（加密币 5 跳 / 法币 4 跳），法币两腿串行」；§5 父键说明「三个 parent FK」改四个、`directionOf` 加内部划转分支；§6 加「内部划转腿的外部账单由模拟托管方在提交时写（本波唯一新演示装置）」。
- `accounting-coa.md`：§5 转账类型码处加「81–83 内部划转」；§6 删「资本注入少一行流水凭证」那条（改为一句「2026-09-05 起注资在流水里」）。
- `v4-deposit.md`：§2 / §3 「退汇认领」处「余额不够即拒、案子照旧红」改「余额不够 → 案子上『发起垫款』（内部划转单，`modules/v7-treasury.md`），到账后再认领」；§6 缺口同步。
- `demo/simulated-externals.md`：表里加一行「**托管方 / 银行回单（内部划转腿）** ｜ 🎭 假 ｜ 腿一提交，模拟托管方就往对账单里写出方 OUT、入方 IN 两行并增减当日收盘；铺场脚本重铸时不重复；铺场前不得有在途划转 ｜ 资金单 ⚡ SUBMIT」。

- [ ] **Step 3: 账本三件 + 三期承接**

- `decisions.md`：核对 2026-09-05 七条已在（spec 提交时追加）；若执行中有新裁定（如 e2e 截止用「现在」的约束）追加一条。
- `CHANGELOG.md` 顶部加一行：`- [2026-09-05] **平账二期：客户资金短缺终于有出口** —— 观众能感知的变化是：客户池查不出的小额短缺到线后可以「认损」（账跟着托管走、案子愈），随后金库在案子上「发起补款」、CFO 批、公司真金白银把客户补齐，客户端看到先减后加两行；退汇认领余额不够不再只是拒，行上直接「发起垫款」，先垫后扣。补款 / 垫款是第四类订单「内部划转单」：法币两腿经结算户、加密币一腿；腿一提交对账单上就有影（模拟托管方回单），钱在路上时对账不红。公司池调拨不做（结算户是过渡户）；成因表退一条 21 → 20。搭车修了开户登记账户号补零与注资流水。破口场景 15 → 17、案子 10 → 11。`
- `BACKLOG.md`：销（`- [x] ~~…~~ —— 已解（2026-09-05 平账二期 …）`）：§G「二期 · 内部划转单」条（注明「只做公司 → 客户两条路，公司池调拨不做，理由见 decisions 2026-09-05」）、「退汇认领·客户余额不足时系统直接拒」条、「`AccountingService.createAccounts()` 写注册表时本身不补零」条、§B 两条「资本注入流水缺 evidence 行」「资本注入 evidence 待核」；§G 首条「⭐ 真差异处置闭环」的「已交付」加「划转（认损补款 / 退汇垫款）」并删「二期」指引。加：`- [ ] **手续费归集不做，等报表层**（2026-09-05 平账二期 F1'）：账上等于收入结转进运营户，可做；但收入户兼作钱包位置，归集后余额清零，没有报表层时观众读不出本期收入 ｜来源: 平账二期 spec §0`；`- [ ] **法币补款腿 2 失败后款项停在结算户**（2026-09-05）：腿 1 已落账、账与钱一致，订单 FAILED，人工处理，不做自动退回 ｜来源: 平账二期 spec §3`；三期条补一句「追索 = 垫款反向（客户 → 公司），垫款单上 `purpose=CLIENT_ADVANCE` 是它的入口」。
- 三期骨架 `2026-09-03-incident-register-design.md` 的「承接上一波（二期）」段按执行实况写三节：**实际偏差**（对照本 plan 逐任务写，例如 e2e 截止改用「现在」、`requiredFields` 只列真列）、**执行中发现的新事实**、**三期前提有无变化**（至少写：补款划转已是赔付原语，来源今天只有认损单 / 账单行两种，三期赔付要给它加第三种来源 `sourceIncidentNo`；`SimulatedCustodianStatementService` 可直接复用；成因表 20 码；`UNAUTHORIZED_OUTFLOW` 仍留档等三期）。**只写承接，不展开三期。**
- 总纲 `2026-09-03-recon-settlement-waves-outline.md` 二期行状态改「合 main <日期>（<commit>）」（合并后由 Task 16 补 commit 号）。

- [ ] **Step 4: Commit**

```bash
git add doc-final/modules doc-final/demo/simulated-externals.md doc-final/BACKLOG.md doc-final/CHANGELOG.md doc-final/decisions.md doc-final/superpowers/specs
git commit -m "docs(二期收口): 新篇 v7-treasury、v8-recon / funds-orders / accounting-coa / v4-deposit / overview 同步、模拟托管方回单入册、BACKLOG 销五加二、CHANGELOG、三期骨架承接记录（平账二期 Task 15）"
```

本任务过哪几条：每轮收尾（文档分层 + CHANGELOG + BACKLOG ✅）｜ 本任务是多波中的一波（承接写进三期骨架开头，不展开 ✅）。

---

### Task 16: 收尾闸 + 合并准备

**Files:** 无新文件；产出 = 全绿证据 + 合并

- [ ] **Step 1: 随手闸全量**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/asset-treasury/internal-transfers src/modules/funds-orders src/modules/clearing-settle/reconciliation src/modules/governance src/modules/audit-logging src/modules/accounting src/modules/trading/deposit-transactions admin-web/src
npm run test:client
```
Expected：全绿；判据 = 全绿，无红名单。

- [ ] **Step 2: 收尾闸（顺序不可颠倒——verify:rbac / act1 会写探针数据，必须排在重铺之前）**

```bash
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:act1
bash scripts/stack.sh reset self && bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:setup
bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-'
bash scripts/stack.sh reset self && bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self recon:demo:break
```
Expected：`verify:rbac` 全绿（新策略行 + 前后端权限码差集空）；`verify:act1` 15/15（或 +1 SKIP）；五份 recon e2e 全绿；`demo:all` 29/29；`recon:demo:break` 17/17 + 11/11 + casesOpened 11/11。

- [ ] **Step 3: 第六幕 16 / 17 真人走查（预览）**

按 `demo/script.md` 第六幕 16、17 两行从头走到尾（含账号切换注③），每一步三查：走通没有 / 页面对不对 / 审计查得到吗（审计页按 `ITR…` 单号能查到七码里走过的那几条、按 Alice 客户号能查到 OWNER 行）。走查中撞到的问题当场修、补提交；走完再跑：

```bash
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:audit
```
Expected：`verify:coa` 两恒等式 + 负余额全绿（三种划转分录 + 认损都落过账）；`verify:audit` 七项恒绿。

- [ ] **Step 4: 交付清单终审（spec 附录 B 逐行）**

对照 `rules/delivery-checklist.md` 每一行在本 plan 里找到落点，尤其两条永不豁免：改了前端 → 八张截图都在 `artifacts/`（`ls -la doc-final/superpowers/plans/artifacts/2026-09-05-W2-*.png` 八个文件、大小 > 0）；动了钱 → `verify:coa` 绿。终审专门问「每条承诺的代码在哪」（spec §14 验收四组 e2e / 三条变异 / 收尾闸——逐条指到文件与命令；memory：逐任务评审抓不到「spec 承诺了但没人建」）。

- [ ] **Step 5: 合并（superpowers:finishing-a-development-branch）**

1. 在 worktree 里把 `main` 并进来解冲突（`git merge main`），重跑 Step 1；
2. 主工作树 `git merge --ff-only recon-wave2`；
3. **主栈重铺**（schema 变了）：`rm -f /tmp/exchange_js_main/dev.db && npm run prisma:generate && bash scripts/stack.sh reset main && bash scripts/stack.sh up main && bash scripts/on-stack.sh main demo:all && bash scripts/on-stack.sh main recon:demo:break`（2026-09-04 波一合并实证：不先删库迁移撞 NOT NULL 中止）；
4. 归档：`git mv doc-final/superpowers/specs/2026-09-03-internal-transfer-order-design.md doc-final/archive/specs/` 与 plan 同款到 `doc-final/archive/plans/`；总纲二期行填「合 main <日期>（<commit>）」；`CHANGELOG` 已在 Task 15；
5. 清 worktree 与分支：`git worktree remove .claude/worktrees/recon-wave2 && git branch -d recon-wave2`；
6. 报一行：`Documentation updated: modules§0-4 / modules§5 / demo / decisions —— 平账二期合 main`。

本任务过哪几条：每轮收尾（全部闸门 + 归档 + 合并 ✅）。

---

## Self-review（写完计划后按 spec 逐节对照）

**Spec 覆盖**

| spec 节 | 落点 |
|---|---|
| §0 F1–F8 / N1–N3 | 不做项不建任务；N1 甲 → Task 8 读面 + Task 12 按钮；N2 → Task 4；N3 → Task 1 / Task 10 |
| §1 两个用途、金额锁定 | Task 5 dto、Task 7 发起（金额来自认损单 / 差额，dto 不收金额）|
| §2 叙事 | Task 9 两条主链的数字（7.5 USDT / 1200−300=900 AED）|
| §3 六态六边、出生守卫、批准复核、法币腿 2 失败 | Task 5 迁移表 + 单测；Task 7 守卫 + 单测 + Task 9 C 组 |
| §4 父键、走法表、每一步表、参考号提交时铸、模拟回单 | Task 2、Task 7 `onLegSubmitted`、Task 6 |
| §5 三个转账码 / 分录 / walletRef / crossing / currency | Task 3 码、Task 7 `postOpsToSet` / `postFinalLeg` + 单测 + Task 9 evidence 断言 |
| §6 审批类型 / verify-rbac 表 / 快照零 UUID / 后果原话 | Task 3、Task 7 `submitForApproval` + 单测 + Task 9 快照断言 |
| §7.1 认损解锁只许 REDUCE | Task 4 + Task 9 C1 |
| §7.2 RESOLVED 后行还活着 | Task 8 `deriveFundingNextStep`（不看案子状态）+ Task 9 A + Task 12 分支① |
| §7.3 余额不足指路 | Task 8 ADVANCE + Task 9 B |
| §7.4 在途不红 | Task 6 + Task 9 A（IN_TRANSIT 断言）|
| §7.5 铺场闸 | Task 11 + 变异 |
| §7.6 成因退役 | Task 4 |
| §8 页面八项 + 八张截图 | Task 12（4）/ Task 13（3）/ Task 14（1）|
| §9 权限四处 / 五端点 / sync 重启 | Task 3 + Task 8 |
| §10 审计七码 | Task 3（名册）+ Task 7（写点）+ Task 9（断言）|
| §11 客户可见面 | Task 14 |
| §12 演示 16 / 17、切账号、判据 | Task 11 |
| §13 搭车两条 | Task 1 / Task 10 |
| §14 验收（e2e 四组、变异三条、收尾闸）| Task 9 / Task 11 Step 3 / Task 16 |
| §15 不做 | 全程未建任务 |
| §16 文档 / decisions / BACKLOG / 三期承接 | Task 15 / Task 16 |

**占位扫描**：全文无 TBD / TODO / 「类似 Task N」；每处「照抄 X」都给了文件与行号。两处执行者需自行核对签名的地方（`StatusPill` / `InfoField` / `adminButtonClass` 变体名、`injectScenarios` 第五参数名）已写明查法。

**类型一致性**：`InternalTransferStatus` 六值 ｜ `nextStep.kind` 五值（Task 4 定义、Task 8 填 COMPENSATION / ADVANCE、Task 12 消费）｜ `transfer` 回挂三字段（Task 8 → Task 12）｜ `pendingFunding` 两字段（Task 8 → Task 12）｜ 转账码名 `INTERNAL_TRANSFER_OPS_TO_SET / FIRM_OUT / CLIENT_IN`（Task 3 → Task 7 → Task 9）｜ 事件码 `INTERNAL_TRANSFER_COMPENSATION_IN / ADVANCE_IN`（Task 7 → Task 9 → Task 14）｜ 审计七码名与 requiredFields（Task 3 spec 与 Task 7 信封：`amount` / `reason` / `approvalNo` / `effectiveDate` / `reasonCode` 都是信封顶层字段）｜ 前端权限码五个（Task 3 → Task 12 / 13）｜ dedupKey `SIM-<资金单号>-<钱包 id>`（Task 6 → Task 9 `waitForSimLines`）。
