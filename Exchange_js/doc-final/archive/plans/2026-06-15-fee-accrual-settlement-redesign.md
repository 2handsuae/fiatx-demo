# FeeAccrual 结算重设计 实施计划

> **状态：✅ 全部完成（2026-06-15）。** W1 改名 / W2 crypto F_FEE / W3 FeeAccrual 双结算+3类批+可追溯 全部 TDD 落地，全量 jest 905 passed/0 failed，build+admin tsc 绿。live e2e 验证：F_FEE(USDT) 0→24.86（== Σ SETTLED USDT accrual 精确吻合），fee_accruals 全 SETTLED，3 类 batch 齐（PRINCIPAL⊥SWAP_FEE⊥WITHDRAW_FEE），可追溯链通。额外修复：feeAccrualNo P2002 撞号（重试）、sim harness 驱动新费用 leg。
>
> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐条执行。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 把费用纳入"计提（FeeAccrual）→ 结算（settlement）"统一模型，与本金 Outstanding 同构；法币即时结、虚拟币 EOD 净额结；结算分 PRINCIPAL⊥SWAP_FEE⊥WITHDRAW_FEE 三类独立批；Path 枚举一致化改名；crypto 建 F_FEE 钱包；两轨统一可追溯。

**Architecture:** 新增 `FeeAccrual` 表（Outstanding 兄弟，三态 ACCRUED→LOCKED→SETTLED）+ `FeeAccrualService`（accrue/lock+settle/settleByTransfer）。法币在订单成功后立即 accrue+settle；虚拟币 accrue 后留到 `eod-settlement-workflow` 净额 settle。`settlement_batches` 加 `category`。改名零行为变化（`resolvePathPolicy` 按 from/to 匹配，不依赖枚举字面量）。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest。脚本：`node -r ts-node/register -r tsconfig-paths/register <script>`。branch 栈：API 3500 / DB `/tmp/exchange_js_branch/dev.db` / TB 3503。**禁用 `dev:rebuild`**。

**Spec:** `doc-final/superpowers/specs/2026-06-15-fee-accrual-settlement-redesign-design.md`

---

## 文件结构总览

**W1 改名**（仅 rename，零新逻辑）
- Modify: `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`（enum + whitelist 11 项）
- Modify: `src/modules/funds-layer/accounting/funds-accounting.service.ts:79-81`（isFeePath）
- Modify: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts:175`
- Modify: `src/modules/funds-layer/domain/settlement-batch.service.ts:29,158,165`（'INTERNAL_IN'/'INTERNAL_OUT' 字面量）
- Modify: 10 个 `.spec.ts`（断言字面量，见 W1-T4 清单）
- **不动**：`fee-collection-workflow.service.ts:99` 的 `settlementType:'FEE_COLLECT'`（是 settlementType，非 TransferPath）

**W2 crypto F_FEE 钱包**
- Modify: `src/modules/asset-treasury/wallets/system-wallet.util.ts:3-5`（加 F_FEE）
- Create: `scripts/seed-crypto-ffee.ts`（幂等 upsert crypto F_FEE 钱包，不重跑全量 seed）

**W3 FeeAccrual + 双结算**
- Modify: `prisma/schema.prisma`（新 model FeeAccrual + SettlementBatch 加 category/费计数）
- Create: `src/modules/funds-layer/domain/fee-accrual.service.ts` + `.spec.ts`
- Modify: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts`（swap 费改走 accrue+settle）
- Modify: `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts`（吸收/改造为 accrue 入口）
- Modify: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`（追加 fee pass）
- Modify: `src/modules/funds-layer/domain/funds-flow.service.ts`（leg CLEAR 时调 FeeAccrual.settleByTransfer，紧邻 Outstanding settle）
- Modify: `src/modules/funds-layer/funds-layer.module.ts`（注册 FeeAccrualService）
- Create: query 方法 `getFeeCollectionStatus`（FeeAccrualService 上）
- Modify: `scripts/verify-two-book.ts`（加 §对账断言）

---

# W1 — Path 枚举一致化全表改名

> 纯机械改名。判据：`resolvePathPolicy(from,to)`/`resolveRoutePolicy(route)` 只按角色串匹配，**不依赖枚举名**——改名后全量 jest 必须全绿即证零行为变化。

**改名映射（权威表）：**

| 旧 | 新 | 备注 |
|---|---|---|
| `AGGREGATE` | `CRYPTO_DEPOSIT_SWEEP` | |
| `FUND_OUT` | `CRYPTO_HOTWALLET_FUND` | |
| `FUND_RETURN` | `CRYPTO_HOTWALLET_RETURN` | |
| `INTERNAL_OUT` | `CRYPTO_SETTLE_OUT` | |
| `INTERNAL_IN` | `CRYPTO_SETTLE_IN` | |
| `FEE_COLLECT` | `CRYPTO_WITHDRAW_FEE_COLLECT` | W3 再改 to=F_FEE/trigger=EOD |
| `FIAT_SETTLE_OUT` | `FIAT_SETTLE_OUT` | 不变 |
| `FIAT_SETTLE_IN` | `FIAT_SETTLE_IN` | 不变 |
| `FIAT_FEE_COLLECT` | `FIAT_WITHDRAW_FEE_COLLECT` | |
| `FIAT_SPREAD_COLLECT` | `FIAT_SWAP_FEE_COLLECT` | 修误名 |

### Task W1-T1: 改 enum + whitelist 定义

**Files:** Modify `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`

- [ ] **Step 1: 改 enum 成员名**（行 2-11）。把 8 个成员按映射表改名（FIAT_SETTLE_OUT/IN 保持），值=名（字符串同步改）：

```ts
export enum TransferPath {
  CRYPTO_DEPOSIT_SWEEP    = 'CRYPTO_DEPOSIT_SWEEP',
  CRYPTO_HOTWALLET_FUND   = 'CRYPTO_HOTWALLET_FUND',
  CRYPTO_HOTWALLET_RETURN = 'CRYPTO_HOTWALLET_RETURN',
  CRYPTO_SETTLE_OUT       = 'CRYPTO_SETTLE_OUT',
  CRYPTO_SETTLE_IN        = 'CRYPTO_SETTLE_IN',
  CRYPTO_WITHDRAW_FEE_COLLECT = 'CRYPTO_WITHDRAW_FEE_COLLECT',
  FIAT_SETTLE_OUT         = 'FIAT_SETTLE_OUT',
  FIAT_SETTLE_IN          = 'FIAT_SETTLE_IN',
  FIAT_WITHDRAW_FEE_COLLECT = 'FIAT_WITHDRAW_FEE_COLLECT',
  FIAT_SWAP_FEE_COLLECT   = 'FIAT_SWAP_FEE_COLLECT',
}
```

- [ ] **Step 2: 同步 TRANSFER_PATH_WHITELIST 的 10 个 key 与 `path:` 字段**到新枚举名（行 39-129）。逐项把 `[TransferPath.旧]` 和 `path: TransferPath.旧` 改为新名。**from/to/mirror/trigger/route 全部保持不变**（本任务零行为变化）。

- [ ] **Step 3: 运行该文件的单测看红**

Run: `npx jest internal-transfer-paths.constant.spec -t "" 2>&1 | tail -20`
Expected: FAIL（spec 还在用旧枚举名/旧字面量）

- [ ] **Step 4: 改 `internal-transfer-paths.constant.spec.ts`** 的枚举引用与字符串断言到新名（该 spec 约 24 处：行 12 数组、行 17 cryptoPaths 数组、行 28/35 及 45-80 的 `TransferPath.*` 与 resolve 返回值断言）。cryptoPaths 数组改为：`['CRYPTO_DEPOSIT_SWEEP','CRYPTO_WITHDRAW_FEE_COLLECT','CRYPTO_HOTWALLET_FUND','CRYPTO_HOTWALLET_RETURN','CRYPTO_SETTLE_IN','CRYPTO_SETTLE_OUT']`。

- [ ] **Step 5: 跑该 spec 看绿**

Run: `npx jest internal-transfer-paths.constant.spec 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/constants/internal-transfer-paths.constant.ts src/modules/funds-layer/constants/internal-transfer-paths.constant.spec.ts
git commit -m "refactor(paths): rename TransferPath enum to consistent {CRYPTO|FIAT}_{purpose}_{dir} (behavior-neutral)"
```

### Task W1-T2: 同步生产代码 3 处枚举/字面量引用

**Files:**
- Modify `src/modules/funds-layer/accounting/funds-accounting.service.ts:79-81`
- Modify `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts:175`
- Modify `src/modules/funds-layer/domain/settlement-batch.service.ts:29,158,165`

- [ ] **Step 1: 改 isFeePath**（funds-accounting.service.ts:79-81）到两条 WITHDRAW_FEE 路径：

```ts
const isFeePath =
  transfer.pathLabel === TransferPath.CRYPTO_WITHDRAW_FEE_COLLECT ||
  transfer.pathLabel === TransferPath.FIAT_WITHDRAW_FEE_COLLECT;
