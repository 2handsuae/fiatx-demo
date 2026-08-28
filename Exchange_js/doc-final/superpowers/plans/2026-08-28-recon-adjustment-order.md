# 对账破口平账 · 一期调账单 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让对账破口有账务出路——运营针对一条差异项开一张调账单，经审批后落一笔账本分录，重对账时 case 自愈。

**Architecture:** 新建 `ReconciliationAdjustment` 主体（**不是订单，无资金单，不动真钱，无在途**；4 态状态机，`POSTED` 不可撤），挂在对账 case 的差异项上。审批复用治理域现成审批中心（`ApprovalsService` + `ApprovalHandlerBase`，actionType `RECON_ADJUSTMENT_POST`，默认单步 `OPS_OFFICER`）。落账走 `AccountingService.executeTransfer`，evidence 带 `walletRef` + `isExternalCrossing: false`；`TbEvidenceService` 自动投影进 `account_flows`，重对账时内部余额变动 → delta 归零 → 现有 `autoHealCases()` 关案。

**Tech Stack:** NestJS 10 ｜ Prisma 5.22 + SQLite ｜ TigerBeetle 复式账本 ｜ React 18 + Vite（admin-web）｜ Jest（`testRegex: '.*\.spec\.ts$'`，roots = `src` + `admin-web/src` + `client-web/src`）｜ e2e = `test/*.e2e-spec.ts`，配置 `test/jest-e2e.json`

**Spec:** `doc-final/superpowers/specs/2026-08-27-recon-adjustment-order-design.md`（**v2，2026-08-28 重写版；先读完再动手**，尤其 §0 决策记录里被推翻的初稿口径、§3 四种分录组合、§4 守卫、§5 成因清单）

## Global Constraints

- **§1 边界线**：调账单**不得**补记真实发生的客户资金流入或流出。外面真有钱进出而我方未记的归交易三域。违反 = 绕 KYT 与合规闸（铁律②）。
- **本期无资金单、无订单层、无真实转账**。`decisions.md [2026-08-28]`：资金单的判据是「有没有在途要追」，纠错没有。**不许顺手给它建资金单。**
- **铁律③**：一律不直写 TigerBeetle，只调 `AccountingService`；不直写 `account_flows`（由 `TbEvidenceService` 投影）。
- **铁律④**：4 态迁移表显式声明，非法跃迁显式拒绝。`POSTED` / `REJECTED` 终态。
- **铁律⑥**：`adjustmentNo` 对外；**任何界面不得出现 UUID**（`ownerId` 只在服务端用）。
- **金额一律最小单位（分）整数**，与 `account_flows.amount` 同口径。
- **落账 evidence 必带** `debitWalletRef` / `creditWalletRef` = case 的 `walletRef`，`isExternalCrossing: false`。漏 walletRef → delta 不归零 → case 无法自愈。**本计划最容易写错的一处，Task 5 第一个测试专门断言它。**
- **不新增任何科目**（`decisions.md [2026-08-13]` COA 终盘 9 码）。
- **禁做清单**（CLAUDE.md §2）：不写幂等/去重/重试/并发锁/迁移兼容层/防御性校验。数据随时可重铺。
- 测试的绿必须来自行为；**禁止扫源码文本型断言**。
- 随手闸（每个 Task 收尾）：`npx tsc --noEmit -p tsconfig.json` + `cd admin-web && npx tsc -b --noEmit` + `cd client-web && npx tsc -b --noEmit`。

---

## File Structure

**新建**
| 文件 | 职责 |
|---|---|
| `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts` | 纯函数：成因合法性 + 四种分录组合 + 原单守卫 |
| `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts` | 网格测试 |
| `src/modules/clearing-settle/reconciliation/constants/adjustment-transitions.constant.ts` | 4 态迁移表 |
| `src/modules/clearing-settle/reconciliation/dto/adjustment.dto.ts` | DTO |
| `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts` | 开单 / 提交 / 落账 / 驳回 |
| `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts` | 服务行为测试 |
| `src/modules/clearing-settle/reconciliation/disposition/adjustment-approval.service.ts` | 审批 handler |
| `src/modules/clearing-settle/reconciliation/disposition/adjustment-approval.service.spec.ts` | handler 测试 |
| `src/modules/clearing-settle/reconciliation/disposition/adjustment.controller.ts` | admin 端点 |
| `admin-web/src/pages/ReconciliationAdjustmentDetailPage.tsx` | 调账单详情 |
| `test/recon-adjustment-money-arcs.e2e-spec.ts` | 全链 e2e |

**修改**
| 文件 | 改什么 |
|---|---|
| `prisma/schema.prisma` | 加 `ReconciliationAdjustment` model |
| `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts` | 加 `RECON_ADJUSTMENT` 转账码 |
| `src/modules/governance/approvals/constants/approval.constants.ts` | 加 actionType + 默认策略 |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | 加 `RECON_ADJUSTMENT_POSTED`（对账域 4 → 5 码）+ 实体类型 |
| `src/modules/identity/access-control/rbac.catalog.ts` | 登记 3 端点 + `RECON_ADJUSTMENT_WRITE` |
| `src/modules/clearing-settle/reconciliation/reconciliation.module.ts` | 注册新 service / controller |
| `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` | `getCase` 的差异项带上「已有调账单」标记 |
| `admin-web/src/pages/ReconciliationCasesDetailPage.tsx` | 差异项行加「开调账单」入口 + 表单弹层 |

**本期不碰** `client-web/`——客户可见面并入「客户流水读模型加工层」任务（BACKLOG 已带完整设计）。一期落地后客户流水会短暂出现天书行，**已知并接受，不要顺手修**。

---

## Task 1: 数据模型与迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_recon_adjustment/migration.sql`（由 `prisma migrate dev` 生成）
- Test: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: Prisma model `ReconciliationAdjustment`；后续所有 Task 依赖这些字段名

- [ ] **Step 1: 加 model**

`prisma/schema.prisma` 中 `model ReconciliationLineItem` 之后追加：

