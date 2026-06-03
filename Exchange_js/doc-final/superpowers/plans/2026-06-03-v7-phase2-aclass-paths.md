# V7 Phase 2 — A 类路径接入（充值归集 + FUND_OUT/RETURN）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 用 Phase 1 的通用内部转账工作流交付两条 A 类 crypto 路径——充值归集（C_DEP→C_MAIN，cron 驱动）与提现资金调拨（FUND_OUT：C_MAIN→C_OUT；FUND_RETURN：C_OUT→C_MAIN，repair 触发）——并删除 Wave-8 旧归集 orchestrator。

**Architecture:** 复用 `InternalTransferWorkflowService.initiate`（Phase 1）。新增：funds-layer 的归集 workflow + cron sweep、提现侧 FUND_OUT hook、FUND_RETURN repair 面。DepositTransaction 加幂等标记字段。所有路径 A 类零 TB。

**Tech Stack:** NestJS · Prisma · SQLite · Jest · React(admin)

**依据 spec：** `doc-final/superpowers/specs/2026-06-03-v7-internal-transfer-crypto-mvp-design.md`（§5 Phase 2 + Phase 2 实现决策）

**关键命令：** `npx jest <path>` · `npm run build` · `npm run dev:rebuild` · 端口 3500/3501/3502

**已锁定的设计决策（见 spec Phase 2 实现决策）：**
- 可归集余额 = 按 C_DEP 钱包汇总未归集的 SUCCESS 充值 gross `amount`；不用 mockBalance / SafeguardingPolicy。
- 幂等：DepositTransaction +`aggregatedAt`/`aggregatedTransferId`；AGGREGATE transfer `sourceType='DEPOSIT_AGGREGATION'`、`sourceId='{walletId}:{anchorDepositId}'`。
- 阈值：funds-layer 硬编码 `AGGREGATION_THRESHOLD` / `DUST_THRESHOLD`。
- 旧 orchestrator：重做后删除（orchestrator + workflows.module provider + 两个 controller + spec）。
- FUND_OUT：`initiatePayoutPhase()` 创建 payout 后触发（C_MAIN→C_OUT，amount=netAmount），非阻塞跟踪转账。
- FUND_RETURN：无自动触发路径（无 PAYOUT_FAILED 事件 / V5 失败分支未建）→ 以命名 repair/admin 触发面交付。

**前置：** Phase 0+1（已交付）。`InternalTransferWorkflowService` 已 export 自 FundsLayerModule。
**注意：** 本分支有 ~34 个 pre-existing 后端失败套件 + ~11 个 admin-web tsc 错误（与本工作无关），以及用户未提交的 WIP（勿动）。验收 = 不新增失败。所有 `git add` 用显式路径，禁止 `git add -A`。

---

## 文件结构总览

```
prisma/schema.prisma                                   # 改：DepositTransaction +aggregatedAt/aggregatedTransferId
prisma/migrations/<ts>_v7_phase2_deposit_aggregation/  # 新：migration
src/modules/funds-layer/
├── constants/internal-transfer-paths.constant.ts      # 改：加 AGGREGATION_THRESHOLD/DUST_THRESHOLD
├── domain/system-wallet-resolver.service.ts           # 新：解析 platform 系统钱包（C_MAIN/C_OUT）
├── workflow/deposit-aggregation-workflow.service.ts   # 新：充值归集 workflow
├── workflow/fund-transfer-workflow.service.ts         # 新：FUND_OUT 触发 + FUND_RETURN repair
├── sweep/deposit-aggregation-sweep.service.ts         # 新：@Cron
├── controllers/fund-return-repair.controller.ts       # 新：FUND_RETURN admin 触发面
└── funds-layer.module.ts                              # 改：注册上述 + exports FundTransferWorkflowService
src/modules/trading/deposit-transactions/deposit-transactions.service.ts  # 改：findAggregationCandidates + markAggregated
src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts     # 改：FUND_OUT hook
src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts  # 改：import FundsLayerModule
src/orchestrators/internal-collection-workflow.orchestrator.ts             # 删
src/orchestrators/workflows.module.ts                                       # 改：移除 provider
src/modules/asset-treasury/internal-transaction-workflow/                   # 删/改：移除调用旧 orchestrator 的 controller
```

