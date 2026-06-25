# Phase A — 资金核心（实时 1:1 COA + 三大流）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把资金账本从「权责发生制 + 池化 + EOD 轧差」整体切换到「实时收付实现制 + 每钱包 1:1 镜像」，落地新 COA（8 code）+ provisioning + seed + 三大业务流（充值/提现/兑换）实时记账，并提供不变量自检。

**Architecture:** TigerBeetle 持有余额（每物理账户一个 TB 账户，1:1）；Prisma 持凭证（`TbTransferEvidence`）+ 账户注册表（`TbAccountRegistry`）。每笔真实转账 = 一/多条 TB transfer + 一条 evidence。客户侧 = 聚合资产(`CLIENT_ASSET`) + 每客户负债(`CLIENT_PAYABLE`/`DEPOSIT_SUSPENSE`)；公司侧 = 聚合资产(`FIRM_ASSET`) + 每账户权益(`FIRM_OPS`/`FIRM_SET`/`FIRM_FEE`/`FIRM_LIQ`)。不再创建 Outstanding/FeeAccrual，不跑 EOD/归集 cron。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle；Jest（TB 全 mock）；ts-node 脚本。设计依据：`doc-final/superpowers/specs/2026-06-25-realtime-1to1-funds-model-redesign-design.md`。

**前置约定：**
- 在 main 栈（端口 3000-3003）操作；**fresh DB，不迁历史数据**。重置：`bash scripts/stack.sh reset-main`。
- 测试命令：`npm test`（jest，TB 已 mock，无需真实 TB）。
- 业务校验脚本经包装器：`bash scripts/on-stack.sh main <script>`。
- 每个 Task 末尾 commit；commit 信息用 `feat(funds):`/`refactor(funds):`/`test(funds):` 前缀。

---

## File Structure（本期触碰的文件）

**改写（常量/地基）**
- `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts` — 8 个新 code + COA 映射
- `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts` — 新 transfer 码（删旧）
- `src/modules/asset-treasury/assets/asset-provisioning.service.ts` — 系统账户 provisioning
- `prisma/seed.business.ts` — 系统/客户账户 seed + 资本注入
- `admin-web/src/pages/ledger-account.constants.ts` — COA 展示标签

**新增**
- `scripts/verify-realtime-coa.ts` — 不变量自检脚本

**改写（三大流）**
- `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（+ `withdraw-transactions.service.ts`）
- `src/modules/trading/swap-transactions/swap-workflow.service.ts`（+ `swap-transactions.service.ts`）

**改写（停用旧机器，保留待 Phase C 删）**
- swap/withdraw 中 `outstandingsService.createForSwapSuccess()` / `feeAccrual.*` 调用点
- `src/modules/funds-layer/sweep/*` 的 `@Cron`（EOD 结算 + 充值归集）

**测试**
- `src/modules/accounting/tigerbeetle/constants/*.spec.ts`（新）
- `src/modules/asset-treasury/assets/asset-provisioning.service.spec.ts`（改）
- 三大流各自 `*.spec.ts`（改）

---

## Task 1: 新 TB 账户码常量

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`（整文件替换）
- Test: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts`（新建）

- [ ] **Step 1: 写失败测试**

```typescript
// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts
import { TB_ACCOUNT_CODES, COA_TO_TB_CODE, TB_CODE_TO_COA } from './tb-account-codes.constant';

describe('TB_ACCOUNT_CODES (real-time 1:1 COA)', () => {
  it('exposes exactly the 8 new codes', () => {
    expect(TB_ACCOUNT_CODES).toEqual({
      CLIENT_ASSET: 1,
      FIRM_ASSET: 50,
      CLIENT_PAYABLE: 100,
      DEPOSIT_SUSPENSE: 101,
      FIRM_OPS: 200,
      FIRM_SET: 201,
      FIRM_FEE: 202,
      FIRM_LIQ: 203,
    });
  });

  it('drops all legacy codes', () => {
    const names = Object.keys(TB_ACCOUNT_CODES);
    for (const dead of ['CLIENT_BANK','CLIENT_CUSTODY','TRADE_CLEARING','FIRM_TREASURY','FX_POSITION','PAID_IN_CAPITAL','RETAINED_EARNINGS','FEE_INCOME','SPREAD_INCOME','FX_UNREALIZED_PNL','FX_REALIZED_PNL']) {
      expect(names).not.toContain(dead);
    }
  });

  it('round-trips COA labels', () => {
    expect(COA_TO_TB_CODE['A.CLIENT_ASSET']).toBe(1);
    expect(COA_TO_TB_CODE['E.FIRM_FEE']).toBe(202);
    expect(TB_CODE_TO_COA[201]).toBe('E.FIRM_SET');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest tb-account-codes.constant.spec -i`
Expected: FAIL（旧常量含 CLIENT_BANK 等）

- [ ] **Step 3: 整文件替换实现**

```typescript
// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts
/**
 * TB account type codes (u16). Immutable once assigned.
 * 实时 1:1 资金模型 COA（2026-06-25 重设计）。
 * 编码段:A 资产 1–99、L 负债 100–199、E 权益 200–299。
 * 币种用 ledger 区分(AED/USDT),code 只编类型。
 */