```prisma
model ReconciliationAdjustment {
  id              String    @id @default(uuid())
  adjustmentNo    String    @unique @default("TEMP")
  caseNo          String
  lineItemId      String?
  walletRef       String
  book            String    // CLIENT | FIRM —— 取自 case.book，非表单字段
  direction       String    // REDUCE | INCREASE —— 内部余额该往哪边动
  reasonCode      String    // spec §5 七个成因码之一
  relatedOrderNo  String?   // 关联原单业务号；book=CLIENT 且 direction=INCREASE 时必填
  assetCode       String
  amount          String    // 最小单位（分）整数，存字符串避免精度损失
  effectiveDate   String    // YYYY-MM-DD 业务生效日
  reasonInternal  String
  reasonCustomer  String    // 本期不展示，留给客户流水读模型任务
  status          String    @default("DRAFT") // DRAFT | PENDING_APPROVAL | POSTED | REJECTED
  approvalCaseId  String?
  approvalNo      String?
  ownerNo         String?   // 客户业务号 —— 对外用它
  ownerId         String?   // 客户 UUID —— 仅服务端 resolveTbAccountId 用，任何界面不得展示
  traceId         String?
  createdByUserId String
  decidedByUserId String?
  postedAt        DateTime?
  tbTransferId    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([caseNo])
  @@index([status])
  @@index([lineItemId])
  @@map("reconciliation_adjustments")
}
```

- [ ] **Step 2: 生成迁移**

```bash
npx prisma migrate dev --name recon_adjustment && npm run prisma:generate
```

预期：新增迁移目录，`CREATE TABLE "reconciliation_adjustments"` 出现在 migration.sql。

- [ ] **Step 3: 写建表冒烟测试**

创建 `adjustment.service.spec.ts`：

```ts
import { PrismaClient } from '@prisma/client';

describe('ReconciliationAdjustment schema', () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  it('persists an adjustment row with the documented defaults', async () => {
    const row = await (prisma as any).reconciliationAdjustment.create({
      data: {
        adjustmentNo: 'ADJ_SCHEMA_SMOKE_1',
        caseNo: 'CASE_SMOKE', walletRef: 'W_SMOKE', book: 'CLIENT',
        direction: 'REDUCE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
        assetCode: 'AED', amount: '1500', effectiveDate: '2026-08-28',
        reasonInternal: 'smoke', reasonCustomer: 'smoke',
        createdByUserId: 'U_SMOKE',
      },
    });
    expect(row.status).toBe('DRAFT');
    expect(row.postedAt).toBeNull();
    await (prisma as any).reconciliationAdjustment.delete({ where: { id: row.id } });
  });
});
```

- [ ] **Step 4: 跑测试**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts
```

预期：1 passed。报 `reconciliationAdjustment is not a function` = Step 2 的 `prisma:generate` 没成功。

- [ ] **Step 5: 随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && git add prisma/schema.prisma prisma/migrations src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts && git commit -m "feat(recon): 调账单数据模型 + 迁移"
```

---

## Task 2: 规则纯函数（成因合法性 + 分录 + 原单守卫）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts`
- Test: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts`

**Interfaces:**
- Consumes: `TB_ACCOUNT_CODES`（`src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`）
- Produces:
  - 类型 `Book = 'CLIENT'|'FIRM'`、`Direction = 'REDUCE'|'INCREASE'`、`ReasonCode`（7 个字面量联合）
  - `REASON_SPECS: Record<ReasonCode, { book: Book; directions: Direction[]; customerLabel: string | null }>`
  - `assertReasonAllowed(reasonCode, book, direction): void`（非法组合抛 `BadRequestException`）
  - `resolvePostingLegs(book, direction): { debitCode: number; creditCode: number }`
  - `requiresRelatedOrder(book, direction): boolean`

- [ ] **Step 1: 先写失败测试**

创建 `adjustment-rules.spec.ts`：

```ts
import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import {
  REASON_SPECS, assertReasonAllowed, resolvePostingLegs, requiresRelatedOrder,
} from './adjustment-rules';

describe('resolvePostingLegs —— 四种组合，成因不参与计算', () => {
  it('客户账簿 · 减：借客户应付 / 贷客户托管', () => {
    expect(resolvePostingLegs('CLIENT', 'REDUCE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      creditCode: TB_ACCOUNT_CODES.CLIENT_ASSET,
    });
  });

  it('客户账簿 · 加：借客户托管 / 贷客户应付', () => {
    expect(resolvePostingLegs('CLIENT', 'INCREASE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_ASSET,
      creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
    });
  });

  it('公司账簿 · 减：借公司运营 / 贷公司资产', () => {
    expect(resolvePostingLegs('FIRM', 'REDUCE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.FIRM_OPS,
      creditCode: TB_ACCOUNT_CODES.FIRM_ASSET,
    });
  });

  it('公司账簿 · 加：借公司资产 / 贷其他收入', () => {
    expect(resolvePostingLegs('FIRM', 'INCREASE')).toEqual({
      debitCode: TB_ACCOUNT_CODES.FIRM_ASSET,
      creditCode: TB_ACCOUNT_CODES.INCOME_OTHER,
    });
  });
});

describe('requiresRelatedOrder —— §4 边界线守卫', () => {
  it('客户账簿加钱必须有原单', () => {
    expect(requiresRelatedOrder('CLIENT', 'INCREASE')).toBe(true);
  });
  it('其余三种组合不强制', () => {
    expect(requiresRelatedOrder('CLIENT', 'REDUCE')).toBe(false);
    expect(requiresRelatedOrder('FIRM', 'INCREASE')).toBe(false);
    expect(requiresRelatedOrder('FIRM', 'REDUCE')).toBe(false);
  });
});

