# funds_orders 三合一 + V7/V8 结算残留清除 — 实施计划 (Round 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 payin / payout / internal_funds 三张表合并成 funds_orders 一张(rename + 加字段),workflow 走 event 驱动,清除 V7/V8 延迟结算残留。

**Architecture:** `internal_funds` 表 rename 成 `funds_orders`(不新建、不 backfill、不 dual-write)。`FundsOrderService` 是唯一数据 owner(纯数据 API,不写 audit),`advance()` 内部 emit `funds_order.status.changed`,3 个 workflow `@OnEvent` 监听决定下一步。audit 归 workflow 层。对账先抽 repo 再删死表。

**Tech Stack:** NestJS + Prisma(SQLite)+ TigerBeetle;@nestjs/event-emitter;Jest。

**Spec:** `doc-final/superpowers/specs/2026-07-01-funds-orders-round2-design.md`

**Base:** `main` at `1072697`。**Branch:** `refactor/funds-orders-round2`。

---

## 全局约定(每个 Task 都遵守)

- **业务不断硬 gate**:每个 commit 结束前必须 `tsc 0 + demo:all 10/10 + verify:coa PASS`,不到不 commit。
- **Commit 用显式路径**(`git add <files>`),**禁止 `git add -A`**。
- **禁区**:`src/modules/clearing-settle/reconciliation/` 的核对语义(五公式 / run/case scoreboard / CoA snapshot)一行不动 —— 只换数据源。
- **硬闸命令**(标准三连,下文简称"跑硬闸"):
  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npx tsc --noEmit -p tsconfig.json
  npm run demo:all 2>&1 | tail -14
  DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 npm run verify:coa 2>&1 | tail -4
  ```
  期望:tsc 静默(0 error);demo:all `asserts: 10/10 PASS`;verify:coa `ALL INVARIANTS PASS`。
- **前置**:main 栈已起(TB 在 3003,DB `/tmp/exchange_js_main/dev.db`)。若 demo 报 "assets not seeded" 或 TB 连不上,先 `bash scripts/stack.sh up main` + `npm run db:biz:init`。

---

## 文件结构地图(改造前 → 改造后)

**Rename(C1)**:
- `internal_funds` 表 → `funds_orders`;model `InternalFund` → `FundsOrder`
- 约 13 个 src 文件引用 `InternalFund` / `internalFund` 需批量 replace

**新建**:
- `src/modules/funds-orders/dto/funds-order.dto.ts` — 枚举 + CreateInput(C1)
- `src/modules/funds-orders/constants/funds-order-transitions.constant.ts` — 4 转移表(C1)
- `src/modules/funds-orders/funds-order.service.ts` — 数据 owner(C1)
- `src/modules/funds-orders/funds-order.service.spec.ts` — 单测(C1)
- `src/modules/funds-orders/funds-orders.module.ts`(C1)
- `src/modules/clearing-settle/reconciliation/data-source/funds-order-source.repo.ts` — 对账 repo(C4)
- `src/modules/funds-orders/funds-orders.admin.controller.ts` — 统一 admin(C6)
- `admin-web/src/pages/FundsOrderList.tsx` / `FundsOrderDetail.tsx`(C6)
- `admin-web/src/utils/fundsOrderStatusMap.ts` — 双语 helper(C6)

**删除**:
- payin/payout: service + dto + events + controller(C3)
- 5 结算 workflow + outstanding/fee-accrual/settlement-batch service + InternalTransaction 全套(C5)
- funds-flow.service.ts 整个文件(C5)
- admin-web PayinList/Detail、PayoutList/Detail(C6)

---

## Task C0: 建分支 + 基线锚定

**Files:** 无代码改动。

- [ ] **Step 1: 确认 main 干净且在正确起点**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git log --oneline main -1
git status --short | wc -l | tr -d ' '
```
Expected: HEAD = `527be6b`(spec commit)或 `1072697`;dirty = `0`。
> 注:spec commit 527be6b 已在 main 上,基于它建分支即可。

- [ ] **Step 2: 建分支**

Run:
```bash
git checkout -b refactor/funds-orders-round2
git branch --show-current
```
Expected: `refactor/funds-orders-round2`

- [ ] **Step 3: 锚定基线 —— 跑硬闸确认起点全绿**

Run 硬闸三连(见全局约定)。
Expected: tsc 0;demo:all 10/10;verify:coa PASS。
> 若 demo 报 seed 缺失,先 `cd Exchange_js && bash scripts/stack.sh up main && npm run db:biz:init`,再重跑。这是 Round 2 的黄金基线,必须绿了才动手。

---