export const TB_ACCOUNT_CODES = {
  // ── 资产 A(聚合,每币种一个,ownerType SYSTEM)──
  CLIENT_ASSET: 1, // 客户托管资产 = Σ 所有客户钱包
  FIRM_ASSET: 50, // 公司资产 = Σ 所有公司账户
  // ── 负债 L(每客户)──
  CLIENT_PAYABLE: 100, // 客户应付,与客户钱包 1:1
  DEPOSIT_SUSPENSE: 101, // 充值合规暂扣
  // ── 权益 E(每公司账户,单例)──
  FIRM_OPS: 200, // 运营/流动性(兑换对手盘)
  FIRM_SET: 201, // 法币结算户(仅法币 ledger,银行约束)
  FIRM_FEE: 202, // 手续费
  FIRM_LIQ: 203, // 流动性储备(本版挂着不用)
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

/** Human-readable COA code → TB numeric code */
export const COA_TO_TB_CODE: Record<string, number> = {
  'A.CLIENT_ASSET': TB_ACCOUNT_CODES.CLIENT_ASSET,
  'A.FIRM_ASSET': TB_ACCOUNT_CODES.FIRM_ASSET,
  'L.CLIENT_PAYABLE': TB_ACCOUNT_CODES.CLIENT_PAYABLE,
  'L.DEPOSIT_SUSPENSE': TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE,
  'E.FIRM_OPS': TB_ACCOUNT_CODES.FIRM_OPS,
  'E.FIRM_SET': TB_ACCOUNT_CODES.FIRM_SET,
  'E.FIRM_FEE': TB_ACCOUNT_CODES.FIRM_FEE,
  'E.FIRM_LIQ': TB_ACCOUNT_CODES.FIRM_LIQ,
};

/** TB numeric code → human-readable COA code */
export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest tb-account-codes.constant.spec -i`
Expected: PASS（3 passed）

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts
git commit -m "feat(funds): new 8-code COA for real-time 1:1 model"
```

> ⚠️ 此 commit 后全仓**暂不编译**（旧流引用已删的 code）。Task 2-3-8-9-10-11 把引用迁完后恢复绿。这是 Phase A 内部的红窗，**不对外交付**，到 Task 12 整体转绿。

---

## Task 2: 新 TB transfer 码常量

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`（整文件替换）

每条「跨账本」腿 = 2 条 TB transfer（客户侧 + 公司侧）；「公司内部」腿 = 1 条；「外部边界」腿 = 1 条（仅受影响侧）。

- [ ] **Step 1: 整文件替换实现**

```typescript
// src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
/** TB transfer type codes (u16). Immutable once assigned. 实时 1:1 模型。 */
export const TB_TRANSFER_CODES = {
  // ── 充值(1–9)──
  DEPOSIT_ASSET_TO_SUSPENSE: 1,   // DR CLIENT_ASSET / CR DEPOSIT_SUSPENSE
  DEPOSIT_SUSPENSE_TO_PAYABLE: 2, // DR DEPOSIT_SUSPENSE / CR CLIENT_PAYABLE

  // ── 提现(10–19)──
  WITHDRAW_NET_PENDING: 10, // 客户侧锁定:DR CLIENT_PAYABLE / CR CLIENT_ASSET (pending)
  WITHDRAW_NET_POST: 11,    // 外部确认:post
  WITHDRAW_NET_VOID: 12,    // 取消/失败:void
  WITHDRAW_FEE_PENDING: 13, // 客户侧费锁定:DR CLIENT_PAYABLE / CR CLIENT_ASSET (pending)
  WITHDRAW_FEE_POST: 14,    // post
  WITHDRAW_FEE_VOID: 15,    // void
  WITHDRAW_FEE_FIRM: 16,    // 公司侧收费:DR FIRM_ASSET / CR FIRM_FEE

  // ── 兑换(30–49)──
  SWAP_SELL_CLIENT: 30,        // 客户卖出(from):DR CLIENT_PAYABLE / CR CLIENT_ASSET
  SWAP_SELL_FIRM: 31,          // 公司收入(from):DR FIRM_ASSET / CR FIRM_OPS
  SWAP_BUY_OPS_TO_SET: 32,     // 法币公司内:DR FIRM_OPS / CR FIRM_SET (仅 fiat 腿)
  SWAP_BUY_SET_TO_ASSET: 33,   // 公司放出(to):DR FIRM_SET / CR FIRM_ASSET (fiat) | DR FIRM_OPS / CR FIRM_ASSET (crypto)
  SWAP_BUY_CLIENT: 34,         // 客户收到(to,毛):DR CLIENT_ASSET / CR CLIENT_PAYABLE
  SWAP_FEE_CLIENT: 35,         // 客户付费(to):DR CLIENT_PAYABLE / CR CLIENT_ASSET
  SWAP_FEE_FIRM: 36,           // 公司收费(to):DR FIRM_ASSET / CR FIRM_FEE

  // ── Bootstrap(70)──
  CAPITAL_INJECTION: 70, // 资本注入:DR FIRM_ASSET / CR FIRM_OPS
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
git commit -m "feat(funds): new transfer codes for real-time legs"
```

---

## Task 3: 系统账户 provisioning

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-provisioning.service.ts`（替换 `provision` 内账户清单）
- Test: `src/modules/asset-treasury/assets/asset-provisioning.service.spec.ts`（改）

每资产(=每币种 ledger)开系统账户：`CLIENT_ASSET`、`FIRM_ASSET`、`FIRM_OPS`、`FIRM_FEE`、`FIRM_LIQ`；**法币额外开 `FIRM_SET`**（crypto 不开）。`CLIENT_PAYABLE`/`DEPOSIT_SUSPENSE` 是每客户级，不在此（在 seed/客户开户时建）。

- [ ] **Step 1: 改测试**

```typescript
// asset-provisioning.service.spec.ts —— 整文件替换
import { AssetProvisioningService } from './asset-provisioning.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

describe('AssetProvisioningService (real-time 1:1)', () => {
  function setup(type: 'FIAT' | 'CRYPTO', currency: string) {
    const createAccounts = jest.fn().mockResolvedValue(undefined);
    const prisma: any = {
      asset: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'a1', type, currency, assetNo: 'AST-1' }),
        aggregate: jest.fn().mockResolvedValue({ _max: { tbLedgerId: 1 } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const svc = new AssetProvisioningService(prisma, { createAccounts } as any);
    return { svc, createAccounts };
  }

  it('CRYPTO 资产开 5 个系统账户(无 FIRM_SET)', async () => {
    const { svc, createAccounts } = setup('CRYPTO', 'USDT');
    await svc.provision('a1');
    const codes = createAccounts.mock.calls[0][0].map((p: any) => p.code).sort((a: number, b: number) => a - b);
    expect(codes).toEqual([
      TB_ACCOUNT_CODES.CLIENT_ASSET, // 1
      TB_ACCOUNT_CODES.FIRM_ASSET,   // 50
      TB_ACCOUNT_CODES.FIRM_OPS,     // 200
      TB_ACCOUNT_CODES.FIRM_FEE,     // 202
      TB_ACCOUNT_CODES.FIRM_LIQ,     // 203
    ]);
  });

  it('FIAT 资产额外开 FIRM_SET(6 个)', async () => {
    const { svc, createAccounts } = setup('FIAT', 'AED');
    await svc.provision('a1');
    const codes = createAccounts.mock.calls[0][0].map((p: any) => p.code);
    expect(codes).toContain(TB_ACCOUNT_CODES.FIRM_SET); // 201
    expect(codes).toHaveLength(6);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest asset-provisioning.service.spec -i`
Expected: FAIL

- [ ] **Step 3: 改实现**（替换 `provision` 中 `poolCode`/`firmBookCodes`/`accountParams` 段）

先 `Read` 当前文件确认 import 与方法签名，然后把账户清单替换为：

```typescript
    // 系统账户:聚合资产 + 公司权益账户。法币额外 FIRM_SET。
    const isFiat = asset.type === 'FIAT';
    const systemCodes: Array<{ code: number; desc: string }> = [
      { code: TB_ACCOUNT_CODES.CLIENT_ASSET, desc: 'CLIENT_ASSET' },
      { code: TB_ACCOUNT_CODES.FIRM_ASSET, desc: 'FIRM_ASSET' },
      { code: TB_ACCOUNT_CODES.FIRM_OPS, desc: 'FIRM_OPS' },
      { code: TB_ACCOUNT_CODES.FIRM_FEE, desc: 'FIRM_FEE' },
      { code: TB_ACCOUNT_CODES.FIRM_LIQ, desc: 'FIRM_LIQ' },
      ...(isFiat ? [{ code: TB_ACCOUNT_CODES.FIRM_SET, desc: 'FIRM_SET' }] : []),
    ];

    const accountParams: CreateTbAccountParams[] = systemCodes.map(({ code, desc }) => ({
      code,
      ledger: tbLedgerId,
      ownerType: 'SYSTEM' as const,
      assetCurrency: asset.currency,
      description: `${desc} for ${asset.currency}`,
    }));

    await this.accountingService.createAccounts(accountParams, tx);
    this.logger.log(`Asset ${asset.assetNo} provisioned tbLedgerId=${tbLedgerId}, ${accountParams.length} system TB accounts`);
    return { tbLedgerId };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest asset-provisioning.service.spec -i`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-provisioning.service.ts src/modules/asset-treasury/assets/asset-provisioning.service.spec.ts
git commit -m "feat(funds): provision new COA system accounts per asset"
```

---

## Task 4: Seed 系统 + 客户账户

**Files:**
- Modify: `prisma/seed.business.ts`（`seedAssets` 的 `systemAccounts`、`seedCustomers` 的客户账户码）

- [ ] **Step 1: 改 `seedAssets` 系统账户清单**

先 `Read` `prisma/seed.business.ts` 定位 `seedAssets`。把 `systemAccounts` 段替换为：

```typescript
    const isFiat = asset.type === 'FIAT';
    const systemAccounts = [
      { code: TB_ACCOUNT_CODES.CLIENT_ASSET, desc: 'CLIENT_ASSET' },
      { code: TB_ACCOUNT_CODES.FIRM_ASSET, desc: 'FIRM_ASSET' },
      { code: TB_ACCOUNT_CODES.FIRM_OPS, desc: 'FIRM_OPS' },
      { code: TB_ACCOUNT_CODES.FIRM_FEE, desc: 'FIRM_FEE' },
      { code: TB_ACCOUNT_CODES.FIRM_LIQ, desc: 'FIRM_LIQ' },
      ...(isFiat ? [{ code: TB_ACCOUNT_CODES.FIRM_SET, desc: 'FIRM_SET' }] : []),
    ];
    for (const acct of systemAccounts) {
      await ensureTbAccountRegistry(prisma, {
        code: acct.code, ledger, ownerType: 'SYSTEM', ownerUuid: null, ownerNo: null,
        assetCode: asset.code, description: `${acct.desc} for ${asset.code}`,
      });
    }
```

- [ ] **Step 2: 改 `seedCustomers` 客户账户码**（保持 CLIENT_PAYABLE/DEPOSIT_SUSPENSE，码未变，仅确认无旧码引用）

确认 `seedCustomers` 内循环仍是：

```typescript
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
```

（码 100/101 未变，无需改；若引用了其他旧码则删除。）

- [ ] **Step 3: 验证 seed 编译 + 跑**

Run: `bash scripts/stack.sh reset-main`（重置库并跑 seed）
Expected: seed 日志含 “Seeded ... assets + system TB accounts”，无报错。

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.business.ts
git commit -m "feat(funds): seed new COA system + customer accounts"
```

---

## Task 5: 资本注入 → FIRM_OPS（无 PAID_IN_CAPITAL）

**Files:**
- Modify: `prisma/seed.business.ts`（`seedCapitalInjection`）

新模型无 `PAID_IN_CAPITAL`：资本注入 = `DR FIRM_ASSET / CR FIRM_OPS`（资产↑、自有资金↑）。

- [ ] **Step 1: 改 `seedCapitalInjection` 的账户解析 + transfer**

把解析 `FIRM_TREASURY`/`PAID_IN_CAPITAL` 改为 `FIRM_ASSET`/`FIRM_OPS`：

```typescript
      const firmAssetReg = await (prisma as any).tbAccountRegistry.findFirst({
        where: { code: TB_ACCOUNT_CODES.FIRM_ASSET, ledger, ownerType: 'SYSTEM' },
        select: { tbAccountId: true },
      });
      const firmOpsReg = await (prisma as any).tbAccountRegistry.findFirst({
        where: { code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' },
        select: { tbAccountId: true },
      });
      if (!firmAssetReg || !firmOpsReg) { /* keep existing skip+log */ continue; }

      transfers.push({
        id: deterministicTransferId('SEED_CAPITAL', asset.currency, 'CAPITAL_INJECTION', 0),
        debit_account_id: BigInt('0x' + firmAssetReg.tbAccountId),  // DR FIRM_ASSET
        credit_account_id: BigInt('0x' + firmOpsReg.tbAccountId),   // CR FIRM_OPS
        amount, pending_id: 0n, user_data_128: 0n, user_data_64: 0n, user_data_32: 0,
        timeout: 0, ledger, code: TB_TRANSFER_CODES.CAPITAL_INJECTION, flags: 0, timestamp: 0n,
      });
```

- [ ] **Step 2: 跑 seed + 校验余额**

Run: `bash scripts/stack.sh reset-main`
Expected: 资本注入后 `FIRM_ASSET_AED`=1,000,000、`FIRM_OPS_AED`=1,000,000（USDT 同理 100,000）。下一 Task 的脚本会断言。

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.business.ts
git commit -m "feat(funds): capital injection DR FIRM_ASSET / CR FIRM_OPS"
```

---

## Task 6: Admin COA 展示标签

**Files:**
- Modify: `admin-web/src/pages/ledger-account.constants.ts`（整文件替换）

- [ ] **Step 1: 整文件替换**

```typescript
// admin-web/src/pages/ledger-account.constants.ts
/** TB account code → COA name. 与后端 tb-account-codes.constant.ts 同步。 */
export const TB_CODE_LABELS: Record<number, string> = {
  1: 'CLIENT_ASSET',
  50: 'FIRM_ASSET',
  100: 'CLIENT_PAYABLE',
  101: 'DEPOSIT_SUSPENSE',
  200: 'FIRM_OPS',
  201: 'FIRM_SET',
  202: 'FIRM_FEE',
  203: 'FIRM_LIQ',
};

const labelOf = (code: number) => `${code} · ${TB_CODE_LABELS[code] ?? `CODE_${code}`}`;

export const TB_CODE_OPTIONS = [
  { value: '', label: 'All codes' },
  ...Object.keys(TB_CODE_LABELS).map((c) => ({ value: c, label: labelOf(Number(c)) })),
];

/** SYSTEM-owner codes (1/ledger). */
export const SYSTEM_TB_CODES = [1, 50, 200, 201, 202, 203];
/** Per-customer codes. */
export const CUSTOMER_TB_CODES = [100, 101];

export const SYSTEM_CODE_OPTIONS = SYSTEM_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));
export const CUSTOMER_CODE_OPTIONS = CUSTOMER_TB_CODES.map((c) => ({ value: c, label: labelOf(c) }));