describe('assertReasonAllowed —— 成因 × 账簿 × 方向 合法组合写死', () => {
  it('充值金额更正在客户账簿上双向都合法', () => {
    expect(() => assertReasonAllowed('DEPOSIT_AMOUNT_CORRECTION', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('DEPOSIT_AMOUNT_CORRECTION', 'CLIENT', 'INCREASE')).not.toThrow();
  });

  it('重复入账撤销只能减', () => {
    expect(() => assertReasonAllowed('DEPOSIT_DUPLICATE_REVERSAL', 'CLIENT', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('DEPOSIT_DUPLICATE_REVERSAL', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
  });

  it('银行利息只能落公司账簿、只能加', () => {
    expect(() => assertReasonAllowed('BANK_INTEREST', 'FIRM', 'INCREASE')).not.toThrow();
    expect(() => assertReasonAllowed('BANK_INTEREST', 'CLIENT', 'INCREASE')).toThrow(BadRequestException);
    expect(() => assertReasonAllowed('BANK_INTEREST', 'FIRM', 'REDUCE')).toThrow(BadRequestException);
  });

  it('银行费用只能落公司账簿、只能减', () => {
    expect(() => assertReasonAllowed('BANK_CHARGE', 'FIRM', 'REDUCE')).not.toThrow();
    expect(() => assertReasonAllowed('BANK_CHARGE', 'CLIENT', 'REDUCE')).toThrow(BadRequestException);
  });

  it('客户侧成因不能落公司账簿', () => {
    expect(() => assertReasonAllowed('WITHDRAW_VOID_REFUND', 'FIRM', 'INCREASE')).toThrow(BadRequestException);
  });

  it('成因清单恰好七个，且无兜底档', () => {
    const codes = Object.keys(REASON_SPECS).sort();
    expect(codes).toEqual([
      'BANK_CHARGE', 'BANK_INTEREST',
      'DEPOSIT_AMOUNT_CORRECTION', 'DEPOSIT_DUPLICATE_REVERSAL', 'DEPOSIT_SIGNAL_VOID',
      'WITHDRAW_AMOUNT_CORRECTION', 'WITHDRAW_VOID_REFUND',
    ]);
  });

  it('公司账簿成因没有客户口径词（客户看不到公司侧调账）', () => {
    expect(REASON_SPECS.BANK_INTEREST.customerLabel).toBeNull();
    expect(REASON_SPECS.BANK_CHARGE.customerLabel).toBeNull();
    expect(REASON_SPECS.DEPOSIT_DUPLICATE_REVERSAL.customerLabel).toBe('重复入账撤销');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts
```

预期：FAIL，`Cannot find module './adjustment-rules'`。

- [ ] **Step 3: 写实现**

创建 `adjustment-rules.ts`：

```ts
// 调账规则（spec §3/§4/§5）——纯函数，无 IO。
// 关键认知：借贷科目**只由（账簿 × 方向）决定**，成因不参与计算。成因只用于
// 留痕、客户文案、闸门。故没有 shape/bearer 这类字段（初稿有，已删，见 spec §0）。
import { BadRequestException } from '@nestjs/common';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';

export type Book = 'CLIENT' | 'FIRM';
export type Direction = 'REDUCE' | 'INCREASE';

export type ReasonCode =
  | 'DEPOSIT_AMOUNT_CORRECTION'
  | 'DEPOSIT_DUPLICATE_REVERSAL'
  | 'DEPOSIT_SIGNAL_VOID'
  | 'WITHDRAW_AMOUNT_CORRECTION'
  | 'WITHDRAW_VOID_REFUND'
  | 'BANK_INTEREST'
  | 'BANK_CHARGE';

/**
 * 成因清单（业主 2026-08-28 确认）。**无兜底档**——兜底档一开，说不清的全往里塞，
 * 久了变垃圾桶、审计价值归零。遇到新成因显式加一条。
 * customerLabel = 客户口径词；公司账簿成因为 null（客户看不到公司侧调账）。
 */
export const REASON_SPECS: Record<ReasonCode, {
  book: Book; directions: Direction[]; customerLabel: string | null;
}> = {
  DEPOSIT_AMOUNT_CORRECTION:  { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], customerLabel: '充值金额更正' },
  DEPOSIT_DUPLICATE_REVERSAL: { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: '重复入账撤销' },
  DEPOSIT_SIGNAL_VOID:        { book: 'CLIENT', directions: ['REDUCE'],             customerLabel: '充值撤销' },
  WITHDRAW_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['INCREASE'],           customerLabel: '提现金额更正' },
  WITHDRAW_VOID_REFUND:       { book: 'CLIENT', directions: ['INCREASE'],           customerLabel: '提现撤销退回' },
  BANK_INTEREST:              { book: 'FIRM',   directions: ['INCREASE'],           customerLabel: null },
  BANK_CHARGE:                { book: 'FIRM',   directions: ['REDUCE'],             customerLabel: null },
};

export function assertReasonAllowed(reasonCode: ReasonCode, book: Book, direction: Direction): void {
  const spec = REASON_SPECS[reasonCode];
  if (!spec) throw new BadRequestException(`未知成因码：${reasonCode}`);
  if (spec.book !== book) {
    throw new BadRequestException(`成因 ${reasonCode} 只能用于 ${spec.book} 账簿，本案在 ${book} 账簿`);
  }
  if (!spec.directions.includes(direction)) {
    throw new BadRequestException(`成因 ${reasonCode} 不允许方向 ${direction}`);
  }
}

export function resolvePostingLegs(book: Book, direction: Direction): { debitCode: number; creditCode: number } {
  if (book === 'CLIENT') {
    return direction === 'REDUCE'
      ? { debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE, creditCode: TB_ACCOUNT_CODES.CLIENT_ASSET }
      : { debitCode: TB_ACCOUNT_CODES.CLIENT_ASSET,   creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE };
  }
  return direction === 'REDUCE'
    ? { debitCode: TB_ACCOUNT_CODES.FIRM_OPS,   creditCode: TB_ACCOUNT_CODES.FIRM_ASSET }
    : { debitCode: TB_ACCOUNT_CODES.FIRM_ASSET, creditCode: TB_ACCOUNT_CODES.INCOME_OTHER };
}

/**
 * §4 边界线守卫：客户账簿加钱，必须指向一张已存在的原单。
 * 有原单 = KYT 已对那笔跑过，改金额不算绕闸；无原单 = 凭空给客户加钱，走 V4 补录。
 */
export function requiresRelatedOrder(book: Book, direction: Direction): boolean {
  return book === 'CLIENT' && direction === 'INCREASE';
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts
```

预期：12 passed。

- [ ] **Step 5: 随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && git add src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts && git commit -m "feat(recon): 调账规则纯函数——四种分录组合 + 成因闸 + 原单守卫"
```

---

## Task 3: 状态机 + 开单/提交服务

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/constants/adjustment-transitions.constant.ts`
- Create: `src/modules/clearing-settle/reconciliation/dto/adjustment.dto.ts`
- Create: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`（保留 Task 1 冒烟块，追加）

**Interfaces:**
- Consumes: Task 1 model ｜ Task 2 全部导出
- Produces:
  - `AdjustmentStatus = { DRAFT, PENDING_APPROVAL, POSTED, REJECTED }`
  - `ADJUSTMENT_TRANSITIONS: Record<string, string[]>`
  - `AdjustmentService.createDraft(dto, operatorId): Promise<{ adjustmentNo: string }>`
  - `AdjustmentService.submit(adjustmentNo, operatorId): Promise<void>`
  - `AdjustmentService.assertTransition(from, to): void`
  - `AdjustmentService.describeImpact(row): string`

- [ ] **Step 1: 写迁移表**

创建 `adjustment-transitions.constant.ts`：

```ts
// 调账单 4 态迁移表（spec §6.3）。POSTED / REJECTED 终态——账本只进不出，
// 开错了只能再开一张反向单，不能撤销。
export const AdjustmentStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  POSTED: 'POSTED',
  REJECTED: 'REJECTED',
} as const;

export type AdjustmentStatusValue = (typeof AdjustmentStatus)[keyof typeof AdjustmentStatus];

export const ADJUSTMENT_TRANSITIONS: Record<string, string[]> = {
  [AdjustmentStatus.DRAFT]: [AdjustmentStatus.PENDING_APPROVAL],
  [AdjustmentStatus.PENDING_APPROVAL]: [AdjustmentStatus.POSTED, AdjustmentStatus.REJECTED],
  [AdjustmentStatus.POSTED]: [],
  [AdjustmentStatus.REJECTED]: [],
};
```

- [ ] **Step 2: 写失败测试**

追加到 `adjustment.service.spec.ts`：

```ts
import { BadRequestException } from '@nestjs/common';
import { AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { AdjustmentService } from './adjustment.service';

describe('AdjustmentService.assertTransition', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any);

  it('DRAFT → PENDING_APPROVAL 放行', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.DRAFT, AdjustmentStatus.PENDING_APPROVAL)).not.toThrow();
  });
  it('POSTED 是终态，任何再迁移都被拒', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.POSTED, AdjustmentStatus.REJECTED)).toThrow(BadRequestException);
  });
  it('DRAFT 不能跳过审批直接 POSTED', () => {
    expect(() => svc.assertTransition(AdjustmentStatus.DRAFT, AdjustmentStatus.POSTED)).toThrow(BadRequestException);
  });
});

describe('AdjustmentService.describeImpact —— 审批页看到的是后果，不是单号', () => {
  const svc = new AdjustmentService(null as any, null as any, null as any, null as any);
  it('客户账簿减钱，说清是谁、少多少、为什么', () => {
    const text = svc.describeImpact({
      book: 'CLIENT', ownerNo: 'C0042', amount: '1500', assetCode: 'AED',
      direction: 'REDUCE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', reasonInternal: '同一笔充值入账两次',
    } as any);
    expect(text).toContain('C0042');
    expect(text).toContain('减少');
    expect(text).toContain('1500');
    expect(text).toContain('同一笔充值入账两次');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts
```

预期：FAIL，`Cannot find module './adjustment.service'`。

- [ ] **Step 4: 写 DTO**

创建 `src/modules/clearing-settle/reconciliation/dto/adjustment.dto.ts`：

```ts
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { REASON_SPECS } from '../disposition/adjustment-rules';

export class CreateAdjustmentDto {
  @IsString() @IsNotEmpty() caseNo!: string;
  @IsString() @IsNotEmpty() lineItemId!: string;
  @IsIn(Object.keys(REASON_SPECS)) reasonCode!: keyof typeof REASON_SPECS;
  @IsIn(['REDUCE', 'INCREASE']) direction!: 'REDUCE' | 'INCREASE';
  @IsString() @IsNotEmpty() amount!: string;               // 最小单位（分）整数字符串
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @IsString() @IsNotEmpty() reasonInternal!: string;
  @IsString() @IsNotEmpty() reasonCustomer!: string;
  @IsOptional() @IsString() relatedOrderNo?: string;
}
```

- [ ] **Step 5: 写服务**

创建 `adjustment.service.ts`：

```ts
// 一期调账单（spec v2）。开单只落库；落账在审批通过后（Task 5）。
// 本期无订单层、无资金单、无真实转账——不许顺手给它建资金单。
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateReferenceNo } from '../../../../common/utils/no-generator.util';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../../governance/approvals/approvals.service';
import { AccountingService } from '../../../accounting/tigerbeetle/accounting.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { ADJUSTMENT_TRANSITIONS, AdjustmentStatus } from '../constants/adjustment-transitions.constant';
import { CreateAdjustmentDto } from '../dto/adjustment.dto';
import {
  Book, Direction, ReasonCode, REASON_SPECS,
  assertReasonAllowed, requiresRelatedOrder,
} from './adjustment-rules';

@Injectable()
export class AdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly accounting: AccountingService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  assertTransition(from: string, to: string): void {
    const allowed = ADJUSTMENT_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`调账单非法状态迁移：${from} → ${to}`);
    }
  }

  /** 审批页文案：把后果展开成一句人话。审批看不见后果就是橡皮图章。 */
  describeImpact(row: {
    book: string; ownerNo: string | null; amount: string; assetCode: string;
    direction: string; reasonCode: string; reasonInternal: string;
  }): string {
    const dir = row.direction === 'REDUCE' ? '减少' : '增加';
    const who = row.book === 'CLIENT' ? `客户 ${row.ownerNo ?? '(未知)'}` : '公司自有资金';
    return `本单将使${who}余额${dir} ${row.amount}（最小单位）${row.assetCode}；`
         + `成因：${row.reasonCode}；理由：${row.reasonInternal}`;
  }

  async createDraft(dto: CreateAdjustmentDto, operatorId: string) {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo: dto.caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${dto.caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('只能对打开中的案件开调账单');

    const book: Book = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
    const direction = dto.direction as Direction;

    // 闸一：成因 × 账簿 × 方向 合法性
    assertReasonAllowed(dto.reasonCode as ReasonCode, book, direction);

    // 闸二：§4 边界线——客户账簿加钱必须指向一张已存在的原单
    if (requiresRelatedOrder(book, direction) && !dto.relatedOrderNo?.trim()) {
      throw new BadRequestException(
        '客户账簿加钱必须指明关联原单号——无原单即凭空给客户加钱，会绕过 KYT 与合规闸；'
        + '若为未归属入金，请走充值域补录入站信号。',
      );
    }

    // 落账时 resolveTbAccountId 要客户 UUID，case 上只有业务号，这里换一次。
    const owner = kase.ownerNo
      ? await (this.prisma as any).customer.findUnique({ where: { customerNo: kase.ownerNo }, select: { id: true } })
      : null;

    const row = await (this.prisma as any).reconciliationAdjustment.create({
      data: {
        adjustmentNo: generateReferenceNo('ADJ'),
        caseNo: dto.caseNo,
        lineItemId: dto.lineItemId,
        walletRef: kase.walletRef,
        book,
        direction,
        reasonCode: dto.reasonCode,
        relatedOrderNo: dto.relatedOrderNo ?? null,
        assetCode: kase.assetCode,
        amount: dto.amount,
        effectiveDate: dto.effectiveDate,
        reasonInternal: dto.reasonInternal,
        reasonCustomer: dto.reasonCustomer,
        ownerNo: kase.ownerNo ?? null,
        ownerId: owner?.id ?? null,
        traceId: kase.traceId ?? null,
        createdByUserId: operatorId,
        status: AdjustmentStatus.DRAFT,
      },
    });
    return { adjustmentNo: row.adjustmentNo };
  }

  async submit(adjustmentNo: string, operatorId: string) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.PENDING_APPROVAL);

    // 真实签名：createAndSubmit(createDto, submitDto, actor, client?, options?)
    //   CreateApprovalDto = { actionType, entityRef, objectSnapshot?, traceId? }
    //   SubmitApprovalDto = { reason?, traceId? }
    //   ApprovalActorContext = { actorType: 'ADMIN', userId, userNo?, role?, roleCodes }
    const impact = this.describeImpact(row);
    const approval = await this.approvals.createAndSubmit(
      {
        actionType: 'RECON_ADJUSTMENT_POST',
        entityRef: adjustmentNo,          // handler 靠它回查，不另造 payload
        objectSnapshot: {
          adjustmentNo, caseNo: row.caseNo, walletRef: row.walletRef, book: row.book,
          direction: row.direction, reasonCode: row.reasonCode,
          customerLabel: REASON_SPECS[row.reasonCode as ReasonCode]?.customerLabel ?? null,
          amount: row.amount, assetCode: row.assetCode, ownerNo: row.ownerNo, impact,
        },
        traceId: row.traceId ?? undefined,
      },
      { reason: impact, traceId: row.traceId ?? undefined },
      { actorType: 'ADMIN', userId: operatorId, userNo: operatorId, roleCodes: ['ADMIN'] },
    );

    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: {
        status: AdjustmentStatus.PENDING_APPROVAL,
        approvalCaseId: approval.id,
        approvalNo: approval.approvalNo,
      },
    });
  }
}
```

> 审批调用已按真实签名写（`approvals.service.ts:648` + `dto/approval.dto.ts` + `constants/approval.constants.ts:118`），**不要加 `as any` 绕过类型错误**；对不上就以那三处源码为准修。

- [ ] **Step 6: 跑测试确认通过**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts
```

预期：5 passed（1 冒烟 + 3 迁移 + 1 文案）。

- [ ] **Step 7: 随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && git add src/modules/clearing-settle/reconciliation && git commit -m "feat(recon): 调账单 4 态状态机 + 开单/提交（含两道闸）"
```

---

## Task 4: 接审批中心

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Create: `src/modules/clearing-settle/reconciliation/disposition/adjustment-approval.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/disposition/adjustment-approval.service.spec.ts`
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`（加 `onApproved` 桩 + `onRejected`）

**Interfaces:**
- Consumes: Task 3 的 `AdjustmentService` ｜ `ApprovalHandlerBase`
- Produces: `AdjustmentApprovalService`（`actionType='RECON_ADJUSTMENT_POST'`, `workflowType='RECON'`）；`AdjustmentService.onApproved(adjustmentNo, deciderId)` / `onRejected(adjustmentNo, deciderId)`

- [ ] **Step 1: 登记 actionType 与默认策略**

`approval.constants.ts` 的 `ApprovalActionTypes` 加：

```ts
  RECON_ADJUSTMENT_POST: 'RECON_ADJUSTMENT_POST',
```

默认策略表（`steps: [{ stepNo: 1, roles: [...] }]` 那张）加：

```ts
  [ApprovalActionTypes.RECON_ADJUSTMENT_POST]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
  },
```

> 与现有运营类动作同形。策略可配，将来要升两步或换 `CFO` 改配置不改代码（spec §7）。

- [ ] **Step 2: 写失败测试**

创建 `adjustment-approval.service.spec.ts`：

```ts
import { AdjustmentApprovalService } from './adjustment-approval.service';

describe('AdjustmentApprovalService', () => {
  it('只认领 RECON_ADJUSTMENT_POST', () => {
    const svc = new AdjustmentApprovalService(null as any, null as any);
    expect(svc.actionType).toBe('RECON_ADJUSTMENT_POST');
    expect(svc.workflowType).toBe('RECON');
  });

  it('批准事件转调 onApproved（单号取自 entityRef）', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleApproved({
      actionType: 'RECON_ADJUSTMENT_POST', entityRef: 'ADJ2608280001', decidedByUserId: 'U_OPS',
    } as any);
    expect(adjustments.onApproved).toHaveBeenCalledWith('ADJ2608280001', 'U_OPS');
  });

  it('驳回事件转调 onRejected', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleRejected({
      actionType: 'RECON_ADJUSTMENT_POST', entityRef: 'ADJ2608280001', decidedByUserId: 'U_OPS',
    } as any);
    expect(adjustments.onRejected).toHaveBeenCalledWith('ADJ2608280001', 'U_OPS');
  });

  it('不是自己的 actionType 就不动手', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleApproved({ actionType: 'SOMETHING_ELSE', entityRef: 'X' } as any);
    expect(adjustments.onApproved).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment-approval.service.spec.ts
```

预期：FAIL，`Cannot find module './adjustment-approval.service'`。

- [ ] **Step 4: 写 handler**

创建 `adjustment-approval.service.ts`（**钩子方法名以 `approval-handler.base.ts:60-85` 真实签名为准**）：

```ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApprovalHandlerBase } from '../../../governance/approvals/approval-handler.base';
import { AdjustmentService } from './adjustment.service';

@Injectable()
export class AdjustmentApprovalService extends ApprovalHandlerBase {
  readonly actionType = 'RECON_ADJUSTMENT_POST';
  readonly workflowType = 'RECON';

  constructor(
    private readonly adjustments: AdjustmentService,
    eventEmitter: EventEmitter2,
  ) {
    super(eventEmitter);
  }

  async handleApproved(event: { actionType: string; entityRef: string; decidedByUserId?: string }) {
    if (event.actionType !== this.actionType) return;
    await this.adjustments.onApproved(event.entityRef, event.decidedByUserId ?? 'SYSTEM');
  }

  async handleRejected(event: { actionType: string; entityRef: string; decidedByUserId?: string }) {
    if (event.actionType !== this.actionType) return;
    await this.adjustments.onRejected(event.entityRef, event.decidedByUserId ?? 'SYSTEM');
  }
}
```

- [ ] **Step 5: 在 AdjustmentService 加两个钩子**

```ts
  async onRejected(adjustmentNo: string, deciderId: string) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.REJECTED);
    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: { status: AdjustmentStatus.REJECTED, decidedByUserId: deciderId },
    });
  }

  async onApproved(adjustmentNo: string, deciderId: string): Promise<void> {
    throw new Error('Task 5 实现');
  }
```

- [ ] **Step 6: 注册进模块**

`reconciliation.module.ts` 的 `providers` 加 `AdjustmentService`、`AdjustmentApprovalService`；`imports` 补审批中心与账本所在模块（照该文件已有 import 风格）。

- [ ] **Step 7: 跑测试 + 随手闸 + 提交**

```bash
npx jest src/modules/clearing-settle/reconciliation && npx tsc --noEmit -p tsconfig.json
git add src/modules && git commit -m "feat(recon): 调账单接审批中心（单步 OPS_OFFICER）"
```

预期：本域测试全绿，无净新失败。

---

## Task 5: 落账（本计划的核心）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`（填 `onApproved`）
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `resolvePostingLegs` ｜ `AccountingService.executeTransfer` / `resolveTbAccountId` ｜ `TB_LEDGERS` / `TB_CODE_TO_COA` / `TB_TRANSFER_CODES`
- Produces: `AdjustmentService.onApproved` 落账并置 `POSTED`；审计码 `RECON_ADJUSTMENT_POSTED`

- [ ] **Step 1: 登记转账码与审计码**

`tb-transfer-codes.constant.ts` 加一个未占用的 `RECON_ADJUSTMENT` 码。

`audit-actions.constant.ts` 的 `AuditActions` 加 `RECON_ADJUSTMENT_POSTED: 'RECON_ADJUSTMENT_POSTED'`；合同表加：

```ts
  RECON_ADJUSTMENT_POSTED: {
    domain: 'RECON',
    correlationMode: I,                 // INHERIT——继承关联原单旅程，同 RECON_PUSH_ORDER
    requiredFields: ['reasonCode', 'direction', 'amount', 'effectiveDate'],
    requiresCausation: false,
  },
```

`AuditEntityTypes` 登记 `RECON_ADJUSTMENT`（`RECON_CASE` 若已存在则复用）。

- [ ] **Step 2: 写失败测试**

追加到 `adjustment.service.spec.ts`：

```ts
describe('AdjustmentService.onApproved 落账', () => {
  const makeSvc = (row: any, accounting: any, update = jest.fn()) => {
    const prisma: any = {
      reconciliationAdjustment: { findUnique: jest.fn().mockResolvedValue(row), update },
    };
    return new AdjustmentService(prisma, null as any, accounting, { recordByActor: jest.fn() } as any);
  };

  const clientRow = {
    adjustmentNo: 'ADJ2608280001', status: 'PENDING_APPROVAL', book: 'CLIENT',
    direction: 'REDUCE', reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL',
    walletRef: 'W_CUST_1', assetCode: 'AED', amount: '1500', effectiveDate: '2026-08-15',
    ownerNo: 'C0042', ownerId: 'uuid-cust', caseNo: 'RC26082800001',
    reasonInternal: '同一笔充值入账两次', traceId: 'T1', relatedOrderNo: 'DP2608150042',
  };

  it('evidence 必须带该 case 的 walletRef 且 isExternalCrossing=false', async () => {
    const executeTransfer = jest.fn().mockResolvedValue({ tbTransferId: 7n });
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn().mockResolvedValue(1n) };
    await makeSvc(clientRow, accounting).onApproved('ADJ2608280001', 'U_OPS');

    const evidence = executeTransfer.mock.calls[0][0].evidence;
    expect(evidence.debitWalletRef).toBe('W_CUST_1');
    expect(evidence.creditWalletRef).toBe('W_CUST_1');
    expect(evidence.isExternalCrossing).toBe(false);
    expect(evidence.effectiveDate).toBe('2026-08-15');
  });

  it('客户账簿减钱走「借客户应付 / 贷客户托管」', async () => {
    const resolveTbAccountId = jest.fn().mockResolvedValue(1n);
    const accounting = { executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 1n }), resolveTbAccountId };
    await makeSvc(clientRow, accounting).onApproved('ADJ2608280001', 'U_OPS');
    const codes = resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
    expect(codes).toEqual([TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.CLIENT_ASSET]);
  });

  it('落账后置 POSTED 并记下 tbTransferId', async () => {
    const update = jest.fn();
    const accounting = {
      executeTransfer: jest.fn().mockResolvedValue({ tbTransferId: 42n }),
      resolveTbAccountId: jest.fn().mockResolvedValue(1n),
    };
    await makeSvc(clientRow, accounting, update).onApproved('ADJ2608280001', 'U_OPS');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'POSTED', tbTransferId: '42', decidedByUserId: 'U_OPS' }),
    }));
  });

  it('已 POSTED 的单再落一次被状态机拒绝，且不碰账本', async () => {
    const executeTransfer = jest.fn();
    const accounting = { executeTransfer, resolveTbAccountId: jest.fn() };
    await expect(
      makeSvc({ ...clientRow, status: 'POSTED' }, accounting).onApproved('ADJ2608280001', 'U_OPS'),
    ).rejects.toThrow(BadRequestException);
    expect(executeTransfer).not.toHaveBeenCalled();
  });
});
```

文件顶部补 `import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';`

- [ ] **Step 3: 跑测试确认失败**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts
```

预期：FAIL，`Task 5 实现`。

- [ ] **Step 4: 实现 onApproved**

替换 `onApproved` 桩：

```ts
  async onApproved(adjustmentNo: string, deciderId: string) {
    const row = await (this.prisma as any).reconciliationAdjustment.findUnique({ where: { adjustmentNo } });
    if (!row) throw new NotFoundException(`调账单不存在：${adjustmentNo}`);
    this.assertTransition(row.status, AdjustmentStatus.POSTED);

    const legs = resolvePostingLegs(row.book as Book, row.direction as Direction);
    const ledger = TB_LEDGERS[row.assetCode as keyof typeof TB_LEDGERS];

    const ownerFor = (code: number) =>
      code === TB_ACCOUNT_CODES.CLIENT_PAYABLE || code === TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE
        ? { ownerType: 'CUSTOMER' as const, ownerUuid: row.ownerId }
        : code === TB_ACCOUNT_CODES.CLIENT_ASSET || code === TB_ACCOUNT_CODES.FIRM_ASSET
          ? { ownerType: 'SYSTEM' as const }
          : { ownerType: 'FIRM' as const };

    const debitAccountId = await this.accounting.resolveTbAccountId({ code: legs.debitCode, ledger, ...ownerFor(legs.debitCode) } as any);
    const creditAccountId = await this.accounting.resolveTbAccountId({ code: legs.creditCode, ledger, ...ownerFor(legs.creditCode) } as any);

    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId,
      creditAccountId,
      amount: BigInt(row.amount),
      ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        sourceType: 'RECON_ADJUSTMENT',
        sourceNo: row.adjustmentNo,
        eventCode: 'RECON_ADJUSTMENT_POSTED',
        traceId: row.traceId || row.adjustmentNo,
        debitCode: TB_CODE_TO_COA[legs.debitCode],
        creditCode: TB_CODE_TO_COA[legs.creditCode],
        assetCurrency: row.assetCode,
        actorType: 'ADMIN',
        actorId: deciderId,
        memo: row.reasonInternal,
        // ⚠ 必须落到出问题的那个钱包，否则 delta 不归零、case 无法自愈
        debitWalletRef: row.walletRef,
        creditWalletRef: row.walletRef,
        // 调账是纯账面重分类，不出现在任何外部账单上——置 false 才不会被
        // wallet-flow-matcher 当成「内部有外部无」的孤儿行
        isExternalCrossing: false,
        effectiveDate: row.effectiveDate,
      },
    });

    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo },
      data: {
        status: AdjustmentStatus.POSTED,
        decidedByUserId: deciderId,
        postedAt: new Date(),
        tbTransferId: tbTransferId.toString(),
      },
    });

    // 信封照 push-order.service.ts:235 `recordPush` 抄——对账件的现成范本
    const subjects: any[] = [
      { subjectType: 'RECON_ADJUSTMENT', subjectNo: row.adjustmentNo, subjectRole: 'PRIMARY' },
    ];
    if (row.ownerNo) subjects.push({ subjectType: 'CUSTOMER', subjectNo: row.ownerNo, subjectRole: 'OWNER' });
    if (row.caseNo) subjects.push({ subjectType: 'RECON_CASE', subjectNo: row.caseNo, subjectRole: 'RELATED' });

    await this.auditLogs.recordByActor(
      {
        action: 'RECON_ADJUSTMENT_POSTED',
        actionDomain: 'RECON',
        primarySubjectType: 'RECON_ADJUSTMENT',
        primarySubjectNo: row.adjustmentNo,
        ownerCustomerNo: row.ownerNo,
        correlationId: row.traceId,
        fromStatus: AdjustmentStatus.PENDING_APPROVAL,
        toStatus: AdjustmentStatus.POSTED,
        subjects,
        reason: row.reasonInternal,
        requestId: `RECON_ADJUSTMENT_POSTED_${row.adjustmentNo}_${randomUUID()}`,
        metadata: {
          reasonCode: row.reasonCode, direction: row.direction, amount: row.amount,
          effectiveDate: row.effectiveDate, relatedOrderNo: row.relatedOrderNo, book: row.book,
        },
        sourcePlatform: 'ADMIN',
      } as any,
      { actorType: 'ADMIN', actorNo: deciderId, actorDisplayName: deciderId, actorRolesAtTime: ['ADMIN'] },
    );
  }
