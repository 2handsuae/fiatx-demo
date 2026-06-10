# 两本账记账体系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `doc-final/superpowers/specs/2026-06-10-two-book-accounting-design.md` 把 TB 账本重定为两本账:客户 safeguarding 账本 + 公司账本(FIRM_OPS/换汇户/三桶损益),删除 FEE_RECEIVABLE,重做充值/提现/兑换记账节点与 EOD(清桥+重估+对账)。

**Architecture:** 单一 TigerBeetle cluster 扩 E(200)/R(300) 编码段;收入 T1 确认(swap posted、提现 two-phase pending);结算腿只做"客户池↔FIRM_OPS"物理镜像(挂 funds-flow CLEAR);桥由 EOD 统一清入 FX_POSITION;每日重估出 FX_UNREALIZED_PNL。一刀换血,但任务序列保持每步编译/测试通过:FEE_RECEIVABLE 常量保留到 Task 9 统一删除(运行时从 Task 4 起就无人再写它)。

**Tech Stack:** NestJS + Prisma(SQLite)+ tigerbeetle-node。测试 `npx jest <file>`,构建 `npm run build`。所有提交只进 `branch`,禁止 merge main。

**关键既有事实(执行者必读):**
- COA 常量:`src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`(现有 BANK:1/CUSTODY:10/CLIENT_CREDIT:100/CLIENT_AUDIT:101/TRADE_CLEARING:110/FEE_RECEIVABLE:120)。
- `AccountingService`(`accounting.service.ts`)提供 `createAccounts/executeTransfer/executePendingTransfer/postPendingTransfer/voidPendingTransfer/lookupBalance/resolveTbAccountId`。transfer id 由 `deterministicTransferId(sourceType, sourceNo, eventCode, 0)` 决定 → **同一 evidence 三元组天然幂等**(TB `exists` 状态被过滤)。
- `lookupBalance` 返回 bigint 单位(按 asset.decimals 缩放)。`TB_LEDGERS = { AED:1, USDT:2 }`。
- 价源:`BinanceRateProvider.fetchRate(fromCode, toCode)`(`src/modules/trading/pricing-center/providers/binance-rate.provider.ts`),返回 `{ rate: Prisma.Decimal, ... }`。
- 物理路径白名单:`src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`(`drain` 字段将被 `mirror` 取代)。
- `FundsAccountingService.applyAccounting` 现被两处调用:`internal-transfer-workflow.service.ts:141`(initiate 内,事务中)和 `fiat-settlement-workflow.service.ts:170`(CLEAR 时);`drainFeeReceivableAmount` 被 `fiat-fee-collection-workflow.service.ts:201` 调用。三处全部重接。

---

## Task 1: COA 常量重定(改名 + 新增,FEE_RECEIVABLE 暂留)

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`
- Modify(机械改名): 所有引用 `TB_ACCOUNT_CODES.BANK` / `TB_ACCOUNT_CODES.CUSTODY` / `'A.BANK'` / `'A.CUSTODY'` 的文件(见 Step 3 grep 清单)
- Test: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts`(新建)

- [x] **Step 1: 写失败测试**

```typescript
// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts
import { TB_ACCOUNT_CODES, COA_TO_TB_CODE, TB_CODE_TO_COA } from './tb-account-codes.constant';

describe('TB_ACCOUNT_CODES (two-book COA)', () => {
  it('客户账本科目保留原编码', () => {
    expect(TB_ACCOUNT_CODES.CLIENT_BANK).toBe(1);
    expect(TB_ACCOUNT_CODES.CLIENT_CUSTODY).toBe(10);
    expect(TB_ACCOUNT_CODES.CLIENT_CREDIT).toBe(100);
    expect(TB_ACCOUNT_CODES.CLIENT_AUDIT).toBe(101);
    expect(TB_ACCOUNT_CODES.TRADE_CLEARING).toBe(110);
  });
  it('公司账本科目按 class 编码段', () => {
    expect(TB_ACCOUNT_CODES.FIRM_OPS).toBe(50);
    expect(TB_ACCOUNT_CODES.FX_POSITION).toBe(60);
    expect(TB_ACCOUNT_CODES.PAID_IN_CAPITAL).toBe(200);
    expect(TB_ACCOUNT_CODES.RETAINED_EARNINGS).toBe(210);
    expect(TB_ACCOUNT_CODES.FEE_INCOME).toBe(300);
    expect(TB_ACCOUNT_CODES.SPREAD_INCOME).toBe(310);
    expect(TB_ACCOUNT_CODES.FX_UNREALIZED_PNL).toBe(320);
    expect(TB_ACCOUNT_CODES.FX_REALIZED_PNL).toBe(330);
  });
  it('COA 字符串双向映射一致', () => {
    expect(COA_TO_TB_CODE['A.CLIENT_BANK']).toBe(1);
    expect(COA_TO_TB_CODE['A.FIRM_OPS']).toBe(50);
    expect(COA_TO_TB_CODE['R.FEE_INCOME']).toBe(300);
    expect(TB_CODE_TO_COA[310]).toBe('R.SPREAD_INCOME');
    expect(TB_CODE_TO_COA[60]).toBe('A.FX_POSITION');
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts`
Expected: FAIL(`CLIENT_BANK` undefined)

- [x] **Step 3: 重写常量文件**

```typescript
// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts
/**
 * TB account type codes (u16). Immutable once assigned.
 * 编码段:A 资产 1–99(1–49 客户资金形态 / 50–99 公司自有)、
 * L 负债 100–199、E 权益 200–299、R 损益 300–399。
 */
export const TB_ACCOUNT_CODES = {
  // ── 客户账本(safeguarding)──
  CLIENT_BANK: 1,        // 原 BANK:客户资金池·银行侧(法币 ledger)
  CLIENT_CUSTODY: 10,    // 原 CUSTODY:客户资金池·托管侧(crypto ledger)
  CLIENT_CREDIT: 100,
  CLIENT_AUDIT: 101,
  TRADE_CLEARING: 110,   // swap 桥(双向,EOD 清入 FX_POSITION)
  FEE_RECEIVABLE: 120,   // @deprecated — Task 9 删除;Task 4 起运行时不再写入
  // ── 公司账本 ──
  FIRM_OPS: 50,          // 公司自有资金(F_OPS/F_LIQ/F_SET/F_FEE 合并视角)
  FX_POSITION: 60,       // 换汇户:FX 头寸,每币种一条腿,双向
  PAID_IN_CAPITAL: 200,
  RETAINED_EARNINGS: 210,
  FEE_INCOME: 300,
  SPREAD_INCOME: 310,
  FX_UNREALIZED_PNL: 320, // 每日重估,双向
  FX_REALIZED_PNL: 330,   // LP 平盘锁定,双向
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

/** Human-readable COA code → TB numeric code */
export const COA_TO_TB_CODE: Record<string, number> = {
  'A.CLIENT_BANK': TB_ACCOUNT_CODES.CLIENT_BANK,
  'A.CLIENT_CUSTODY': TB_ACCOUNT_CODES.CLIENT_CUSTODY,
  'A.FIRM_OPS': TB_ACCOUNT_CODES.FIRM_OPS,
  'A.FX_POSITION': TB_ACCOUNT_CODES.FX_POSITION,
  'L.CLIENT_CREDIT': TB_ACCOUNT_CODES.CLIENT_CREDIT,
  'L.CLIENT_AUDIT': TB_ACCOUNT_CODES.CLIENT_AUDIT,
  'L.TRADE_CLEARING': TB_ACCOUNT_CODES.TRADE_CLEARING,
  'L.FEE_RECEIVABLE': TB_ACCOUNT_CODES.FEE_RECEIVABLE, // @deprecated — Task 9 删除
  'E.PAID_IN_CAPITAL': TB_ACCOUNT_CODES.PAID_IN_CAPITAL,
  'E.RETAINED_EARNINGS': TB_ACCOUNT_CODES.RETAINED_EARNINGS,
  'R.FEE_INCOME': TB_ACCOUNT_CODES.FEE_INCOME,
  'R.SPREAD_INCOME': TB_ACCOUNT_CODES.SPREAD_INCOME,
  'R.FX_UNREALIZED_PNL': TB_ACCOUNT_CODES.FX_UNREALIZED_PNL,
  'R.FX_REALIZED_PNL': TB_ACCOUNT_CODES.FX_REALIZED_PNL,
};

/** TB numeric code → human-readable COA code */
export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);
```