const CLASS_PREFIX: Record<number, string> = {
  1: 'A', 50: 'A',
  100: 'L', 101: 'L',
  200: 'E', 201: 'E', 202: 'E', 203: 'E',
};

export const COA_OPTIONS = Object.entries(TB_CODE_LABELS).map(([code, name]) => ({
  value: `${CLASS_PREFIX[Number(code)]}.${name}`,
  label: `${CLASS_PREFIX[Number(code)]}.${name}`,
}));
```

- [ ] **Step 2: 前端编译检查**

Run: `cd admin-web && npx tsc --noEmit`
Expected: 无新增类型错误（若有引用旧码常量处，按报错修正引用）。

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/ledger-account.constants.ts
git commit -m "feat(funds): admin COA labels for new 8-code chart"
```

---

## Task 7: 不变量自检脚本

**Files:**
- Create: `scripts/verify-realtime-coa.ts`

校验两条恒等式（逐币种）：`CLIENT_ASSET == Σ CLIENT_PAYABLE + Σ DEPOSIT_SUSPENSE`；`FIRM_ASSET == FIRM_OPS + FIRM_SET + FIRM_FEE + FIRM_LIQ`。资产类余额=debits−credits；负债/权益类=credits−debits。

- [ ] **Step 1: 写脚本**