```

补齐顶部 import：`randomUUID`（`node:crypto`）/ `TB_ACCOUNT_CODES` / `TB_CODE_TO_COA` / `TB_LEDGERS` / `TB_TRANSFER_CODES` / `resolvePostingLegs`。

> `recordByActor(input, actor, client?)` 是真实签名（`audit-logs.service.ts:940`）。对 `input` 的 `as any` **与 `recordPush` 现有写法一致，属房屋风格，保留**；`actor` 那一侧不加 cast。

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition
```

预期：全绿（Task 1–5 累计 21 例）。

- [ ] **Step 6: 随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && git add src/modules && git commit -m "feat(recon): 调账单落账 + RECON_ADJUSTMENT_POSTED 审计码"
```

---

## Task 6: admin 端点 + 权限登记

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/disposition/adjustment.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`

**Interfaces:**
- Consumes: Task 3/5 的 `AdjustmentService`
- Produces: `POST /admin/reconciliation/adjustments`、`POST /admin/reconciliation/adjustments/:adjustmentNo/submit`、`GET /admin/reconciliation/adjustments/:adjustmentNo`；`getCase` 每条差异项多一个 `adjustment: { adjustmentNo, status } | null`

- [ ] **Step 1: 写 controller**

创建 `adjustment.controller.ts`，照同目录 `push-order.controller.ts` 的形状（现成范本）：`@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)`、每路由 `@RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/adjustments'))`、`operatorId = req.user?.userNo || req.user?.sub`。