---

# Phase 2A — 充值归集（AGGREGATE）

## Task 2A.1: schema 幂等字段 + 阈值常量 + migration

**Files:**
- Modify: `prisma/schema.prisma`（model DepositTransaction）
- Modify: `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`
- Create: migration

- [ ] **Step 1: DepositTransaction 加两个幂等字段**

在 `model DepositTransaction` 里（找到该 model；它有 `toWalletId`/`status`/`amount`），加：
```prisma
  aggregatedAt          DateTime?
  aggregatedTransferId  String?
```
并加索引（用于扫未归集候选）：
```prisma
  @@index([toWalletId, status, aggregatedAt])
```

- [ ] **Step 2: 阈值常量**

在 `internal-transfer-paths.constant.ts` 末尾加（用 string 表示 Decimal，避免精度问题；实现处用 `new Prisma.Decimal`）：
```typescript
// 充值归集阈值（MVP 硬编码；配置化为 ADVANCED）
export const AGGREGATION_THRESHOLD = '100';   // 归集触发额：地址累计未归集 ≥ 100 才扫
export const DUST_THRESHOLD = '1';            // dust：< 1 记 DUST_SKIPPED，不动
```

- [ ] **Step 3: 生成 migration（用 diff，避免 drift reset）**

参考 Phase 0 的做法（commit c8961a1 用的是 `prisma migrate diff`）：
```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > /tmp/v7p2.sql
```
检查 `/tmp/v7p2.sql` 只含 DepositTransaction 的两列 + 索引（SQLite 可能是表重建模式）。确认无用户 WIP drift（不应出现 swap/compliance/pricing）。把 SQL 放入新目录 `prisma/migrations/<timestamp>_v7_phase2_deposit_aggregation/migration.sql`（timestamp 必须晚于 `20260603111655`）。

- [ ] **Step 4: 验证 clean rebuild**

```bash
npx prisma validate && npm run dev:rebuild
sqlite3 /tmp/exchange_js_branch/dev.db "PRAGMA table_info(deposit_transactions);" | grep -i aggregated
```
Expected: validate 通过；rebuild 干净；`aggregatedAt`/`aggregatedTransferId` 两列出现。`npm run build` 0 错误。

- [ ] **Step 5: Commit**
```bash
git add prisma/schema.prisma prisma/migrations/ src/modules/funds-layer/constants/internal-transfer-paths.constant.ts
git commit -m "feat(v7-phase2): deposit aggregation idempotency fields + thresholds + migration"
```

---

## Task 2A.2: deposit 域服务——候选查询 + 归集标记

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
- Test: 同目录 `.spec.ts`

> 该表归 deposit 域服务所有；归集 workflow（funds-layer）通过它读/写，不直接写 deposit 表（跨模块经 canonical 入口）。

- [ ] **Step 1: 写失败测试**

在 deposit-transactions.service.spec.ts 加两个用例：
- `findAggregationCandidates(assetType?)` 返回按 `toWalletId`+`assetId` 分组、`status=SUCCESS` 且 `aggregatedAt=null` 的 crypto 充值聚合：每组含 `{ toWalletId, assetId, ownerId, depositIds[], totalAmount, anchorDepositId }`（anchor = 组内最小 createdAt 的 deposit id）。
- `markAggregated(depositIds, transferId, tx?)` 把这些 deposit 置 `aggregatedAt=now`、`aggregatedTransferId=transferId`，且只更新仍未归集的（`aggregatedAt: null` 条件，防重复）。

（参考该文件已有方法的 mock prisma 写法。）