## Task C1: schema rename + FundsOrder 数据层

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`(model InternalFund → FundsOrder + 加 depositTransactionId + 删 internalTransactionId 关系)
- Create: `Exchange_js/prisma/migrations/20260701120000_funds_orders_rename/migration.sql`
- Create: `Exchange_js/src/modules/funds-orders/dto/funds-order.dto.ts`
- Create: `Exchange_js/src/modules/funds-orders/constants/funds-order-transitions.constant.ts`
- Create: `Exchange_js/src/modules/funds-orders/funds-order.service.ts`
- Create: `Exchange_js/src/modules/funds-orders/funds-order.service.spec.ts`
- Create: `Exchange_js/src/modules/funds-orders/funds-orders.module.ts`
- Modify: `Exchange_js/src/app.module.ts`(注册 FundsOrdersModule)
- Modify: ~13 个引用 `InternalFund` 的文件(批量 rename import + type)

### 说明:C1 分两半

C1a = schema/migration/service 新建(funds_orders 表就绪 + FundsOrderService 可用,但没人调用它,legacy internal_funds 逻辑仍跑在 rename 后的表上)。
C1b = 把全库 `InternalFund` 符号 rename 成 `FundsOrder`(纯机械,让 tsc 过)。

C1 完成后,**功能零变化**(只是表名 + 符号名换了),demo:all 必须仍 10/10。

- [ ] **Step 1: 改 schema —— model InternalFund 改名 FundsOrder + 调整 FK**

打开 `Exchange_js/prisma/schema.prisma`,把 `model InternalFund { ... @@map("internal_funds") }` 整块替换为(注意:删掉 `internalTransactionId` 及其 relation,加 `depositTransactionId` 及 relation,`@@map` 改成 `funds_orders`,legSeq 默认 1):

```prisma
model FundsOrder {
  id                    String                 @id @default(uuid())
  fundsOrderNo          String                 @unique
  depositTransactionId  String?
  swapTransactionId     String?
  withdrawTransactionId String?
  legSeq                Int                    @default(1)
  attempt               Int                    @default(1)
  status                String
  assetId               String
  amount                Decimal
  feeAmount             Decimal                @default(0)
  netAmount             Decimal
  fromWalletId          String?
  fromAddress           String?
  fromIban              String?
  toWalletId            String?
  toAddress             String?
  toIban                String?
  txHash                String?
  confirmations         Int                    @default(0)
  referenceNo           String?
  providerTxnId         String?
  nonce                 String?
  blockNo               String?
  gasUsed               String?
  effectiveGasPrice     String?
  sentAt                DateTime?
  confirmedAt           DateTime?
  completedAt           DateTime?
  statusHistory         String?
  createdAt             DateTime               @default(now())
  updatedAt             DateTime               @updatedAt
  deposit               DepositTransaction?    @relation("DepositFundsOrders", fields: [depositTransactionId], references: [id], onDelete: SetNull)
  swapTransaction       SwapTransaction?       @relation("SwapFundsOrders", fields: [swapTransactionId], references: [id], onDelete: Cascade)
  withdrawTransaction   WithdrawTransaction?   @relation("WithdrawFundsOrders", fields: [withdrawTransactionId], references: [id], onDelete: Cascade)
  asset                 Asset                  @relation(fields: [assetId], references: [id])
  fromWallet            Wallet?                @relation("FundsOrderFromWallet", fields: [fromWalletId], references: [id])
  toWallet              Wallet?                @relation("FundsOrderToWallet", fields: [toWalletId], references: [id])
  auditLogs             InternalFundAuditLog[]

  @@unique([swapTransactionId, legSeq, attempt])
  @@index([depositTransactionId])
  @@index([swapTransactionId, legSeq])
  @@index([withdrawTransactionId])
  @@index([status])
  @@index([txHash])
  @@index([createdAt])
  @@map("funds_orders")
}
```

> 注意:`closedOutstandings` / `closedFeeAccruals` 反向关系**先保留在对端 model 引用不动**(它们指向 Outstanding/FeeAccrual,C5 才删)。这里 FundsOrder 内部去掉了这两个反向 relation 字段 —— 需同步改 Outstanding/FeeAccrual model 里的 `closedByInternalFund` 关系名。**为降低 C1 风险,改法**:把 Outstanding model 里 `closedByInternalFund InternalFund? @relation(...)` 的类型 `InternalFund` 改成 `FundsOrder`,relation 名不变,并在 FundsOrder model 末尾补回:
> ```prisma
>   closedOutstandings    Outstanding[]
>   closedFeeAccruals     FeeAccrual[]           @relation("FeeAccrualClosedByFund")
> ```
> (C5 删 Outstanding/FeeAccrual 时再一并清)。

- [ ] **Step 2: 改所有对端 model 的反向关系名 + 类型**

在 schema.prisma 里搜索这些反向关系,把类型 `InternalFund` → `FundsOrder`,relation 名同步(searchable):
- `DepositTransaction` model:**新增** `fundsOrders FundsOrder[] @relation("DepositFundsOrders")`
- `SwapTransaction` model:`internalFunds InternalFund[] @relation("SwapInternalFunds")` → `fundsOrders FundsOrder[] @relation("SwapFundsOrders")`
- `WithdrawTransaction` model:`internalFunds InternalFund[] @relation("WithdrawInternalFunds")` → `fundsOrders FundsOrder[] @relation("WithdrawFundsOrders")`
- `Asset` model:`internalFunds InternalFund[]` → `fundsOrders FundsOrder[]`
- `Wallet` model:`internalFundsFrom InternalFund[] @relation("InternalFundFromWallet")` → `fundsOrdersFrom FundsOrder[] @relation("FundsOrderFromWallet")`;`internalFundsTo ... "InternalFundToWallet"` → `fundsOrdersTo ... "FundsOrderToWallet"`
- `InternalFundAuditLog` model:`internalFund InternalFund @relation(...)` → `fundsOrder FundsOrder @relation(...)`(字段名 `internalFundId` 可保留,relation 类型改 FundsOrder)
- `InternalTransaction` model:删掉 `internalFunds InternalFund[]` 反向字段(因为 FundsOrder 不再有 internalTransactionId)

Run(校验 schema 合法):
```bash
cd Exchange_js && npx prisma validate 2>&1 | tail -3
```
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 3: 写 migration SQL**

Create `Exchange_js/prisma/migrations/20260701120000_funds_orders_rename/migration.sql`:
```sql
-- rename 主表
ALTER TABLE "internal_funds" RENAME TO "funds_orders";
ALTER TABLE "funds_orders" RENAME COLUMN "internalFundNo" TO "fundsOrderNo";

-- 加 depositTransactionId FK 列
ALTER TABLE "funds_orders" ADD COLUMN "depositTransactionId" TEXT;
CREATE INDEX "funds_orders_depositTransactionId_idx" ON "funds_orders"("depositTransactionId");

-- drop 老 internalTransactionId 列(SQLite 3.35+ 支持)
DROP INDEX IF EXISTS "internal_funds_internalTransactionId_idx";
ALTER TABLE "funds_orders" DROP COLUMN "internalTransactionId";

-- 重建 swap 唯一约束(legSeq+attempt)
DROP INDEX IF EXISTS "internal_funds_swapTransactionId_idx";
CREATE INDEX "funds_orders_swapTransactionId_legSeq_idx" ON "funds_orders"("swapTransactionId", "legSeq");
CREATE UNIQUE INDEX "funds_orders_swapTransactionId_legSeq_attempt_key" ON "funds_orders"("swapTransactionId", "legSeq", "attempt");
```

> 其余老 index(status/txHash/createdAt/withdrawTransactionId)在 rename 表后自动跟随,无需重建。若 apply 时报 index 名冲突,加 `DROP INDEX IF EXISTS "internal_funds_xxx_idx"` 后 `CREATE INDEX "funds_orders_xxx_idx"`。

- [ ] **Step 4: apply migration + regenerate client**

Run:
```bash
cd Exchange_js
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" bash scripts/apply-local-migrations.sh 2>&1 | tail -8
npm run prisma:generate 2>&1 | tail -3
```
Expected: migration applied;`Generated Prisma Client`。

Run(验证表名换了):
```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('internal_funds','funds_orders');"
```
Expected: 只输出 `funds_orders`。

- [ ] **Step 5: 批量 rename src 里的 `prisma.internalFund` → `prisma.fundsOrder`**

这 13 个文件里所有 `this.prisma.internalFund` / `prisma.internalFund` 改成 `this.prisma.fundsOrder`。用逐个文件 replace(**不用 sed 全局**,避免误伤 spec 里的字符串):
```bash
cd Exchange_js
grep -rln "prisma\.internalFund\b" src/ --include="*.ts"
```
对每个命中文件,把 `.internalFund` → `.fundsOrder`,`internalFundNo` 字段名 → `fundsOrderNo`(where/data/select 里)。

> 这一步纯机械,目标是让 tsc 过。Prisma client 现在只有 `fundsOrder` delegate,没有 `internalFund`。

- [ ] **Step 6: 建 DTO(新状态机枚举)**

Create `Exchange_js/src/modules/funds-orders/dto/funds-order.dto.ts`:
```typescript
export enum FundsOrderStatus {
  CREATED = 'CREATED',
  SUBMITTED = 'SUBMITTED',
  CONFIRMING = 'CONFIRMING',
  CONFIRMED = 'CONFIRMED',
  CLEARED = 'CLEARED',
  FAILED = 'FAILED',
  TIMEOUT = 'TIMEOUT',
}