```typescript
// scripts/verify-realtime-coa.ts
import { PrismaClient } from '@prisma/client';
import { createClient as tbCreateClient } from 'tigerbeetle-node';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';

const ASSET = new Set<number>([TB_ACCOUNT_CODES.CLIENT_ASSET, TB_ACCOUNT_CODES.FIRM_ASSET]);

async function main() {
  const prisma = new PrismaClient();
  const tbAddress = process.env.TB_ADDRESS;
  if (!tbAddress) throw new Error('TB_ADDRESS not set');
  const tb = tbCreateClient({ cluster_id: 0n, replica_addresses: [tbAddress] });
  try {
    const regs = await (prisma as any).tbAccountRegistry.findMany({ where: { status: 'ACTIVE' } });
    const accounts = await tb.lookupAccounts(regs.map((r: any) => BigInt('0x' + r.tbAccountId)));
    const balById = new Map<string, bigint>();
    for (const a of accounts) {
      const isAsset = ASSET.has(a.code);
      const bal = isAsset
        ? a.debits_posted - a.credits_posted
        : a.credits_posted - a.debits_posted;
      balById.set(a.id.toString(), bal);
    }
    const ledgers = [...new Set(regs.map((r: any) => r.ledger))];
    let failures = 0;
    for (const ledger of ledgers) {
      const inLedger = regs.filter((r: any) => r.ledger === ledger);
      const get = (code: number, pred = (r: any) => r.code === code) =>
        inLedger.filter(pred).reduce((s: bigint, r: any) => s + (balById.get(BigInt('0x' + r.tbAccountId).toString()) ?? 0n), 0n);

      const clientAsset = get(TB_ACCOUNT_CODES.CLIENT_ASSET);
      const clientLiab = get(0, (r: any) => r.code === TB_ACCOUNT_CODES.CLIENT_PAYABLE || r.code === TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE);
      const firmAsset = get(TB_ACCOUNT_CODES.FIRM_ASSET);
      const firmEquity = get(0, (r: any) => [TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FIRM_SET, TB_ACCOUNT_CODES.FIRM_FEE, TB_ACCOUNT_CODES.FIRM_LIQ].includes(r.code));

      const okClient = clientAsset === clientLiab;
      const okFirm = firmAsset === firmEquity;
      if (!okClient) { failures++; console.log(`✗ ledger ${ledger} CLIENT: asset=${clientAsset} liab=${clientLiab}`); }
      else console.log(`✓ ledger ${ledger} CLIENT 恒等 ${clientAsset}`);
      if (!okFirm) { failures++; console.log(`✗ ledger ${ledger} FIRM: asset=${firmAsset} equity=${firmEquity}`); }
      else console.log(`✓ ledger ${ledger} FIRM 恒等 ${firmAsset}`);
    }
    if (failures > 0) { console.error(`FAIL: ${failures} invariant breaks`); process.exit(1); }
    console.log('ALL INVARIANTS PASS');
  } finally {
    tb.destroy();
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 加 npm script**（`package.json` scripts 段）

```json
"verify:coa": "ts-node -r tsconfig-paths/register scripts/verify-realtime-coa.ts",
```

- [ ] **Step 3: 跑(资本注入后,无业务)应全绿**

Run: `bash scripts/on-stack.sh main verify:coa`
Expected: `✓ ledger 1 CLIENT 恒等 0` / `✓ ledger 1 FIRM 恒等 1000000...` / `ALL INVARIANTS PASS`

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-realtime-coa.ts package.json
git commit -m "feat(funds): real-time COA invariant self-check script"
```