- [x] **Step 4: 机械改名所有引用点**

Run: `grep -rln "TB_ACCOUNT_CODES.BANK\b\|TB_ACCOUNT_CODES.CUSTODY\b" --include="*.ts" src prisma scripts`

对每个文件做纯文本替换(语义零变化):`TB_ACCOUNT_CODES.BANK` → `TB_ACCOUNT_CODES.CLIENT_BANK`,`TB_ACCOUNT_CODES.CUSTODY` → `TB_ACCOUNT_CODES.CLIENT_CUSTODY`。已知清单(以 grep 实际输出为准):
`tb-manual-account.service.ts`、`asset-provisioning.service.ts`、`asset-activation-workflow.service.ts`、`funds-accounting.service.ts`、`deposit-workflow.service.ts`、`withdraw-workflow.service.ts`、`withdraw-transactions.service.ts`、`prisma/seed.business.ts`、`scripts/verify-tb-drain.ts`、`scripts/seed-fiat-settle-demo.ts`、`scripts/seed-eod-demo.ts` 及对应 `.spec.ts`。
同时替换字符串字面量 `'A.BANK'`→`'A.CLIENT_BANK'`、`'A.CUSTODY'`→`'A.CLIENT_CUSTODY'`(`grep -rln "'A.BANK'\|'A.CUSTODY'" --include="*.ts" src scripts`)。

- [x] **Step 5: 测试 + 构建通过**

Run: `npx jest src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts && npm run build`
Expected: PASS + 编译零错误

- [x] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(accounting): two-book COA — rename client pool accounts, add E/R code ranges"
```

---

## Task 2: TB transfer codes 扩充

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`

- [x] **Step 1: 在文件尾部(`} as const;` 之前)追加新 code 段**

```typescript
  // ── Two-book accounting (50–70) ──
  // Settlement-leg physical mirrors: client pool ↔ FIRM_OPS
  SETTLE_POOL_TO_FIRM: 50, // debit FIRM_OPS, credit CLIENT_BANK|CLIENT_CUSTODY
  SETTLE_FIRM_TO_POOL: 51, // debit CLIENT_BANK|CLIENT_CUSTODY, credit FIRM_OPS
  // Withdrawal-fee de-commingle: fee leaves the client pool into firm ops
  FEE_DECOMMINGLE: 52,     // debit FIRM_OPS, credit CLIENT_BANK|CLIENT_CUSTODY

  // EOD bridge sweep: TRADE_CLEARING ↔ FX_POSITION (the only cross-currency point)
  BRIDGE_SWEEP_OUT: 60, // bridge net CREDIT → debit TRADE_CLEARING, credit FX_POSITION
  BRIDGE_SWEEP_IN: 61,  // bridge net DEBIT  → debit FX_POSITION, credit TRADE_CLEARING

  // FX revaluation / realization
  FX_REVAL_LOSS: 62, // debit FX_UNREALIZED_PNL, credit FX_POSITION
  FX_REVAL_GAIN: 63, // debit FX_POSITION, credit FX_UNREALIZED_PNL
  FX_REALIZE: 64,    // LP fill: close position legs against FIRM_OPS + FX_REALIZED_PNL

  // Bootstrap
  CAPITAL_INJECTION: 70, // debit FIRM_OPS, credit PAID_IN_CAPITAL
```

注:`EOD_DRAIN_OUT:40 / EOD_DRAIN_IN:41 / FEE_DRAIN:42` 本任务**不动**(消费者 Task 6 重接,常量 Task 9 删)。`WITHDRAW_CREDIT_TO_FEE_*:11/13/15` 与 `SWAP_CREDIT_TO_FEE:36 / SWAP_CLEARING_TO_SPREAD:35` 语义不变(目的科目在 Task 4/5 换),编号保留。

- [x] **Step 2: 构建 + Commit**

Run: `npm run build`
Expected: 编译零错误

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
git commit -m "feat(accounting): transfer codes for settlement mirrors, bridge sweep, FX reval/realize, capital injection"
```

---

## Task 3: 科目开户(provisioning + seed)+ 资本注入

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-provisioning.service.ts`
- Modify: `src/modules/asset-treasury/assets/asset-activation-workflow.service.ts:137-138`(requiredCodes)
- Modify: `prisma/seed.business.ts`(systemAccounts 列表 ~line 125-144;文件尾部加资本注入)
- Test: `src/modules/asset-treasury/assets/asset-provisioning.service.spec.ts`(如无则新建)

- [x] **Step 1: 写失败测试(provisioning 开满公司账本科目)**

```typescript
// src/modules/asset-treasury/assets/asset-provisioning.service.spec.ts
import { AssetProvisioningService } from './asset-provisioning.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

describe('AssetProvisioningService (two-book)', () => {
  it('provision 为每个资产开 10 个 SYSTEM 账户(无 FEE_RECEIVABLE)', async () => {
    const createAccounts = jest.fn().mockResolvedValue(undefined);
    const prisma: any = {
      asset: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'a1', type: 'CRYPTO', currency: 'USDT', assetNo: 'AST-1' }),
        aggregate: jest.fn().mockResolvedValue({ _max: { tbLedgerId: 1 } }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const svc = new AssetProvisioningService(prisma, { createAccounts } as any);
    await svc.provision('a1');
    const codes = createAccounts.mock.calls[0][0].map((p: any) => p.code).sort((a: number, b: number) => a - b);
    expect(codes).toEqual([
      TB_ACCOUNT_CODES.CLIENT_CUSTODY,
      TB_ACCOUNT_CODES.FIRM_OPS,
      TB_ACCOUNT_CODES.FX_POSITION,
      TB_ACCOUNT_CODES.TRADE_CLEARING,
      TB_ACCOUNT_CODES.PAID_IN_CAPITAL,
      TB_ACCOUNT_CODES.RETAINED_EARNINGS,
      TB_ACCOUNT_CODES.FEE_INCOME,
      TB_ACCOUNT_CODES.SPREAD_INCOME,
      TB_ACCOUNT_CODES.FX_UNREALIZED_PNL,
      TB_ACCOUNT_CODES.FX_REALIZED_PNL,
    ]);
    expect(codes).not.toContain(TB_ACCOUNT_CODES.FEE_RECEIVABLE);
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/asset-treasury/assets/asset-provisioning.service.spec.ts`
Expected: FAIL(当前只开 3 个账户,含 FEE_RECEIVABLE)

- [x] **Step 3: 改 provisioning 的 accountParams**

替换 `asset-provisioning.service.ts` 中 `accountParams` 数组(31–55 行):

```typescript
    const poolCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.CLIENT_BANK : TB_ACCOUNT_CODES.CLIENT_CUSTODY;

    const firmBookCodes: Array<{ code: number; desc: string }> = [
      { code: TB_ACCOUNT_CODES.FIRM_OPS, desc: 'FIRM_OPS' },
      { code: TB_ACCOUNT_CODES.FX_POSITION, desc: 'FX_POSITION' },
      { code: TB_ACCOUNT_CODES.PAID_IN_CAPITAL, desc: 'PAID_IN_CAPITAL' },
      { code: TB_ACCOUNT_CODES.RETAINED_EARNINGS, desc: 'RETAINED_EARNINGS' },
      { code: TB_ACCOUNT_CODES.FEE_INCOME, desc: 'FEE_INCOME' },
      { code: TB_ACCOUNT_CODES.SPREAD_INCOME, desc: 'SPREAD_INCOME' },
      { code: TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, desc: 'FX_UNREALIZED_PNL' },
      { code: TB_ACCOUNT_CODES.FX_REALIZED_PNL, desc: 'FX_REALIZED_PNL' },
    ];

    const accountParams: CreateTbAccountParams[] = [
      {
        code: poolCode,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCurrency: asset.currency,
        description: `${asset.type === 'FIAT' ? 'CLIENT_BANK' : 'CLIENT_CUSTODY'} for ${asset.currency}`,
      },
      {
        code: TB_ACCOUNT_CODES.TRADE_CLEARING,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCurrency: asset.currency,
        description: `TRADE_CLEARING for ${asset.currency}`,
      },
      ...firmBookCodes.map(({ code, desc }) => ({
        code,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM' as const,
        assetCurrency: asset.currency,
        description: `${desc} for ${asset.currency}`,
      })),
    ];
```

同步 `asset-activation-workflow.service.ts` 的 `requiredCodes`(137–138 行)改为:

```typescript
    const poolCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.CLIENT_BANK : TB_ACCOUNT_CODES.CLIENT_CUSTODY;
    const requiredCodes = [poolCode, TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.FIRM_OPS, TB_ACCOUNT_CODES.FEE_INCOME];
```

- [x] **Step 4: 跑测试通过**

Run: `npx jest src/modules/asset-treasury/assets/asset-provisioning.service.spec.ts`
Expected: PASS

- [x] **Step 5: seed 同步 — systemAccounts 列表 + 资本注入**

`prisma/seed.business.ts` 中 `systemAccounts`(~129 行)改为与 provisioning 一致的 10 个科目:

```typescript
    const systemAccounts = [
      { code: custodyCode, desc: isFiat ? 'CLIENT_BANK' : 'CLIENT_CUSTODY' },
      { code: TB_ACCOUNT_CODES.TRADE_CLEARING, desc: 'TRADE_CLEARING' },
      { code: TB_ACCOUNT_CODES.FIRM_OPS, desc: 'FIRM_OPS' },
      { code: TB_ACCOUNT_CODES.FX_POSITION, desc: 'FX_POSITION' },
      { code: TB_ACCOUNT_CODES.PAID_IN_CAPITAL, desc: 'PAID_IN_CAPITAL' },
      { code: TB_ACCOUNT_CODES.RETAINED_EARNINGS, desc: 'RETAINED_EARNINGS' },
      { code: TB_ACCOUNT_CODES.FEE_INCOME, desc: 'FEE_INCOME' },
      { code: TB_ACCOUNT_CODES.SPREAD_INCOME, desc: 'SPREAD_INCOME' },
      { code: TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, desc: 'FX_UNREALIZED_PNL' },
      { code: TB_ACCOUNT_CODES.FX_REALIZED_PNL, desc: 'FX_REALIZED_PNL' },
    ];
```

(`custodyCode` 变量此时已在 Task 1 改名为 `CLIENT_BANK/CLIENT_CUSTODY` 引用。)
资本注入:在 seed 的 TB 账户创建完成之后(同一资产循环内或独立循环),每币种一笔:

```typescript
// Firm capital bootstrap: 借 FIRM_OPS / 贷 PAID_IN_CAPITAL(dev 浮动资金,金额见常量)
const SEED_FIRM_CAPITAL: Record<string, string> = { AED: '1000000', USDT: '100000' };
```

用 seed 既有的 TB client 帮助函数(`prisma/seed-tb.helper.ts` 的 createTransfers 封装;若只有 createAccounts 封装,则参照其模式新增 `seedTransfer` 帮助函数)创建 posted transfer:
debit = FIRM_OPS(ledger),credit = PAID_IN_CAPITAL(ledger),amount = 按 asset.decimals 缩放的 bigint,code = `TB_TRANSFER_CODES.CAPITAL_INJECTION`,transfer id 用 `deterministicTransferId('SEED_CAPITAL', currency, 'CAPITAL_INJECTION', 0)` 保证 reseed 幂等。

- [x] **Step 6: 构建 + Commit**

Run: `npm run build`
Expected: 编译零错误

```bash
git add -A && git commit -m "feat(accounting): provision/seed full two-book accounts + firm capital bootstrap"
```

---

## Task 4: 兑换 T1 — fee/spread 改进收入科目

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`(148–220 行区域)
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`(如无则新建,mock AccountingService)

- [x] **Step 1: 写失败测试**

新建/追加 spec,直接断言科目去向(mock 全部依赖,只验 resolve+transfer 调用):

```typescript
// 关键断言(测试骨架按模块内既有 spec 风格搭;核心是这两个 expect):
// 1) spread 腿:resolveTbAccountId 被调用时 code = TB_ACCOUNT_CODES.SPREAD_INCOME
// 2) fee   腿:resolveTbAccountId 被调用时 code = TB_ACCOUNT_CODES.FEE_INCOME
// 3) 任何调用都不再出现 code = TB_ACCOUNT_CODES.FEE_RECEIVABLE
const resolveCalls = accountingService.resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
expect(resolveCalls).toContain(TB_ACCOUNT_CODES.SPREAD_INCOME);
expect(resolveCalls).toContain(TB_ACCOUNT_CODES.FEE_INCOME);
expect(resolveCalls).not.toContain(TB_ACCOUNT_CODES.FEE_RECEIVABLE);
```

- [x] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`
Expected: FAIL

- [x] **Step 3: 改 swap-workflow.service.ts(三处)**

(a) spread 腿(151–163 行):`FEE_RECEIVABLE` → `SPREAD_INCOME`,变量改名 `feeReceivable`→`spreadIncome`,evidence 的 creditCode 同步:

```typescript
        if (spreadAmountBigint > 0n) {
          const spreadIncome = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.SPREAD_INCOME, ledger: toLedger, ownerType: 'SYSTEM',
          });
          const spreadPending = await this.accountingService.executePendingTransfer({
            debitAccountId: clearingTo, creditAccountId: spreadIncome, amount: spreadAmountBigint,
            ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_CLEARING_TO_SPREAD, timeout: 0,
            evidence: this.evidence(swapNo, 'SWAP_SPREAD', TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.SPREAD_INCOME, toCurrency, traceId, ownerId, 'Swap pending: spread income (T1 recognition)'),
            tx,
          });