- [ ] **Step 2: 运行 → FAIL**
`npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

- [ ] **Step 3: 实现两个方法**

```typescript
// 候选：仅 crypto（FIAT 充值归集 Phase 6），SUCCESS 且未归集；按 toWalletId 分组
async findAggregationCandidates(): Promise<Array<{
  toWalletId: string; assetId: string; ownerId: string; ownerType: string;
  depositIds: string[]; anchorDepositId: string; totalAmount: Prisma.Decimal;
}>> {
  const rows = await this.prisma.depositTransaction.findMany({
    where: { status: 'SUCCESS', aggregatedAt: null, toWalletId: { not: null },
             asset: { type: 'CRYPTO' } },
    select: { id: true, toWalletId: true, assetId: true, ownerId: true, ownerType: true,
              amount: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  // group by toWalletId
  const groups = new Map<string, any>();
  for (const r of rows) {
    const key = r.toWalletId as string;
    if (!groups.has(key)) groups.set(key, {
      toWalletId: key, assetId: r.assetId, ownerId: r.ownerId, ownerType: r.ownerType,
      depositIds: [], anchorDepositId: r.id, totalAmount: new Prisma.Decimal(0),
    });
    const g = groups.get(key);
    g.depositIds.push(r.id);
    g.totalAmount = g.totalAmount.plus(new Prisma.Decimal(r.amount));
  }
  return Array.from(groups.values());
}

async markAggregated(depositIds: string[], transferId: string, tx?: Prisma.TransactionClient) {
  const db = tx ?? this.prisma;
  return db.depositTransaction.updateMany({
    where: { id: { in: depositIds }, aggregatedAt: null },
    data: { aggregatedAt: new Date(), aggregatedTransferId: transferId },
  });
}
```
（按该文件实际的 prisma 访问风格调整 `this.prisma` vs `(this.prisma as any)`。anchorDepositId 取分组里 createdAt 最早那条——因为 orderBy asc，第一条即 anchor。）

- [ ] **Step 4: 运行 → PASS。** **Step 5: Commit**
```bash
git add src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
git commit -m "feat(v7-phase2): deposit aggregation candidate query + mark-aggregated"
```

---

## Task 2A.3: SystemWalletResolver + 充值归集 workflow + 模块接线

**Files:**
- Create: `src/modules/funds-layer/domain/system-wallet-resolver.service.ts`
- Create: `src/modules/funds-layer/workflow/deposit-aggregation-workflow.service.ts` (+ spec)
- Modify: `src/modules/funds-layer/funds-layer.module.ts`

- [ ] **Step 1: SystemWalletResolver（解析 platform 系统钱包）**

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class SystemWalletResolver {
  constructor(private readonly prisma: PrismaService) {}
  /** 取指定资产的 ACTIVE platform 钱包（C_MAIN / C_OUT / F_LIQ / F_OPS） */
  async resolve(assetId: string, walletRole: string) {
    const wallet = await (this.prisma as any).wallet.findFirst({
      where: { walletRole, assetId, ownerType: 'PLATFORM', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet) throw new BadRequestException({
      code: 'SYSTEM_WALLET_NOT_FOUND',
      message: `No ACTIVE ${walletRole} platform wallet for asset ${assetId}`,
    });
    return wallet;
  }
}
```

- [ ] **Step 2: 写失败测试（deposit-aggregation-workflow.service.spec.ts）**

Mock DepositTransactionsService（findAggregationCandidates/markAggregated）、InternalTransferWorkflowService（initiate）、SystemWalletResolver（resolve）、PrismaService（查重 internalTransaction.findFirst）。用例：
- **超阈值归集**：候选组 totalAmount=150（≥100）→ resolve C_MAIN → initiate(AGGREGATE) 被调用且 amount='150'、fromWalletId=候选 toWalletId、sourceType='DEPOSIT_AGGREGATION'、sourceId=`${walletId}:${anchorDepositId}`；随后 markAggregated(depositIds, transfer.id) 被调用。
- **dust 跳过**：totalAmount=0.5（<DUST_THRESHOLD 1）→ initiate NOT called；markAggregated NOT called。
- **介于 dust 与阈值之间**：totalAmount=50（≥dust，<threshold）→ 不归集、不标记、不报错（等更多充值）。
- **幂等**：已存在 (DEPOSIT_AGGREGATION, sourceId) transfer → 不重复 initiate，但仍 markAggregated（恢复漏标）。

- [ ] **Step 3: 运行 → FAIL**

- [ ] **Step 4: 实现 workflow**

```typescript
@Injectable()
export class DepositAggregationWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deposits: DepositTransactionsService,
    private readonly transferWorkflow: InternalTransferWorkflowService,
    private readonly systemWallets: SystemWalletResolver,
  ) {}

  /** 扫所有候选 C_DEP 钱包，超阈值的归集到 C_MAIN。供 cron 调用。 */
  async runSweep(operatorId = 'SYSTEM'): Promise<{ aggregated: number; skipped: number }> {
    const candidates = await this.deposits.findAggregationCandidates();
    let aggregated = 0, skipped = 0;
    for (const c of candidates) {
      try {
        const did = await this.aggregateOne(c, operatorId);
        did ? aggregated++ : skipped++;
      } catch (err) {
        // per-item 隔离：一个失败不阻断其余
        this.logger.error(`aggregate failed for wallet ${c.toWalletId}`, err as any);
      }
    }
    return { aggregated, skipped };
  }

  private async aggregateOne(c, operatorId): Promise<boolean> {
    const threshold = new Prisma.Decimal(AGGREGATION_THRESHOLD);
    const dust = new Prisma.Decimal(DUST_THRESHOLD);
    if (c.totalAmount.lt(dust)) { /* 记 DUST_SKIPPED 审计可选 */ return false; }
    if (c.totalAmount.lt(threshold)) return false; // 等更多充值

    const sourceId = `${c.toWalletId}:${c.anchorDepositId}`;
    let transfer = await (this.prisma as any).internalTransaction.findFirst({
      where: { sourceType: 'DEPOSIT_AGGREGATION', sourceId },
    });
    if (!transfer) {
      const mainWallet = await this.systemWallets.resolve(c.assetId, 'C_MAIN');
      transfer = await this.transferWorkflow.initiate({
        fromRole: 'C_DEP', toRole: 'C_MAIN',
        sourceType: 'DEPOSIT_AGGREGATION', sourceId,
        ownerType: 'PLATFORM', ownerId: 'PLATFORM',
        assetId: c.assetId, amount: c.totalAmount.toString(),
        fromWalletId: c.toWalletId, toWalletId: mainWallet.id,
        triggerSource: 'CRON',
      }, operatorId);
    }
    await this.deposits.markAggregated(c.depositIds, transfer.id);
    return true;
  }
}
```
（加 `private readonly logger = new Logger(...)`。`initiate` 的入参字段名以 Phase 1 `InitiateTransferInput` 为准——先读 `internal-transfer-workflow.service.ts` 确认。）

- [ ] **Step 5: 运行 → PASS**

- [ ] **Step 6: 模块接线**

`funds-layer.module.ts` providers 加 `SystemWalletResolver`、`DepositAggregationWorkflowService`；imports 加 deposit 模块（提供 `DepositTransactionsService`——确认其 module 是否 export 了该 service，没有则在 deposit 模块 exports 补上）。`npm run build` 0 错误。

- [ ] **Step 7: Commit**
```bash
git add src/modules/funds-layer/
git commit -m "feat(v7-phase2): deposit aggregation workflow + system wallet resolver"
```

---

## Task 2A.4: cron sweep

**Files:**
- Create: `src/modules/funds-layer/sweep/deposit-aggregation-sweep.service.ts`
- Modify: `funds-layer.module.ts`（provider）

- [ ] **Step 1: 实现（参考 `withdrawal-address-sweep.service.ts` 的 @Cron 模式）**

```typescript
@Injectable()
export class DepositAggregationSweepService {
  private readonly logger = new Logger(DepositAggregationSweepService.name);
  constructor(private readonly workflow: DepositAggregationWorkflowService) {}

  @Cron('0 */1 * * *') // 每小时
  async handle() {
    const res = await this.workflow.runSweep('CRON');
    this.logger.log(`Deposit aggregation sweep: aggregated=${res.aggregated} skipped=${res.skipped}`);
  }
}
```
> `@Cron` 仅出现在 sweep 文件（规则）。sweep 只找候选并直调 workflow。

- [ ] **Step 2: 接线 + build**：funds-layer.module providers 加该 service。`npm run build` 0 错误。无独立单测（行为在 workflow 测试覆盖）。

- [ ] **Step 3: Commit**
```bash
git add src/modules/funds-layer/sweep/ src/modules/funds-layer/funds-layer.module.ts
git commit -m "feat(v7-phase2): deposit aggregation @Cron sweep"
```

---

## Task 2A.5: 删除 Wave-8 旧归集 orchestrator

**Files:**
- Delete: `src/orchestrators/internal-collection-workflow.orchestrator.ts` (+ `.spec.ts`)
- Modify: `src/orchestrators/workflows.module.ts`（移除 provider）
- Delete/Modify: `src/modules/asset-treasury/internal-transaction-workflow/internal-collection-wallets.controller.ts` 及 `internal-transaction-workflow.controller.ts` 中调用旧 orchestrator 的部分 + 其 module 接线

- [ ] **Step 1: 摸清精确引用**
```bash
grep -rln "InternalCollectionWorkflowOrchestrator\|internal-collection-workflow\|reconcileCollectionWallet\|listCollectionWallets" src | grep -v ".spec.ts"
```
列出全部引用点。

- [ ] **Step 2: 删除 orchestrator + spec**
```bash
git rm src/orchestrators/internal-collection-workflow.orchestrator.ts src/orchestrators/internal-collection-workflow.orchestrator.spec.ts
```

- [ ] **Step 3: 移除 workflows.module.ts 的 provider/import**；移除/精简调用它的 controller（`internal-collection-wallets.controller.ts` 整文件若仅服务旧归集则 `git rm`；`internal-transaction-workflow.controller.ts` 若混用则只删调用旧 orchestrator 的 endpoint）。同步处理其 module 的 controllers 数组 + 相关 DTO（`collection-wallet.dto.ts` / `reconcile-collections.dto.ts` 若仅此处用则删）。若有 rbac 路由对应这些 endpoint，一并移除。

- [ ] **Step 4: 验证无悬挂引用 + build + 旧 spec 清理**
```bash
grep -rn "InternalCollectionWorkflowOrchestrator\|reconcileCollectionWallet\|listCollectionWallets" src | grep -v node_modules   # 应为空
npm run build   # 0 错误
```
若有 controller spec 引用被删 endpoint，相应删除/调整。

- [ ] **Step 5: Commit**
```bash
git add -A -- src/orchestrators/ src/modules/asset-treasury/internal-transaction-workflow/
git commit -m "feat(v7-phase2): delete Wave-8 internal-collection orchestrator (superseded by V7 aggregation)"
```
（注意：用显式路径 add，勿 `git add -A` 全局，以免误纳用户 WIP。）

---

# Phase 2B — FUND_OUT / FUND_RETURN

## Task 2B.1: FUND_OUT hook（提现付款前预归集）

**Files:**
- Create: `src/modules/funds-layer/workflow/fund-transfer-workflow.service.ts` (+ spec)
- Modify: `src/modules/funds-layer/funds-layer.module.ts`（provider + export）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（hook）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`（import FundsLayerModule）

- [ ] **Step 1: 写失败测试（fund-transfer-workflow.service.spec.ts）**

Mock InternalTransferWorkflowService（initiate）、SystemWalletResolver（resolve）。用例：
- `fundOut({ withdrawId, withdrawNo, assetId, netAmount })` → resolve C_MAIN + C_OUT → initiate(FUND_OUT, fromRole 'C_MAIN', toRole 'C_OUT', amount=netAmount, sourceType='WITHDRAW', sourceId=withdrawId, sourceNo=withdrawNo, triggerSource 'WITHDRAW', ownerType 'PLATFORM').
- `fundReturn(...)`（Task 2B.2 用）→ initiate(FUND_RETURN, C_OUT→C_MAIN, ...).

- [ ] **Step 2: 运行 → FAIL**

- [ ] **Step 3: 实现 FundTransferWorkflowService**

```typescript
@Injectable()
export class FundTransferWorkflowService {
  constructor(
    private readonly transferWorkflow: InternalTransferWorkflowService,
    private readonly systemWallets: SystemWalletResolver,
  ) {}

  /** 提现付款前：Main→Outbound 预归集（非阻塞跟踪转账）。crypto only。 */
  async fundOut(input: { withdrawId: string; withdrawNo: string; assetId: string; netAmount: string }, operatorId = 'SYSTEM') {
    const [main, out] = await Promise.all([
      this.systemWallets.resolve(input.assetId, 'C_MAIN'),
      this.systemWallets.resolve(input.assetId, 'C_OUT'),
    ]);
    return this.transferWorkflow.initiate({
      fromRole: 'C_MAIN', toRole: 'C_OUT',
      sourceType: 'WITHDRAW', sourceId: input.withdrawId, sourceNo: input.withdrawNo,
      ownerType: 'PLATFORM', ownerId: 'PLATFORM',
      assetId: input.assetId, amount: input.netAmount,
      fromWalletId: main.id, toWalletId: out.id, triggerSource: 'WITHDRAW',
    }, operatorId);
  }

  /** FUND_RETURN：Outbound→Main 退回（repair 触发，Task 2B.2）。 */
  async fundReturn(input: { withdrawId: string; withdrawNo: string; assetId: string; amount: string }, operatorId = 'SYSTEM') {
    const [main, out] = await Promise.all([
      this.systemWallets.resolve(input.assetId, 'C_MAIN'),
      this.systemWallets.resolve(input.assetId, 'C_OUT'),
    ]);
    return this.transferWorkflow.initiate({
      fromRole: 'C_OUT', toRole: 'C_MAIN',
      sourceType: 'WITHDRAW_RETURN', sourceId: input.withdrawId, sourceNo: input.withdrawNo,
      ownerType: 'PLATFORM', ownerId: 'PLATFORM',
      assetId: input.assetId, amount: input.amount,
      fromWalletId: out.id, toWalletId: main.id, triggerSource: 'WITHDRAW',
    }, operatorId);
  }
}
```
模块：funds-layer.module providers 加 `FundTransferWorkflowService`，exports 加它（供 withdraw 模块用）。

- [ ] **Step 4: 运行 → PASS**

- [ ] **Step 5: 在 withdraw workflow 加 FUND_OUT hook**

`withdraw-workflow.service.ts` 的 `initiatePayoutPhase()`，在 `linkPayout(...)` 之后加（非阻塞——失败只记日志，不阻断付款，因为是 mock 跟踪转账）：
```typescript
// V7 Phase 2: 付款前 Main→Outbound 预归集（FUND_OUT，跟踪转账）
if (w.asset?.type === 'CRYPTO') {
  try {
    await this.fundTransferWorkflow.fundOut(
      { withdrawId: w.id, withdrawNo: w.withdrawNo, assetId: w.assetId, netAmount: String(w.netAmount) },
      'WITHDRAW_WORKFLOW',
    );
  } catch (err) {
    this.logger.error(`FUND_OUT failed for withdrawal ${w.id} (non-blocking)`, err as any);
  }
}
```
构造函数注入 `private readonly fundTransferWorkflow: FundTransferWorkflowService`。`withdraw-transactions.module.ts` 的 imports 加 `FundsLayerModule`。
> 仅 crypto；FIAT 提现的资金调拨随法币轮次。FUND_OUT 是 A 类零 TB，不影响 V5 既有 TB 记账。

- [ ] **Step 6: build + withdraw 既有测试不回归**
```bash
npm run build
npx jest src/modules/funds-layer/workflow/fund-transfer-workflow.service.spec.ts src/modules/trading/withdraw-transactions/
```
Expected: 新测试 PASS；withdraw 既有测试不新增失败（若 withdraw workflow 测试因新依赖报缺 provider，在该 spec 的 TestingModule 里补一个 FundTransferWorkflowService mock）。

- [ ] **Step 7: Commit**
```bash
git add src/modules/funds-layer/ src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts
git commit -m "feat(v7-phase2): FUND_OUT pre-funding hook on withdraw payout init"
```

---

## Task 2B.2: FUND_RETURN repair 触发面

**Files:**
- Create: `src/modules/funds-layer/controllers/fund-return-repair.controller.ts`
- Create: `src/modules/funds-layer/dto/fund-return.dto.ts`
- Modify: `funds-layer.module.ts`（controller）
- Modify: `rbac.catalog.ts`（路由）

> 现状无 PAYOUT_FAILED 事件、V5 失败分支未建 → FUND_RETURN 无自动触发。以命名 repair/admin 面交付：对已 FUND_OUT 但不再推进的提现，管理员显式触发 Outbound→Main 退回，全程审计。自动触发待 V5 失败分支建成后接入（Phase 后续）。

- [ ] **Step 1: DTO**
```typescript
import { IsString, IsNotEmpty } from 'class-validator';
export class FundReturnDto {
  @IsString() @IsNotEmpty() withdrawId!: string;
  @IsString() @IsNotEmpty() withdrawNo!: string;
  @IsString() @IsNotEmpty() assetId!: string;
  @IsString() @IsNotEmpty() amount!: string;
  @IsString() @IsNotEmpty() reason!: string; // repair 必须记原因
}
```

- [ ] **Step 2: controller（mirror Phase 1 controller 的 guard 模式：`@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)` + `@RequirePermissions(buildPermissionCode(...))`）**
```typescript
@Controller('admin/funds-layer/fund-return')
export class FundReturnRepairController {
  constructor(private readonly fundTransfer: FundTransferWorkflowService) {}
  @Post()
  trigger(@Body() dto: FundReturnDto) {
    return this.fundTransfer.fundReturn(
      { withdrawId: dto.withdrawId, withdrawNo: dto.withdrawNo, assetId: dto.assetId, amount: dto.amount },
      'ADMIN',
    );
  }
}
```
> repair 面比正常路径更窄：单一命名动作 + 必填 reason；初始化转账后由 simulate 推进执行 leg（复用 Phase 1）。审计在通用工作流里已写（INTERNAL_TRANSFER_REQUESTED + 终态）。

- [ ] **Step 3: 接线 + rbac**：funds-layer.module controllers 加该 controller；`rbac.catalog.ts` 加 `route('POST', '/admin/funds-layer/fund-return', 'Trigger FUND_RETURN repair', ['INTERNAL_TRANSFER_WRITE'])`（复用 Phase 0 权限组）。`npm run build` 0 错误；`npx jest src/modules/funds-layer/` 全过。

- [ ] **Step 4: Commit**
```bash
git add src/modules/funds-layer/ src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(v7-phase2): FUND_RETURN repair surface (admin-triggered, audited)"
```

---

## Phase 2 验收清单

- [ ] `npm run dev:rebuild && npm run build` 通过；migration 干净重放；deposit 两列就位
- [ ] funds-layer 全部测试 + deposit 域测试通过；无新增失败
- [ ] 构造一组 ≥ 阈值的 SUCCESS crypto 充值在同一 C_DEP 地址 → cron（或手动调 `runSweep`）产生一笔 AGGREGATE transfer（C_DEP→C_MAIN）→ deposit 标记 aggregated → 重跑不重复
- [ ] dust 充值被跳过、不产生 transfer
- [ ] 触发一笔 crypto 提现走到 payout init → 产生一笔 FUND_OUT transfer（C_MAIN→C_OUT），sourceId=withdrawId、可在 Phase 1 列表按 pathLabel=FUND_OUT 查到
- [ ] admin 调 FUND_RETURN repair 端点 → 产生 FUND_RETURN transfer（C_OUT→C_MAIN）
- [ ] 旧 internal-collection orchestrator 及其 controller 已删除、无悬挂引用、无回归

---

## 明确排除（本轮不做）
- 充值/提现的 FIAT 侧（法币轮次）。
- FUND_RETURN 自动触发（依赖未建的 V5 失败分支 / PAYOUT_FAILED 事件）。
- 阈值配置化工作流（ADVANCED）。
- 单笔超阈值实时归集入口（spec 提及；MVP 先只做 cron 周期归集，实时入口可后续加——若实现简单可一并做，否则记为待办）。
- 归集专属 Admin 监控页（复用 Phase 1 列表 pathLabel 筛选）。