```

- [ ] **Step 2: 改 fiat-settlement-workflow.service.ts:175** `TransferPath.FIAT_SETTLE_IN`（名未变，**确认无需改**；若 import 无误跳过）。

- [ ] **Step 3: 改 settlement-batch.service.ts** 行 29 类型 `path: 'CRYPTO_SETTLE_IN' | 'CRYPTO_SETTLE_OUT';`、行 158 `path: 'CRYPTO_SETTLE_IN',`、行 165 `path: 'CRYPTO_SETTLE_OUT',`。

- [ ] **Step 4: 全量编译**

Run: `npm run build 2>&1 | tail -15`
Expected: 0 error（若有 TS 报未知枚举成员，改到对）

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/accounting/funds-accounting.service.ts src/modules/funds-layer/domain/settlement-batch.service.ts src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts
git commit -m "refactor(paths): sync production refs to renamed TransferPath members"
```

### Task W1-T3: 同步剩余 9 个 spec 的字面量断言

**Files (逐个改字面量到新名):**
- `funds-accounting.service.spec.ts`（行 28/71/152 `'INTERNAL_OUT'`→`'CRYPTO_SETTLE_OUT'`；行 117 `'FEE_COLLECT'`→`'CRYPTO_WITHDRAW_FEE_COLLECT'`；行 137 `'FIAT_SPREAD_COLLECT'`→`'FIAT_SWAP_FEE_COLLECT'`；行 90/164/187 `'FIAT_SETTLE_IN'` 不变）
- `eod-settlement-workflow.service.spec.ts`（行 126/205 `'INTERNAL_IN'`→`'CRYPTO_SETTLE_IN'`）
- `fiat-fee-collection-workflow.service.spec.ts`（行 54/62 `'FIAT_SPREAD_COLLECT'`→`'FIAT_SWAP_FEE_COLLECT'`；行 94 `'FIAT_FEE_COLLECT'`→`'FIAT_WITHDRAW_FEE_COLLECT'`）
- `settlement-batch.service.spec.ts`（行 66 `'INTERNAL_IN'`→`'CRYPTO_SETTLE_IN'`；行 76 `'INTERNAL_OUT'`→`'CRYPTO_SETTLE_OUT'`；**行 55/58 `'FEE_COLLECT'` 是 settlementType，保持不变**）
- `internal-transfer.service.spec.ts`（行 47 `TransferPath.AGGREGATE`→`CRYPTO_DEPOSIT_SWEEP`；行 65/70 `'AGGREGATE'`→`'CRYPTO_DEPOSIT_SWEEP'`）
- `whitelist.guard.spec.ts`（行 10 `TransferPath.AGGREGATE`→`CRYPTO_DEPOSIT_SWEEP`；行 23 `'FIAT_SETTLE_OUT'` 不变；行 31 不变；行 44 `'FIAT_FEE_COLLECT'`→`'FIAT_WITHDRAW_FEE_COLLECT'`；行 52 `'FIAT_SPREAD_COLLECT'`→`'FIAT_SWAP_FEE_COLLECT'`）
- `internal-transfer-workflow.service.spec.ts`（行 98 `'AGGREGATE'`→`'CRYPTO_DEPOSIT_SWEEP'`）
- `fiat-settlement-workflow.service.spec.ts`（行 59 `'FIAT_SETTLE_OUT'` 不变；行 80/197/207 不变——全是未改名路径，**确认后跳过**）
- `fee-collection-workflow.service.spec.ts`（行 81 `settlementType:'FEE_COLLECT'` 是 settlementType，**保持不变**）