---

## Task 8: 充值流改实时

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Test: 对应 `*.spec.ts`

**新分录（外部 → 客户钱包，钱留钱包）：**

| 步 | 触发 | debit | credit | code |
|---|---|---|---|---|
| Step1 入暂扣 | payin 确认 | `CLIENT_ASSET`(SYSTEM) | `DEPOSIT_SUSPENSE`[客户] | `DEPOSIT_ASSET_TO_SUSPENSE` |
| Step2 释放 | 合规通过 | `DEPOSIT_SUSPENSE`[客户] | `CLIENT_PAYABLE`[客户] | `DEPOSIT_SUSPENSE_TO_PAYABLE` |

- [ ] **Step 1: 读当前实现**

`Read` `deposit-workflow.service.ts`，定位 `executeDepositAccounting`（STEP_1/STEP_2）。当前用 `CLIENT_CUSTODY|CLIENT_BANK`→`DEPOSIT_SUSPENSE`→`CLIENT_PAYABLE`、codes `DEPOSIT_CUSTODY_TO_AUDIT`/`DEPOSIT_AUDIT_TO_CREDIT`。

- [ ] **Step 2: 改 Step1 leg**

把 STEP_1 的 debit 账户解析从 `poolCode(CLIENT_BANK/CUSTODY, SYSTEM)` 改为 `CLIENT_ASSET(SYSTEM)`；code 改 `DEPOSIT_ASSET_TO_SUSPENSE`；evidence `debitCode:'A.CLIENT_ASSET'`、`creditCode:'L.DEPOSIT_SUSPENSE'`。credit 仍 `DEPOSIT_SUSPENSE` ownerType CUSTOMER。

