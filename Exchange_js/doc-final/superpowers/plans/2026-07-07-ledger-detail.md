# 账本细化（三菜单 / 权限包 / 流水列表页 + 当时余额）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把账本域收敛为「账户 / 凭证 / 流水列表」三菜单三表严格对应，新建「流水列表」页（含存储式「当时余额」），把共享的 `ACCOUNTING_CONFIG_*` 权限拆成每菜单一读 + 一写，移除「对账单」，补 `/wallets` 权限门与手动建账审计。

**Architecture:** 后端 NestJS + Prisma(SQLite) + TigerBeetle。`account_flows` 加 `balanceAfter` 列；余额在记账漏斗 `TbEvidenceService.writeEvidence` 处从底层 TB 客户端 `TigerBeetleService.lookupAccounts` 取「过账后余额」（类别感知），经投影器写入两行流水各自账户的余额。RBAC 拆分只动后端 `rbac.catalog.ts`（前端权限码是路由签名，仅新增流水路由码）。

**Tech Stack:** NestJS、Prisma、TigerBeetle(node client)、React + Tailwind(admin-web)、Jest。

**设计依据（spec）：** `doc-final/superpowers/specs/2026-07-07-ledger-detail-design.md`

**决策记录：** 「当时余额」采用**存储列 balanceAfter**（用户拍板甲；好处：冻结历史快照 / 读时零计算 / 将来可扩展到混合列表）。

---

## 前置约定

- 所有后端命令在 `Exchange_js/` 下执行。
- 每个 Task 结束都 commit（frequent commits）。
- 金额/余额单位：`account_flows` 全程存「分」（整数最小单位），前端展示才按 `asset.decimals` 转「元」。`balanceAfter` 同为「分」。

---

## Task 1: DB — `account_flows` 加 `balanceAfter` 列

**Files:**
- Modify: `prisma/schema.prisma`（`model AccountFlow`）
- Migration: `prisma/migrations/<ts>_add_account_flow_balance_after/`

- [ ] **Step 1: 改 schema**

在 `model AccountFlow` 里 `effectiveDate` 之后、`createdAt` 之前加一行：

```prisma
  effectiveDate        String   @default("") // 业务归属日 YYYY-MM-DD（UTC）；default 仅为 SQLite ALTER 所需，写入方必须显式设置
  balanceAfter         Decimal? // 该账户在这笔过账后的类别感知余额（分）；历史行未回填为 null；仅单账户视图展示
  createdAt            DateTime
```

- [ ] **Step 2: 生成迁移 + client**

Run:
```bash
npx prisma migrate dev --name add_account_flow_balance_after
npx prisma generate
```
Expected: 迁移生成成功；`AccountFlow` 类型出现可空 `balanceAfter`。

- [ ] **Step 3: 编译确认**

Run: `npx tsc --noEmit`
Expected: 0 error（新列可空，不破坏现有写入）。

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(ledger): add balanceAfter column to account_flows"
```

---

## Task 2: 投影器 — 把 balanceAfter 透传到两行流水

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts`（若无则新建）

- [ ] **Step 1: 写失败测试**

新增（或追加）测试：debit 行拿 `debitBalanceAfter`、credit 行拿 `creditBalanceAfter`。

```ts
import { AccountFlowProjectorService } from './account-flow-projector.service';

describe('AccountFlowProjectorService balanceAfter', () => {
  const svc = new AccountFlowProjectorService();
  it('maps debit/credit balanceAfter onto the correct rows', () => {
    const rows = svc.projectEvidence({
      tbTransferId: 't1', sourceType: 'DEPOSIT', sourceNo: 'D1', eventCode: 'E',
      debitTbAccountId: 'a_debit', creditTbAccountId: 'a_credit',
      amount: '100', assetCode: 'AED', transferType: 'POSTED',
      createdAt: new Date('2026-07-07T00:00:00Z'), effectiveDate: '2026-07-07',
      debitBalanceAfter: '900', creditBalanceAfter: '1100',
    } as any);
    const debit = rows.find((r) => r.direction === 'OUT');
    const credit = rows.find((r) => r.direction === 'IN');
    expect(debit?.balanceAfter).toBe('900');
    expect(credit?.balanceAfter).toBe('1100');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest account-flow-projector.service.spec -t balanceAfter`