- [ ] **Step 1: 逐个按上表改字面量**（注意区分 pathLabel/path 断言 vs settlementType——后者不改）。

- [ ] **Step 2: 全量 jest**

Run: `npx jest 2>&1 | tail -15`
Expected: Tests: 0 failed（全绿即证改名零行为变化）

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor(paths): sync remaining spec assertions to renamed TransferPath (all green = behavior-neutral)"
```

---

# W2 — crypto F_FEE 钱包

### Task W2-T1: 加 F_FEE 到 crypto 系统钱包角色 + 幂等 seed

**Files:**
- Modify `src/modules/asset-treasury/wallets/system-wallet.util.ts:3-5`
- Create `scripts/seed-crypto-ffee.ts`

- [ ] **Step 1: 加 F_FEE 到 CRYPTO_SYSTEM_WALLET_ROLES**（保留既有 F_LIQ/F_OPS 不动）：

```ts
export const CRYPTO_SYSTEM_WALLET_ROLES: WalletRole[] = [
  WalletRole.C_MAIN, WalletRole.C_OUT, WalletRole.F_LIQ, WalletRole.F_OPS, WalletRole.F_FEE,
];
```

- [ ] **Step 2: 写幂等 seed 脚本**（只补 crypto F_FEE 钱包，不重跑全量 seed，避免动 branch DB 其他数据）。镜像 `prisma/seed.business.ts` seedAssets() 里 crypto 分支的 `wallet.upsert` 形状（type='CRYPTO_ADDRESS'、address 由 `buildSystemWalletAddress` 算、walletNo 由 `buildDeterministicNo('WA',role,assetCode,network)` 算）：

```ts
// scripts/seed-crypto-ffee.ts
import { PrismaClient } from '@prisma/client';
import { WalletRole } from '../src/modules/asset-treasury/wallets/wallet-role.enum'; // 按实际路径
import { buildDeterministicNo, normalizeSegment, normalizeNetwork, buildSystemWalletAddress } from '../src/modules/asset-treasury/wallets/system-wallet.util';

const prisma = new PrismaClient();
async function main() {
  const cryptoAssets = await prisma.asset.findMany({ where: { type: 'CRYPTO' } });
  for (const asset of cryptoAssets) {
    const role = WalletRole.F_FEE;
    const net = normalizeNetwork ? normalizeNetwork(asset.network) : asset.network;
    const walletNo = buildDeterministicNo('WA', role, normalizeSegment(asset.code), net ? normalizeSegment(net) : '');
    const address = buildSystemWalletAddress(role, asset.code, asset.network);
    await prisma.wallet.upsert({
      where: { walletNo },
      update: { status: 'ACTIVE' },
      create: {
        walletNo, ownerType: 'PLATFORM', ownerId: null, ownerNo: 'PLATFORM',
        type: 'CRYPTO_ADDRESS', walletRole: role, assetId: asset.id, address, status: 'ACTIVE',
        mockBalance: '0',
      },
    });
    console.log(`F_FEE crypto wallet ensured: ${asset.code} ${walletNo}`);
  }
  await prisma.$disconnect();
}
main();
```
> 执行前先核对 `system-wallet.util.ts` 实际导出的 helper 名（buildSystemWalletAddress / normalizeNetwork / WalletRole import 路径），照实改。

- [ ] **Step 3: 跑脚本（针对 branch DB）**

Run: `DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" node -r ts-node/register -r tsconfig-paths/register scripts/seed-crypto-ffee.ts`
Expected: 打印每个 crypto 资产 "F_FEE crypto wallet ensured"

- [ ] **Step 4: 验证 resolver 能命中 crypto F_FEE**

Run:
```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT a.code, w.walletRole, w.type FROM wallets w JOIN assets a ON a.id=w.assetId WHERE w.walletRole='F_FEE' AND a.type='CRYPTO';"
```
Expected: 每个 crypto 资产一行（USDT-TRON | F_FEE | CRYPTO_ADDRESS）

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/wallets/system-wallet.util.ts scripts/seed-crypto-ffee.ts
git commit -m "feat(wallets): add F_FEE to crypto system-wallet roles + idempotent seed (crypto fee destination)"
```

---

# W3 — FeeAccrual 兄弟表 + 双结算 + 3 类独立批 + 统一可追溯

### Task W3-T1: schema — FeeAccrual 表 + SettlementBatch.category

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: 加 FeeAccrual model**（镜像 Outstanding，三态）：

```prisma
model FeeAccrual {
  id                  String               @id @default(uuid())
  feeAccrualNo        String?              @unique
  sourceType          String                                  // SWAP | WITHDRAW
  sourceId            String
  sourceNo            String?
  ownerType           String
  ownerId             String
  ownerNo             String?
  feeKind             String                                  // SERVICE_FEE | SPREAD | WITHDRAW_FEE
  category            String                                  // SWAP_FEE | WITHDRAW_FEE
  assetId             String
  assetCode           String?
  amount              Decimal
  status              String               @default("ACCRUED")  // ACCRUED → LOCKED → SETTLED
  settlementBatchId   String?
  settledByTransferId String?
  lockedAt            DateTime?
  closedAt            DateTime?
  closedByInternalFundId String?
  createdAt           DateTime             @default(now())
  updatedAt           DateTime             @updatedAt
  asset               Asset                @relation(fields: [assetId], references: [id])
  settlementBatch     SettlementBatch?     @relation(fields: [settlementBatchId], references: [id], onDelete: SetNull)
  settledByTransfer   InternalTransaction? @relation("FeeAccrualSettledByTransfer", fields: [settledByTransferId], references: [id], onDelete: SetNull)
  closedByInternalFund InternalFund?       @relation("FeeAccrualClosedByFund", fields: [closedByInternalFundId], references: [id], onDelete: SetNull)
  @@unique([sourceType, sourceId, feeKind])
  @@index([status]) @@index([sourceType, sourceId]) @@index([assetId]) @@index([settlementBatchId]) @@index([settledByTransferId])
  @@map("fee_accruals")
}
```

- [ ] **Step 2: SettlementBatch 加字段**（在 model SettlementBatch 内）：

```prisma
  category               String @default("PRINCIPAL")  // PRINCIPAL | SWAP_FEE | WITHDRAW_FEE
  totalFeeAccrualCount   Int    @default(0)
  settledFeeAccrualCount Int    @default(0)
  feeAccruals            FeeAccrual[]