- [ ] **Step 2: 登记 RBAC**

`rbac.catalog.ts` 为三个端点 `route()` 登记；写用新增的 `RECON_ADJUSTMENT_WRITE`，读复用 `RECON_CASE_READ`。

- [ ] **Step 3: 让差异项带上调账单标记**

`reconciliation-query.service.ts` 的 `getCase` 里按 `lineItemId` 批量查 `reconciliation_adjustments`（一条 `IN` 查询，照该文件"在途行补单子状态"那处的现成写法），把 `{ adjustmentNo, status }` 挂到每条差异项上。前端据此把已开单的行置灰。

- [ ] **Step 4: 同步权限并重启**

```bash
bash scripts/on-stack.sh main db:base:sync
```

然后**重启后端**——`SUPER_ADMIN` 权限走内存 `RBAC_PERMISSION_DEFINITIONS`，只 seed 不重启等于白做。

- [ ] **Step 5: 端到端手验**

```bash
curl -s -X POST localhost:3000/admin/reconciliation/adjustments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"caseNo":"<真实caseNo>","lineItemId":"<真实id>","reasonCode":"DEPOSIT_DUPLICATE_REVERSAL","direction":"REDUCE","amount":"1500","effectiveDate":"2026-08-15","reasonInternal":"同一笔充值入账两次","reasonCustomer":"重复入账已撤销"}'
```