```

(b) post-spread evidence(195–201 行):`TB_ACCOUNT_CODES.FEE_RECEIVABLE` → `TB_ACCOUNT_CODES.SPREAD_INCOME`。
(c) fee 腿(206–220 行):`FEE_RECEIVABLE` → `FEE_INCOME`:

```typescript
        if (feeAmountBigint > 0n) {
          const feeIncome = await this.accountingService.resolveTbAccountId({
            code: TB_ACCOUNT_CODES.FEE_INCOME, ledger: toLedger, ownerType: 'SYSTEM',
          });
          const feeTransfer = await this.accountingService.executeTransfer({
            debitAccountId: clientCreditTo, creditAccountId: feeIncome, amount: feeAmountBigint,
            ledger: toLedger, code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_FEE,
            evidence: this.evidence(swapNo, 'SWAP_FEE', TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.FEE_INCOME, toCurrency, traceId, ownerId, 'Swap: fee income debited from client credit (T1 recognition)'),
            tx,
          });
```

同时更新 99–103 行注释(FEE_RECEIVABLE → SPREAD_INCOME 语境)。

- [x] **Step 4: 测试 + 构建通过,Commit**

Run: `npx jest src/modules/trading/swap-transactions && npm run build`
Expected: PASS

```bash
git add -A && git commit -m "feat(swap): T1 books fee/spread into FEE_INCOME/SPREAD_INCOME (revenue at trade time)"
```

---

## Task 5: 提现 fee — pending 直通 FEE_INCOME

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:643-670`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:499-500`(post 时 evidence)
- Test: 模块内既有 withdraw spec(如有)+ 同 Task 4 风格断言

- [x] **Step 1: 改 Pending #2(withdraw-transactions.service.ts)**

```typescript
            // Pending #2: fee amount CLIENT_CREDIT → FEE_INCOME (two-phase:
            // posted on payout success = revenue recognized; voided on fail/return
            // = revenue never existed, zero reversal entries)
            let pendingFeeId: bigint | undefined;
            if (feeBigint > 0n) {
              const feeIncomeId = await this.accountingService.resolveTbAccountId({
                code: TB_ACCOUNT_CODES.FEE_INCOME,
                ledger,
                ownerType: 'SYSTEM',
              });

              const result = await this.accountingService.executePendingTransfer({
                debitAccountId: clientCreditId,
                creditAccountId: feeIncomeId,
                amount: feeBigint,
                ledger,
                code: TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_FEE_PENDING,
                timeout: 0,
                evidence: {
                  ...evidenceBase,
                  eventCode: 'WITHDRAW_LOCK_FEE',
                  creditCode: String(TB_ACCOUNT_CODES.FEE_INCOME),
                  memo: 'Withdrawal pending lock: fee → FEE_INCOME',
                },
                tx,
              });
```

- [x] **Step 2: 改 withdraw-workflow.service.ts post evidence(~500 行)**

`creditCode: String(TB_ACCOUNT_CODES.FEE_RECEIVABLE)` → `creditCode: String(TB_ACCOUNT_CODES.FEE_INCOME)`。post/void 机制本身不动(pending id 已存 `tbPendingFeeId`)。

- [x] **Step 3: 测试 + 构建,Commit**

Run: `npx jest src/modules/trading/withdraw-transactions && npm run build`
Expected: PASS(若既有 spec 断言 FEE_RECEIVABLE,改为 FEE_INCOME)

```bash
git add -A && git commit -m "feat(withdraw): fee pending leg targets FEE_INCOME (post=recognize, void=never existed)"
```

---

## Task 6: 结算腿镜像 — mirror 取代 drain

**Files:**
- Modify: `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`(`drain` → `mirror`)
- Modify: `src/modules/funds-layer/accounting/funds-accounting.service.ts`(新 `mirrorPhysicalTransfer`;`applyAccounting`/`drainFeeReceivableAmount` 留壳到 Task 9 删)
- Modify: `src/modules/funds-layer/workflow/internal-transfer-workflow.service.ts`(initiate 内移除 applyAccounting;CLEAR 事件中调 mirror)
- Modify: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts:168-173`(applyAccounting → mirror)
- Modify: `src/modules/funds-layer/workflow/fiat-fee-collection-workflow.service.ts:191-211`(drainFeeReceivableAmount → mirror)
- Modify: `src/modules/funds-layer/accounting/tb-amount.util.ts`(导出 `decimalToTbUnits`)
- Test: `src/modules/funds-layer/accounting/funds-accounting.service.spec.ts`、`src/modules/funds-layer/constants/internal-transfer-paths.constant.spec.ts`

- [x] **Step 1: 白名单 — mirror 字段**

`internal-transfer-paths.constant.ts`:

```typescript
/** TB 镜像方向:物理资金流完成(funds-flow CLEAR)时在 TB 上记"客户池↔FIRM_OPS" */
export type TbMirror = 'POOL_TO_FIRM' | 'FIRM_TO_POOL';

export interface TransferPathPolicy {
  path: TransferPath;
  from: string;
  to: string;
  class: AccountingClass;
  medium: TransferMedium;
  trigger: string[];
  mirror?: TbMirror;         // 取代 drain
  route?: string[];
}
```

逐路径设置(删除所有 `drain:` 行):
- `INTERNAL_OUT`(C_MAIN→F_LIQ,客户池付币给公司): `mirror: 'POOL_TO_FIRM'`
- `INTERNAL_IN`(F_LIQ→C_MAIN,公司付币给客户池): `mirror: 'FIRM_TO_POOL'`
- `FIAT_SETTLE_OUT`(C_VIBAN→F_LIQ): `mirror: 'POOL_TO_FIRM'`
- `FIAT_SETTLE_IN`(F_LIQ→C_VIBAN): `mirror: 'FIRM_TO_POOL'`
- `FEE_COLLECT`(C_MAIN→F_OPS,提现费去混同): `mirror: 'POOL_TO_FIRM'`
- `FIAT_FEE_COLLECT`(C_VIBAN→F_FEE,提现费去混同): `mirror: 'POOL_TO_FIRM'`
- `FIAT_SPREAD_COLLECT`(F_LIQ→F_FEE,公司内部倒手): **无 mirror**(TB no-op)
- `AGGREGATE`/`FUND_OUT`/`FUND_RETURN`(池内倒手): 无 mirror
删除 `DrainAccount` 类型导出。`internal-transfer-paths.constant.spec.ts` 同步:断言上表每条路径的 mirror 值。

- [x] **Step 2: 写失败测试(mirrorPhysicalTransfer)**

`funds-accounting.service.spec.ts` 重写为:

```typescript
// 核心断言(mock prisma/accounting):
// POOL_TO_FIRM + CRYPTO 资产 → executeTransfer({ debit: FIRM_OPS, credit: CLIENT_CUSTODY, amount: transfer.amount 的 units, code: SETTLE_POOL_TO_FIRM 或 FEE_DECOMMINGLE })
// FIRM_TO_POOL + FIAT 资产  → executeTransfer({ debit: CLIENT_BANK, credit: FIRM_OPS, code: SETTLE_FIRM_TO_POOL })
// 无 mirror 路径(FIAT_SPREAD_COLLECT)→ 返回 { tbApplied: false },不调 executeTransfer
// fee 路径(FEE_COLLECT/FIAT_FEE_COLLECT)→ code 用 FEE_DECOMMINGLE
```

Run: `npx jest src/modules/funds-layer/accounting/funds-accounting.service.spec.ts`
Expected: FAIL

- [x] **Step 3: 实现 mirrorPhysicalTransfer**

`funds-accounting.service.ts` 新增(旧 `applyAccounting`/`drainFeeReceivableAmount` 此任务先不删,仅不再被调用):

```typescript
  /**
   * 物理资金流完成时的 TB 镜像:客户池 ↔ FIRM_OPS,金额 = transfer.amount。
   * 结算腿(SETTLE_*)与提现费去混同(FEE_DECOMMINGLE)共用;公司内部倒手无 mirror → no-op。
   * 幂等:evidence (sourceType, internalTxNo, eventCode) → deterministic transfer id。
   */
  async mirrorPhysicalTransfer(input: {
    internalTransferId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<ApplyResult> {
    const db = input.tx ?? this.prisma;
    const transfer = await db.internalTransaction.findUnique({
      where: { id: input.internalTransferId },
      include: { asset: true },
    });
    if (!transfer) {
      throw new NotFoundException({
        code: 'INTERNAL_TRANSFER_NOT_FOUND',
        message: `Internal transfer ${input.internalTransferId} not found`,
      });
    }

    const policy = TRANSFER_PATH_WHITELIST[transfer.pathLabel as TransferPath];
    const mirror = policy?.mirror;
    if (!mirror) return { tbApplied: false };

    const currency = transfer.asset.currency;
    const ledger = (TB_LEDGERS as Record<string, number>)[currency];
    if (!ledger) {
      throw new NotFoundException({
        code: 'TB_LEDGER_NOT_FOUND',
        message: `Unsupported asset currency for TB accounting: ${currency}`,
      });
    }

    const amount = decimalToTbUnits(new Prisma.Decimal(transfer.amount), transfer.asset.decimals);
    if (amount <= 0n) return { tbApplied: false };

    const poolCode = transfer.asset.type === 'FIAT' ? TB_ACCOUNT_CODES.CLIENT_BANK : TB_ACCOUNT_CODES.CLIENT_CUSTODY;
    const poolId = await this.accounting.resolveTbAccountId({ code: poolCode, ledger, ownerType: 'SYSTEM' });
    const firmId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' });

    const isFeePath =
      transfer.pathLabel === TransferPath.FEE_COLLECT ||
      transfer.pathLabel === TransferPath.FIAT_FEE_COLLECT;

    const debitAccountId = mirror === 'POOL_TO_FIRM' ? firmId : poolId;
    const creditAccountId = mirror === 'POOL_TO_FIRM' ? poolId : firmId;
    const code = isFeePath
      ? TB_TRANSFER_CODES.FEE_DECOMMINGLE
      : mirror === 'POOL_TO_FIRM'
        ? TB_TRANSFER_CODES.SETTLE_POOL_TO_FIRM
        : TB_TRANSFER_CODES.SETTLE_FIRM_TO_POOL;
    const eventCode = isFeePath ? 'FEE_DECOMMINGLE' : mirror === 'POOL_TO_FIRM' ? 'SETTLE_POOL_TO_FIRM' : 'SETTLE_FIRM_TO_POOL';
    const debitTbCode = mirror === 'POOL_TO_FIRM' ? TB_ACCOUNT_CODES.FIRM_OPS : poolCode;
    const creditTbCode = mirror === 'POOL_TO_FIRM' ? poolCode : TB_ACCOUNT_CODES.FIRM_OPS;

    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount,
      ledger,
      code,
      tx: input.tx,
      evidence: {
        sourceType: transfer.sourceType ?? 'INTERNAL_TRANSFER',
        sourceNo: transfer.internalTxNo,
        eventCode,
        debitCode: TB_CODE_TO_COA[debitTbCode],
        creditCode: TB_CODE_TO_COA[creditTbCode],
        assetCurrency: currency,
        traceId: transfer.traceId ?? `MIRROR:${transfer.internalTxNo}`,
        actorType: 'SYSTEM',
        actorId: 'SYSTEM',
        memo: `${transfer.pathLabel} physical mirror (${eventCode})`,
      },
    });

    return { tbApplied: true, tbTransferId };
  }
```

`tb-amount.util.ts` 导出(把 funds-accounting 私有方法提为共享):

```typescript
export function decimalToTbUnits(value: Prisma.Decimal, decimals: number): bigint {
  const truncated = value.toDecimalPlaces(decimals, Prisma.Decimal.ROUND_DOWN).toFixed(decimals);
  const [whole, frac = ''] = truncated.split('.');
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}
```

- [x] **Step 4: 重接三个调用点**

(a) `internal-transfer-workflow.service.ts` initiate 事务内(~141 行)**删除** `applyAccounting` 调用块;在 `onFundsFlowStatusChanged`(CLEAR 分支,审计写之后)追加:

```typescript
      if (event.newStatus === 'CLEAR') {
        await this.accounting.mirrorPhysicalTransfer({ internalTransferId: event.internalTransferId });
        // ……(既有 CLEAR 审计逻辑保持)
      }
```

注意:`fiat-settlement-workflow` 的两跳 transfer 会触发多个 fund 的 CLEAR 事件——deterministic id 保证同一 transfer 只落一笔镜像(重复调用命中 TB `exists` 被吞)。
(b) `fiat-settlement-workflow.service.ts` 168–173 行:`applyAccounting({ accountingClass: B, ... })` → `mirrorPhysicalTransfer({ internalTransferId: transfer.id })`(若 (a) 的统一 CLEAR 钩子已覆盖该路径,则此处直接删除调用,二选一:**优先统一钩子,删除此处**)。
(c) `fiat-fee-collection-workflow.service.ts` `onFundsFlowStatusChanged`(191–211 行):删除 `drainFeeReceivableAmount` 调用——FIAT_FEE_COLLECT 的镜像同样由统一 CLEAR 钩子覆盖;该事件 handler 若再无其他职责则整个删除。

- [x] **Step 5: 测试 + 构建,Commit**

Run: `npx jest src/modules/funds-layer && npm run build`
Expected: PASS(funds-layer 既有 spec 中对 applyAccounting/drain 的断言改为 mirror 行为)

```bash
git add -A && git commit -m "feat(funds-layer): settlement-leg TB mirrors (pool<->FIRM_OPS) replace drain accounting"
```

---

## Task 7: 虚拟币提现费归集额 — Prisma 口径

**Files:**
- Modify: `src/modules/funds-layer/workflow/fee-collection-workflow.service.ts:63-100`
- Test: `src/modules/funds-layer/workflow/fee-collection-workflow.service.spec.ts`

- [x] **Step 1: 写失败测试**

```typescript
// 断言:候选金额 = Σ(SUCCESS 状态 crypto 提现的 feeAmount) − Σ(已 spawn 的 FEE_COLLECTION transfer amount)
// mock prisma.withdrawTransaction.aggregate 返回 fee 合计 0.5,
// mock prisma.internalTransaction.aggregate 返回已归集 0.2,
// 期望 spawn 金额 0.3;两者相等时不 spawn(no-op)。
```

Run: `npx jest src/modules/funds-layer/workflow/fee-collection-workflow.service.spec.ts`
Expected: FAIL

- [x] **Step 2: 改 runFeeCollection 候选计算**

替换 63–100 行的 TB 余额读取(`resolveTbAccountId`+`lookupBalance`)为 Prisma 推导:

```typescript
    const candidates: FeeCandidate[] = [];
    for (const asset of assets) {
      // 应归集 = 成功提现累计 fee − 历史已归集(FEE_COLLECTION transfer 累计)。
      // 推导自不变量「客户池 − Σclaim = 未归集 fee」,无需任何挂账科目。
      const accrued = await (this.prisma as any).withdrawTransaction.aggregate({
        where: { assetId: asset.id, status: 'SUCCESS' },
        _sum: { feeAmount: true },
      });
      const collected = await (this.prisma as any).internalTransaction.aggregate({
        where: { assetId: asset.id, sourceType: FEE_SOURCE_TYPE },
        _sum: { amount: true },
      });
      const net = new Prisma.Decimal(accrued._sum.feeAmount ?? 0).sub(
        new Prisma.Decimal(collected._sum.amount ?? 0),
      );
      if (net.lte(0)) continue;

      candidates.push({ assetId: asset.id, currency: asset.currency, decimals: asset.decimals, netDecimal: net });
    }
```

`FeeCandidate` 接口 `netBigint: bigint` → `netDecimal: Prisma.Decimal`;下方 spawn 处 `bigintToDecimal(candidate.netBigint, ...)` → 直接 `candidate.netDecimal`。删除该文件对 `AccountingService`/`TB_ACCOUNT_CODES`/`TB_LEDGERS`/`bigintToDecimal` 的 import(若不再使用)。`Prisma` 需从 `@prisma/client` import。
注:终态(SUCCESS)不会回退(RETURNED 在 SUCCESS 前分叉),且 FEE_COLLECT spawn 即记账额 → 差额口径自校正,中断重跑安全。

- [x] **Step 3: 测试 + 构建,Commit**

Run: `npx jest src/modules/funds-layer/workflow/fee-collection-workflow.service.spec.ts && npm run build`
Expected: PASS

```bash
git add -A && git commit -m "feat(funds-layer): crypto fee-collect amount derives from Prisma (accrued minus collected), no TB receivable"
```

---

## Task 8: FxEodService — 清桥 + 重估 + 平盘 + 对账

**Files:**
- Create: `src/modules/funds-layer/accounting/fx-eod.service.ts`
- Create: `src/modules/funds-layer/accounting/fx-eod.service.spec.ts`
- Modify: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`(runEodSettlement 尾部接清桥/重估/校验)
- Modify: `src/modules/funds-layer/funds-layer.module.ts`(注册 provider)

- [x] **Step 1: 写失败测试(三块核心算法)**

```typescript
// fx-eod.service.spec.ts — mock accounting.lookupBalance / resolveTbAccountId / executeTransfer、prisma、rateProvider
describe('FxEodService', () => {
  it('sweepBridges: 桥净额减未结算贡献后清入 FX_POSITION,方向随符号', async () => {
    // 给定 USDT 桥 net CREDIT +1000_000000(units)、无 open swap
    // 期望:executeTransfer(debit=TRADE_CLEARING, credit=FX_POSITION, amount=1000_000000, code=BRIDGE_SWEEP_OUT)
    // 给定 AED 桥 net DEBIT −367250(units)
    // 期望:executeTransfer(debit=FX_POSITION, credit=TRADE_CLEARING, amount=367250, code=BRIDGE_SWEEP_IN)
  });
  it('sweepBridges: 部分结算 swap 的桥贡献整笔保留(open 贡献被扣除)', async () => {
    // 桥 net +1500,open swap 贡献 +500 → 只清 1000
  });
  it('revalueFxPositions: target AED 腿 = −Σ(非AED腿净额×fixing),差额记 FX_UNREALIZED_PNL', async () => {
    // FX_POSITION(USDT) net CREDIT 1000(decimal)、FX_POSITION(AED) net DEBIT 3672.50、fixing 3.65
    // target AED net = −(+1000)×3.65 = −3650(debit 3650)→ delta = −3650 − (−3672.50) = +22.50
    // 期望:executeTransfer(debit=FX_UNREALIZED_PNL, credit=FX_POSITION, amount=2250 units, code=FX_REVAL_LOSS)
  });
  it('checkInvariants: I1 客户池=Σclaim、I2 桥残余=open 贡献,违例返回 violation', async () => {});
});
```

Run: `npx jest src/modules/funds-layer/accounting/fx-eod.service.spec.ts`
Expected: FAIL(服务不存在)

- [x] **Step 2: 实现 FxEodService**

```typescript
// src/modules/funds-layer/accounting/fx-eod.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../../accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { BinanceRateProvider } from '../../trading/pricing-center/providers/binance-rate.provider';
import { decimalToTbUnits } from './tb-amount.util';

const BASE_CURRENCY = 'AED';

export interface InvariantViolation { invariant: string; currency: string; detail: string; }
export interface EodAccountingReport {
  sweeps: Array<{ currency: string; amountUnits: string; direction: 'OUT' | 'IN' }>;
  revals: Array<{ currency: string; fixing: string; deltaUnits: string; direction: 'LOSS' | 'GAIN' }>;
  violations: InvariantViolation[];
}

@Injectable()
export class FxEodService {
  private readonly logger = new Logger(FxEodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly rateProvider: BinanceRateProvider,
  ) {}

  /** 主入口:EOD 物理结算完成后调用。batchNo 进 evidence sourceNo → 同批次幂等。 */
  async runEodAccounting(batchNo: string): Promise<EodAccountingReport> {
    const report: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
    await this.sweepBridges(batchNo, report);
    await this.revalueFxPositions(batchNo, report);
    await this.checkInvariants(report);
    this.logger.log(`EOD accounting ${batchNo}: ${JSON.stringify(report)}`);
    return report;
  }

  /** 5.4 清桥:每币种 sweep = 桥净额 − open swap 桥贡献;清入 FX_POSITION。 */
  async sweepBridges(batchNo: string, report: EodAccountingReport): Promise<void> {
    const assets = await (this.prisma as any).asset.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, currency: true, decimals: true },
    });
    const openByCurrency = await this.computeOpenBridgeContributions();

    for (const asset of assets) {
      const ledger = (TB_LEDGERS as Record<string, number>)[asset.currency];
      if (!ledger) continue;

      const bridgeId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger, ownerType: 'SYSTEM',
      });
      const bal = await this.accounting.lookupBalance(bridgeId);
      const bridgeNet = bal.creditsPosted - bal.debitsPosted; // signed units
      const openNet = openByCurrency.get(asset.currency) ?? 0n;
      const sweep = bridgeNet - openNet;
      if (sweep === 0n) continue;

      const fxId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FX_POSITION, ledger, ownerType: 'SYSTEM',
      });
      const out = sweep > 0n;
      await this.accounting.executeTransfer({
        debitAccountId: out ? bridgeId : fxId,
        creditAccountId: out ? fxId : bridgeId,
        amount: out ? sweep : -sweep,
        ledger,
        code: out ? TB_TRANSFER_CODES.BRIDGE_SWEEP_OUT : TB_TRANSFER_CODES.BRIDGE_SWEEP_IN,
        evidence: {
          sourceType: 'EOD_ACCOUNTING',
          sourceNo: batchNo,
          eventCode: `BRIDGE_SWEEP_${asset.currency}`,
          debitCode: TB_CODE_TO_COA[out ? TB_ACCOUNT_CODES.TRADE_CLEARING : TB_ACCOUNT_CODES.FX_POSITION],
          creditCode: TB_CODE_TO_COA[out ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.TRADE_CLEARING],
          assetCurrency: asset.currency,
          traceId: `EODACC:${batchNo}`,
          actorType: 'SYSTEM', actorId: 'SYSTEM',
          memo: `Bridge sweep into FX position (settled swaps only)`,
        },
      });
      report.sweeps.push({ currency: asset.currency, amountUnits: (out ? sweep : -sweep).toString(), direction: out ? 'OUT' : 'IN' });
    }
  }

  /**
   * open swap 的桥贡献(signed,credits−debits 口径,units):
   * from 币 +fromAmount;to 币 −(toAmount(gross)+spreadAmount)。
   * open = 该 swap 存在任一 Outstanding 状态 ≠ SETTLED。
   */
  private async computeOpenBridgeContributions(): Promise<Map<string, bigint>> {
    const openSwapIds = await (this.prisma as any).outstanding.findMany({
      where: { status: { not: 'SETTLED' }, swapTransactionId: { not: null } },
      select: { swapTransactionId: true },
      distinct: ['swapTransactionId'],
    });
    const ids = openSwapIds.map((o: any) => o.swapTransactionId);
    const map = new Map<string, bigint>();
    if (ids.length === 0) return map;

    const swaps = await (this.prisma as any).swapTransaction.findMany({
      where: { id: { in: ids } },
      select: {
        fromAmount: true, toAmount: true, spreadAmount: true,
        fromAsset: { select: { currency: true, decimals: true } },
        toAsset: { select: { currency: true, decimals: true } },
      },
    });
    for (const s of swaps) {
      const fromUnits = decimalToTbUnits(new Prisma.Decimal(s.fromAmount), s.fromAsset.decimals);
      const toUnits = decimalToTbUnits(
        new Prisma.Decimal(s.toAmount).add(new Prisma.Decimal(s.spreadAmount ?? 0)),
        s.toAsset.decimals,
      );
      map.set(s.fromAsset.currency, (map.get(s.fromAsset.currency) ?? 0n) + fromUnits);
      map.set(s.toAsset.currency, (map.get(s.toAsset.currency) ?? 0n) - toUnits);
    }
    return map;
  }

  /** 6.1 重估:target AED 腿净额 = −Σ(非AED FX 腿净额 × fixing);差额 → FX_UNREALIZED_PNL(AED)。 */
  async revalueFxPositions(batchNo: string, report: EodAccountingReport): Promise<void> {
    const aedLedger = TB_LEDGERS[BASE_CURRENCY as keyof typeof TB_LEDGERS];
    const assets = await (this.prisma as any).asset.findMany({
      where: { status: 'ACTIVE' },
      select: { currency: true, decimals: true },
    });
    const aedAsset = assets.find((a: any) => a.currency === BASE_CURRENCY);
    if (!aedAsset) return;

    let targetAedNet = new Prisma.Decimal(0); // credits−debits 口径(decimal)
    for (const asset of assets) {
      if (asset.currency === BASE_CURRENCY) continue;
      const ledger = (TB_LEDGERS as Record<string, number>)[asset.currency];
      if (!ledger) continue;
      const fxId = await this.accounting.resolveTbAccountId({
        code: TB_ACCOUNT_CODES.FX_POSITION, ledger, ownerType: 'SYSTEM',
      });
      const bal = await this.accounting.lookupBalance(fxId);
      const netUnits = bal.creditsPosted - bal.debitsPosted;
      if (netUnits === 0n) continue;
      const netDecimal = new Prisma.Decimal(netUnits.toString()).div(new Prisma.Decimal(10).pow(asset.decimals));
      const { rate } = await this.rateProvider.fetchRate(asset.currency, BASE_CURRENCY);
      targetAedNet = targetAedNet.sub(netDecimal.mul(rate)); // target = −Σ(leg×fixing)
      report.revals.push({ currency: asset.currency, fixing: rate.toString(), deltaUnits: '0', direction: 'LOSS' });
    }

    const aedFxId = await this.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.FX_POSITION, ledger: aedLedger, ownerType: 'SYSTEM',
    });
    const aedBal = await this.accounting.lookupBalance(aedFxId);
    const currentAedNetUnits = aedBal.creditsPosted - aedBal.debitsPosted;
    const targetAedNetUnits = decimalToTbUnits(targetAedNet.abs(), aedAsset.decimals) * (targetAedNet.isNegative() ? -1n : 1n);
    const delta = targetAedNetUnits - currentAedNetUnits;
    if (delta === 0n) return;

    const unrealizedId = await this.accounting.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, ledger: aedLedger, ownerType: 'SYSTEM',
    });
    // delta > 0 → AED 腿要变"更贷/更少借" = 头寸缩水 = 亏:借 FX_UNREALIZED / 贷 FX_POSITION
    const loss = delta > 0n;
    await this.accounting.executeTransfer({
      debitAccountId: loss ? unrealizedId : aedFxId,
      creditAccountId: loss ? aedFxId : unrealizedId,
      amount: loss ? delta : -delta,
      ledger: aedLedger,
      code: loss ? TB_TRANSFER_CODES.FX_REVAL_LOSS : TB_TRANSFER_CODES.FX_REVAL_GAIN,
      evidence: {
        sourceType: 'EOD_ACCOUNTING',
        sourceNo: batchNo,
        eventCode: 'FX_REVAL_AED',
        debitCode: TB_CODE_TO_COA[loss ? TB_ACCOUNT_CODES.FX_UNREALIZED_PNL : TB_ACCOUNT_CODES.FX_POSITION],
        creditCode: TB_CODE_TO_COA[loss ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.FX_UNREALIZED_PNL],
        assetCurrency: BASE_CURRENCY,
        traceId: `EODACC:${batchNo}`,
        actorType: 'SYSTEM', actorId: 'SYSTEM',
        memo: 'Daily FX mark-to-fixing (full position restate)',
      },
    });
    const last = report.revals[report.revals.length - 1];
    if (last) { last.deltaUnits = (loss ? delta : -delta).toString(); last.direction = loss ? 'LOSS' : 'GAIN'; }
  }

  /** 6.2 LP 平盘(demo/手动触发):全量平掉一个非 AED 头寸。 */
  async realizeFxPosition(input: { currency: string; fillRate: Prisma.Decimal; operatorId: string }): Promise<void> {
    const aedLedger = TB_LEDGERS[BASE_CURRENCY as keyof typeof TB_LEDGERS];
    const ledger = (TB_LEDGERS as Record<string, number>)[input.currency];
    const assets = await (this.prisma as any).asset.findMany({
      where: { currency: { in: [input.currency, BASE_CURRENCY] } },
      select: { currency: true, decimals: true },
    });
    const cur = assets.find((a: any) => a.currency === input.currency);
    const aed = assets.find((a: any) => a.currency === BASE_CURRENCY);

    const fxCurId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FX_POSITION, ledger, ownerType: 'SYSTEM' });
    const fxAedId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FX_POSITION, ledger: aedLedger, ownerType: 'SYSTEM' });
    const firmCurId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger, ownerType: 'SYSTEM' });
    const firmAedId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_OPS, ledger: aedLedger, ownerType: 'SYSTEM' });
    const realizedId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FX_REALIZED_PNL, ledger: aedLedger, ownerType: 'SYSTEM' });
    const unrealizedId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FX_UNREALIZED_PNL, ledger: aedLedger, ownerType: 'SYSTEM' });

    const curBal = await this.accounting.lookupBalance(fxCurId);
    const qtyUnits = curBal.creditsPosted - curBal.debitsPosted; // 长仓为正(贷方腿)
    if (qtyUnits === 0n) return;
    const long = qtyUnits > 0n;
    const qtyAbs = long ? qtyUnits : -qtyUnits;
    const qtyDecimal = new Prisma.Decimal(qtyAbs.toString()).div(new Prisma.Decimal(10).pow(cur.decimals));
    const proceedsUnits = decimalToTbUnits(qtyDecimal.mul(input.fillRate), aed.decimals);

    const aedBal = await this.accounting.lookupBalance(fxAedId);
    const carryingUnits = aedBal.debitsPosted - aedBal.creditsPosted; // 长仓时为正(借方腿,市值口径)
    const unrlBal = await this.accounting.lookupBalance(unrealizedId);
    const unrealizedNet = unrlBal.debitsPosted - unrlBal.creditsPosted; // 借方=累计亏

    const seq = [
      // ① 币腿平掉:长仓付币给 LP(借 FX_POSITION(cur) / 贷 FIRM_OPS(cur));短仓反向
      {
        debit: long ? fxCurId : firmCurId, credit: long ? firmCurId : fxCurId, amount: qtyAbs, ledger,
        event: 'FX_REALIZE_LEG', cur: input.currency,
        dCode: long ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.FIRM_OPS,
        cCode: long ? TB_ACCOUNT_CODES.FIRM_OPS : TB_ACCOUNT_CODES.FX_POSITION,
      },
      // ② AED 腿:收/付 proceeds,头寸账面清零,差额进 FX_REALIZED_PNL —— 拆两笔等价分录:
      //    (a) 借 FIRM_OPS(AED) proceeds / 贷 FX_POSITION(AED) proceeds   (长仓;短仓反向)
      {
        debit: long ? firmAedId : fxAedId, credit: long ? fxAedId : firmAedId, amount: proceedsUnits, ledger: aedLedger,
        event: 'FX_REALIZE_PROCEEDS', cur: BASE_CURRENCY,
        dCode: long ? TB_ACCOUNT_CODES.FIRM_OPS : TB_ACCOUNT_CODES.FX_POSITION,
        cCode: long ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.FIRM_OPS,
      },
    ];
    for (const t of seq) {
      await this.accounting.executeTransfer({
        debitAccountId: t.debit, creditAccountId: t.credit, amount: t.amount, ledger: t.ledger,
        code: TB_TRANSFER_CODES.FX_REALIZE,
        evidence: {
          sourceType: 'FX_REALIZE', sourceNo: `${input.currency}:${Date.now()}`, eventCode: t.event,
          debitCode: TB_CODE_TO_COA[t.dCode], creditCode: TB_CODE_TO_COA[t.cCode],
          assetCurrency: t.cur, traceId: `FXREAL:${input.currency}`,
          actorType: 'ADMIN', actorId: input.operatorId, memo: `LP fill @${input.fillRate}`,
        },
      });
    }
    //    (b) 残值清零:平盘后 FX_POSITION(AED) 残余 = carrying − proceeds(>0 亏 / <0 赚)→ FX_REALIZED_PNL
    const residual = (long ? carryingUnits : -carryingUnits) - proceedsUnits;
    if (residual !== 0n) {
      const lossSide = residual > 0n;
      await this.accounting.executeTransfer({
        debitAccountId: lossSide ? realizedId : fxAedId,
        creditAccountId: lossSide ? fxAedId : realizedId,
        amount: lossSide ? residual : -residual,
        ledger: aedLedger, code: TB_TRANSFER_CODES.FX_REALIZE,
        evidence: {
          sourceType: 'FX_REALIZE', sourceNo: `${input.currency}:${Date.now()}:PNL`, eventCode: 'FX_REALIZE_PNL',
          debitCode: TB_CODE_TO_COA[lossSide ? TB_ACCOUNT_CODES.FX_REALIZED_PNL : TB_ACCOUNT_CODES.FX_POSITION],
          creditCode: TB_CODE_TO_COA[lossSide ? TB_ACCOUNT_CODES.FX_POSITION : TB_ACCOUNT_CODES.FX_REALIZED_PNL],
          assetCurrency: BASE_CURRENCY, traceId: `FXREAL:${input.currency}`,
          actorType: 'ADMIN', actorId: input.operatorId, memo: 'Realized PnL on close (carrying minus proceeds)',
        },
      });
    }
    //    (c) 浮动转已实现:把 FX_UNREALIZED 余额回转进 FX_REALIZED(全量平仓语义)
    if (unrealizedNet !== 0n) {
      const wasLoss = unrealizedNet > 0n;
      await this.accounting.executeTransfer({
        debitAccountId: wasLoss ? realizedId : unrealizedId,
        creditAccountId: wasLoss ? unrealizedId : realizedId,
        amount: wasLoss ? unrealizedNet : -unrealizedNet,
        ledger: aedLedger, code: TB_TRANSFER_CODES.FX_REALIZE,
        evidence: {
          sourceType: 'FX_REALIZE', sourceNo: `${input.currency}:${Date.now()}:RECLASS`, eventCode: 'FX_UNREALIZED_RECLASS',
          debitCode: TB_CODE_TO_COA[wasLoss ? TB_ACCOUNT_CODES.FX_REALIZED_PNL : TB_ACCOUNT_CODES.FX_UNREALIZED_PNL],
          creditCode: TB_CODE_TO_COA[wasLoss ? TB_ACCOUNT_CODES.FX_UNREALIZED_PNL : TB_ACCOUNT_CODES.FX_REALIZED_PNL],
          assetCurrency: BASE_CURRENCY, traceId: `FXREAL:${input.currency}`,
          actorType: 'ADMIN', actorId: input.operatorId, memo: 'Reclass unrealized → realized on close',
        },
      });
    }
  }

  /** 7. 对账不变量 I1/I2(硬校验)+ I5(报告级)。 */
  async checkInvariants(report: EodAccountingReport): Promise<void> {
    const assets = await (this.prisma as any).asset.findMany({
      where: { status: 'ACTIVE' },
      select: { currency: true, type: true },
    });
    const registry = (this.prisma as any).tbAccountRegistry;

    for (const asset of assets) {
      const ledger = (TB_LEDGERS as Record<string, number>)[asset.currency];
      if (!ledger) continue;

      // I1: 客户池(借方资产) = ΣCLIENT_CREDIT + ΣCLIENT_AUDIT(贷方负债)
      const poolCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.CLIENT_BANK : TB_ACCOUNT_CODES.CLIENT_CUSTODY;
      const poolId = await this.accounting.resolveTbAccountId({ code: poolCode, ledger, ownerType: 'SYSTEM' });
      const poolBal = await this.accounting.lookupBalance(poolId);
      const poolNet = poolBal.debitsPosted - poolBal.creditsPosted;

      let claims = 0n;
      const claimEntries = await registry.findMany({
        where: { ledger, code: { in: [TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.CLIENT_AUDIT] } },
        select: { tbAccountId: true },
      });
      for (const e of claimEntries) {
        const b = await this.accounting.lookupBalance(BigInt('0x' + e.tbAccountId));
        claims += b.creditsPosted - b.debitsPosted;
      }
      if (poolNet !== claims) {
        report.violations.push({ invariant: 'I1', currency: asset.currency, detail: `pool=${poolNet} claims=${claims}` });
      }

      // I2: 桥残余 = open swap 贡献
      const bridgeId = await this.accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger, ownerType: 'SYSTEM' });
      const bridgeBal = await this.accounting.lookupBalance(bridgeId);
      const bridgeNet = bridgeBal.creditsPosted - bridgeBal.debitsPosted;
      const open = (await this.computeOpenBridgeContributions()).get(asset.currency) ?? 0n;
      if (bridgeNet !== open) {
        report.violations.push({ invariant: 'I2', currency: asset.currency, detail: `bridge=${bridgeNet} open=${open}` });
      }
    }
  }
}
```

实现注意:
- `tbAccountRegistry` 的 Prisma model 名以 `tb-account-registry.service.ts` 实际 schema 为准(执行时先读该文件,如 hex 存法不同,用 `hexToBigint` util)。
- `realizeFxPosition` 的 `Date.now()` 在 sourceNo 里(平盘非幂等操作,允许;demo 单次调用)。
- 重估 evidence sourceNo=batchNo → 同批次重跑幂等(deterministic id)。

- [x] **Step 3: 接入 EOD workflow**

`eod-settlement-workflow.service.ts`:constructor 注入 `private readonly fxEod: FxEodService`;`runEodSettlement` 在 `recomputeBatch` 之后追加:

```typescript
    // V8 two-book: bridge sweep + FX reval + invariant checks ride the same EOD run.
    // Settled-swap aggregation makes this correct even when some legs remain open.
    await this.fxEod.runEodAccounting(batch.batchNo);