- [ ] **Step 3: 改 Step2 leg**

code 改 `DEPOSIT_SUSPENSE_TO_PAYABLE`；账户不变（`DEPOSIT_SUSPENSE`→`CLIENT_PAYABLE`，均 CUSTOMER）；evidence code 同步。

- [ ] **Step 4: 改测试**

更新 deposit workflow spec：断言 STEP_1 用 `DEPOSIT_ASSET_TO_SUSPENSE`、debit 解析 `CLIENT_ASSET`；STEP_2 用 `DEPOSIT_SUSPENSE_TO_PAYABLE`。（沿用现有 mock 风格：mock `accountingService.executeTransfer`，断言 `code` 入参。）

- [ ] **Step 5: 跑测试**

Run: `npx jest deposit-workflow -i`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions/
git commit -m "feat(funds): deposit posts to CLIENT_ASSET (real-time 1:1, no aggregation)"
```

---

## Task 9: 提现流改实时

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`、`withdraw-transactions.service.ts`
- Test: 对应 `*.spec.ts`

**新分录（提现 1000 + 费 10，客户钱包直出；crypto/fiat 同构）：**

| 腿 | 时点 | debit | credit | code |
|---|---|---|---|---|
| 净额锁定 | 创建 | `CLIENT_PAYABLE`[c] | `CLIENT_ASSET` | `WITHDRAW_NET_PENDING` |
| 费锁定 | 创建 | `CLIENT_PAYABLE`[c] | `CLIENT_ASSET` | `WITHDRAW_FEE_PENDING` |
| 净额结算 | 外部确认 | (post `WITHDRAW_NET_PENDING`) | | `WITHDRAW_NET_POST` |
| 费结算(客户侧) | 外部确认 | (post `WITHDRAW_FEE_PENDING`) | | `WITHDRAW_FEE_POST` |
| 费入公司 | 外部确认 | `FIRM_ASSET` | `FIRM_FEE` | `WITHDRAW_FEE_FIRM` |
| 取消/失败 | 任意 | (void net + fee pending) | | `WITHDRAW_NET_VOID`/`WITHDRAW_FEE_VOID` |