export enum FundsOrderAction {
  SUBMIT = 'SUBMIT',
  OBSERVE_CONFIRMING = 'OBSERVE_CONFIRMING',
  CONFIRM = 'CONFIRM',
  CLEAR = 'CLEAR',
  FAIL = 'FAIL',
  TIMEOUT = 'TIMEOUT',
}

export type FundsOrderDirection = 'IN' | 'OUT' | 'INTERNAL';
export type FundsOrderAssetType = 'CRYPTO' | 'FIAT';

export interface CreateFundsOrderInput {
  // 三者恰好一个非空
  depositTransactionId?: string;
  withdrawTransactionId?: string;
  swapTransactionId?: string;
  legSeq?: number; // 默认 1
  attempt?: number; // 默认 1
  assetId: string;
  amount: string;
  feeAmount?: string;
  netAmount?: string;
  fromWalletId?: string | null;
  fromAddress?: string | null;
  fromIban?: string | null;
  toWalletId?: string | null;
  toAddress?: string | null;
  toIban?: string | null;
  txHash?: string | null;
  referenceNo?: string | null;
  providerTxnId?: string | null;
  initialStatus?: FundsOrderStatus; // 默认 CREATED
  traceId?: string;
}
```

- [ ] **Step 7: 建转移表**

Create `Exchange_js/src/modules/funds-orders/constants/funds-order-transitions.constant.ts`:
```typescript
import { FundsOrderAction, FundsOrderStatus, FundsOrderDirection, FundsOrderAssetType } from '../dto/funds-order.dto';

type Transitions = Partial<Record<FundsOrderStatus, Partial<Record<FundsOrderAction, FundsOrderStatus>>>>;

// crypto OUT / INTERNAL — 全 5 hop
export const CRYPTO_OUT_TRANSITIONS: Transitions = {
  [FundsOrderStatus.CREATED]: {
    [FundsOrderAction.SUBMIT]: FundsOrderStatus.SUBMITTED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
  },
  [FundsOrderStatus.SUBMITTED]: {
    [FundsOrderAction.OBSERVE_CONFIRMING]: FundsOrderStatus.CONFIRMING,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
    [FundsOrderAction.TIMEOUT]: FundsOrderStatus.TIMEOUT,
  },
  [FundsOrderStatus.CONFIRMING]: {
    [FundsOrderAction.CONFIRM]: FundsOrderStatus.CONFIRMED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
    [FundsOrderAction.TIMEOUT]: FundsOrderStatus.TIMEOUT,
  },
  [FundsOrderStatus.CONFIRMED]: {
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  },
};

// fiat OUT — 无 CONFIRMING
export const FIAT_OUT_TRANSITIONS: Transitions = {
  [FundsOrderStatus.CREATED]: {
    [FundsOrderAction.SUBMIT]: FundsOrderStatus.SUBMITTED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
  },
  [FundsOrderStatus.SUBMITTED]: {
    [FundsOrderAction.CONFIRM]: FundsOrderStatus.CONFIRMED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
    [FundsOrderAction.TIMEOUT]: FundsOrderStatus.TIMEOUT,
  },
  [FundsOrderStatus.CONFIRMED]: {
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  },
};

// crypto IN — 入口 SUBMITTED
export const CRYPTO_IN_TRANSITIONS: Transitions = {
  [FundsOrderStatus.SUBMITTED]: {
    [FundsOrderAction.OBSERVE_CONFIRMING]: FundsOrderStatus.CONFIRMING,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
  },
  [FundsOrderStatus.CONFIRMING]: {
    [FundsOrderAction.CONFIRM]: FundsOrderStatus.CONFIRMED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
  },
  [FundsOrderStatus.CONFIRMED]: {
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  },
};

// fiat IN — 入口 CONFIRMED
export const FIAT_IN_TRANSITIONS: Transitions = {
  [FundsOrderStatus.CONFIRMED]: {
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  },
};

export function getTransitionMap(direction: FundsOrderDirection, assetType: FundsOrderAssetType): Transitions {
  const isCrypto = assetType === 'CRYPTO';
  if (direction === 'IN') return isCrypto ? CRYPTO_IN_TRANSITIONS : FIAT_IN_TRANSITIONS;
  return isCrypto ? CRYPTO_OUT_TRANSITIONS : FIAT_OUT_TRANSITIONS;
}

export const TERMINAL_STATUSES = new Set<FundsOrderStatus>([
  FundsOrderStatus.CLEARED,
  FundsOrderStatus.FAILED,
  FundsOrderStatus.TIMEOUT,
]);
```

- [ ] **Step 8: 写 FundsOrderService 单测(TDD 先行)**

Create `Exchange_js/src/modules/funds-orders/funds-order.service.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FundsOrderService } from './funds-order.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FundsOrderAction, FundsOrderStatus } from './dto/funds-order.dto';

describe('FundsOrderService', () => {
  let service: FundsOrderService;
  let prisma: any;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    const fundsOrderDelegate = {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    };
    prisma = {
      fundsOrder: fundsOrderDelegate,
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    emitter = { emit: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        FundsOrderService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = mod.get(FundsOrderService);
  });

  it('create rejects when zero parent FK provided', async () => {
    await expect(
      service.create({ assetId: 'a1', amount: '1' } as any),
    ).rejects.toThrow(/exactly one parent/i);
  });

  it('create rejects when two parent FKs provided', async () => {
    await expect(
      service.create({ depositTransactionId: 'd1', swapTransactionId: 's1', assetId: 'a1', amount: '1' } as any),
    ).rejects.toThrow(/exactly one parent/i);
  });

  it('create inserts row + emits with oldStatus=null', async () => {
    prisma.fundsOrder.create.mockResolvedValue({
      id: 'fo1', fundsOrderNo: 'FO1', depositTransactionId: 'd1',
      swapTransactionId: null, withdrawTransactionId: null,
      legSeq: 1, attempt: 1, status: 'SUBMITTED',
    });
    const fo = await service.create({ depositTransactionId: 'd1', assetId: 'a1', amount: '1', initialStatus: FundsOrderStatus.SUBMITTED });
    expect(fo.status).toBe('SUBMITTED');
    expect(emitter.emit).toHaveBeenCalledWith(
      'funds_order.status.changed',
      expect.objectContaining({ oldStatus: null, newStatus: 'SUBMITTED', parent: expect.objectContaining({ depositTransactionId: 'd1' }) }),
    );
  });

  it('advance rejects illegal transition', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CREATED', depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
    });
    // CREATED + CONFIRM 非法(crypto OUT)
    await expect(service.advance('fo1', FundsOrderAction.CONFIRM, 'SYSTEM')).rejects.toThrow(/invalid transition/i);
  });

  it('advance CREATED --SUBMIT--> SUBMITTED + emits', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CREATED', depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
    });
    prisma.fundsOrder.update.mockResolvedValue({
      id: 'fo1', status: 'SUBMITTED', depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
      legSeq: 1, attempt: 1,
    });
    const fo = await service.advance('fo1', FundsOrderAction.SUBMIT, 'SYSTEM');
    expect(fo.status).toBe('SUBMITTED');
    expect(emitter.emit).toHaveBeenCalledWith(
      'funds_order.status.changed',
      expect.objectContaining({ oldStatus: 'CREATED', newStatus: 'SUBMITTED' }),
    );
  });

  it('advance rejects when already terminal', async () => {
    prisma.fundsOrder.findUnique.mockResolvedValue({
      id: 'fo1', status: 'CLEARED', depositTransactionId: 'd1', withdrawTransactionId: null, swapTransactionId: null,
      legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'FIAT' },
    });
    await expect(service.advance('fo1', FundsOrderAction.CLEAR, 'SYSTEM')).rejects.toThrow(/terminal|invalid transition/i);
  });
});
```

- [ ] **Step 9: Run 单测确认 fail**

Run:
```bash
cd Exchange_js && npx jest funds-order.service --silent 2>&1 | tail -8
```
Expected: FAIL(FundsOrderService 还没写)。

- [ ] **Step 10: 写 FundsOrderService**

Create `Exchange_js/src/modules/funds-orders/funds-order.service.ts`:
```typescript
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../common/utils/no-generator.util';
import {
  CreateFundsOrderInput,
  FundsOrderAction,
  FundsOrderStatus,
  FundsOrderDirection,
  FundsOrderAssetType,
} from './dto/funds-order.dto';
import { getTransitionMap, TERMINAL_STATUSES } from './constants/funds-order-transitions.constant';