```

- [ ] **Step 3: 反向关系**：在 `Asset` model 加 `feeAccruals FeeAccrual[]`；在 `InternalTransaction` model 加 `feeAccrualsSettled FeeAccrual[] @relation("FeeAccrualSettledByTransfer")`；在 `InternalFund` model 加 `feeAccrualsClosed FeeAccrual[] @relation("FeeAccrualClosedByFund")`。

- [ ] **Step 4: 生成迁移（针对 branch DB，禁用 rebuild）**

Run: `DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx prisma migrate dev --name fee_accrual_settlement_category --create-only`
然后检查生成的 SQL 只含 CREATE TABLE fee_accruals + ALTER settlement_batches ADD COLUMN，无 DROP；再 apply：
`DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx prisma migrate dev`
Expected: 迁移成功，`npx prisma generate` 自动跑

- [ ] **Step 5: 验证表存在**

Run: `sqlite3 /tmp/exchange_js_branch/dev.db ".schema fee_accruals" | head -5; sqlite3 /tmp/exchange_js_branch/dev.db "PRAGMA table_info(settlement_batches);" | grep category`
Expected: fee_accruals 表 + settlement_batches.category 列

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add FeeAccrual table + SettlementBatch.category (3-category settlement)"
```

### Task W3-T2: FeeAccrualService.accrue（计提，红→绿）

**Files:**
- Create `src/modules/funds-layer/domain/fee-accrual.service.ts`
- Create `src/modules/funds-layer/domain/fee-accrual.service.spec.ts`
- Modify `src/modules/funds-layer/funds-layer.module.ts`（providers 加 FeeAccrualService）

- [ ] **Step 1: 写失败测试**（accrueForSwap 建 2 条、accrueForWithdraw 建 1 条、幂等不重复）：