> 与旧模型差异：净额 credit 从 `CLIENT_CUSTODY/CLIENT_BANK` 改 `CLIENT_ASSET`；费从「`CLIENT_PAYABLE→FEE_INCOME`」改为客户侧 `CLIENT_PAYABLE→CLIENT_ASSET` + 公司侧 `FIRM_ASSET→FIRM_FEE`；**不再创建 FeeAccrual**（Task 11 处理调用点）。

- [ ] **Step 1: 读当前实现**

`Read` `withdraw-workflow.service.ts`（`create` 锁定段、`finalizeWithdrawal` post 段、`voidWithdrawPending`）。

- [ ] **Step 2: 改创建锁定**

把净额 pending 的 credit 账户从 `poolCode` 改 `CLIENT_ASSET(SYSTEM)`，code `WITHDRAW_NET_PENDING`。费 pending 改为 `CLIENT_PAYABLE[c]→CLIENT_ASSET(SYSTEM)`、code `WITHDRAW_FEE_PENDING`（旧是 `CLIENT_PAYABLE→FEE_INCOME`）。记录 `tbPendingNetId`/`tbPendingFeeId` 不变。

- [ ] **Step 3: 改结算 post + 公司侧收费**

`finalizeWithdrawal`：post 两个 pending（code `WITHDRAW_NET_POST`/`WITHDRAW_FEE_POST`）；**新增**一条公司侧收费 transfer `DR FIRM_ASSET / CR FIRM_FEE`(同币种, amount=fee, code `WITHDRAW_FEE_FIRM`)。

- [ ] **Step 4: 改 void**

`voidWithdrawPending`：两个 pending void，code `WITHDRAW_NET_VOID`/`WITHDRAW_FEE_VOID`。

- [ ] **Step 5: 改测试** — 断言新 code + 新账户解析 + 公司侧收费 transfer 被调用。

- [ ] **Step 6: 跑测试**

Run: `npx jest withdraw -i`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/withdraw-transactions/
git commit -m "feat(funds): withdraw real-time, fee to FIRM_FEE (no FeeAccrual)"
```

---

## Task 10: 兑换流改实时（核心）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`、`swap-transactions.service.ts`
- Test: 对应 `*.spec.ts`

**新分录（USDT→AED，卖 1000 / 毛 3670 / 费 20；先转出再转入）：**

| 腿 | 类型 | debit | credit | code |
|---|---|---|---|---|
| ① 卖 USDT(客户侧) | 跨账本 | `CLIENT_PAYABLE`[c]_USDT | `CLIENT_ASSET`_USDT | `SWAP_SELL_CLIENT` |
| ① 卖 USDT(公司侧) | 跨账本 | `FIRM_ASSET`_USDT | `FIRM_OPS`_USDT | `SWAP_SELL_FIRM` |
| ② 买 AED 公司内(仅fiat) | 公司内 | `FIRM_OPS`_AED | `FIRM_SET`_AED | `SWAP_BUY_OPS_TO_SET` |
| ② 买 AED 放出(公司侧) | 跨账本 | `FIRM_SET`_AED (fiat) / `FIRM_OPS`_AED (crypto) | `FIRM_ASSET`_AED | `SWAP_BUY_SET_TO_ASSET` |
| ② 买 AED 收到(客户侧,毛) | 跨账本 | `CLIENT_ASSET`_AED | `CLIENT_PAYABLE`[c]_AED | `SWAP_BUY_CLIENT` |
| ③ 费 AED(客户侧) | 跨账本 | `CLIENT_PAYABLE`[c]_AED | `CLIENT_ASSET`_AED | `SWAP_FEE_CLIENT` |
| ③ 费 AED(公司侧) | 跨账本 | `FIRM_ASSET`_AED | `FIRM_FEE`_AED | `SWAP_FEE_FIRM` |

> 方向判定：to-ccy 为 fiat → 含 `SWAP_BUY_OPS_TO_SET` 且 `SWAP_BUY_SET_TO_ASSET` 的 debit=`FIRM_SET`；to-ccy 为 crypto → 跳过 `OPS_TO_SET`，`SWAP_BUY_SET_TO_ASSET` 的 debit=`FIRM_OPS`。from-ccy 为 fiat（AED→USDT）则①卖出侧法币经 SET（对称：客户 vIBAN→SET→OPS，即 ①公司侧拆成 `CLIENT→SET` 跨账本 + `SET→OPS` 公司内）。
> 删除：旧 `TRADE_CLEARING` 四腿（codes 30/31/33/35/36）、`SWAP_CLEARING_TO_SPREAD`、`outstandingsService.createForSwapSuccess()`（Task 11 处理）。点差(spread)= 公司放出毛额按客户汇率 vs 市场汇率的差，自然留存于 `FIRM_OPS`，不单记。

- [ ] **Step 1: 读当前实现**