预期：返回 `{"adjustmentNo":"ADJ..."}`。403 = Step 4 的重启没做。

再验一次边界线（应当 400）：

```bash
curl -s -X POST localhost:3000/admin/reconciliation/adjustments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"caseNo":"<客户账簿caseNo>","lineItemId":"<真实id>","reasonCode":"DEPOSIT_AMOUNT_CORRECTION","direction":"INCREASE","amount":"1500","effectiveDate":"2026-08-15","reasonInternal":"x","reasonCustomer":"x"}'
```

预期：400，报文提示必须指明关联原单号。

- [ ] **Step 6: 随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json && git add src/modules && git commit -m "feat(recon): 调账单 admin 端点 + RBAC 登记"
```

---

## Task 7: admin 前端 —— 从差异项开单

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`
- Create: `admin-web/src/pages/ReconciliationAdjustmentDetailPage.tsx`

**Interfaces:**
- Consumes: Task 6 三个端点；`getCase` 差异项上的 `adjustment` 字段
- Produces: 无（终端消费方）

- [ ] **Step 1: 差异项行加入口**

「流水下钻」表格每行末尾加「开调账单」按钮；`adjustment` 非空时置灰并显示 `已开 ADJ… · <状态>`，可点进详情页。

- [ ] **Step 2: 开单表单弹层**