```

并在该 workflow 的 CLEAR 事件 handler 完成最后一个 item 结算后(批次关闭分支,如有)也调一次 `runEodAccounting(batch.batchNo)`(同 batchNo 幂等,保证"结算异步 CLEAR 之后桥才可清"的时序)。`funds-layer.module.ts` providers 数组加入 `FxEodService`;`BinanceRateProvider` 若不在本模块可注入范围,imports 对应模块(查 `pricing-center` 的 module 导出,没有则在该 module exports 中补)。

- [x] **Step 4: 测试 + 构建,Commit**

Run: `npx jest src/modules/funds-layer/accounting/fx-eod.service.spec.ts && npm run build`
Expected: PASS

```bash
git add -A && git commit -m "feat(funds-layer): FxEodService — bridge sweep, daily FX reval, LP realize, invariant checks"
```

---

## Task 9: 删除 FEE_RECEIVABLE 与全部死代码

**Files:**
- Modify: `tb-account-codes.constant.ts`(删 FEE_RECEIVABLE + 'L.FEE_RECEIVABLE')
- Modify: `tb-transfer-codes.constant.ts`(删 EOD_DRAIN_OUT/EOD_DRAIN_IN/FEE_DRAIN)
- Modify: `funds-accounting.service.ts`(删 `applyAccounting` + `drainFeeReceivableAmount` + 私有 `decimalToTbUnits`)
- Modify: `internal-transfer-paths.constant.ts`(确认无 drain 残留)
- Modify: `tb-manual-account.service.ts`(SYSTEM 科目白名单:删 FEE_RECEIVABLE,加 FIRM_OPS/FX_POSITION/PAID_IN_CAPITAL/RETAINED_EARNINGS/FEE_INCOME/SPREAD_INCOME/FX_UNREALIZED_PNL/FX_REALIZED_PNL)
- Delete/Rewrite: `scripts/verify-tb-drain.ts`(drain 体系已死 → 删除;替代验证在 Task 10 的 verify-two-book.ts)
- Modify: `scripts/seed-eod-demo.ts`、`scripts/seed-fiat-settle-demo.ts`(科目引用改名已在 Task 1;此处确认无 FEE_RECEIVABLE/drain 依赖)

- [x] **Step 1: 全局搜索确认无运行时引用**

Run: `grep -rn "FEE_RECEIVABLE\|EOD_DRAIN\|FEE_DRAIN\|applyAccounting\|drainFeeReceivableAmount" --include="*.ts" src prisma scripts | grep -v spec`
Expected: 仅常量定义本身(将在本任务删除)

- [x] **Step 2: 删除上述符号与函数;受影响 spec 同步删除/改写**

- [x] **Step 3: 全量测试 + 构建**

Run: `npx jest && npm run build`
Expected: 全绿(期间任何 FEE_RECEIVABLE 断言残留 → 一并清)

- [x] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(accounting): delete FEE_RECEIVABLE and drain accounting (two-book cutover complete)"
```