type Tx = Prisma.TransactionClient;

@Injectable()
export class FundsOrderService {
  private readonly logger = new Logger(FundsOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private parentOf(row: { depositTransactionId?: string | null; withdrawTransactionId?: string | null; swapTransactionId?: string | null }) {
    return {
      depositTransactionId: row.depositTransactionId ?? undefined,
      withdrawTransactionId: row.withdrawTransactionId ?? undefined,
      swapTransactionId: row.swapTransactionId ?? undefined,
    };
  }

  private directionOf(row: { depositTransactionId?: string | null; withdrawTransactionId?: string | null; swapTransactionId?: string | null }): FundsOrderDirection {
    if (row.depositTransactionId) return 'IN';
    if (row.withdrawTransactionId) return 'OUT';
    return 'INTERNAL'; // swap
  }

  async create(input: CreateFundsOrderInput, tx?: Tx) {
    const fks = [input.depositTransactionId, input.withdrawTransactionId, input.swapTransactionId].filter(Boolean);
    if (fks.length !== 1) {
      throw new BadRequestException('FundsOrder requires exactly one parent FK (deposit/withdraw/swap)');
    }
    const client: any = tx ?? this.prisma;
    const status = input.initialStatus ?? FundsOrderStatus.CREATED;
    const row = await client.fundsOrder.create({
      data: {
        fundsOrderNo: generateReferenceNo('FO'),
        depositTransactionId: input.depositTransactionId ?? null,
        withdrawTransactionId: input.withdrawTransactionId ?? null,
        swapTransactionId: input.swapTransactionId ?? null,
        legSeq: input.legSeq ?? 1,
        attempt: input.attempt ?? 1,
        status,
        assetId: input.assetId,
        amount: new Prisma.Decimal(input.amount),
        feeAmount: new Prisma.Decimal(input.feeAmount ?? '0'),
        netAmount: new Prisma.Decimal(input.netAmount ?? input.amount),
        fromWalletId: input.fromWalletId ?? null,
        fromAddress: input.fromAddress ?? null,
        fromIban: input.fromIban ?? null,
        toWalletId: input.toWalletId ?? null,
        toAddress: input.toAddress ?? null,
        toIban: input.toIban ?? null,
        txHash: input.txHash ?? null,
        referenceNo: input.referenceNo ?? null,
        providerTxnId: input.providerTxnId ?? null,
        statusHistory: JSON.stringify([{ toStatus: status, action: 'CREATE', at: new Date().toISOString() }]),
      },
    });
    this.eventEmitter.emit('funds_order.status.changed', {
      fundsOrderId: row.id,
      fundsOrderNo: row.fundsOrderNo,
      parent: this.parentOf(row),
      legSeq: row.legSeq,
      attempt: row.attempt,
      oldStatus: null,
      newStatus: row.status,
      traceId: input.traceId,
    });
    return row;
  }

  async advance(id: string, action: FundsOrderAction, operatorId: string, tx?: Tx) {
    const run = async (client: any) => {
      const row = await client.fundsOrder.findUnique({ where: { id }, include: { asset: true } });
      if (!row) throw new NotFoundException(`FundsOrder ${id} not found`);
      const current = row.status as FundsOrderStatus;
      if (TERMINAL_STATUSES.has(current)) {
        throw new BadRequestException(`FundsOrder ${id} already terminal (${current}) — invalid transition`);
      }
      const direction = this.directionOf(row);
      const assetType = (row.asset?.type ?? 'CRYPTO').toUpperCase() as FundsOrderAssetType;
      const map = getTransitionMap(direction, assetType);
      const next = map[current]?.[action];
      if (!next) {
        throw new BadRequestException(`Invalid transition: ${current} --${action}--> (direction=${direction}, asset=${assetType})`);
      }
      const history = row.statusHistory ? JSON.parse(row.statusHistory) : [];
      history.push({ fromStatus: current, toStatus: next, action, operatorId, at: new Date().toISOString() });
      const updated = await client.fundsOrder.update({
        where: { id },
        data: { status: next, statusHistory: JSON.stringify(history) },
      });
      return { updated, oldStatus: current, newStatus: next };
    };

    const { updated, oldStatus, newStatus } = tx ? await run(tx) : await this.prisma.$transaction(run);

    this.eventEmitter.emit('funds_order.status.changed', {
      fundsOrderId: updated.id,
      fundsOrderNo: updated.fundsOrderNo,
      parent: this.parentOf(updated),
      legSeq: updated.legSeq,
      attempt: updated.attempt,
      oldStatus,
      newStatus,
      traceId: undefined,
    });
    return updated;
  }

  async findById(id: string, tx?: Tx) {
    const client: any = tx ?? this.prisma;
    return client.fundsOrder.findUnique({ where: { id }, include: { asset: true } });
  }

  async findByParent(
    parent: { depositTransactionId?: string; withdrawTransactionId?: string; swapTransactionId?: string },
    filter?: { legSeq?: number; attempt?: number; status?: FundsOrderStatus },
    tx?: Tx,
  ) {
    const client: any = tx ?? this.prisma;
    return client.fundsOrder.findMany({
      where: {
        ...(parent.depositTransactionId && { depositTransactionId: parent.depositTransactionId }),
        ...(parent.withdrawTransactionId && { withdrawTransactionId: parent.withdrawTransactionId }),
        ...(parent.swapTransactionId && { swapTransactionId: parent.swapTransactionId }),
        ...(filter?.legSeq !== undefined && { legSeq: filter.legSeq }),
        ...(filter?.attempt !== undefined && { attempt: filter.attempt }),
        ...(filter?.status && { status: filter.status }),
      },
      include: { asset: true },
      orderBy: [{ legSeq: 'asc' }, { attempt: 'asc' }],
    });
  }
}
```

- [ ] **Step 11: Run 单测确认 pass**

Run:
```bash
cd Exchange_js && npx jest funds-order.service --silent 2>&1 | tail -8
```
Expected: PASS(6 tests)。

- [ ] **Step 12: 建 module + 注册**

Create `Exchange_js/src/modules/funds-orders/funds-orders.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { FundsOrderService } from './funds-order.service';

@Module({
  imports: [PrismaModule],
  providers: [FundsOrderService],
  exports: [FundsOrderService],
})
export class FundsOrdersModule {}
```

Modify `Exchange_js/src/app.module.ts`:在 imports 数组里(FundsLayerModule 附近)加 `FundsOrdersModule`,并在顶部 import。

> 若 PrismaModule 路径不确定,grep 现有 module 的 import 写法对齐。

- [ ] **Step 13: 跑硬闸 + commit C1**

Run 硬闸三连 + `npx jest funds-order.service`.
Expected: 全绿;demo:all 10/10。

> ⚠️ 此时 legacy internal-fund 逻辑仍跑(通过 rename 后的 fundsOrder delegate),FundsOrderService 还没被调用。demo:all 必须仍 10/10 —— 证明 rename 零功能损伤。

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git add Exchange_js/prisma/schema.prisma \
        Exchange_js/prisma/migrations/20260701120000_funds_orders_rename/migration.sql \
        Exchange_js/src/modules/funds-orders/ \
        Exchange_js/src/app.module.ts \
        $(git -C Exchange_js diff --name-only | sed 's#^#Exchange_js/#')
git commit -m "C1: rename internal_funds → funds_orders + FundsOrderService (data owner)"
```
> 注:最后一行 `$(...)` 把 Step 5 批量 rename 的文件都 add 进来。若嫌不精确,先 `git -C Exchange_js status --short` 手动列出显式路径。

---

## Task C2: 3 Workflow 切 event 驱动

**Files:**
- Modify: `Exchange_js/src/common/events/domain-events.constants.ts`(加 FUNDS_ORDER_STATUS_CHANGED)
- Modify: `Exchange_js/src/modules/audit-logging/constants/audit-actions.constant.ts`(加 FUNDS_ORDER 相关 audit action)
- Modify: `Exchange_js/src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Modify: `Exchange_js/src/modules/trading/deposit-transactions/deposit-transactions.service.ts`(detected 建 funds_order)
- Modify: `Exchange_js/src/modules/trading/deposit-transactions/deposit-transactions.module.ts`(import FundsOrdersModule)
- Modify: `Exchange_js/src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
- Modify: `Exchange_js/src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`
- Modify: `Exchange_js/src/modules/trading/swap-transactions/swap-workflow.service.ts`
- Modify: `Exchange_js/src/modules/trading/swap-transactions/swap-transactions.module.ts`
- Modify: `Exchange_js/scripts/demo-lib.ts`(3 个 drive 函数改走 funds_order 状态推进)

### 说明:C2 是最大最难的一步 —— 拆成 C2a/C2b/C2c

**C2a = Deposit**、**C2b = Withdraw**、**C2c = Swap**,每个子步骤独立跑 demo:<domain> 硬闸,全绿后统一 commit。不搞 dormant handler —— 每个 workflow 一次从 legacy event 切到 funds_order event。

> 详细逐 workflow 改造代码量极大,以下给**骨架 + 关键契约**,实施 subagent 需读现有 workflow 全文对齐。核心不变量:demo:all 必须 10/10。

- [ ] **Step 1: 加 event 常量**

Modify `Exchange_js/src/common/events/domain-events.constants.ts`:在 `DOMAIN_EVENTS` 里加:
```typescript
  // ── Funds Order (unified) ──
  FUNDS_ORDER_STATUS_CHANGED: {
    name: 'funds_order.status.changed',
    emitter: 'FundsOrderService',
    subscribers: ['DepositWorkflowService', 'WithdrawWorkflowService', 'SwapWorkflowService'],
    payload: '{ fundsOrderId, fundsOrderNo, parent: {depositTransactionId?, withdrawTransactionId?, swapTransactionId?}, legSeq, attempt, oldStatus, newStatus, traceId? }',
  },
```
在 `DomainEventNames` 里加:
```typescript
  FUNDS_ORDER_STATUS_CHANGED: DOMAIN_EVENTS.FUNDS_ORDER_STATUS_CHANGED.name,
```
> legacy 的 PAYIN_* / PAYOUT_* / FUNDSFLOW_* / SWAP_SUCCEEDED / INTERNALTRANSFER_* 常量**先留着**(C3/C5 删),避免 tsc 炸。

- [ ] **Step 2: 加 audit action 常量**

Modify `Exchange_js/src/modules/audit-logging/constants/audit-actions.constant.ts`:在 `AuditActions` 里加(business 视角 action):
```typescript
  // Deposit payin (funds_order-driven)
  DEPOSIT_PAYIN_CONFIRMED: 'DEPOSIT_PAYIN_CONFIRMED',
  DEPOSIT_PAYIN_FAILED: 'DEPOSIT_PAYIN_FAILED',
  // Withdraw payout (funds_order-driven)
  WITHDRAW_PAYOUT_INITIATED: 'WITHDRAW_PAYOUT_INITIATED',
  WITHDRAW_PAYOUT_CONFIRMED: 'WITHDRAW_PAYOUT_CONFIRMED',
  WITHDRAW_PAYOUT_FAILED: 'WITHDRAW_PAYOUT_FAILED',
```
> `SWAP_CREATED / SWAP_SUCCEEDED / SWAP_LEG_POSTED / SWAP_LEG_RETRIED / SWAP_LEG_STUCK` 已存在,复用。`DEPOSIT_CREATED / WITHDRAW_CREATED / WITHDRAW_SUCCESS / WITHDRAW_LOCK_RELEASED` 已存在,复用。

- [ ] **Step 3 (C2a): DepositWorkflow 切 funds_order event**

在 `deposit-workflow.service.ts`:
1. constructor 注入 `private readonly fundsOrders: FundsOrderService`(import from `../../funds-orders/funds-order.service`)。
2. 删 `@OnEvent('payin.created') handlePayinCreated` 和 `@OnEvent('payin.status.changed') handlePayinStatusChanged`,替换为:
```typescript
@OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
async handleFundsOrderChanged(event: {
  fundsOrderId: string; fundsOrderNo: string;
  parent: { depositTransactionId?: string; withdrawTransactionId?: string; swapTransactionId?: string };
  legSeq: number; attempt: number; oldStatus: string | null; newStatus: string; traceId?: string;
}) {
  if (!event.parent.depositTransactionId) return; // 只关心 payin
  const depositId = event.parent.depositTransactionId;
  switch (event.newStatus) {
    case FundsOrderStatus.CONFIRMED:
      await this.onPayinConfirmed(depositId, event.fundsOrderId);
      break;
    case FundsOrderStatus.FAILED:
    case FundsOrderStatus.TIMEOUT:
      await this.onPayinFailed(depositId, event.fundsOrderId);
      break;
  }
}
```
3. 把老 `orchestratePayinConfirmed` 逻辑迁进新 `onPayinConfirmed(depositId, fundsOrderId)`:audit `DEPOSIT_PAYIN_CONFIRMED` → TB posting(复用现有 `executeDepositAccounting`)→ `await this.fundsOrders.advance(fundsOrderId, FundsOrderAction.CLEAR, 'SYSTEM')` → deposit 推 COMPLIANCE_PENDING。老 `orchestratePayinFailed` → `onPayinFailed`。
4. 删 `orchestratePayinDetected`(建 deposit 的活儿移到 `deposit-transactions.service.detected`)。

在 `deposit-transactions.service.ts` 的 `detected()`(或建单入口)里:建 deposit 后调 `fundsOrders.create({ depositTransactionId: deposit.id, assetId, amount, initialStatus: isCrypto ? SUBMITTED : CONFIRMED, ... }, tx)` + audit `DEPOSIT_CREATED`。

`deposit-transactions.module.ts`:imports 加 `FundsOrdersModule`。

- [ ] **Step 4 (C2a): 改 demo-lib driveDeposit + 跑 demo:deposit**

`scripts/demo-lib.ts` 的 `driveDeposit`:建 deposit → (crypto) `fundsOrders.advance(foId, OBSERVE_CONFIRMING)` → `advance(foId, CONFIRM)`;(fiat)直接 `advance(foId, CONFIRM)`(初始 CONFIRMED 则跳过)。handler 自动 CLEAR。

Run:
```bash
cd Exchange_js && npm run demo:deposit 2>&1 | tail -8
```
Expected: 6 SUCCESS。

- [ ] **Step 5 (C2b): WithdrawWorkflow 切 funds_order event**

在 `withdraw-workflow.service.ts`:
1. 注入 `fundsOrders: FundsOrderService`。
2. 删 `@OnEvent(PAYOUT_STATUS_CONFIRMED) handlePayoutConfirmed` + `@OnEvent(EVT_PAYOUT_FAILED/TIMEOUT/RETURNED)` handlers,替换为统一 `handleFundsOrderChanged`(filter `event.parent.withdrawTransactionId`)。
3. `initiatePayoutPhase`:改用 `fundsOrders.create({ withdrawTransactionId, legSeq: 1, initialStatus: CREATED, ... })`(payout 主腿)+ 有 fee 时 legSeq: 2。删 `payoutsService.create` 调用。
4. handler CONFIRMED(主腿)→ audit `WITHDRAW_PAYOUT_CONFIRMED` + TB posting + `advance(foId, CLEAR)`;CLEARED(主+fee)→ audit `WITHDRAW_SUCCESS` + `withdrawService.updateStatus(SUCCESS)` + releaseLock;FAILED/TIMEOUT → `WITHDRAW_PAYOUT_FAILED` + releaseLock(退回,堵 P6)。
5. 删 `FundsFlowService` 里 withdraw fee-fund 相关调用(`createWithdrawFeeFund`/`setWithdrawFeeFundStatus`)→ 改用 fundsOrders fee 腿。

`withdraw-transactions.module.ts`:imports 加 `FundsOrdersModule`。

Run:
```bash
cd Exchange_js && npm run demo:withdraw 2>&1 | tail -8
```
Expected: 5 withdrawals SUCCESS。

- [ ] **Step 6 (C2c): SwapWorkflow 切 funds_order event**

在 `swap-workflow.service.ts`:
1. 注入 `fundsOrders: FundsOrderService`,删 `FundsFlowService` 依赖里 swap 部分。
2. `executeSwap`:`fundsOrders.create({ swapTransactionId, legSeq: 1, attempt: 1, initialStatus: CREATED, ... })`(只建 leg1)。删 `createSwapLeg`。
3. 新 `@OnEvent(FUNDS_ORDER_STATUS_CHANGED) handleFundsOrderChanged`(filter `event.parent.swapTransactionId`):
   - CLEARED → audit `SWAP_LEG_POSTED` → leg<4? `fundsOrders.create({legSeq: legSeq+1, ...})` 建下一腿 : 全 CLEARED → audit `SWAP_SUCCEEDED` + `swapService.updateStatus(SUCCESS)` + 解 TB 锁。
   - FAILED/TIMEOUT → self-heal:attempt<3? `fundsOrders.create({legSeq, attempt: attempt+1, ...})` + audit `SWAP_LEG_RETRIED` : `swap.needsReview=true` + audit `SWAP_LEG_STUCK`。
4. `advanceLeg`(controller 同步入口)改成薄封装:`await this.fundsOrders.advance(foId, mapAction(action), operator)`。保留供 admin/demo 手动推进。
5. 删 `onLegCleared`/`onLegFailedSelfHeal` 里对 internal_funds 表的直接操作,改为读 `fundsOrders.findByParent`。TB posting 逻辑(SwapLegAccounting)保留。

`swap-transactions.module.ts`:imports 加 `FundsOrdersModule`。

Run:
```bash
cd Exchange_js && npm run demo:swap 2>&1 | tail -8
```
Expected: 3 swaps SUCCESS。

- [ ] **Step 7: 跑硬闸 + commit C2**

Run 硬闸三连。Expected: 全绿;demo:all 10/10。

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git -C Exchange_js status --short  # 确认改动文件清单
git add <上面 Files 列出的每个显式路径>
git commit -m "C2: 3 workflows event-driven on funds_order.status.changed (no dormant handler)"
```

---

## Task C3: 删 legacy payin/payout

**Files:**
- Delete: `Exchange_js/src/modules/asset-treasury/payins/payins.service.ts` + `.spec.ts` + `dto/payin.dto.ts` + `events/payin.events.ts` + `payins.controller.ts` + `payins.admin.controller.ts`(若存在)
- Delete: `Exchange_js/src/modules/asset-treasury/payouts/payouts.service.ts` + `.spec.ts` + `dto/payout.dto.ts` + `events/payout.events.ts` + `errors.ts` + `constants/payout-events.constant.ts` + `payouts.controller.ts`
- Delete: `Exchange_js/src/orchestrators/payout-closeout-repair.controller.ts`
- Modify: `payins.module.ts` / `payouts.module.ts`(清空 legacy provider)
- Modify: `Exchange_js/src/common/events/domain-events.constants.ts`(删 PAYIN_* / PAYOUT_* 常量)
- Modify: `Exchange_js/prisma/schema.prisma`(删 Payin/Payout model + deposit.payinId/withdraw.payoutId 列)
- Create: migration `20260701130000_drop_payin_payout/migration.sql`
- Modify: RBAC catalog(删 treasury/payins、payouts 权限)

- [ ] **Step 1: grep 确认 legacy 已无引用**

Run:
```bash
cd Exchange_js
grep -rn "PayinsService\|PayoutsService\|PayinStatus\|PayinAction\|PayoutStatus\|PayoutAction" src/ --include="*.ts" | grep -v "\.spec\.ts"
```
Expected: 只剩 payins/payouts 模块自身文件(将被删)。若有 workflow 残留 → 回 C2 补。

- [ ] **Step 2: 删文件**

Run `git rm` 每个 Delete 清单文件。module 文件改成只保留能编译的空壳(或一并删,若无别的 provider)。

- [ ] **Step 3: 删 event 常量 + schema model + FK 列**

domain-events.constants.ts 删 PAYIN_CREATED/PAYIN_STATUS_CHANGED/PAYOUT_CREATED/PAYOUT_STATUS_CONFIRMED(DOMAIN_EVENTS + DomainEventNames 两处)。
schema.prisma 删 `model Payin` + `model Payout` + `DepositTransaction.payinId` + `WithdrawTransaction.payoutId/payoutNo/payoutRequestedAt` + 对端反向关系。

Create migration `20260701130000_drop_payin_payout/migration.sql`:
```sql
DROP TABLE "payin";
DROP TABLE "payout";
ALTER TABLE "deposit_transactions" DROP COLUMN "payinId";
ALTER TABLE "withdraw_transactions" DROP COLUMN "payoutId";
ALTER TABLE "withdraw_transactions" DROP COLUMN "payoutNo";
ALTER TABLE "withdraw_transactions" DROP COLUMN "payoutRequestedAt";
```
> ⚠️ **先确认 reconciliation 没读 payin/payout**。若 C4 还没做,recon 仍读 `prisma.payin/payout` → tsc 炸。**故 C3 只删 service 层,DROP TABLE 挪到 C4 之后**。修正:C3 删 service+dto+event+controller,**表和 model 的 DROP 移到 C4 末尾**(recon 迁 repo 之后)。

- [ ] **Step 3 修正: C3 只删 service 层,不 DROP 表**

C3 阶段:删 service/dto/events/controller + 清 module + 删 event 常量。schema 的 Payin/Payout model **暂留**(recon 还在读),但把 `deposit.payinId`/`withdraw.payoutId` 列的**代码引用**清掉(workflow 已在 C2 不用了)。

Run 硬闸三连。Expected: 全绿。

- [ ] **Step 4: apply + regenerate + 硬闸 + commit C3**

Run:
```bash
cd Exchange_js && npm run prisma:generate 2>&1 | tail -3
```
Run 硬闸 + grep 0-hit(PayinsService/PayoutsService)。
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git add <显式路径>
git commit -m "C3: delete legacy payin/payout service+dto+event+controller (tables deferred to C4)"
```

---

## Task C4: 对账 repo 抽象 + DROP payin/payout/outstanding/feeAccrual 依赖迁移

**Files:**
- Create: `Exchange_js/src/modules/clearing-settle/reconciliation/data-source/funds-order-source.repo.ts`
- Modify: `internal-actions.service.ts`(3 处)、`leg-projection.service.ts`(3 处)、`in-transit.service.ts`(3 处)、`mock-external.adapter.ts`(1 处)、`subledger-inputs.service.ts`(2 处)
- Modify: reconciliation.module.ts(注册 repo)
- Create: migration `20260701140000_drop_payin_payout_tables/migration.sql`(此时才 DROP payin/payout 表)

> **禁区提醒**:只换数据源(raw prisma call → repo 调用),recon 五公式 / scoreboard / CoA 一行不动。

- [ ] **Step 1: 建 FundsOrderSourceRepo**

Create `funds-order-source.repo.ts`(见 spec §6.1,5 方法:findPayins/findPayouts/findInternals/findOpenOutstandings/findFeeAccruals)。每个方法内部 map funds_order 行到旧 shape(如 payinNo→fundsOrderNo),让 recon 消费方零改动。

> 关键:先读 `internal-actions.service.ts` / `leg-projection.service.ts` / `subledger-inputs.service.ts` 现有消费方读了哪些字段,repo map 时对齐这些字段。写 repo 单测覆盖 5 方法的 where 条件。

- [ ] **Step 2: 逐处替换 raw prisma call**

10 处 `prisma.payin/payout/internalFund/outstanding/feeAccrual.findMany` → 对应 repo 方法(见 spec §6.2 表)。

- [ ] **Step 3: DROP payin/payout 表(现在 recon 不读了)**

Create migration `20260701140000_drop_payin_payout_tables/migration.sql`:
```sql
DROP TABLE "payin";
DROP TABLE "payout";
```
schema.prisma 删 `model Payin` + `model Payout`。

Run apply + generate。

- [ ] **Step 4: 跑硬闸(含 recon spec)+ commit C4**

Run 硬闸 + `npx jest reconciliation --silent`。
Expected: 全绿;verify:coa PASS(证明五公式换源后等价)。
```bash
git add <显式路径>
git commit -m "C4: FundsOrderSourceRepo — recon reads funds_orders; drop payin/payout tables"
```

---

## Task C5: 清 V7/V8 结算残留

**Files(全 Delete,除 schema/module modify):**
- Delete: `funds-layer/workflow/{eod-settlement,fiat-settlement,fiat-fee-collection,deposit-aggregation,fund-transfer,internal-transfer}-workflow.service.ts` + `eod-cutoff.util.ts`
- Delete: `funds-layer/sweep/eod-settlement-sweep.service.ts`、`funds-layer/accounting/fx-eod.service.ts`
- Delete: `funds-layer/controllers/{settlement-admin,internal-transfer-admin,funds-simulate}.controller.ts`
- Delete: `funds-layer/domain/{settlement-batch,internal-transfer,fee-accrual}.service.ts` + `funds-flow.service.ts`
- Delete: `clearing-settle/outstandings/` 整个模块、`funds-layer/domain/outstanding-consumer.service.ts`、`fee-accruals.controller.ts`
- Delete: InternalTransaction model + 表 + audit log 表;Outstanding/FeeAccrual/SettlementBatch model + 表
- Modify: domain-events.constants.ts(删 FUNDSFLOW_STATUS_CHANGED / SWAP_SUCCEEDED / INTERNALTRANSFER_COMPLETED)
- Modify: app.module.ts / funds-layer.module.ts(去注册)
- Create: migration `20260701150000_drop_v7v8_settlement/migration.sql`

- [ ] **Step 1: grep 依赖扫描(确认删得干净)**

Run:
```bash
cd Exchange_js
grep -rln "FundsFlowService\|EodSettlement\|FiatSettlement\|OutstandingsService\|FeeAccrualService\|InternalTransferService\|SettlementBatchService" src/ --include="*.ts" | grep -v "\.spec\.ts"
```
列出所有引用者。每个引用者要么在删除清单里,要么需先解耦。

- [ ] **Step 2: 删文件 + 删 module 注册 + 删 event 常量**

`git rm` 全部 Delete 清单。app.module.ts 去掉 `OutstandingsModule`。funds-layer.module.ts 去掉删掉的 provider。domain-events.constants.ts 删 3 个 event 常量(FUNDSFLOW/SWAP_SUCCEEDED/INTERNALTRANSFER)。

- [ ] **Step 3: schema 删 model + migration**

schema.prisma 删 `model InternalTransaction` + `model InternalTransactionAuditLog` + `model Outstanding` + `model FeeAccrual` + `model SettlementBatch` + 所有对端反向关系。

Create migration `20260701150000_drop_v7v8_settlement/migration.sql`:
```sql
DROP TABLE "outstandings";
DROP TABLE "fee_accruals";
DROP TABLE "settlement_batches";
DROP TABLE "internal_transaction_audit_logs";
DROP TABLE "internal_transactions";
```

Run apply + generate。

- [ ] **Step 4: 跑硬闸 + grep 0-hit + commit C5**

Run 硬闸 + grep 清单(见 spec §8)。
Expected: 全绿;grep 全 0。
```bash
git add <显式路径>
git commit -m "C5: purge V7/V8 settlement residue — 5 workflows + outstanding/feeAccrual/settlementBatch + InternalTransaction"
```

---

## Task C6: Admin UI 合并(4 页 → 2 页)

**Files:**
- Create: `Exchange_js/src/modules/funds-orders/funds-orders.admin.controller.ts`
- Create: `Exchange_js/src/modules/funds-orders/dto/funds-order-query.dto.ts`
- Modify: funds-orders.module.ts(加 controller)
- Modify: RBAC catalog(加 funds-orders/read + funds-orders/repair)
- Delete: `admin-web/src/pages/{PayinList,PayinDetail,PayoutList,PayoutDetail}.tsx`
- Create: `admin-web/src/pages/{FundsOrderList,FundsOrderDetail}.tsx`
- Create: `admin-web/src/utils/fundsOrderStatusMap.ts`
- Modify: `admin-web/src/App.tsx`(路由)、`DashboardLayout.tsx`(菜单)

- [ ] **Step 1: 后端 admin controller**

Create `funds-orders.admin.controller.ts`(`@Controller('admin/funds-orders')`,3 端点:list/detail/repair),用 `FundsOrderService.findByParent` + prisma 分页。RBAC catalog 加权限 + `db:base:sync` + 重启后端(见 memory [[admin-endpoint-rbac-registration]])。

- [ ] **Step 2: 前端双语 helper**

Create `fundsOrderStatusMap.ts`:`formatFundsOrderStatusLabel(status, assetType, lang)`(见 spec §3 双语表)。

- [ ] **Step 3: 前端 2 页**

删 4 页,建 `FundsOrderList.tsx`(顶部 tab 全部/充值/提现/兑换 + 表)+ `FundsOrderDetail.tsx`(metadata + 动态字段块 + statusHistory + 关联 audit + repair 按钮)。App.tsx 路由 + DashboardLayout.tsx 菜单更新。

- [ ] **Step 4: admin build + preview 渲染验证**

Run:
```bash
cd Exchange_js/admin-web && npx tsc --noEmit && npm run build 2>&1 | tail -6
```
Expected: tsc 0 + build ✓。

用 preview 渲染 admin(见 memory [[stack-preview-ops]]:种子 admin@fiatx.com/123456 登录注入 token),截 4 张图:全部/充值/提现/兑换 tab,核对双语标签正确。

- [ ] **Step 5: 跑硬闸 + commit C6**

Run 后端硬闸 + admin build。
```bash
git add <显式路径>
git commit -m "C6: unified funds-orders admin UI (4 pages → 2 + tabs + bilingual labels)"
```

---

## Task C7: 终检 + memory + 合 main

- [ ] **Step 1: 全套 grep 0-hit 终检**

Run spec §8 全部 grep 命令。Expected: 每条 0 hit(除 .spec.ts 历史 mock)。

- [ ] **Step 2: DB 表最终状态验证**

Run:
```bash
sqlite3 /tmp/exchange_js_main/dev.db "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('payin','payout','internal_funds','outstandings','fee_accruals','settlement_batches','internal_transactions');"
```
Expected: 空。

- [ ] **Step 3: 全套硬闸 + jest 全跑**

Run 硬闸三连 + `npx jest --silent 2>&1 | tail -6`。
Expected: tsc 0;demo:all 10/10;verify:coa PASS;jest 净新失败 = 0(记录 pre-existing 失败数对比基线)。

- [ ] **Step 4: 更新 memory**

写 `funds-orders-round2-done.md` 收官 memory(标注:三合一真正完成、V7/V8 结算清除、遗产 defer 项如 RETURNED)。更新 MEMORY.md 索引。标注取代 [[funds-orders-merger-done]](Round 1)。

- [ ] **Step 5: ff-merge main**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git checkout main
git merge --ff-only refactor/funds-orders-round2
git log --oneline main -8
```
Expected: fast-forward;7 个 C1-C7 commit 上 main。

- [ ] **Step 6: main 上复跑硬闸(合并后确认)**

Run 硬闸三连。Expected: 全绿。

---

## 附录:上一轮避坑清单(实施时贴脑门)

1. **不搞 dormant handler**(Round 1 FO-8/9/10 造 stub 又 FO-11a 补,双路径混乱)—— C2 一次切干净
2. **不搞 dual-write / mirror**(Round 1 FO-13c 双写 internal_funds)—— C1 rename 不新造
3. **不搞 backfill**(rename 表继承数据)—— 零迁移
4. **删表前先撬引用者**(recon 引用先迁 repo)—— C4 在 C5 前;payin/payout 表 DROP 在 recon 迁 repo 后
5. **每 commit demo:all 硬闸**,不到 10/10 不 commit
6. **禁区**:reconciliation 核对语义一行不动,只换数据源
7. **显式路径 commit**,禁 `git add -A`

---

## Self-Review 记录

- **Spec 覆盖**:§1 overview→C0;§2 数据模型→C1;§3 状态机→C1(transitions);§4 service/event→C1+C2;§5 3 workflow→C2;§6 recon+UI→C4+C6;§7 阶段→C0-C7;§8 验收→C7。全覆盖。
- **顺序矫正**:C4(repo)在 C5(删结算表)前 —— outstanding/feeAccrual 被 recon 读,先迁 repo 才能删。payin/payout 表 DROP 也挪到 C4(recon 迁完)。
- **类型一致**:`FundsOrderStatus` / `FundsOrderAction` / `getTransitionMap` / `funds_order.status.changed` payload shape 全程一致。
- **已知留白**:C2 三 workflow 改造给的是骨架 + 契约(代码量太大无法逐行),实施 subagent 需读现有 workflow 全文对齐 —— 这是**有意的**,因为逐行贴 500 行 workflow 改造不现实,契约 + 硬闸兜底。