```ts
// fee-accrual.service.spec.ts
import { FeeAccrualService } from './fee-accrual.service';
import { Prisma } from '@prisma/client';

describe('FeeAccrualService.accrue', () => {
  const created: any[] = [];
  const prisma: any = {
    swapTransaction: { findUnique: jest.fn() },
    withdrawTransaction: { findUnique: jest.fn() },
    feeAccrual: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: any) => { created.push(args.data); return Promise.resolve({ id: 'fa', ...args.data }); }),
    },
  };
  const svc = new FeeAccrualService(prisma as any, {} as any, {} as any, {} as any);
  beforeEach(() => { created.length = 0; });

  it('swap → 2 accruals (SERVICE_FEE + SPREAD), category SWAP_FEE', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 's1', swapNo: 'SWP1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
      toAssetId: 'a-usdt', feeAmount: '3', spreadAmount: '1.5', feeCurrency: 'USDT',
      toAsset: { code: 'USDT-TRON' },
    });
    await svc.accrueForSwap('s1', prisma);
    expect(created).toHaveLength(2);
    expect(created.map((c) => c.feeKind).sort()).toEqual(['SERVICE_FEE', 'SPREAD']);
    expect(created.every((c) => c.category === 'SWAP_FEE')).toBe(true);
    expect(created.every((c) => c.sourceType === 'SWAP' && c.sourceNo === 'SWP1')).toBe(true);
  });

  it('withdraw → 1 accrual (WITHDRAW_FEE), category WITHDRAW_FEE', async () => {
    prisma.withdrawTransaction.findUnique.mockResolvedValue({
      id: 'w1', withdrawNo: 'WD1', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
      assetId: 'a-usdt', feeAmount: '1', asset: { code: 'USDT-TRON' },
    });
    await svc.accrueForWithdraw('w1', prisma);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ feeKind: 'WITHDRAW_FEE', category: 'WITHDRAW_FEE', sourceType: 'WITHDRAW', sourceNo: 'WD1' });
  });

  it('skips zero-amount fee/spread', async () => {
    prisma.swapTransaction.findUnique.mockResolvedValue({
      id: 's2', swapNo: 'SWP2', ownerType: 'CUSTOMER', ownerId: 'c1', ownerNo: 'C1',
      toAssetId: 'a', feeAmount: '0', spreadAmount: '0', toAsset: { code: 'X' },
    });
    await svc.accrueForSwap('s2', prisma);
    expect(created).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑看红**

Run: `npx jest fee-accrual.service.spec 2>&1 | tail -15`
Expected: FAIL（FeeAccrualService 不存在）

- [ ] **Step 3: 写 FeeAccrualService（accrue 部分）**：

```ts
// fee-accrual.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { InternalTransferService } from './internal-transfer.service';
import { FundsFlowService } from './funds-flow.service';
import { SystemWalletResolver } from './system-wallet-resolver.service';
import { generateReferenceNo } from '../../../common/utils/reference-no.util'; // 按实际路径

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class FeeAccrualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly systemWallets: SystemWalletResolver,
  ) {}

  private async createAccrual(tx: Tx, d: {
    sourceType: string; sourceId: string; sourceNo: string | null;
    ownerType: string; ownerId: string; ownerNo: string | null;
    feeKind: string; category: string; assetId: string; assetCode: string | null;
    amount: Prisma.Decimal;
  }) {
    const existing = await (tx as any).feeAccrual.findUnique({
      where: { sourceType_sourceId_feeKind: { sourceType: d.sourceType, sourceId: d.sourceId, feeKind: d.feeKind } },
    });
    if (existing) return existing;
    return (tx as any).feeAccrual.create({
      data: {
        feeAccrualNo: generateReferenceNo('FAC'),
        sourceType: d.sourceType, sourceId: d.sourceId, sourceNo: d.sourceNo,
        ownerType: d.ownerType, ownerId: d.ownerId, ownerNo: d.ownerNo,
        feeKind: d.feeKind, category: d.category, assetId: d.assetId, assetCode: d.assetCode,
        amount: d.amount, status: 'ACCRUED',
      },
    });
  }

  async accrueForSwap(swapId: string, tx: Tx = this.prisma): Promise<void> {
    const s = await (tx as any).swapTransaction.findUnique({
      where: { id: swapId },
      select: { id: true, swapNo: true, ownerType: true, ownerId: true, ownerNo: true,
        toAssetId: true, feeAmount: true, spreadAmount: true, toAsset: { select: { code: true } } },
    });
    if (!s) return;
    const fee = new Prisma.Decimal(s.feeAmount ?? 0);
    const spread = new Prisma.Decimal(s.spreadAmount ?? 0);
    const base = { sourceType: 'SWAP', sourceId: s.id, sourceNo: s.swapNo,
      ownerType: s.ownerType, ownerId: s.ownerId, ownerNo: s.ownerNo,
      category: 'SWAP_FEE', assetId: s.toAssetId, assetCode: s.toAsset?.code ?? null };
    if (fee.gt(0))    await this.createAccrual(tx, { ...base, feeKind: 'SERVICE_FEE', amount: fee });
    if (spread.gt(0)) await this.createAccrual(tx, { ...base, feeKind: 'SPREAD', amount: spread });
  }

  async accrueForWithdraw(withdrawId: string, tx: Tx = this.prisma): Promise<void> {
    const w = await (tx as any).withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: { id: true, withdrawNo: true, ownerType: true, ownerId: true, ownerNo: true,
        assetId: true, feeAmount: true, asset: { select: { code: true } } },
    });
    if (!w) return;
    const fee = new Prisma.Decimal(w.feeAmount ?? 0);
    if (!fee.gt(0)) return;
    await this.createAccrual(tx, { sourceType: 'WITHDRAW', sourceId: w.id, sourceNo: w.withdrawNo,
      ownerType: w.ownerType, ownerId: w.ownerId, ownerNo: w.ownerNo,
      feeKind: 'WITHDRAW_FEE', category: 'WITHDRAW_FEE', assetId: w.assetId, assetCode: w.asset?.code ?? null,
      amount: fee });
  }
}
```
> `generateReferenceNo` 实际路径照 `payouts.service.ts` 的 import 抄。

- [ ] **Step 4: 跑看绿**

Run: `npx jest fee-accrual.service.spec 2>&1 | tail -10`
Expected: PASS（3 个 it 全绿）

- [ ] **Step 5: 注册到 module**（funds-layer.module.ts providers 数组加 `FeeAccrualService`，并 import）。

- [ ] **Step 6: module DI 冒烟**

Run: `npx jest funds-layer.module.spec 2>&1 | tail -8`
Expected: PASS（若报 DI 缺依赖，给 module.spec 的 providers 也加 FeeAccrualService 或其依赖 mock）

- [ ] **Step 7: Commit**

```bash
git add src/modules/funds-layer/domain/fee-accrual.service.ts src/modules/funds-layer/domain/fee-accrual.service.spec.ts src/modules/funds-layer/funds-layer.module.ts
git commit -m "feat(fee-accrual): FeeAccrualService.accrue for swap(fee+spread)/withdraw + DI registration (TDD)"
```

### Task W3-T3: FeeAccrualService.settle（按 category 分组建批+净额转账+锁定）

**Files:** Modify `fee-accrual.service.ts` + `.spec.ts`

- [ ] **Step 1: 写失败测试**（settle 按 (asset,category) 分组，每组 1 批 + 1 净额转账 + leg，把组内 accrual 锁定 LOCKED+settledByTransferId+settlementBatchId）：

```ts
it('settle: groups by (asset,category), 1 batch + 1 net transfer per group, locks accruals', async () => {
  const accruals = [
    { id: 'a1', assetId: 'usdt', category: 'SWAP_FEE', amount: '3', ownerType: 'PLATFORM', ownerId: 'P', ownerNo: null },
    { id: 'a2', assetId: 'usdt', category: 'SWAP_FEE', amount: '1.5', ownerType: 'PLATFORM', ownerId: 'P', ownerNo: null },
  ];
  const batchSvc = { createBatch: jest.fn().mockResolvedValue({ id: 'b1', batchNo: 'OSB1' }) };
  const transfers = { createTransfer: jest.fn().mockResolvedValue({ id: 't1', internalTxNo: 'ITX1' }) };
  const flow = { createLeg: jest.fn().mockResolvedValue({ id: 'leg1' }) };
  const resolver = { resolve: jest.fn().mockResolvedValue({ id: 'w-fops' }) };
  const updateMany = jest.fn().mockResolvedValue({ count: 2 });
  const prisma: any = { feeAccrual: { updateMany }, $transaction: (fn: any) => fn(prisma) };
  const svc = new FeeAccrualService(prisma, transfers as any, flow as any, resolver as any);
  (svc as any).batchService = batchSvc; // 若注入则改构造
  await svc.settle(accruals as any, 'SWAP_FEE', 'FIAT_SWAP', prisma);
  expect(transfers.createTransfer).toHaveBeenCalledTimes(1);
  const tArg = transfers.createTransfer.mock.calls[0][0];
  expect(tArg.path).toBe('FIAT_SWAP_FEE_COLLECT');      // SWAP_FEE → F_OPS→F_FEE
  expect(tArg.amount.toString()).toBe('4.5');           // 3 + 1.5
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: { in: ['a1', 'a2'] } },
    data: expect.objectContaining({ status: 'LOCKED', settledByTransferId: 't1', settlementBatchId: 'b1' }),
  }));
});
```

- [ ] **Step 2: 跑看红**

Run: `npx jest fee-accrual.service.spec -t "settle" 2>&1 | tail -12`
Expected: FAIL

- [ ] **Step 3: 实现 settle**（加 `SettlementBatchService` 注入；category→path/from/to 映射）：

```ts
// 构造加：private readonly batchService: SettlementBatchService
private pathFor(category: string): { path: string; fromRole: string; toRole: string } {
  if (category === 'SWAP_FEE')     return { path: 'FIAT_SWAP_FEE_COLLECT', fromRole: 'F_OPS', toRole: 'F_FEE' };
  // 注：path 字面量按资产侧在调用处用 asset.type 选 CRYPTO_/FIAT_ 前缀，见下
  return { path: 'FIAT_WITHDRAW_FEE_COLLECT', fromRole: 'C_VIBAN', toRole: 'F_FEE' };
}