---

## Task 10: 重建 DB + 全链 demo 验收

**Files:**
- Create: `scripts/verify-two-book.ts`
- Modify: `package.json`(可选:`"verify:two-book": "ts-node scripts/verify-two-book.ts"`)

- [x] **Step 1: 写全链验证脚本**

参照 `scripts/verify-tb-drain.ts`(删除前的副本)与 `scripts/seed-eod-demo.ts` 的 Nest 上下文引导模式,脚本步骤:

```
1. 充值:C-001 入 1000 USDT(走 deposit workflow 两步)→ 断言 CLIENT_CUSTODY=1000、CLIENT_CREDIT=1000、CLIENT_AUDIT=0
2. 兑换方向一:卖 1000 USDT 买 AED(mock/固定 quote: mid 3.6725, markup 2%, fee 2%)
   → 断言 T1 后:CLIENT_CREDIT(AED)=3527.07、FEE_INCOME(AED)=71.98、SPREAD_INCOME(AED)=73.45、
     TRADE_CLEARING(USDT)=+1000、TRADE_CLEARING(AED)=−3672.50
3. 法币腿结算(fiat-settlement sim 到 CLEAR)→ 断言 CLIENT_BANK(AED)+3527.07、FIRM_OPS(AED)−3527.07
4. EOD(runEodSettlement)→ 断言:
   I2 桥清零(两币种)、FX_POSITION(USDT) 贷方 1000、FX_POSITION(AED) 借方 3672.50(±重估)、
   I1 客户账本 A=L、violations=[]
5. 提现:C-001 提 100 AED(fee 5)→ 成功 post → 断言 FEE_INCOME(AED) 增 5;
   FIAT_FEE_COLLECT CLEAR 后 FEE_DECOMMINGLE 镜像:CLIENT_BANK −5、FIRM_OPS +5;I1 复绿
6. 平盘:fxEod.realizeFxPosition({ currency:'USDT', fillRate: 3.62 })
   → 断言 FX_POSITION 两腿清零、FX_REALIZED_PNL = 实际差额、FX_UNREALIZED 归零
7. 输出汇总表(各科目终态余额)+ 不变量结果,任何断言失败 exit 1
```