`Read` `swap-workflow.service.ts` 的 `executeSwap`（TB 四腿 + `outstandingsService.createForSwapSuccess()` 调用点 + `SWAP_SUCCEEDED` emit）。

- [ ] **Step 2: 写新 leg 编排（替换 executeSwap 记账段）**

按上表实现：解析 from/to ledger、是否 fiat；用 `accountingService.executeTransfer` 逐腿发（每腿带 evidence：sourceType `SWAP`、sourceNo、对应 debit/credit COA label、traceId）。保留 `SWAP_SUCCEEDED` emit（Task 11 决定其订阅者去留）。

- [ ] **Step 3: 删 Outstanding 创建**

移除 `executeSwap` 内 `outstandingsService.createForSwapSuccess(...)` 调用及相关 import（domain service 本身留到 Phase C 删）。

- [ ] **Step 4: 改测试** — 断言 7 腿（fiat to-ccy）/ 6 腿（crypto to-ccy）的 code 序列与账户解析；断言不再调用 `createForSwapSuccess`。

- [ ] **Step 5: 跑测试**

Run: `npx jest swap -i`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/swap-transactions/
git commit -m "feat(funds): swap real-time legs (no clearing bridge / no Outstanding)"
```

---

## Task 11: 停用旧机器（不删，留 Phase C）

**Files:**
- Modify: swap/withdraw 中残留的 `feeAccrual.*` 调用点（listener）
- Modify: `src/modules/funds-layer/sweep/eod-settlement-sweep.service.ts`、`deposit-aggregation-sweep.service.ts`（注释/禁用 `@Cron`）

- [ ] **Step 1: 摘除 FeeAccrual 创建**

`Read` `src/modules/funds-layer/workflow/fee-accrual-listener.service.ts`，把 `@OnEvent('...SWAP_SUCCEEDED...')` / 提现成功 的处理体改为 no-op（或移除 `@OnEvent`），保留类（Phase C 删）。同理移除 swap/withdraw 对 `feeAccrual` 的直接调用。

- [ ] **Step 2: 禁用 EOD + 归集 cron**

`Read` 两个 sweep service，注释掉 `@Cron(...)` 装饰器并在方法首行 `return;`（防止扫到空 outstanding 报错）。加注释 `// disabled in Phase A — removed in Phase C`。

- [ ] **Step 3: 全量编译**

Run: `npm run build`
Expected: 编译通过（红窗闭合）。若有遗留旧码引用，按报错修正（指向新码或删调用）。

- [ ] **Step 4: 全量单测**

Run: `npm test`
Expected: 全绿（修正本期改动波及的 spec）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(funds): stop creating Outstanding/FeeAccrual, disable EOD/aggregation crons"
```

---

## Task 12: 端到端验收

**Files:** 无（运行验证）

- [ ] **Step 1: 重置 + seed**

Run: `bash scripts/stack.sh reset-main`
Expected: 起栈成功，seed 完成，资本注入到位。

- [ ] **Step 2: 跑三大流 demo**

Run: `bash scripts/on-stack.sh main demo:deposit && bash scripts/on-stack.sh main demo:swap && bash scripts/on-stack.sh main demo:withdraw`
Expected: 三流均 SUCCESS（若 demo 脚本引用旧概念报错，记入 Phase C 待修，不阻塞——但记账路径须跑通）。

- [ ] **Step 3: 不变量自检**

Run: `bash scripts/on-stack.sh main verify:coa`
Expected: `ALL INVARIANTS PASS`

- [ ] **Step 4: 抽查逐账户 1:1**

用 admin API 或 `tbAccountRegistry` + `lookupBalance` 抽查：某客户 `CLIENT_PAYABLE` == 其钱包应得；`FIRM_FEE` == 已收手续费累计。

- [ ] **Step 5: 最终 commit（如有验收修正）**

```bash
git add -A
git commit -m "test(funds): Phase A end-to-end verification green"
```

---

## Self-Review（写完已自查）

- **Spec 覆盖**：§2 COA→Task1/3/4/6；§3 路由(SET)→Task10 方向判定；§4.1 充值→Task8；§4.2 提现→Task9；§4.3 兑换→Task10；§10 不变量→Task7；停旧机器→Task11。✅
- **占位扫描**：无 TBD；流任务给了精确分录表 + code + 账户解析，"读当前实现"是执行约定非占位。
- **类型/命名一致**：account code 名（`CLIENT_ASSET`/`FIRM_*`）、transfer code 名（`SWAP_*`/`WITHDRAW_*`/`DEPOSIT_*`）跨 Task 一致；DR/CR 与既有 `executeTransfer(debitAccountId/creditAccountId)` 语义一致（资产借增、负债/权益贷增）。
- **已知风险**：Task1 后到 Task11 有编译红窗（Phase A 内部，不交付）；demo 脚本可能引用旧概念，验收以记账路径跑通 + verify:coa 为准。