Expected: FAIL（`balanceAfter` 未定义 / 类型错误）。

- [ ] **Step 3: 改投影器**

在 `EvidenceLike` 接口尾部加两字段：
```ts
  isExternalCrossing?: boolean | null;
  debitBalanceAfter?: string | null;
  creditBalanceAfter?: string | null;
}
```
在 `AccountFlowRow` 接口尾部加：
```ts
  effectiveDate: string;
  balanceAfter: string | null;
}
```
`projectEvidence` 里，debit / credit 两处 push 各加 `balanceAfter`：
```ts
    if (evidence.debitTbAccountId) {
      rows.push({
        ...shared,
        tbAccountId: evidence.debitTbAccountId,
        walletRef: evidence.debitWalletRef ?? null,
        direction: 'OUT',
        balanceAfter: evidence.debitBalanceAfter ?? null,
      });
    }
    if (evidence.creditTbAccountId) {
      rows.push({
        ...shared,
        tbAccountId: evidence.creditTbAccountId,
        walletRef: evidence.creditWalletRef ?? null,
        direction: 'IN',
        balanceAfter: evidence.creditBalanceAfter ?? null,
      });
    }
```
`persist` 的 upsert `update` 分支里**有条件**更新 balanceAfter（避免 POST 重投影时被 null 覆盖）：
```ts
        update: {
          walletRef: row.walletRef,
          direction: row.direction,
          amount: row.amount,
          isExternalCrossing: row.isExternalCrossing,
          externalRef: row.externalRef,
          eventCode: row.eventCode,
          sourceType: row.sourceType,
          sourceNo: row.sourceNo,
          transferType: row.transferType,
          assetCode: row.assetCode,
          effectiveDate: row.effectiveDate,
          ...(row.balanceAfter != null ? { balanceAfter: row.balanceAfter } : {}),
          // createdAt intentionally NOT updated.
        },
```
（`create` 分支用 `create: row` 即可，row 已含 balanceAfter。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest account-flow-projector.service.spec -t balanceAfter`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts
git commit -m "feat(ledger): thread balanceAfter through account-flow projector"
```

---

## Task 3: 记账漏斗 — 捕获「过账后」类别感知余额

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`

**背景锚点：** `AccountingService.lookupBalance` = `tbService.lookupAccounts([id])[0].{debits_posted,credits_posted}`（`accounting.service.ts:342`）。`AccountingService` 依赖 `TbEvidenceService`，故**不能**反向注入 `AccountingService`；改注入底层 `TigerBeetleService`（零循环）。类别由 COA code 前缀判定：`'A.'`=资产(借正)，其余(`'L.'`/`'E.'`)=负债/权益(贷正)，与 `tb-admin.controller.ts:91` netBalance 口径一致。

- [ ] **Step 1: 注入 TB 客户端 + 导入 hexToBigint**

顶部加导入：
```ts
import { TigerBeetleService } from './tigerbeetle.service';
import { hexToBigint } from './utils/tb-id.util';
```
构造器加依赖（放在 flowProjector 之前，保持 flowProjector 可选在最后）：
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly tbService: TigerBeetleService,
    private readonly flowProjector?: AccountFlowProjectorService,
  ) {}
```

- [ ] **Step 2: 加类别感知余额 helper**

在类内加私有方法：
```ts
  /** 过账后类别感知余额（分，字符串）。资产借正、负债/权益贷正。TB 不可用则返回 null。 */
  private async postedBalanceAfter(
    tbAccountId: string | null | undefined,
    coaCode: string,
  ): Promise<string | null> {
    if (!tbAccountId) return null;
    try {
      const [a] = await this.tbService.lookupAccounts([hexToBigint(tbAccountId)]);
      if (!a) return null;
      const isAsset = coaCode.startsWith('A.');
      const net = isAsset
        ? a.debits_posted - a.credits_posted
        : a.credits_posted - a.debits_posted;
      return net.toString();
    } catch {
      return null;
    }
  }
```