async settle(accruals: any[], category: string, settlementType: string, tx: Tx): Promise<void> {
  if (!accruals.length) return;
  // 按 assetId 分组（同 category 已由调用方保证）
  const byAsset = new Map<string, any[]>();
  for (const a of accruals) (byAsset.get(a.assetId) ?? byAsset.set(a.assetId, []).get(a.assetId))!.push(a);
  for (const [assetId, group] of byAsset) {
    const amount = group.reduce((s, a) => s.add(new Prisma.Decimal(a.amount)), new Prisma.Decimal(0));
    if (amount.lte(0)) continue;
    const asset = await (tx as any).asset.findUnique({ where: { id: assetId }, select: { type: true } });
    const isCrypto = asset?.type === 'CRYPTO';
    const { path, fromRole, toRole } = this.resolvePath(category, isCrypto, group[0]);
    const from = await this.systemWallets.resolve(assetId, fromRole === 'C_VIBAN' ? 'C_VIBAN' : fromRole, /* C_VIBAN 需按 owner 解析，见注 */);
    const to = await this.systemWallets.resolve(assetId, toRole);
    const batch = await this.batchService.createBatch({ cutoffAt: new Date(), settlementType, category } as any);
    const transfer = await this.transfers.createTransfer({
      path: path as any, accountingClass: 'B' as any, medium: isCrypto ? 'CHAIN' : 'BANK',
      triggerSource: settlementType, sourceType: category === 'SWAP_FEE' ? 'SWAP_FEE_SETTLEMENT' : 'WITHDRAW_FEE_SETTLEMENT',
      sourceId: `${batch.id}:${assetId}`, sourceNo: batch.batchNo,
      ownerType: group[0].ownerType, ownerId: group[0].ownerId, ownerNo: group[0].ownerNo,
      assetId, amount, feeAmount: new Prisma.Decimal(0), netAmount: amount,
      fromWalletId: from.id, toWalletId: to.id, settlementBatchId: batch.id,
    });
    await this.fundsFlow.createLeg({ internalTransactionId: transfer.id, fromWalletId: from.id, toWalletId: to.id, amount });
    await (tx as any).feeAccrual.updateMany({
      where: { id: { in: group.map((a) => a.id) } },
      data: { status: 'LOCKED', settledByTransferId: transfer.id, settlementBatchId: batch.id, lockedAt: new Date() },
    });
  }
}
```
> **C_VIBAN 解析特殊**：WITHDRAW_FEE 法币侧 from=C_VIBAN（按 ownerId 取客户钱包，用 `systemWallets.resolveCustomer(assetId,'C_VIBAN',ownerId)`，见 FiatFeeCollectionWorkflowService 用法）。`resolvePath(category,isCrypto,sample)` 返回正确前缀：SWAP_FEE→`{CRYPTO|FIAT}_SWAP_FEE_COLLECT`(F_OPS→F_FEE)；WITHDRAW_FEE→crypto `CRYPTO_WITHDRAW_FEE_COLLECT`(C_MAIN→F_FEE) / fiat `FIAT_WITHDRAW_FEE_COLLECT`(C_VIBAN→F_FEE)。批的 from 角色据此选 F_OPS / C_MAIN / C_VIBAN。
> `batchService.createBatch` 需扩参支持 `category`（见 W3-T6）。测试里把 batchService 注入并 mock。

- [ ] **Step 4: 跑看绿**

Run: `npx jest fee-accrual.service.spec -t "settle" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/domain/fee-accrual.service.ts src/modules/funds-layer/domain/fee-accrual.service.spec.ts
git commit -m "feat(fee-accrual): settle() groups by (asset,category), 1 net transfer + lock per group (TDD)"
```

### Task W3-T4: settleByTransfer（leg CLEAR 时 LOCKED→SETTLED）+ 挂到 funds-flow

**Files:** Modify `fee-accrual.service.ts` + `.spec.ts`；Modify `funds-flow.service.ts`（紧邻 Outstanding 的 settle 调用处）

- [ ] **Step 1: 写失败测试**：

```ts
it('settleByTransfer: flips LOCKED→SETTLED for the transfer', async () => {
  const updateMany = jest.fn().mockResolvedValue({ count: 2 });
  const prisma: any = { feeAccrual: { updateMany } };
  const svc = new FeeAccrualService(prisma, {} as any, {} as any, {} as any);
  await svc.settleByTransfer('t1', 'fund1', prisma);
  expect(updateMany).toHaveBeenCalledWith({
    where: { settledByTransferId: 't1', status: 'LOCKED' },
    data: expect.objectContaining({ status: 'SETTLED', closedByInternalFundId: 'fund1' }),
  });
});
```

- [ ] **Step 2: 跑看红** → `npx jest fee-accrual.service.spec -t "settleByTransfer"`：FAIL

- [ ] **Step 3: 实现**：

```ts
async settleByTransfer(settledByTransferId: string, internalFundId: string, tx: Tx): Promise<{ count: number }> {
  return (tx as any).feeAccrual.updateMany({
    where: { settledByTransferId, status: 'LOCKED' },
    data: { status: 'SETTLED', closedByInternalFundId: internalFundId, closedAt: new Date() },
  });
}
```

- [ ] **Step 4: 跑看绿** → PASS

- [ ] **Step 5: 挂到 leg CLEAR**：在 `funds-flow.service.ts` 中找到 Outstanding 在 leg CLEAR 时被 settle 的调用处（grep `settledByTransferId` 或 `consumer.settle(`），在其紧邻处加 `await this.feeAccrual.settleByTransfer(internalTransactionId, fundId, client)`（同事务）。注入 FeeAccrualService。

> 若 funds-flow 与 fee-accrual 互相依赖成环，用 `forwardRef` 或把 settleByTransfer 调用放在更上层 workflow 完成处——优先无环方案。

- [ ] **Step 6: 全量 jest + DI 冒烟**

Run: `npx jest funds-flow.service.spec funds-layer.module.spec 2>&1 | tail -10`
Expected: PASS（给 funds-flow.spec 加 FeeAccrualService mock `{ settleByTransfer: jest.fn() }`）

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(fee-accrual): settleByTransfer on leg CLEAR (LOCKED→SETTLED), wired beside Outstanding settle (TDD)"
```

### Task W3-T5: 法币即时结 — 替换 collectSwapFees 触发 + 提现费

**Files:** Modify `fiat-settlement-workflow.service.ts:177`；Modify `fiat-fee-collection-workflow.service.ts`

- [ ] **Step 1: 写/改 fiat-fee-collection spec**：断言 fiat swap 成功后 → `feeAccrual.accrueForSwap` + `settle('SWAP_FEE','FIAT_SWAP')` 被调用（替换原 spawnCollect 两次断言）。fiat withdraw 成功 → `accrueForWithdraw` + `settle('WITHDRAW_FEE','FIAT_WITHDRAW')`。

- [ ] **Step 2: 跑看红**

- [ ] **Step 3: 改造 `FiatFeeCollectionWorkflowService`** 为薄触发器：
  - `collectSwapFees(swapId)`（仍由 fiat-settlement-workflow:177 调）→ 改为 `await feeAccrual.accrueForSwap(swapId); const open = 查该 swap 的 ACCRUED SWAP_FEE accruals; await feeAccrual.settle(open,'SWAP_FEE','FIAT_SWAP', prisma)`。
  - `@OnEvent(EVT_WITHDRAWAL_SUCCESS__FIAT)` → `accrueForWithdraw` + 立即 `settle(...,'WITHDRAW_FEE','FIAT_WITHDRAW')`。
  - 删除旧 spawnCollect（被 settle 取代）。注入 FeeAccrualService。

- [ ] **Step 4: 跑看绿** + 全量 jest

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(fee-accrual): fiat immediate settle via accrue+settle, replacing per-order spawnCollect (TDD)"
```

### Task W3-T6: SettlementBatchService.createBatch 支持 category + rollup 费计数

**Files:** Modify `settlement-batch.service.ts` + `.spec.ts`

- [ ] **Step 1: 改 spec**：`createBatch({cutoffAt, category:'SWAP_FEE'})` → 落库 `category='SWAP_FEE'`；默认 `'PRINCIPAL'`。

- [ ] **Step 2: 跑看红**

- [ ] **Step 3: 改 createBatch**：`CreateBatchInput` 加 `category?: string`；create data 加 `category: input.category ?? 'PRINCIPAL'`。

- [ ] **Step 4: 跑看绿** + Commit

```bash
git add -A && git commit -m "feat(settlement): SettlementBatch.category param in createBatch (TDD)"
```

### Task W3-T7: 虚拟币 EOD fee pass + accrue 接线

**Files:**
- Modify `eod-settlement-workflow.service.ts`（本金 pass 后追加 fee pass）
- Modify swap 成功路径：crypto swap 也要 accrue（当前 collectSwapFees 只处理 fiat）→ 在 `swap-workflow.service.ts` SWAP_SUCCEEDED 后，或新增 `@OnEvent(SWAP_SUCCEEDED)` 在 FeeAccrualService/一个薄 listener 中对 **crypto** swap 调 `accrueForSwap`（fiat 已在 T5 的 settlement 后 accrue+settle）
- Modify crypto withdraw：新增 `@OnEvent(EVT_WITHDRAWAL_SUCCESS__CRYPTO)` → `accrueForWithdraw`（只 accrue，不 settle）

- [ ] **Step 1: 写 eod fee pass 失败测试**：EOD run 后，对每 crypto 资产，把 ACCRUED 的 SWAP_FEE accrual 汇成 1 笔 `CRYPTO_SWAP_FEE_COLLECT`、WITHDRAW_FEE 汇成 1 笔 `CRYPTO_WITHDRAW_FEE_COLLECT`，各自独立 batch。mock：feeAccrual.findMany 返回若干 ACCRUED，断言 settle 被按 category 各调一次。

- [ ] **Step 2: 跑看红**

- [ ] **Step 3: 实现 crypto accrue 接线**：
  - 新增薄 listener（可放 FeeAccrualService 或新 `FeeAccrualListener`）：`@OnEvent(SWAP_SUCCEEDED)` → 查 swap.toAsset.type，若 CRYPTO 则 `accrueForSwap`（fiat 跳过，避免与 T5 重复）；`@OnEvent(EVT_WITHDRAWAL_SUCCESS__CRYPTO)` → `accrueForWithdraw`。

- [ ] **Step 4: 实现 eod fee pass**：在 `runEodSettlement()` 本金 pass 完成后追加：
```ts
// 伪代码骨架：
for (const assetId of cryptoAssetIds) {
  const swapFees = await prisma.feeAccrual.findMany({ where: { assetId, category: 'SWAP_FEE', status: 'ACCRUED' } });
  if (swapFees.length) await this.feeAccrual.settle(swapFees, 'SWAP_FEE', 'EOD', prisma);
  const wdFees = await prisma.feeAccrual.findMany({ where: { assetId, category: 'WITHDRAW_FEE', status: 'ACCRUED' } });
  if (wdFees.length) await this.feeAccrual.settle(wdFees, 'WITHDRAW_FEE', 'EOD', prisma);
}
```
注入 FeeAccrualService 到 eod workflow。

- [ ] **Step 5: 跑看绿** + 全量 jest

- [ ] **Step 6: 旧 crypto FeeCollectionWorkflowService 处置**：把 `FeeCollectionWorkflowService`/`FeeCollectionSweepService`（CRON, 旧 FEE_COLLECT C_MAIN→F_OPS）的 CRON 触发停用（保留类，不再调度，或标记 deprecated 注释），避免与新 EOD fee pass 双写。验证其 spec 仍绿或相应调整。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(fee-accrual): crypto accrue on swap/withdraw success + EOD fee pass (SWAP_FEE⊥WITHDRAW_FEE nets); retire legacy crypto FEE_COLLECT cron (TDD)"
```

### Task W3-T8: getFeeCollectionStatus 统一可追溯出口

**Files:** Modify `fee-accrual.service.ts` + `.spec.ts`（可选：暴露到某 controller，本轮先做 service 方法）

- [ ] **Step 1: 写失败测试**：`getFeeCollectionStatus('SWP1')` → `{ collected, items:[{feeKind,category,status,settledByTransferNo,settlementBatchNo}] }`，两轨同查 sourceNo。

- [ ] **Step 2: 跑看红**

- [ ] **Step 3: 实现**：
```ts
async getFeeCollectionStatus(orderNo: string) {
  const rows = await (this.prisma as any).feeAccrual.findMany({
    where: { sourceNo: orderNo },
    include: { settledByTransfer: { select: { internalTxNo: true } }, settlementBatch: { select: { batchNo: true } } },
  });
  return {
    collected: rows.length > 0 && rows.every((r: any) => r.status === 'SETTLED'),
    items: rows.map((r: any) => ({ feeKind: r.feeKind, category: r.category, status: r.status,
      settledByTransferNo: r.settledByTransfer?.internalTxNo ?? null, settlementBatchNo: r.settlementBatch?.batchNo ?? null })),
  };
}
```

- [ ] **Step 4: 跑看绿** + Commit

```bash
git add -A && git commit -m "feat(fee-accrual): getFeeCollectionStatus unified traceability (both rails) (TDD)"
```

### Task W3-T9: 对账断言 + 全链验收

**Files:** Modify `scripts/verify-two-book.ts`（加 §对账断言）

- [ ] **Step 1: 加对账断言**（spec §八 5 条）：`F_FEE(asset)==Σ SETTLED accrual`；`SWAP_FEE batch 总额==Σ(SERVICE_FEE+SPREAD)`；`WITHDRAW_FEE batch 总额==Σ WITHDRAW_FEE accrual==TB FEE_DECOMMINGLE`；每 SETTLED accrual 有 settledByTransferId 且 leg=CLEAR。

- [ ] **Step 2: 全量 jest**

Run: `npx jest 2>&1 | tail -8`
Expected: Tests: 0 failed

- [ ] **Step 3: build + admin tsc**

Run: `npm run build 2>&1 | tail -5 && (cd admin-web && npx tsc --noEmit 2>&1 | tail -5)`
Expected: 0 error

- [ ] **Step 4: 重启 branch 栈**

Run: `npm run dev:stop && npm run dev:start`
Expected: 3500-3503 起来，无 DI 环报错

- [ ] **Step 5: 重跑 10 客户 sim 验真**

Run: `DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 node -r ts-node/register -r tsconfig-paths/register scripts/sim-e2e-demo.ts`
然后查：
```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT a.code, printf('%.4f',CAST(w.mockBalance AS REAL)) FROM wallets w JOIN assets a ON a.id=w.assetId WHERE w.walletRole='F_FEE';"
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT category, status, COUNT(*) FROM fee_accruals GROUP BY category, status;"
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT category, COUNT(*) FROM settlement_batches GROUP BY category;"
```
Expected: **F_FEE(USDT) 非 0 入账**；fee_accruals 全 SETTLED；settlement_batches 出现 SWAP_FEE/WITHDRAW_FEE/PRINCIPAL 三类。

- [ ] **Step 6: 勾选本计划 + 终版 commit**

```bash
git add -A && git commit -m "test(fee-accrual): two-book recon assertions + full-chain verify (F_FEE both currencies, 3-category batches)"
```

---

## 验收标准（Definition of Done）

1. `npx jest` 0 failed（W1 改名零行为变化 + W3 新逻辑全绿）。
2. `npm run build` + admin `tsc --noEmit` 0 error。
3. branch 栈重启无 DI 环。
4. 重跑 sim：`F_FEE(USDT)` 与 `F_FEE(AED)` 均按 Σ SETTLED accrual 入账；`fee_accruals` 全 SETTLED；`settlement_batches.category` 出 PRINCIPAL/SWAP_FEE/WITHDRAW_FEE 三类；`getFeeCollectionStatus(SWP/WD号)` 两轨可答。
5. spec §八 5 条对账断言在 verify-two-book 全过。

## 非目标（不做）

- 不改 TB 收入确认时机；不改本金 Outstanding 净额逻辑（仅加 batch.category=PRINCIPAL）；不引余额校验/重试；不并费入本金；FeeAccrual 前端页留后续 UX 轮。