字段：**成因**（下拉，按当前案件账簿过滤——客户账簿只列五个客户侧成因，公司账簿只列两个公司侧成因）、方向（按所选成因的 `directions` 过滤，只有一个可选时锁死）、金额、生效日期、关联原单号（客户账簿+加钱时必填，其余可选）、内部原因、客户可见原因。

**表单里没有「账簿」也没有「谁承担」**——账簿取自案件；承担方这个概念一期整个不存在（spec §0 问题 6）。

- [ ] **Step 3: 提交后跳转**

创建成功 → 调 submit → 跳 `ReconciliationAdjustmentDetailPage`；页面显示状态、审批单号（可深链审批中心）、成因、方向、两版原因、分录预览（借/贷科目助记码）。

- [ ] **Step 4: 渲染验证（不可跳过）**

```bash
bash scripts/stack.sh up main
```

起 preview，登录 admin，走到一个 BREAK case 详情页，**截图**：① 差异项行的按钮；② 开单弹层（含成因下拉按账簿过滤）；③ 调账单详情页。tsc 过不算数（CLAUDE.md §7 ⑤）。

- [ ] **Step 5: 随手闸 + 提交**

```bash
cd admin-web && npx tsc -b --noEmit && cd .. && git add admin-web/src && git commit -m "feat(recon,admin): 差异项开调账单入口 + 调账单详情页"
```