- [ ] **Step 3: writeEvidence 里捕获并透传**

在 `await (client as any).tbTransferEvidence.create({ data: evidenceData });` 之后、`if (this.flowProjector)` 之前插入：
```ts
      (evidenceData as any).debitBalanceAfter = await this.postedBalanceAfter(
        params.debitTbAccountId ?? null, params.debitCode,
      );
      (evidenceData as any).creditBalanceAfter = await this.postedBalanceAfter(
        params.creditTbAccountId ?? null, params.creditCode,
      );
```
（`evidenceData` 随后原样传给 `flowProjector.persist`，Task 2 的投影器会把这两个值落到对应行。这两个字段**不进** `tbTransferEvidence` 表——create 已在上一行完成，此处只是给投影器用的临时字段。）

- [ ] **Step 4: 两阶段 POST 重投影也重算余额**

`enrichForPost`（`tb-evidence.service.ts:148`）与 `updateTransferType`（:112）在 POST/改类型后会用 DB 里的 `updated` 重投影——此时 posted 余额已变，需重算。在这两处 `await this.flowProjector.persist(client as any, updated);` 之前，各加：
```ts
        (updated as any).debitBalanceAfter = await this.postedBalanceAfter(
          updated.debitTbAccountId, updated.debitCode,
        );
        (updated as any).creditBalanceAfter = await this.postedBalanceAfter(
          updated.creditTbAccountId, updated.creditCode,
        );
```
（`updated` 来自 `tbTransferEvidence` 行，含 `debitCode`/`creditCode`/`debit|creditTbAccountId`。）

- [ ] **Step 5: 编译 + 冒烟**

Run: `npx tsc --noEmit`
Expected: 0 error。
Run（起 main 栈跑一次充值 e2e 或 demo，确认写流水不炸）: `bash scripts/on-stack.sh main demo:deposit` 或 `bash scripts/on-stack.sh main recon:demo`
Expected: 通过；抽查 `account_flows` 新行 `balanceAfter` 有值（POSTED 行）。

- [ ] **Step 6: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-evidence.service.ts
git commit -m "feat(ledger): capture class-aware posted balanceAfter at evidence write"
```

---

## Task 4: 历史行回填脚本

**Files:**
- Create: `scripts/backfill-account-flow-balance.ts`
- Modify: `package.json`（加 script 项）

- [ ] **Step 1: 写回填脚本**

按账户分组、按过账序（`createdAt` 升序）累加，写回 `balanceAfter`。类别由 registry code 判定（`isAssetCode`）。

```ts
// scripts/backfill-account-flow-balance.ts
import { PrismaClient } from '@prisma/client';
import { isAssetCode } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';

const prisma = new PrismaClient();