金额断言全部以 TB units(bigint)精确比对,数字锚点取 spec 第 8 节。

- [x] **Step 2: 重建 + 跑通**

Run:
```bash
lsof -ti:3500,3501,3502 | xargs kill -9 2>/dev/null; npm run dev:rebuild && npx ts-node scripts/verify-two-book.ts
```
Expected: 脚本输出每步断言 PASS,exit 0。失败 → 修复后重跑(禁止跳过断言)。

- [x] **Step 3: 全量回归**

Run: `npx jest && npm run build`
Expected: 全绿

- [x] **Step 4: Commit + 文档**

```bash
git add -A && git commit -m "test(accounting): verify-two-book full-chain acceptance (deposit→swap→settle→EOD→withdraw→realize)"
```

更新 `doc-final/reference/roadmap.md`(两本账落地条目)+ 本计划 checkbox 全勾。

---

## Self-Review 记录

- **Spec 覆盖**:§2 COA→Task 1/3;§3 充值→Task 1(改名即生效,deposit-workflow 无语义改动);§4 提现→Task 5/6/7;§5 兑换→Task 4/6/8;§6 EOD/FX→Task 8;§7 不变量→Task 8 checkInvariants + Task 10 断言;§9 一刀换血→Task 9 清尾;§10 验收→Task 10。RETAINED_EARNINGS 仅开科目(Task 3),无结转逻辑 = spec §11 范围外,一致。
- **占位符**:Task 4/7 的测试以"断言要点+关键 expect"给出而非整文件 —— 模块既有 spec 提供了搭建模式,断言内容已完整给出,不构成 TBD。
- **类型一致性**:`mirrorPhysicalTransfer`/`decimalToTbUnits`/`FxEodService.runEodAccounting(batchNo)` 三个新签名在 Task 6/8/10 间引用一致;transfer code 名(SETTLE_POOL_TO_FIRM 等)与 Task 2 定义一致。
- **顺序安全**:每个 Task 收尾 build+jest 全绿;FEE_RECEIVABLE 物理删除推迟到 Task 9,但 Task 4 起运行时已无写入方。