---

## Task 8: 全链 e2e + 收尾闸 + 文档收口

**Files:**
- Create: `test/recon-adjustment-money-arcs.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1–7 全部
- Produces: 无

- [ ] **Step 1: 写全链 e2e**

照 `test/withdraw-money-arcs.e2e-spec.ts` 骨架（含 `test/e2e-db.ts` 用法）。四个场景：

1. **客户账簿 · 减**（重复入账撤销）：铺客户钱包 BREAK → 开单 → 审批通过 → 断言 `account_flows` 多一行且 `isExternalCrossing=false`、`walletRef` 正确 → 重跑对账 → 断言 case `status='RESOLVED'`、`resolutionReason='AUTO_HEALED'`
2. **客户账簿 · 加**（提现撤销退回，带 `relatedOrderNo`）：同上闭环
3. **公司账簿 · 加**（银行利息）：断言落的是 `FIRM_ASSET` / `INCOME_OTHER`
4. **反向断言 · 审批未通过不落账**：开单 → 提交 → **不批** → 断言 `account_flows` 无新增、单仍 `PENDING_APPROVAL`

外加两条服务层断言：客户账簿 + 加钱 + 无原单被拒（§4）；`BANK_INTEREST` 落客户账簿被拒（§5）。

- [ ] **Step 2: 跑 e2e**

```bash
npm run test:e2e -- recon-adjustment-money-arcs
```

预期：6 passed。

- [ ] **Step 3: 收尾闸（CLAUDE.md §7）**

动了 schema，重铺闸必跑：

```bash
bash scripts/stack.sh reset main
```

```bash
bash scripts/on-stack.sh main demo:all
```

```bash
bash scripts/on-stack.sh main verify:coa
```

```bash
bash scripts/on-stack.sh main recon:demo:break
```

判据对照 `doc-final/demo/baseline.md`：`demo:all` 8/8 ｜ `verify:coa` 两恒等式 + 无负余额全过（**四种分录组合各自落账后都要过**）｜ `recon:demo:break` 9/9。

- [ ] **Step 4: 全量 jest 净新失败 0**

```bash
npx jest 2>&1 | tail -20
```

对照 `doc-final/demo/baseline.md` 的基线与已知红名单，判据 = **净新失败 0**。

- [ ] **Step 5: 文档收口**

- `doc-final/modules/v8-recon.md`：§2 状态机加调账单一行；§5 技术节点加新文件；§6 演示缺口把「处置只有推单一个动作」改成实况
- `doc-final/CHANGELOG.md`：加一行
- `doc-final/demo/script.md` 第六幕：第 3 步从「挑一笔在途推单」扩成「在途走推单 / 记错了走调账单」两条
- `doc-final/test-cases/TC-08-reconciliation.md`：补调账单验收用例
- `doc-final/BACKLOG.md`：本轮无新增遗留则不动（二期、三期、客户流水读模型、甲族补录均已在案）

- [ ] **Step 6: 提交**

```bash
git add test doc-final && git commit -m "test(recon): 调账单全链 e2e + 文档收口"
```

---

## 明确不做（照抄 spec §10，实现期不许顺手补）

补记真实资金流入/流出（甲族）｜ 孤儿进账待认领 ｜ **C3 资产短缺认损（等二期赔付通道一起开）** ｜ **二期内部划转单** ｜ **三期事故登记** ｜ **客户可见面（并入客户流水读模型任务，一期落地后客户流水出现天书行属已知并接受，不要顺手修）** ｜ 账龄/SLA/超期升级 ｜ 差异项跨轮持久化 ｜ 手工配对 ｜ `HELD` 态 ｜ 外部账单真实摄入管道 ｜ 分级审批 / 新增 `CFO` 角色 ｜ 新增任何科目 ｜ `MANUAL_RESOLVED` / `WAIVED` 写方 ｜ **给调账单建资金单**。