async function main() {
  const accountIds: { tbAccountId: string }[] =
    await prisma.$queryRawUnsafe(`SELECT DISTINCT tbAccountId FROM account_flows`);
  let touched = 0;
  for (const { tbAccountId } of accountIds) {
    const reg = await (prisma as any).tbAccountRegistry.findUnique({ where: { tbAccountId } });
    const asset = reg ? isAssetCode(reg.code) : true;
    const rows = await (prisma as any).accountFlow.findMany({
      where: { tbAccountId, transferType: 'POSTED' },
      orderBy: { createdAt: 'asc' },
    });
    let bal = 0n;
    for (const r of rows) {
      const amt = BigInt(r.amount.toString().split('.')[0]); // 分，整数
      // 该账户上：IN=贷方，OUT=借方。资产借正、负债贷正。
      const up = asset ? r.direction === 'OUT' : r.direction === 'IN';
      bal += up ? amt : -amt;
      await (prisma as any).accountFlow.update({ where: { id: r.id }, data: { balanceAfter: bal.toString() } });
      touched++;
    }
  }
  console.log(`backfilled balanceAfter on ${touched} POSTED rows`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```
> 注：非 POSTED 行（PENDING/VOID_PENDING）保持 null——展示时按 §约束显「—」。

- [ ] **Step 2: 加 package.json script**

在 `scripts` 段加：
```json
    "backfill:account-flow-balance": "ts-node scripts/backfill-account-flow-balance.ts",
```

- [ ] **Step 3: 对目标栈跑回填**

Run（主工作树）: `bash scripts/on-stack.sh main backfill:account-flow-balance`
Expected: 打印 `backfilled balanceAfter on N POSTED rows`；抽查任一账户按序余额单调对得上。

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-account-flow-balance.ts package.json
git commit -m "chore(ledger): backfill script for account_flows.balanceAfter"
```

---

## Task 5: 后端 — 流水列表接口

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（加 `findAllFlows`）
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`（加 `GET /admin/tb/account-flows`）
- Test: `src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts`（若无则新建）

- [ ] **Step 1: 写失败测试（服务层 findAllFlows 过滤 + 返回 {items,total}）**

```ts
// 断言：按 tbAccountId 过滤、返回 { items, total }，balanceAfter 原样带出
it('findAllFlows filters by tbAccountId and returns items+total', async () => {
  const res = await service.findAllFlows({ tbAccountId: 'a1', take: 10, skip: 0 });
  expect(res).toHaveProperty('items');
  expect(res).toHaveProperty('total');
});
```
（用现有 spec 的 mock prisma 风格；若无 spec，参照 `tb-account-registry.service.ts` 的 findAll 结构。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tb-evidence.service.spec -t findAllFlows`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 实现 findAllFlows（镜像 registry.findAll 的 {items,total} 模式）**

在 `TbEvidenceService` 加：
```ts
  async findAllFlows(filters: {
    tbAccountId?: string;
    walletRef?: string;
    direction?: string;       // 'IN' | 'OUT'
    assetCurrency?: string;
    sourceType?: string;
    transferType?: string;
    effectiveFrom?: string;   // YYYY-MM-DD
    effectiveTo?: string;     // YYYY-MM-DD
    q?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.tbAccountId) where.tbAccountId = filters.tbAccountId;
    if (filters.walletRef) where.walletRef = filters.walletRef;
    if (filters.direction) where.direction = filters.direction;
    if (filters.assetCurrency) where.assetCode = filters.assetCurrency;
    if (filters.sourceType) where.sourceType = filters.sourceType;
    if (filters.transferType) where.transferType = filters.transferType;
    if (filters.effectiveFrom || filters.effectiveTo) {
      where.effectiveDate = {};
      if (filters.effectiveFrom) where.effectiveDate.gte = filters.effectiveFrom;
      if (filters.effectiveTo) where.effectiveDate.lte = filters.effectiveTo;
    }
    const q = filters.q?.trim();
    if (q) {
      where.OR = [
        { tbTransferId: { contains: q } },
        { tbAccountId: { contains: q } },
        { walletRef: { contains: q } },
        { sourceNo: { contains: q } },
        { externalRef: { contains: q } },
      ];
    }
    const [items, total] = await Promise.all([
      (this.prisma as any).accountFlow.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0, take: filters.take ?? 50,
      }),
      (this.prisma as any).accountFlow.count({ where }),
    ]);
    // 单账户筛选才带余额语义标记，供前端决定是否渲染 Balance 列
    return { items, total, singleAccount: !!filters.tbAccountId };
  }
```

- [ ] **Step 4: 加控制器端点**

在 `tb-admin.controller.ts` 的 `getAccountStatement` 之前（或 `findOneTransfer` 之后）加：
```ts
  @Get('account-flows')
  @ApiOperation({ summary: 'List account_flows (raw per-account ledger rows)' })
  findAccountFlows(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('tbAccountId') tbAccountId?: string,
    @Query('walletRef') walletRef?: string,
    @Query('direction') direction?: string,
    @Query('assetCurrency') assetCurrency?: string,
    @Query('sourceType') sourceType?: string,
    @Query('transferType') transferType?: string,
    @Query('effectiveFrom') effectiveFrom?: string,
    @Query('effectiveTo') effectiveTo?: string,
    @Query('q') q?: string,
  ) {
    return this.tbEvidenceService.findAllFlows({
      tbAccountId: tbAccountId || undefined,
      walletRef: walletRef || undefined,
      direction: direction || undefined,
      assetCurrency: assetCurrency || undefined,
      sourceType: sourceType || undefined,
      transferType: transferType || undefined,
      effectiveFrom: effectiveFrom || undefined,
      effectiveTo: effectiveTo || undefined,
      q: q || undefined,
      skip: skip ? Number(skip) : 0,
      take: take ? Number(take) : 50,
    });
  }
```

- [ ] **Step 5: 跑测试 + 编译**

Run: `npx jest tb-evidence.service.spec -t findAllFlows` → PASS
Run: `npx tsc --noEmit` → 0 error

- [ ] **Step 6: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-evidence.service.ts src/modules/accounting/tigerbeetle/tb-admin.controller.ts src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts
git commit -m "feat(ledger): GET /admin/tb/account-flows list endpoint"
```

---

## Task 6: RBAC — 拆权限（纯后端）+ 前端新增流水路由码

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `admin-web/src/rbac/permissions.ts`

**说明：** 前端权限码是路由签名，不引用后端组名；拆分只动后端。前端仅需给新流水路由加一个码。

- [ ] **Step 1: 改 PermissionGroup union（rbac.catalog.ts:55-56）**

把
```ts
  | 'ACCOUNTING_CONFIG_READ'
  | 'ACCOUNTING_CONFIG_WRITE'
```
换成
```ts
  | 'LEDGER_ACCOUNT_READ'
  | 'LEDGER_EVIDENCE_READ'
  | 'LEDGER_FLOW_READ'
  | 'LEDGER_ACCOUNT_WRITE'
```

- [ ] **Step 2: 重绑路由（rbac.catalog.ts:319-324，并新增两条）**

替换整段 `// TB Ledger` 为：
```ts
  // TB Ledger
  route('GET', '/admin/tb/accounts', 'List TB account registry', ['LEDGER_ACCOUNT_READ']),
  route('GET', '/admin/tb/accounts/:tbAccountId', 'Get TB account detail', ['LEDGER_ACCOUNT_READ']),
  route('POST', '/admin/tb/accounts', 'Create manual TB account', ['LEDGER_ACCOUNT_WRITE']),
  route('GET', '/admin/tb/transfers', 'List TB transfer evidence', ['LEDGER_EVIDENCE_READ']),
  route('GET', '/admin/tb/transfers/:tbTransferId', 'Get TB transfer evidence detail', ['LEDGER_EVIDENCE_READ']),
  route('GET', '/admin/tb/account-flows', 'List account flows', ['LEDGER_FLOW_READ']),
  route('GET', '/admin/tb/wallets', 'List distinct wallets from account flows', ['LEDGER_FLOW_READ']),
```
（注意：不再有 `/admin/tb/account-statement` 路由——Task 8 一并移除端点。）

- [ ] **Step 3: 改 action bucket（rbac.catalog.ts:730-748）**

把 `accounting` 域的 buckets 换成四项：
```ts
  {
    id: 'accounting',
    label: 'Accounting',
    icon: '📒',
    buckets: [
      { key: 'ledger.view_accounts', label: 'View ledger accounts', description: 'Browse TB account registry', groups: ['LEDGER_ACCOUNT_READ'] },
      { key: 'ledger.view_evidence', label: 'View transfer evidence', description: 'Browse TB transfer evidence', groups: ['LEDGER_EVIDENCE_READ'] },
      { key: 'ledger.view_flows', label: 'View account flows', description: 'Browse per-account flow rows', groups: ['LEDGER_FLOW_READ'] },
      { key: 'ledger.manage_accounts', label: 'Create TB accounts', description: 'Manually create TB accounts', groups: ['LEDGER_ACCOUNT_WRITE'] },
    ],
  },
```

- [ ] **Step 4: 改三处角色绑定**

- SENIOR_MANAGEMENT_OFFICER（:840）：把 `'ACCOUNTING_CONFIG_READ',` 换成
  ```ts
      'LEDGER_ACCOUNT_READ',
      'LEDGER_EVIDENCE_READ',
      'LEDGER_FLOW_READ',
  ```
- TECH_OFFICER（:864-865）：把 `'ACCOUNTING_CONFIG_READ',` `'ACCOUNTING_CONFIG_WRITE',` 换成
  ```ts
      'LEDGER_ACCOUNT_READ',
      'LEDGER_EVIDENCE_READ',
      'LEDGER_FLOW_READ',
      'LEDGER_ACCOUNT_WRITE',
  ```
- OPS_OFFICER（:882）：把 `'ACCOUNTING_CONFIG_READ',` 换成三读同上。
- （COMPLIANCE_OFFICER 暂不加——spec §6 待定项，默认不给凭证读；如后续要给，追加 `'LEDGER_EVIDENCE_READ'`。）

- [ ] **Step 5: 全仓确认无 ACCOUNTING_CONFIG 残留**

Run: `grep -rn "ACCOUNTING_CONFIG" src/`
Expected: 无输出（全部替换干净）。

- [ ] **Step 6: 前端加流水路由码（admin-web/src/rbac/permissions.ts:133-135）**

在 `TB_TRANSFER_DETAIL_READ` 之后加：
```ts
  TB_ACCOUNTS_READ: 'api.get.admin_tb_accounts',
  TB_TRANSFERS_READ: 'api.get.admin_tb_transfers',
  TB_TRANSFER_DETAIL_READ: 'api.get.admin_tb_transfers_tbtransferid',
  TB_FLOWS_READ: 'api.get.admin_tb_account_flows',
```

- [ ] **Step 7: 同步 + 重启 + 编译**

Run:
```bash
npm run db:base:sync
npx tsc --noEmit
```
Expected: sync 成功；0 error。**重启后端**（SUPER_ADMIN 走内存 RBAC 定义，只 seed 不重启不生效）：`bash scripts/stack.sh down main && bash scripts/stack.sh up main`。

- [ ] **Step 8: Commit**

```bash
git add src/modules/identity/access-control/rbac.catalog.ts admin-web/src/rbac/permissions.ts
git commit -m "feat(ledger): split ACCOUNTING_CONFIG into per-menu LEDGER_* permissions; gate /wallets"
```

---

## Task 7: 前端 — 流水列表页 + 菜单

**Files:**
- Create: `admin-web/src/pages/AccountFlowList.tsx`
- Modify: `admin-web/src/components/DashboardLayout.tsx`（Ledger 组）
- Modify: 路由注册处（`App.tsx` 或 routes 配置——与现有 ledger 页同处注册）

- [ ] **Step 1: 建页面（复制 `TransferEvidenceList.tsx` 起步）**

`cp admin-web/src/pages/TransferEvidenceList.tsx admin-web/src/pages/AccountFlowList.tsx`，然后按以下改：
1. 数据源换 `GET /admin/tb/account-flows`（沿用其 fetch/分页/currencyOptions 逻辑）。
2. 筛选 FilterState 换成：`q / tbAccountId / walletRef / direction / assetCode / sourceType / transferType / effectiveFrom / effectiveTo`。
3. 表头列换成（顺序）：账户 `tbAccountId`(点击→`/admin/ledger/accounts/${id}`) · 钱包 `walletRef` · 方向 `direction`(徽章，IN 绿 `text-green-400`/OUT 红 `text-red-400`) · 金额 `amount`(右对齐 tabular，分→元) · **当时余额 `balanceAfter`** · 币种 · 业务 `sourceType`(徽章) · 业务单号 `sourceNo` · 事件 `eventCode` · 类型 `transferType`(徽章) · 生效日 `effectiveDate` · 创建 `createdAt`。
4. 行点击 → `navigate('/admin/ledger/transfer-evidence/' + row.tbTransferId)`。

**Balance 列的单账户约束**（关键，加这段逻辑）：
```tsx
// 是否单账户视图：仅当按 tbAccountId 精确筛选时，balanceAfter 才有意义
const singleAccount = !!filters.tbAccountId.trim();
// ...表体渲染 Balance 单元格：
<td className="px-3 py-2 font-mono text-[11px] text-adm-t1 text-right tabular-nums">
  {singleAccount && row.balanceAfter != null
    ? formatMinorToMajor(row.balanceAfter, decimalsOf(row.assetCode))
    : '—'}
</td>
```
`formatMinorToMajor`(分串→元串，bigint-safe 插点) 与对账页 `formatAmount` 同款——若无共享工具，从 `ReconciliationRunsDetailPage.tsx` 复用其 `formatAmount(raw, decimals)`。`decimalsOf` 从已拉取的 assets 列表（现页已拉 currencyOptions，改为拉 `{currency,decimals}`）取小数位。表头未按单账户筛选时，Balance 表头加 tooltip「选定账户后显示余额」。

- [ ] **Step 2: 注册路由**

在现有 ledger 路由注册处（与 `/admin/ledger/accounts` 同文件）加：
```tsx
<Route path="/admin/ledger/flows" element={<AccountFlowList />} />
```
并在顶部 import。

- [ ] **Step 3: 改菜单（DashboardLayout.tsx:295-319）**

把 Ledger 组 children 改为：删除 `account-statement` 项，加 `flows` 项：
```tsx
      children: [
        { path: '/admin/ledger/accounts', label: 'Ledger Accounts', icon: <Database size={13} />, requiredPermissions: [PERMISSIONS.TB_ACCOUNTS_READ] },
        { path: '/admin/ledger/transfer-evidence', label: 'Transfer Evidence', icon: <Database size={13} />, requiredPermissions: [PERMISSIONS.TB_TRANSFERS_READ] },
        { path: '/admin/ledger/flows', label: 'Account Flows', icon: <Database size={13} />, requiredPermissions: [PERMISSIONS.TB_FLOWS_READ] },
      ],
```

- [ ] **Step 4: 账户详情加「查看流水」入口（可选闭环）**

在 `LedgerAccountDetail.tsx` 加一个按钮/链接 → `/admin/ledger/flows?tbAccountId=<该账户id>`，`AccountFlowList` 初始化时读 URL query 预填 `filters.tbAccountId`。

- [ ] **Step 5: 前端构建 + 渲染验证**

Run: `cd admin-web && npm run build`
Expected: 构建通过。
起 main 栈，用种子 admin 登录，走预览渲染验证：菜单出现「Account Flows」；无筛选时 Balance 显「—」；按某账户筛选后 Balance 显运行余额、行点击跳凭证详情。（UI 一致性以渲染截图为准。）

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/pages/AccountFlowList.tsx admin-web/src/components/DashboardLayout.tsx admin-web/src/App.tsx admin-web/src/pages/LedgerAccountDetail.tsx
git commit -m "feat(ledger): Account Flows list page with balanceAfter column + menu"
```

---

## Task 8: 移除「对账单」端点与页面

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`（删 `getAccountStatement`）
- Delete: `admin-web/src/pages/AccountStatementPage.tsx`
- Modify: 路由注册处（删 `/admin/ledger/account-statement` route）
- （`tb-evidence.service.ts` 的 `getAccountStatement`/`getWalletStatement` 若仅被此端点消费可一并删；**先 grep 确认无其它引用再删**。）

- [ ] **Step 1: 确认消费方**

Run: `grep -rn "account-statement\|getAccountStatement\|getWalletStatement\|AccountStatementPage" src/ admin-web/src/`
Expected: 只在本端点/本页/菜单出现（菜单项 Task 7 已删）。若被对账域引用 → 保留 service 方法，只删 admin 端点与页面。

- [ ] **Step 2: 删端点**

从 `tb-admin.controller.ts` 删整个 `@Get('account-statement') getAccountStatement(...) {...}` 方法（:146-227）。若 `PrismaService`/`TB_LEDGERS`/`TB_ACCOUNT_CODES` 仅此方法用，顺带清理未用导入（`npx tsc --noEmit` 会报未用）。

- [ ] **Step 3: 删页面 + 路由**

`git rm admin-web/src/pages/AccountStatementPage.tsx`；删其路由注册与 import。

- [ ] **Step 4: 编译 + 构建**

Run: `npx tsc --noEmit && (cd admin-web && npm run build)`
Expected: 0 error、构建通过（无悬空引用）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ledger): remove Account Statement menu/page/endpoint (absorbed by Account Flows)"
```

---

## Task 9: 手动建账补审计

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-manual-account.service.ts`（`manualCreate` 内补审计）
- Modify: 其 module（确保 `AuditLogsService` 已可注入）

**说明：** 账本三菜单只读、不记审计；唯手动建账是改状态写操作，按平台铁律留痕（DI 注入 `AuditLogsService`，禁 `new`）。

- [ ] **Step 1: 注入 AuditLogsService**

在 `TbManualAccountService` 构造器注入 `AuditLogsService`（参照任一现有 workflow 的注入方式与 module imports）。

- [ ] **Step 2: manualCreate 成功后写审计**

在 `manualCreate(...)` 成功返回前加：
```ts
    await this.auditLogs.recordByActor({
      actorType: actor.actorRole ? 'ADMIN' : 'SYSTEM',
      actorId: actor.actorId,
      actorNo: actor.actorNo,
      workflowType: 'LEDGER_ACCOUNT_ADMIN',
      action: 'TB_ACCOUNT_CREATED',
      traceId: /* 复用现有 traceId 生成，见 audit-logging.md */,
      detail: {
        tbAccountId: created.tbAccountId,
        code: params.code,
        assetCurrency: params.assetCurrency,
        ownerType: created.ownerType,
        ownerNo: created.ownerNo ?? null,
        description: params.description ?? null,
      },
    });
```
> `recordByActor` 的确切签名 + traceId 生成方式见 `doc-final/rules/audit-logging.md`；action 命名 `TB_ACCOUNT_CREATED`（UPPER_SNAKE）。

- [ ] **Step 3: 编译 + 冒烟**

Run: `npx tsc --noEmit`
起栈手动建一个 TB 账户，`GET /admin/audit-logs?action=TB_ACCOUNT_CREATED` 应查到一条。

- [ ] **Step 4: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-manual-account.service.ts
git commit -m "feat(ledger): audit log on manual TB account creation"
```

---

## 收尾验证（全绿门）

- [ ] `npx tsc --noEmit` → 0 error
- [ ] `npx jest account-flow-projector tb-evidence` → 相关用例 PASS
- [ ] `grep -rn "ACCOUNTING_CONFIG" src/` → 空
- [ ] 起 main 栈：三菜单（账户/凭证/流水）可见且各自权限独立；对账单菜单消失；流水页单账户筛选显运行余额、行点击跳凭证详情
- [ ] `bash scripts/on-stack.sh main recon:demo` → PASS（记账链未被 balanceAfter 改动破坏）
- [ ] 手动建账留审计一条

---

## Self-Review（对照 spec）

- 三表三菜单：Task 5/7（流水接口+页）、Task 8（删对账单）✅
- balanceAfter 存储列：Task 1/2/3/4 ✅（含两阶段重投影 + 回填 + 单账户展示约束）
- 权限方案 B：Task 6 ✅（union/路由/桶/绑定 + 前端码 + /wallets 门）
- 审计一条：Task 9 ✅
- 待定项（合规读权限 / pending-void 口径）：已在对应步骤注明，不阻塞。
