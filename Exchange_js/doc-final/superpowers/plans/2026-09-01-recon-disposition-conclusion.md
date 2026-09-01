# 平账一期半 · 成因定性驱动的处置收口 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 差异行的处置从「一个按钮挂所有行」改成「选成因 → 出口自动定」：成因注册表单一来源（手册 = 菜单 = 审计同码）、定性落库、挂起两子类、改记（调账单第四族，一单双案同愈）、演示场景重编号 14 条（新增公司池查无果）。

**Architecture:** 后端加一个纯常量注册表（`cause-registry.ts`）+ 一张定性记录表（`reconciliation_dispositions`）+ 调账单第四族（`CUSTOMER_REATTRIBUTION`，借错记方应付/贷正主方应付，资产腿不动）；对账引擎**零改动**（残差公式、五桶、销案判据不碰），改记的双案自愈靠既有的两个解释锚 + `explained-difference` 索引把圈定范围放宽到 `toWalletRef`。前端案件页动作列改六态，处置弹层两屏（成因菜单 → 出口）。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle ｜ React (admin-web) ｜ ts-node 种子脚本 ｜ jest / e2e

**Spec:** `doc-final/superpowers/specs/2026-09-01-recon-disposition-conclusion-design.md`（下文引 §N 均指它）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **零引擎改动**：`bucket-classifier.ts` / `wallet-balance-checker` / `wallet-flow-matcher` / `wallet-recon-run` 的桶规则、残差公式、销案判据一行不改（唯一例外：`explained-difference.service.ts` 的索引查询加 `toWalletRef`，它是解释索引不是引擎规则）
  - **外部权威公理**：任何新文案、注释、手册内容不得出现「对方错了」档——一切不平只有 我方账错了 / 我方账缺了 / 时机没到
  - **同词原则**：成因码只在 `cause-registry.ts` 定义一次；种子 manifest、前端菜单、审计记录、财务手册全部引用它，不许各抄一份不同的词
  - 测试的绿必须来自行为，**禁止「扫源码文本」型断言**（本仓栽过六次）
  - 两个新审计码每次写入必带**显式 `requestId`**（漏了被静默去重）
  - 派 subagent 时任务 prompt 必须带上 CLAUDE.md §0–§5 要点
  - 执行在独立 worktree（`.claude/worktrees/<名>/`）+ self 栈；**新 worktree 先 `bash scripts/stack.sh up` 让 `.env` 落地再做别的**（TOOLING-DEBT 在案的坑：直接 reset 会静默跳过 TigerBeetle 建户与资本注入）

## 文件清单

**后端新建**
- `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts` — 成因注册表（纯常量+纯函数）
- `src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts`
- `src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts` — 定性落库
- `src/modules/clearing-settle/reconciliation/disposition/disposition.service.spec.ts`
- `src/modules/clearing-settle/reconciliation/disposition/disposition.controller.ts`
- `src/modules/clearing-settle/reconciliation/dto/disposition.dto.ts`

**后端修改**
- `prisma/schema.prisma` — `ReconciliationDisposition` 新表；`ReconciliationAdjustment` + `toWalletRef`/`toOwnerNo`
- `disposition/adjustment-rules.ts` — `family` 字段 + 第 8 码 `CUSTOMER_REATTRIBUTION` + `resolveReattributionLegs()`
- `disposition/adjustment.service.ts` — createDraft 第四族分支 + `dispositionNo` 联动 + DRAFTED 审计；onApproved 第四族落账；describeImpact/getAdjustment 第四族
- `disposition/explained-difference.service.ts` — 索引查询加 `toWalletRef`
- `domain/reconciliation-query.service.ts` — 行附 `disposition`/`duplicateTwinRef`/`menu`；listCases 附 `dispositionCount`/`anomalyLineCount`/`decimals`
- `dto/reconciliation.dto.ts` — `FlowComparisonRow` 三个新字段
- `dto/adjustment.dto.ts` — `dispositionNo`/`toCaseNo`
- `reconciliation.module.ts` — 注册新 service/controller
- `src/modules/identity/access-control/rbac.catalog.ts` — 新组四处齐
- `src/modules/audit-logging/constants/audit-actions.constant.ts` — 两新码 + 实体类型

**前端**
- 新 `admin-web/src/rbac/…`：PERMISSIONS 两键
- 新 `admin-web/src/utils/causeRegistry.ts` — 出口词/家族词展示映射（**不镜像成因表**——菜单由后端行数据下发）
- 新 `admin-web/src/components/ReconciliationDispositionModal.tsx` — 两屏弹层
- 改 `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx` — locked 模式（成因定死/方向只读/改记视图/dispositionNo 链）
- 改 `admin-web/src/pages/ReconciliationCasesDetailPage.tsx` — 动作列六态
- 改 `admin-web/src/pages/ReconciliationCasesListPage.tsx` — 定性进度列 + Δ decimals 修

**种子** `scripts/recon-demo.ts` ｜ **e2e** `test/recon-reattribution.e2e-spec.ts`（新）

**文档** `doc-final/reference/recon-cause-handbook.md`（新）+ v8-recon / script / data / baseline / BACKLOG / CHANGELOG / decisions 追加稿

---

### Task 1: 成因注册表（纯函数）

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts`
- Test: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts`

**Interfaces:**
- Consumes: 无（纯常量，不 import 业务模块；BadRequestException 来自 @nestjs/common）
- Produces（后续任务全靠这些名字，抄准）:
  - `export type CauseMatchType = 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL'`
  - `export type CauseBook = 'CLIENT' | 'FIRM'`
  - `export type AdjustFamily = 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE'`
  - `export type StoredOutlet = 'ADJUST_CORRECT'|'ADJUST_REVERSE'|'ADJUST_RECORD'|'ADJUST_REATTRIBUTE'|'HOLD_NEXT_PERIOD'|'HOLD_INVESTIGATING'|'DEFERRED'`
  - `export type DeferredTarget = 'SUPPLEMENT_DEPOSIT'|'SUPPLEMENT_BOUNCE'|'FIRM_REVERSAL'|'INTERNAL_TRANSFER'|'INCIDENT'|'WAIVER'|'NO_REASON_CODE'`
  - `export type CauseCode =` 21 码（见 Step 3 常量表）
  - `export const CAUSE_REGISTRY: Record<CauseCode, CauseSpec>`
  - `export function menuFor(matchType: CauseMatchType, book: CauseBook): Array<{ code: CauseCode; label: string; clue: string; outletLabel: string }>`
  - `export interface RowFacts { matchType: CauseMatchType; book: CauseBook; deltaSign?: 1 | -1; internalDirection?: 'IN'|'OUT'; internalSourceType?: string; externalDirection?: 'IN'|'OUT' }`
  - `export function resolveOutlet(code: CauseCode, facts: RowFacts): ResolvedOutlet` 其中 `ResolvedOutlet = { outlet: StoredOutlet; outletLabel: string; family?: AdjustFamily; reasonCode?: string; direction?: 'REDUCE'|'INCREASE'; deferredTarget?: DeferredTarget }`

- [ ] **Step 1: 写失败的测试**

`cause-registry.spec.ts`（判据 §9-1：六格菜单逐项 + 出口全表 + reason 派生 + 变异验证）：

```ts
import { menuFor, resolveOutlet, CAUSE_REGISTRY, CauseCode } from './cause-registry';

describe('cause-registry —— 六格成因菜单（spec §4，注册表单一来源）', () => {
  const codes = (mt: any, book: any) => menuFor(mt, book).map((m) => m.code);

  it('金额不对 × 客户', () => {
    expect(codes('AMOUNT_MISMATCH', 'CLIENT')).toEqual([
      'AMT_MISBOOKED', 'AMT_FEE_NETTED', 'AMT_ROUNDING', 'PRECISION_DUST', 'UNEXPLAINED',
    ]);
  });
  it('金额不对 × 公司', () => {
    expect(codes('AMOUNT_MISMATCH', 'FIRM')).toEqual([
      'FIRM_AMT_UNDERBOOKED', 'FIRM_AMT_OVERBOOKED', 'PRECISION_DUST', 'UNEXPLAINED',
    ]);
  });
  it('我有外无 × 客户', () => {
    expect(codes('ORPHAN_INTERNAL', 'CLIENT')).toEqual([
      'DUP_BOOKING', 'PHANTOM_BOOKING', 'PAYOUT_NOT_EXECUTED', 'MISATTRIBUTED_FROM', 'CUTOFF_STRADDLE', 'UNEXPLAINED',
    ]);
  });
  it('我有外无 × 公司', () => {
    expect(codes('ORPHAN_INTERNAL', 'FIRM')).toEqual([
      'FIRM_MISBOOKED', 'FIRM_TRANSFER_UNTRACKED', 'UNEXPLAINED',
    ]);
  });
  it('外有我无 × 客户', () => {
    expect(codes('ORPHAN_EXTERNAL', 'CLIENT')).toEqual([
      'MISSED_DEPOSIT', 'BOUNCED_FUNDS', 'MISATTRIBUTED_TO', 'UNAUTHORIZED_OUTFLOW', 'UNEXPLAINED',
    ]);
  });
  it('外有我无 × 公司', () => {
    expect(codes('ORPHAN_EXTERNAL', 'FIRM')).toEqual([
      'BANK_INTEREST_UNBOOKED', 'BANK_CHARGE_UNBOOKED', 'UNCLAIMED_INFLOW', 'UNEXPLAINED',
    ]);
  });
  it('21 码分完，无遗漏：每个码至少出现在一个格的菜单里', () => {
    const all = new Set<string>();
    (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const).forEach((mt) =>
      (['CLIENT', 'FIRM'] as const).forEach((book) => codes(mt, book).forEach((c) => all.add(c))));
    expect([...all].sort()).toEqual(Object.keys(CAUSE_REGISTRY).sort());
  });
});

describe('resolveOutlet —— 出口与 reason 派生（spec §4）', () => {
  it('冲正：reason 按内部流水 sourceType 派生，方向按差额符号', () => {
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1, internalSourceType: 'DEPOSIT',
    })).toEqual({
      outlet: 'ADJUST_CORRECT', outletLabel: '冲正', family: 'CORRECT',
      reasonCode: 'DEPOSIT_AMOUNT_CORRECTION', direction: 'INCREASE',
    });
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1, internalSourceType: 'WITHDRAW',
    }).reasonCode).toBe('WITHDRAW_AMOUNT_CORRECTION');
    expect(resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: -1, internalSourceType: 'WITHDRAW',
    }).direction).toBe('REDUCE');
  });
  it('冲正遇 SWAP 流水：本轮无码 → 留档（spec §11-6）', () => {
    const r = resolveOutlet('AMT_MISBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'CLIENT', deltaSign: 1, internalSourceType: 'SWAP',
    });
    expect(r.outlet).toBe('DEFERRED');
    expect(r.deferredTarget).toBe('NO_REASON_CODE');
  });
  it('冲销：reason 一码一因，方向 = 内部流水方向取反', () => {
    expect(resolveOutlet('DUP_BOOKING', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN',
    })).toEqual({
      outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family: 'REVERSE',
      reasonCode: 'DEPOSIT_DUPLICATE_REVERSAL', direction: 'REDUCE',
    });
    expect(resolveOutlet('PHANTOM_BOOKING', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN',
    }).reasonCode).toBe('DEPOSIT_SIGNAL_VOID');
    expect(resolveOutlet('PAYOUT_NOT_EXECUTED', {
      matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'OUT',
    })).toEqual(expect.objectContaining({ reasonCode: 'WITHDRAW_VOID_REFUND', direction: 'INCREASE' }));
  });
  it('补记：公司金额差按差额符号选码；公司孤儿按外部方向', () => {
    expect(resolveOutlet('FIRM_AMT_UNDERBOOKED', {
      matchType: 'AMOUNT_MISMATCH', book: 'FIRM', deltaSign: -1,
    })).toEqual(expect.objectContaining({ outlet: 'ADJUST_RECORD', reasonCode: 'BANK_CHARGE', direction: 'REDUCE' }));
    expect(resolveOutlet('BANK_INTEREST_UNBOOKED', {
      matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'IN',
    })).toEqual(expect.objectContaining({ reasonCode: 'BANK_INTEREST', direction: 'INCREASE' }));
    expect(resolveOutlet('BANK_CHARGE_UNBOOKED', {
      matchType: 'ORPHAN_EXTERNAL', book: 'FIRM', externalDirection: 'OUT',
    })).toEqual(expect.objectContaining({ reasonCode: 'BANK_CHARGE', direction: 'REDUCE' }));
  });
  it('改记：两端同码 CUSTOMER_REATTRIBUTION，无方向', () => {
    const from = resolveOutlet('MISATTRIBUTED_FROM', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT', internalDirection: 'IN' });
    const to = resolveOutlet('MISATTRIBUTED_TO', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT', externalDirection: 'IN' });
    for (const r of [from, to]) {
      expect(r.outlet).toBe('ADJUST_REATTRIBUTE');
      expect(r.reasonCode).toBe('CUSTOMER_REATTRIBUTION');
      expect(r.direction).toBeUndefined();
    }
  });
  it('挂起两子类', () => {
    expect(resolveOutlet('CUTOFF_STRADDLE', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT' }).outlet).toBe('HOLD_NEXT_PERIOD');
    expect(resolveOutlet('UNEXPLAINED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM' }).outlet).toBe('HOLD_INVESTIGATING');
    expect(resolveOutlet('UNCLAIMED_INFLOW', { matchType: 'ORPHAN_EXTERNAL', book: 'FIRM' }).outlet).toBe('HOLD_INVESTIGATING');
  });
  it('留档四路：补单进/补单出/公司冲销/事故', () => {
    expect(resolveOutlet('MISSED_DEPOSIT', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }))
      .toEqual(expect.objectContaining({ outlet: 'DEFERRED', deferredTarget: 'SUPPLEMENT_DEPOSIT' }));
    expect(resolveOutlet('BOUNCED_FUNDS', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }).deferredTarget).toBe('SUPPLEMENT_BOUNCE');
    expect(resolveOutlet('FIRM_AMT_OVERBOOKED', { matchType: 'AMOUNT_MISMATCH', book: 'FIRM' }).deferredTarget).toBe('FIRM_REVERSAL');
    expect(resolveOutlet('UNAUTHORIZED_OUTFLOW', { matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }).deferredTarget).toBe('INCIDENT');
  });
  it('成因不属于该格 → 显式拒绝（无兜底档的机器面）', () => {
    expect(() => resolveOutlet('BANK_INTEREST_UNBOOKED', { matchType: 'ORPHAN_INTERNAL', book: 'CLIENT' })).toThrow(/不属于/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

`cause-registry.ts`（完整文件）：

```ts
// 成因注册表（spec §4）——单一来源：财务手册、界面菜单、种子答案键、审计记录
// 四处同码，改这里必同步 doc-final/reference/recon-cause-handbook.md。
// 公理（spec §0）：外部资料是权威，没有「对方错」档——一切成因都是
// 我方账错了 / 我方账缺了 / 时机没到 三种性质之一。
// 纯常量 + 纯函数，无 IO；BadRequestException 是唯一的 Nest 依赖。
import { BadRequestException } from '@nestjs/common';

export type CauseMatchType = 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
export type CauseBook = 'CLIENT' | 'FIRM';
export type AdjustFamily = 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE';
export type StoredOutlet =
  | 'ADJUST_CORRECT' | 'ADJUST_REVERSE' | 'ADJUST_RECORD' | 'ADJUST_REATTRIBUTE'
  | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' | 'DEFERRED';
export type DeferredTarget =
  | 'SUPPLEMENT_DEPOSIT'   // 补单 → 充值域补录（下一轮）
  | 'SUPPLEMENT_BOUNCE'    // 补单 → 退汇认领（下一轮）
  | 'FIRM_REVERSAL'        // 公司账簿冲销无码（下一轮随核销补）
  | 'INTERNAL_TRANSFER'    // 二期内部划转
  | 'INCIDENT'             // 三期事故升级
  | 'WAIVER'               // 豁免（下一轮，与容差同批）
  | 'NO_REASON_CODE';      // 冲正类成因遇 SWAP 流水，无对应 reason 码（spec §11-6）

export type CauseCode =
  | 'AMT_MISBOOKED' | 'AMT_FEE_NETTED' | 'AMT_ROUNDING' | 'PRECISION_DUST'
  | 'FIRM_AMT_UNDERBOOKED' | 'FIRM_AMT_OVERBOOKED'
  | 'DUP_BOOKING' | 'PHANTOM_BOOKING' | 'PAYOUT_NOT_EXECUTED' | 'MISATTRIBUTED_FROM' | 'CUTOFF_STRADDLE'
  | 'FIRM_MISBOOKED' | 'FIRM_TRANSFER_UNTRACKED'
  | 'MISSED_DEPOSIT' | 'BOUNCED_FUNDS' | 'MISATTRIBUTED_TO' | 'UNAUTHORIZED_OUTFLOW'
  | 'BANK_INTEREST_UNBOOKED' | 'BANK_CHARGE_UNBOOKED' | 'UNCLAIMED_INFLOW'
  | 'UNEXPLAINED';

type Cell = { matchType: CauseMatchType; book: CauseBook };
const ALL_CELLS: Cell[] = (['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] as const)
  .flatMap((matchType) => (['CLIENT', 'FIRM'] as const).map((book) => ({ matchType, book })));

export interface CauseSpec {
  cells: Cell[];
  /** 菜单文案 = 手册同词 */
  label: string;
  /** 查证线索一句（手册「查证怎么做」的浓缩版） */
  clue: string;
  kind: 'ADJUST' | 'HOLD_NEXT_PERIOD' | 'HOLD_INVESTIGATING' | 'DEFERRED';
  family?: AdjustFamily;          // kind=ADJUST 必有
  deferredTarget?: DeferredTarget; // kind=DEFERRED 必有
  deferredLabel?: string;          // kind=DEFERRED 必有（界面显示去向）
}

const C = (matchType: CauseMatchType, book: CauseBook): Cell => ({ matchType, book });

// ⚠ 每格菜单的排序 = 本表内声明顺序过滤后的顺序（menuFor 不再排序），
// 手册与截图验收都按这个顺序对——挪行等于改菜单。
export const CAUSE_REGISTRY: Record<CauseCode, CauseSpec> = {
  // ── 金额不对 × 客户 ──
  AMT_MISBOOKED:   { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: '我方金额录错（含小数点错位、少记）', clue: '对银行回单原件，差额无规律', kind: 'ADJUST', family: 'CORRECT' },
  AMT_FEE_NETTED:  { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: '银行轧差入账（手续费被扣净额）', clue: '差额恰为固定费/费率，同通道笔笔如此', kind: 'ADJUST', family: 'CORRECT' },
  AMT_ROUNDING:    { cells: [C('AMOUNT_MISMATCH', 'CLIENT')], label: '舍入精度差（钱已到位）', clue: '差额在最小精度量级', kind: 'ADJUST', family: 'CORRECT' },
  PRECISION_DUST:  { cells: [C('AMOUNT_MISMATCH', 'CLIENT'), C('AMOUNT_MISMATCH', 'FIRM')], label: '精度不可表示的尘埃差', clue: '差额低于我方最小记账单位', kind: 'DEFERRED', deferredTarget: 'WAIVER', deferredLabel: '豁免（下一轮）' },
  // ── 金额不对 × 公司 ──
  FIRM_AMT_UNDERBOOKED: { cells: [C('AMOUNT_MISMATCH', 'FIRM')], label: '公司收支记少（实扣/实收 > 所记）', clue: '银行回单 vs 我方记账', kind: 'ADJUST', family: 'RECORD' },
  FIRM_AMT_OVERBOOKED:  { cells: [C('AMOUNT_MISMATCH', 'FIRM')], label: '公司收支记多', clue: '银行回单 vs 我方记账', kind: 'DEFERRED', deferredTarget: 'FIRM_REVERSAL', deferredLabel: '公司冲销（无码，下一轮）' },
  // ── 我有外无 × 客户 ──
  DUP_BOOKING:         { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '重复入账——同一笔入了两次', clue: '已匹配列表里有同参考号同金额的双胞胎', kind: 'ADJUST', family: 'REVERSE' },
  PHANTOM_BOOKING:     { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '假信号入账——外部凭证不存在', clue: '银行/链上查无此笔', kind: 'ADJUST', family: 'REVERSE' },
  PAYOUT_NOT_EXECUTED: { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '提现已记但银行未执行', clue: '无回执/有失败通知', kind: 'ADJUST', family: 'REVERSE' },
  MISATTRIBUTED_FROM:  { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '记错客户——这笔钱是别人的', clue: '对端钱包同日同额「外有我无」成对', kind: 'ADJUST', family: 'REATTRIBUTE' },
  CUTOFF_STRADDLE:     { cells: [C('ORPHAN_INTERNAL', 'CLIENT')], label: '跨账期——下期自平', clue: '外部行时间戳落下一账期，余额并不差', kind: 'HOLD_NEXT_PERIOD' },
  // ── 我有外无 × 公司 ──
  FIRM_MISBOOKED:          { cells: [C('ORPHAN_INTERNAL', 'FIRM')], label: '公司收支误记/重复记', clue: '银行单查无', kind: 'DEFERRED', deferredTarget: 'FIRM_REVERSAL', deferredLabel: '公司冲销（无码，下一轮）' },
  FIRM_TRANSFER_UNTRACKED: { cells: [C('ORPHAN_INTERNAL', 'FIRM')], label: '公司调拨已记账、无资金单跟踪', clue: '本不该发生——公司资金移动应有内部划转单', kind: 'DEFERRED', deferredTarget: 'INTERNAL_TRANSFER', deferredLabel: '二期内部划转' },
  // ── 外有我无 × 客户 ──
  MISSED_DEPOSIT:       { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '漏记客户入金', clue: '外部行带客户归属（VIBAN/链上地址）', kind: 'DEFERRED', deferredTarget: 'SUPPLEMENT_DEPOSIT', deferredLabel: '补单→充值域补录（下一轮）' },
  BOUNCED_FUNDS:        { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '入金被退汇/回冲', clue: '外部 OUT 与此前某笔成功入金同源', kind: 'DEFERRED', deferredTarget: 'SUPPLEMENT_BOUNCE', deferredLabel: '补单→退汇认领（下一轮）' },
  MISATTRIBUTED_TO:     { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '记错客户——这笔是本客户的、记在了别人名下', clue: '对端钱包同日同额「我有外无」成对', kind: 'ADJUST', family: 'REATTRIBUTE' },
  UNAUTHORIZED_OUTFLOW: { cells: [C('ORPHAN_EXTERNAL', 'CLIENT')], label: '未授权转出（盗转/误划）', clue: '我方无任何单据、客户未发起', kind: 'DEFERRED', deferredTarget: 'INCIDENT', deferredLabel: '事故升级（三期）' },
  // ── 外有我无 × 公司 ──
  BANK_INTEREST_UNBOOKED: { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: '银行利息未入账', clue: '银行单科目 = 利息', kind: 'ADJUST', family: 'RECORD' },
  BANK_CHARGE_UNBOOKED:   { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: '银行杂费/账管费未入账', clue: '银行单科目 = 费用', kind: 'ADJUST', family: 'RECORD' },
  UNCLAIMED_INFLOW:       { cells: [C('ORPHAN_EXTERNAL', 'FIRM')], label: '无主入金待归属', clue: '账户归属排查：查明是客户→转补单，公司→补记', kind: 'HOLD_INVESTIGATING' },
  // ── 每格通用收尾 ──
  UNEXPLAINED: { cells: ALL_CELLS, label: '查不出（已穷尽调查）', clue: '说明里写清查过什么', kind: 'HOLD_INVESTIGATING' },
};

export const FAMILY_LABEL: Record<AdjustFamily, string> = {
  CORRECT: '冲正', REVERSE: '冲销', RECORD: '补记', REATTRIBUTE: '改记',
};

export function staticOutletLabel(code: CauseCode): string {
  const spec = CAUSE_REGISTRY[code];
  if (spec.kind === 'ADJUST') return FAMILY_LABEL[spec.family!];
  if (spec.kind === 'HOLD_NEXT_PERIOD') return '挂起·等下期';
  if (spec.kind === 'HOLD_INVESTIGATING') return '挂起·调查中';
  return `留档·${spec.deferredLabel}`;
}

export function menuFor(matchType: CauseMatchType, book: CauseBook) {
  return (Object.entries(CAUSE_REGISTRY) as Array<[CauseCode, CauseSpec]>)
    .filter(([, s]) => s.cells.some((c) => c.matchType === matchType && c.book === book))
    .map(([code, s]) => ({ code, label: s.label, clue: s.clue, outletLabel: staticOutletLabel(code) }));
}

export interface RowFacts {
  matchType: CauseMatchType; book: CauseBook;
  deltaSign?: 1 | -1;                       // AMOUNT_MISMATCH：sign(外部 − 内部)
  internalDirection?: 'IN' | 'OUT';        // ORPHAN_INTERNAL
  internalSourceType?: string;             // AMOUNT_MISMATCH：内部流水 sourceType
  externalDirection?: 'IN' | 'OUT';        // ORPHAN_EXTERNAL
}

export interface ResolvedOutlet {
  outlet: StoredOutlet; outletLabel: string;
  family?: AdjustFamily; reasonCode?: string;
  direction?: 'REDUCE' | 'INCREASE'; deferredTarget?: DeferredTarget;
}

/**
 * 出口判定（spec §4）：成因 + 行事实 → 出口/族/调账 reason/方向 全部机器可判。
 * 方向统一口径「差额 = 外部 − 内部」：金额不对按差额符号；我有外无按内部方向
 * 取反；外有我无按外部方向照搬。reason 派生规则见 spec §4「调账 reason 派生」。
 */
export function resolveOutlet(code: CauseCode, facts: RowFacts): ResolvedOutlet {
  const spec = CAUSE_REGISTRY[code];
  if (!spec) throw new BadRequestException(`未知成因码：${code}`);
  if (!spec.cells.some((c) => c.matchType === facts.matchType && c.book === facts.book)) {
    throw new BadRequestException(`成因 ${code} 不属于该格（${facts.matchType} × ${facts.book}）`);
  }
  if (spec.kind === 'HOLD_NEXT_PERIOD') return { outlet: 'HOLD_NEXT_PERIOD', outletLabel: '挂起·等下期' };
  if (spec.kind === 'HOLD_INVESTIGATING') return { outlet: 'HOLD_INVESTIGATING', outletLabel: '挂起·调查中' };
  if (spec.kind === 'DEFERRED') {
    return { outlet: 'DEFERRED', outletLabel: `留档·${spec.deferredLabel}`, deferredTarget: spec.deferredTarget };
  }

  const family = spec.family!;
  if (family === 'REATTRIBUTE') {
    return { outlet: 'ADJUST_REATTRIBUTE', outletLabel: '改记', family, reasonCode: 'CUSTOMER_REATTRIBUTION' };
  }
  if (family === 'CORRECT') {
    const direction: 'REDUCE' | 'INCREASE' = facts.deltaSign === -1 ? 'REDUCE' : 'INCREASE';
    const reasonCode = facts.internalSourceType === 'DEPOSIT' ? 'DEPOSIT_AMOUNT_CORRECTION'
      : facts.internalSourceType === 'WITHDRAW' ? 'WITHDRAW_AMOUNT_CORRECTION' : null;
    if (!reasonCode) {
      // SWAP 等流水本轮无冲正码（spec §11-6）——留档，不硬塞
      return { outlet: 'DEFERRED', outletLabel: '留档·本流水类型暂无冲正码（下一轮）', deferredTarget: 'NO_REASON_CODE' };
    }
    return { outlet: 'ADJUST_CORRECT', outletLabel: '冲正', family, reasonCode, direction };
  }
  if (family === 'REVERSE') {
    const direction: 'REDUCE' | 'INCREASE' = facts.internalDirection === 'OUT' ? 'INCREASE' : 'REDUCE';
    const reasonCode = code === 'DUP_BOOKING' ? 'DEPOSIT_DUPLICATE_REVERSAL'
      : code === 'PHANTOM_BOOKING' ? 'DEPOSIT_SIGNAL_VOID' : 'WITHDRAW_VOID_REFUND';
    return { outlet: 'ADJUST_REVERSE', outletLabel: '冲销', family, reasonCode, direction };
  }
  // RECORD（公司补记）：金额差按差额符号，公司孤儿按外部方向
  const positive = facts.matchType === 'AMOUNT_MISMATCH' ? facts.deltaSign !== -1 : facts.externalDirection === 'IN';
  return {
    outlet: 'ADJUST_RECORD', outletLabel: '补记', family,
    reasonCode: positive ? 'BANK_INTEREST' : 'BANK_CHARGE',
    direction: positive ? 'INCREASE' : 'REDUCE',
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts`
Expected: PASS 全绿

- [ ] **Step 5: 变异验证（判据 §9-1，做完还原）**

手工做两处变异，各确认对应用例变红后还原：
1. 把 `DUP_BOOKING` 的 reasonCode 派生改成 `DEPOSIT_SIGNAL_VOID` → 「冲销：reason 一码一因」必须红
2. 把 `CUTOFF_STRADDLE` 的 kind 改成 `HOLD_INVESTIGATING` → 「挂起两子类」必须红

还原后再跑一遍全绿。

- [ ] **Step 6: 随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts src/modules/clearing-settle/reconciliation/disposition/cause-registry.spec.ts
git commit -m "feat(recon): 成因注册表——21 码六格，手册/菜单/审计同源（平账一期半 T1）"
```

---

### Task 2: 调账规则第四族（改记的纯函数层）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts`
- Test: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts`（追加）

**Interfaces:**
- Consumes: `TB_ACCOUNT_CODES`（已有 import）
- Produces:
  - `REASON_SPECS` 每条新增 `family: 'CORRECT'|'REVERSE'|'RECORD'` 字段；新增第 8 码 `CUSTOMER_REATTRIBUTION`（`family: 'REATTRIBUTE'`, `directions: []`, `book: 'CLIENT'`, `customerLabel: '账户更正划转'`, `internalLabel: '记错客户更正（改记）'`）
  - `export function resolveReattributionLegs(): { debitCode: number; creditCode: number }` — 两腿都是 `CLIENT_PAYABLE`
  - `ReasonCode` 联合类型多一个 `'CUSTOMER_REATTRIBUTION'`

- [ ] **Step 1: 写失败的测试**（追加到 `adjustment-rules.spec.ts`）

```ts
import { REASON_SPECS, resolveReattributionLegs, assertReasonAllowed } from './adjustment-rules';
import { TB_ACCOUNT_CODES } from '../../../accounting/tigerbeetle/constants/tb-account-codes.constant';

describe('第四族 REATTRIBUTE（spec §6）', () => {
  it('族划分覆盖全部 8 码、无遗漏无重叠', () => {
    const byFamily: Record<string, string[]> = {};
    for (const [code, spec] of Object.entries(REASON_SPECS)) {
      (byFamily[(spec as any).family] ??= []).push(code);
    }
    expect(byFamily.CORRECT!.sort()).toEqual(['DEPOSIT_AMOUNT_CORRECTION', 'WITHDRAW_AMOUNT_CORRECTION']);
    expect(byFamily.REVERSE!.sort()).toEqual(['DEPOSIT_DUPLICATE_REVERSAL', 'DEPOSIT_SIGNAL_VOID', 'WITHDRAW_VOID_REFUND']);
    expect(byFamily.RECORD!.sort()).toEqual(['BANK_CHARGE', 'BANK_INTEREST']);
    expect(byFamily.REATTRIBUTE).toEqual(['CUSTOMER_REATTRIBUTION']);
  });
  it('改记分录：借错记方应付 / 贷正主方应付——资产腿不动（第五种组合）', () => {
    expect(resolveReattributionLegs()).toEqual({
      debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
      creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE,
    });
  });
  it('改记不走 book×direction 语义：assertReasonAllowed 对它任何方向都拒', () => {
    expect(() => assertReasonAllowed('CUSTOMER_REATTRIBUTION' as any, 'CLIENT', 'REDUCE')).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts`
Expected: FAIL（family 字段与新函数不存在）

- [ ] **Step 3: 实现**

`adjustment-rules.ts` 三处改动：

1. `REASON_SPECS` 的类型签名加一行 `family: 'CORRECT' | 'REVERSE' | 'RECORD' | 'REATTRIBUTE';`，七条既有记录各补 `family`（充值金额更正/提现金额更正 → `'CORRECT'`；重复入账撤销/充值撤销/提现撤销退回 → `'REVERSE'`；银行利息/银行杂费 → `'RECORD'`），并新增：

```ts
  // 第四族（spec §6）：钱在托管里一分没动，主人记错了。不走 book×direction
  // 语义（directions 空 = assertReasonAllowed 对它恒拒），分录由
  // resolveReattributionLegs 直接定；两个客户的应付对转，资产腿不动。
  CUSTOMER_REATTRIBUTION:     { book: 'CLIENT', directions: [],                     customerLabel: '账户更正划转', internalLabel: '记错客户更正（改记）', family: 'REATTRIBUTE' },
```

2. `ReasonCode` 联合类型追加 `| 'CUSTOMER_REATTRIBUTION'`。

3. 文件尾追加：

```ts
/** 第五种分录组合（spec §6）：借 错记方 CLIENT_PAYABLE / 贷 正主方 CLIENT_PAYABLE。
 *  同码不同 ownerUuid——resolveTbAccountId 按 (code, ledger, ownerUuid) 落到两个
 *  不同的客户负债户上。客户资产腿（CLIENT_ASSET）刻意不动：托管里的钱没动。 */
export function resolveReattributionLegs(): { debitCode: number; creditCode: number } {
  return { debitCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE, creditCode: TB_ACCOUNT_CODES.CLIENT_PAYABLE };
}
```

- [ ] **Step 4: 跑测试确认通过 + 全模块回归**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition/`
Expected: PASS（既有 adjustment-rules / adjustment.service 等 spec 不受影响——若 REASON_SPECS 形状断言红了，按新字段修断言，不许删断言）

- [ ] **Step 5: 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add -A src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts
git commit -m "feat(recon): 调账单第四族 CUSTOMER_REATTRIBUTION——应付对转分录，资产腿不动（T2）"
```

---

### Task 3: schema 迁移 + 审计常量入册 + RBAC 四处齐

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `admin-web/src/rbac/permissions.ts`

**Interfaces:**
- Produces:
  - Prisma model `ReconciliationDisposition`（表 `reconciliation_dispositions`）；`ReconciliationAdjustment` 新列 `toWalletRef String?` / `toOwnerNo String?`
  - `AuditEntityTypes.RECON_DISPOSITION = 'RECON_DISPOSITION'`
  - `AuditActions.RECON_DISPOSITION_RECORDED` / `AuditActions.RECON_ADJUSTMENT_DRAFTED`
  - `V8_RECON_AUDIT_ACTIONS` 两新条目（四属性）
  - PermissionGroup `'RECON_DISPOSITION_WRITE'`、桶 `recon.act_dispose`、两条新路由、OPS 绑定
  - 前端 `PERMISSIONS.RECON_DISPOSITION_CREATE` / `PERMISSIONS.RECON_REATTRIBUTION_CANDIDATES_READ`

- [ ] **Step 1: schema**

`prisma/schema.prisma`，在 `model ReconciliationAdjustment` 里 `walletRef       String` 之后插入：

```prisma
  // 第四族改记（spec §6）：正主方。仅 reasonCode=CUSTOMER_REATTRIBUTION 使用。
  toWalletRef     String?
  toOwnerNo       String?
```

在 `model ReconciliationRunWallet` 之前新增（spec §7 原文）：

```prisma
model ReconciliationDisposition {
  id                      String    @id @default(uuid())
  dispositionNo           String    @unique @default("TEMP")
  caseNo                  String
  walletRef               String
  businessDate            String
  // 锚：与调账单同款，锚真实证据 id，跨轮稳定；不锚每轮重建的 ReconciliationLineItem.id
  explainedFlowId         String?
  explainedExternalLineId String?
  matchType               String
  book                    String
  causeCode               String
  outlet                  String
  deferredTarget          String?
  findingNote             String
  adjustmentNo            String?
  createdByUserId         String
  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  @@index([caseNo])
  @@index([walletRef, businessDate])
  @@map("reconciliation_dispositions")
}
```

- [ ] **Step 2: 生成迁移（不写 backfill，空库能建起即可）**

```bash
bash scripts/stack.sh up            # 新 worktree 首跑必须先 up 让 .env 落地
set -a && source .env && set +a
npx prisma migrate dev --name recon_disposition_and_reattribution
npx prisma generate
```

Expected: 迁移文件生成于 `prisma/migrations/`，`prisma generate` 成功。

- [ ] **Step 3: 审计常量三处登记**

`audit-actions.constant.ts`：

1. `AuditEntityTypes`（`RECON_ADJUSTMENT: 'RECON_ADJUSTMENT'` 那行之后）加：

```ts
  RECON_DISPOSITION: 'RECON_DISPOSITION',
```

2. `AuditActions` 名表（`RECON_ADJUSTMENT_POSTED` 那行之后）加：

```ts
  RECON_ADJUSTMENT_DRAFTED: 'RECON_ADJUSTMENT_DRAFTED',
  RECON_DISPOSITION_RECORDED: 'RECON_DISPOSITION_RECORDED',
```

3. `V8_RECON_AUDIT_ACTIONS`（`RECON_ADJUSTMENT_POSTED` 条目之后）加——四属性出生即冻结（spec §8）：

```ts
  // 开单（四族通用，DRAFT 阶段无审批件，铁律①要求每个持久化动作留痕——销 BACKLOG「createDraft 零审计」）
  RECON_ADJUSTMENT_DRAFTED: { domain: 'RECON', correlationMode: N, requiredFields: ['reasonCode', 'amount'], requiresCausation: false },
  // 定性 / 覆盖重定（spec §3.2）——对账件无客户旅程，N 模式同 RECON_CASE_OPENED
  RECON_DISPOSITION_RECORDED: { domain: 'RECON', correlationMode: N, requiredFields: ['causeCode', 'outlet'], requiresCausation: false },
```

- [ ] **Step 4: 封册名册**

跑 `npx jest src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts`，按失败提示把两个新码登记进封册要求的名册数组（对账域那节，`'RECON_PUSH_ORDER_SYNCED', 'RECON_PUSH_ORDER_MANUAL'` 附近，加注释 `// ── 平账一期半（2026-09-01）──`）。若有快照差异，确认差异内容只含这两个码后 `npx jest src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts -u` 重打——这是封册流程设计好的显式入册动作，不是「为过测试改测试」。
Expected: closure spec 全绿。

- [ ] **Step 5: RBAC 四处齐（delivery-checklist：调账单当初只齐两处）**

`rbac.catalog.ts` 四处：

1. `PermissionGroup` 联合类型（`'RECON_ADJUSTMENT_WRITE'` 之后）：`| 'RECON_DISPOSITION_WRITE'`
2. 路由登记（`route('GET', '/admin/reconciliation/adjustments/:adjustmentNo', ...)` 之后）：

```ts
  route('POST', '/admin/reconciliation/cases/:caseNo/dispositions', 'Record disposition conclusion on a reconciliation diff row', ['RECON_DISPOSITION_WRITE']),
  route('GET', '/admin/reconciliation/cases/:caseNo/reattribution-candidates', 'List counterpart candidates for a reattribution', ['RECON_CASE_READ']),
```

3. 桶目录 recon 域（`recon.act_adjust` 之后）：

```ts
      { key: 'recon.act_dispose', label: 'Record disposition conclusions', description: 'Record the investigated cause and outlet on a reconciliation diff row (hold / route / precede an adjustment)', groups: ['RECON_DISPOSITION_WRITE'] },
```

4. `RBAC_ROLE_GROUP_BINDINGS.OPS_OFFICER` 的 `'RECON_RUN_WRITE'` 同行追加 `'RECON_DISPOSITION_WRITE'`（OPS 已持 `RECON_CASE_READ`，入口无缺——spec §8 已核）。

`admin-web/src/rbac/permissions.ts` 在 `RECON_ADJUSTMENT_DETAIL_READ` 之后加：

```ts
  RECON_DISPOSITION_CREATE: 'api.post.admin_reconciliation_cases_caseno_dispositions',
  RECON_REATTRIBUTION_CANDIDATES_READ: 'api.get.admin_reconciliation_cases_caseno_reattribution_candidates',
```

**改记复用既有 `RECON_ADJUSTMENT_POST` 审批策略，不新增策略——`scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 表不加行**（spec §6，显式记录免评审再查）。

- [ ] **Step 6: 验证 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/audit-logging
git add -A prisma src/modules/audit-logging/constants src/modules/identity/access-control/rbac.catalog.ts admin-web/src/rbac/permissions.ts
git commit -m "feat(recon): 定性表 schema + 两审计码四属性入册 + RECON_DISPOSITION_WRITE 四处齐（T3）"
```

---

### Task 4: 定性落库 service + controller

**Files:**
- Create: `src/modules/clearing-settle/reconciliation/dto/disposition.dto.ts`
- Create: `src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts`
- Create: `src/modules/clearing-settle/reconciliation/disposition/disposition.controller.ts`
- Modify: `src/modules/clearing-settle/reconciliation/reconciliation.module.ts`
- Test: `src/modules/clearing-settle/reconciliation/disposition/disposition.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `resolveOutlet`/`menuFor`/`CAUSE_REGISTRY`/`staticOutletLabel`；`generateReferenceNo`（prefix `'RCD'`）；`AuditLogsService`
- Produces:
  - `DispositionService.record(caseNo: string, dto: RecordDispositionDto, actor: ApprovalActorContext): Promise<{ dispositionNo; outlet; outletLabel; family?; reasonCode?; direction?; deferredTarget? }>`
  - `DispositionService.linkAdjustment(dispositionNo: string, adjustmentNo: string): Promise<void>`（Task 5 调）
  - `DispositionService.listReattributionCandidates(caseNo: string, side: 'FROM'|'TO', amount: string): Promise<Candidate[]>`，`Candidate = { caseNo; walletNo; ownerNo; anchorId; externalRef; amount }`
  - `POST /admin/reconciliation/cases/:caseNo/dispositions` ｜ `GET /admin/reconciliation/cases/:caseNo/reattribution-candidates?side=&amount=`

- [ ] **Step 1: DTO**

`dto/disposition.dto.ts`：

```ts
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CAUSE_REGISTRY } from '../disposition/cause-registry';

export class RecordDispositionDto {
  @IsIn(['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL']) matchType!: 'AMOUNT_MISMATCH' | 'ORPHAN_INTERNAL' | 'ORPHAN_EXTERNAL';
  // 锚：ORPHAN_INTERNAL 只有 flowId、ORPHAN_EXTERNAL 只有 externalLineId、
  // AMOUNT_MISMATCH 两个都有（与 CreateAdjustmentDto 的锚同一套约定）。
  @IsOptional() @IsString() explainedFlowId?: string;
  @IsOptional() @IsString() explainedExternalLineId?: string;
  @IsIn(Object.keys(CAUSE_REGISTRY)) causeCode!: keyof typeof CAUSE_REGISTRY;
  @IsString() @IsNotEmpty() findingNote!: string;
  // 行事实（出口判定的输入）——前端从被点的那一行原样带上
  @IsOptional() @IsIn([1, -1]) deltaSign?: 1 | -1;
  @IsOptional() @IsIn(['IN', 'OUT']) internalDirection?: 'IN' | 'OUT';
  @IsOptional() @IsString() internalSourceType?: string;
  @IsOptional() @IsIn(['IN', 'OUT']) externalDirection?: 'IN' | 'OUT';
}
```

- [ ] **Step 2: 写失败的测试**

`disposition.service.spec.ts`（mock prisma/audit，形状照抄 `adjustment.service.spec.ts` 的 mock 惯例）：

```ts
import { BadRequestException } from '@nestjs/common';
import { DispositionService } from './disposition.service';

const CASE_ROW = {
  caseNo: 'REC-1', status: 'OPEN', book: 'CUSTOMER', walletRef: 'w-uuid',
  businessDate: '2026-09-01', ownerNo: 'CU001', traceId: null,
};
const ACTOR = { actorType: 'ADMIN', userId: 'uuid-1', userNo: 'ADM001', roleCodes: ['OPS_OFFICER'] } as any;

function build(overrides: any = {}) {
  const prisma: any = {
    reconciliationCase: { findUnique: jest.fn().mockResolvedValue(CASE_ROW) },
    reconciliationDisposition: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: 'd1' })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })),
      findUnique: jest.fn(),
    },
    wallet: { findUnique: jest.fn().mockResolvedValue({ walletNo: 'WA001' }) },
    ...overrides,
  };
  const audit: any = { recordByActor: jest.fn().mockResolvedValue(undefined) };
  return { svc: new DispositionService(prisma, audit), prisma, audit };
}

describe('DispositionService.record（spec §3.2/§7）', () => {
  it('挂起：落定性记录 + 审计带显式 requestId，不碰账', async () => {
    const { svc, prisma, audit } = build();
    const r = await svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'CUTOFF_STRADDLE', findingNote: '外部行时间戳在下一账期', internalDirection: 'IN',
    } as any, ACTOR);
    expect(r.outlet).toBe('HOLD_NEXT_PERIOD');
    const created = prisma.reconciliationDisposition.create.mock.calls[0][0].data;
    expect(created.book).toBe('CLIENT');                    // case.book CUSTOMER → CLIENT 归一化（同 adjustment）
    expect(created.dispositionNo).toMatch(/^RCD/);
    const auditArg = audit.recordByActor.mock.calls[0][0];
    expect(auditArg.action).toBe('RECON_DISPOSITION_RECORDED');
    expect(auditArg.causeCode).toBe('CUTOFF_STRADDLE');      // requiredFields 顶层
    expect(auditArg.outlet).toBe('HOLD_NEXT_PERIOD');
    expect(auditArg.requestId).toMatch(/^RECON_DISPOSITION_RECORDED_RCD/); // 显式 requestId
  });
  it('同锚重定 = 覆盖 + 再记一条审计', async () => {
    const existing = { id: 'd0', dispositionNo: 'RCD000', adjustmentNo: null };
    const { svc, prisma, audit } = build({
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data })),
        create: jest.fn(),
      },
    });
    await svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'DUP_BOOKING', findingNote: '双胞胎实证', internalDirection: 'IN',
    } as any, ACTOR);
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalled();
    expect(prisma.reconciliationDisposition.create).not.toHaveBeenCalled();
    expect(audit.recordByActor).toHaveBeenCalledTimes(1);
  });
  it('已挂调账单的行拒绝覆盖（400）', async () => {
    const { svc } = build({
      reconciliationDisposition: {
        findFirst: jest.fn().mockResolvedValue({ dispositionNo: 'RCD000', adjustmentNo: 'ADJ001' }),
      },
    });
    await expect(svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1',
      causeCode: 'DUP_BOOKING', findingNote: 'x', internalDirection: 'IN',
    } as any, ACTOR)).rejects.toThrow(BadRequestException);
  });
  it('两个锚都缺 → 400；案件非 OPEN → 400', async () => {
    const { svc } = build();
    await expect(svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', causeCode: 'DUP_BOOKING', findingNote: 'x', internalDirection: 'IN',
    } as any, ACTOR)).rejects.toThrow(/锚/);
    const closed = build({ reconciliationCase: { findUnique: jest.fn().mockResolvedValue({ ...CASE_ROW, status: 'RESOLVED' }) } });
    await expect(closed.svc.record('REC-1', {
      matchType: 'ORPHAN_INTERNAL', explainedFlowId: 'f1', causeCode: 'DUP_BOOKING', findingNote: 'x', internalDirection: 'IN',
    } as any, ACTOR)).rejects.toThrow(/OPEN|打开/);
  });
});

describe('DispositionService.linkAdjustment', () => {
  it('只接受 ADJUST 类出口且未挂单的定性', async () => {
    const { svc, prisma } = build({
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue({ dispositionNo: 'RCD001', outlet: 'ADJUST_REVERSE', adjustmentNo: null }),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(), create: jest.fn(),
      },
    });
    await svc.linkAdjustment('RCD001', 'ADJ001');
    expect(prisma.reconciliationDisposition.update).toHaveBeenCalledWith({
      where: { dispositionNo: 'RCD001' }, data: { adjustmentNo: 'ADJ001' },
    });
    const held = build({
      reconciliationDisposition: {
        findUnique: jest.fn().mockResolvedValue({ dispositionNo: 'RCD002', outlet: 'HOLD_INVESTIGATING', adjustmentNo: null }),
        update: jest.fn(), findFirst: jest.fn(), create: jest.fn(),
      },
    });
    await expect(held.svc.linkAdjustment('RCD002', 'ADJ001')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition/disposition.service.spec.ts`
Expected: FAIL（service 不存在）

- [ ] **Step 4: 实现 service**

`disposition/disposition.service.ts`：

```ts
// 定性落库（spec §3.2/§7）——「财务查证的结论」这件事的落点。零账务：
// 挂起/留档只写这张表；ADJUST 类出口的账务动作仍走调账单（Task 5 联动）。
import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateReferenceNo } from '../../../../common/utils/no-generator.util';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../../audit-logging/audit-logs.service';
import { AuditEntityTypes } from '../../../audit-logging/constants/audit-actions.constant';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
import { RecordDispositionDto } from '../dto/disposition.dto';
import { CAUSE_REGISTRY, CauseBook, resolveOutlet } from './cause-registry';

export interface ReattributionCandidate {
  caseNo: string; walletNo: string | null; ownerNo: string | null;
  anchorId: string; externalRef: string | null; amount: string;
}

@Injectable()
export class DispositionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async record(caseNo: string, dto: RecordDispositionDto, actor: ApprovalActorContext) {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${caseNo}`);
    if (kase.status !== 'OPEN') throw new BadRequestException('只能对打开中的案件定性');
    if (!dto.explainedFlowId && !dto.explainedExternalLineId) {
      throw new BadRequestException('定性必须锚在真实证据上（内部流水 id / 外部对账单行 id 至少其一）');
    }

    const book: CauseBook = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
    // 出口判定（含「成因不属于该格」的显式拒绝）——唯一真相在注册表
    const resolved = resolveOutlet(dto.causeCode as any, {
      matchType: dto.matchType, book,
      deltaSign: dto.deltaSign, internalDirection: dto.internalDirection,
      internalSourceType: dto.internalSourceType, externalDirection: dto.externalDirection,
    });

    // 同锚 upsert：一条差异行至多一条有效定性；挂了调账单就锁死（400）
    const anchorWhere: any = { caseNo };
    if (dto.explainedFlowId) anchorWhere.explainedFlowId = dto.explainedFlowId;
    if (dto.explainedExternalLineId) anchorWhere.explainedExternalLineId = dto.explainedExternalLineId;
    const existing = await (this.prisma as any).reconciliationDisposition.findFirst({ where: anchorWhere });
    if (existing?.adjustmentNo) {
      throw new BadRequestException(`该行定性已挂调账单 ${existing.adjustmentNo}，不可覆盖——单和结论必须对得上`);
    }

    const data = {
      caseNo, walletRef: kase.walletRef, businessDate: kase.businessDate,
      explainedFlowId: dto.explainedFlowId ?? null,
      explainedExternalLineId: dto.explainedExternalLineId ?? null,
      matchType: dto.matchType, book,
      causeCode: dto.causeCode, outlet: resolved.outlet,
      deferredTarget: resolved.deferredTarget ?? null,
      findingNote: dto.findingNote,
      createdByUserId: actor.userNo ?? actor.userId,
    };
    const row = existing
      ? await (this.prisma as any).reconciliationDisposition.update({ where: { dispositionNo: existing.dispositionNo }, data })
      : await (this.prisma as any).reconciliationDisposition.create({ data: { ...data, dispositionNo: generateReferenceNo('RCD') } });
    const dispositionNo = existing?.dispositionNo ?? row.dispositionNo;

    // 铁律①：定性是持久化动作。子主体带案件 + 钱包（业务键，spec §8）。
    const wallet = kase.walletRef && !String(kase.walletRef).startsWith('XREF:')
      ? await (this.prisma as any).wallet.findUnique({ where: { id: kase.walletRef }, select: { walletNo: true } })
      : null;
    const actorDisplay = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(
      {
        action: 'RECON_DISPOSITION_RECORDED',
        actionDomain: 'RECON',
        primarySubjectType: AuditEntityTypes.RECON_DISPOSITION,
        primarySubjectNo: dispositionNo,
        ownerCustomerNo: kase.ownerNo ?? undefined,
        causeCode: dto.causeCode,          // requiredFields 顶层
        outlet: resolved.outlet,
        subjects: [
          { subjectType: AuditEntityTypes.RECON_DISPOSITION, subjectNo: dispositionNo, subjectRole: 'PRIMARY' },
          { subjectType: 'RECONCILIATION_CASE', subjectNo: caseNo, subjectRole: 'RELATED' },
          ...(wallet?.walletNo ? [{ subjectType: AuditEntityTypes.WALLET, subjectNo: wallet.walletNo, subjectRole: 'RELATED' }] : []),
        ],
        reason: dto.findingNote,
        requestId: `RECON_DISPOSITION_RECORDED_${dispositionNo}_${randomUUID()}`, // 漏了会被静默去重
        metadata: {
          causeCode: dto.causeCode, outlet: resolved.outlet,
          deferredTarget: resolved.deferredTarget ?? null,
          matchType: dto.matchType, overwrite: !!existing,
        },
        sourcePlatform: 'ADMIN',
      } as any,
      { actorType: 'ADMIN', actorNo: actorDisplay, actorDisplayName: actorDisplay, actorRolesAtTime: actor.roleCodes ?? [] },
    );

    return { dispositionNo, ...resolved };
  }

  /** Task 5 联动：调账单开出后回填，之后该定性锁死不可覆盖。 */
  async linkAdjustment(dispositionNo: string, adjustmentNo: string): Promise<void> {
    const row = await (this.prisma as any).reconciliationDisposition.findUnique({ where: { dispositionNo } });
    if (!row) throw new NotFoundException(`定性记录不存在：${dispositionNo}`);
    if (!String(row.outlet).startsWith('ADJUST')) {
      throw new BadRequestException(`定性 ${dispositionNo} 的出口是 ${row.outlet}，不落调账单`);
    }
    if (row.adjustmentNo) throw new BadRequestException(`定性 ${dispositionNo} 已挂调账单 ${row.adjustmentNo}`);
    await (this.prisma as any).reconciliationDisposition.update({
      where: { dispositionNo }, data: { adjustmentNo },
    });
  }

  /**
   * 改记对端候选（spec §3.3）：同业务日 · 同资产 · 同金额 · 反向孤儿的开放案件。
   * side=FROM：当前行是错记方（我有外无）→ 找外有我无的持久化差异行；
   * side=TO：当前行是正主方 → 找我有外无。差异行读的是 reconciliation_line_items
   * （每轮重建，但候选只在「当下这一轮」里找对端，锚回真实 id 后与轮次无关）。
   */
  async listReattributionCandidates(caseNo: string, side: 'FROM' | 'TO', amount: string): Promise<ReattributionCandidate[]> {
    const kase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo } });
    if (!kase) throw new NotFoundException(`对账案件不存在：${caseNo}`);
    const wantStatus = side === 'FROM' ? 'ORPHAN_EXTERNAL' : 'ORPHAN_INTERNAL';
    const peers = await (this.prisma as any).reconciliationCase.findMany({
      where: {
        status: 'OPEN', caseNo: { not: caseNo },
        businessDate: kase.businessDate, assetCode: kase.assetCode, book: kase.book,
      },
      include: { lineItems: true },
    });
    const out: ReattributionCandidate[] = [];
    for (const peer of peers) {
      for (const li of peer.lineItems ?? []) {
        if (li.matchStatus !== wantStatus) continue;
        const liAmount = (wantStatus === 'ORPHAN_EXTERNAL' ? li.externalAmount : li.internalAmount)?.toString();
        if (liAmount !== amount) continue;
        // 锚：外部孤儿 → externalTxId（external_statement_lines.id）；内部孤儿 → internalSourceId（account_flows.id）
        const anchorId = wantStatus === 'ORPHAN_EXTERNAL' ? li.externalTxId : li.internalSourceId;
        if (!anchorId) continue;
        const wallet = peer.walletRef && !String(peer.walletRef).startsWith('XREF:')
          ? await (this.prisma as any).wallet.findUnique({ where: { id: peer.walletRef }, select: { walletNo: true } })
          : null;
        out.push({
          caseNo: peer.caseNo, walletNo: wallet?.walletNo ?? null, ownerNo: peer.ownerNo ?? null,
          anchorId, externalRef: li.externalRef ?? null, amount: liAmount,
        });
      }
    }
    return out;
  }
}
```

- [ ] **Step 5: controller + module 注册**

`disposition/disposition.controller.ts`（buildActor 照抄 `adjustment.controller.ts`）：

```ts
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../../governance/approvals/constants/approval.constants';
import { DispositionService } from './disposition.service';
import { RecordDispositionDto } from '../dto/disposition.dto';

@ApiTags('Admin - Reconciliation Disposition (平账·定性)')
@ApiBearerAuth()
@Controller('admin/reconciliation/cases/:caseNo')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class DispositionController {
  constructor(private readonly disposition: DispositionService) {}

  private buildActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  @Post('dispositions')
  @ApiOperation({ summary: '定性：记查证结论（成因 + 说明），出口由注册表判定' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/reconciliation/cases/:caseNo/dispositions'))
  record(@Param('caseNo') caseNo: string, @Body() dto: RecordDispositionDto, @Req() req: any) {
    return this.disposition.record(caseNo, dto, this.buildActor(req));
  }

  @Get('reattribution-candidates')
  @ApiOperation({ summary: '改记对端候选：同日同资产同金额的反向孤儿' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/reconciliation/cases/:caseNo/reattribution-candidates'))
  candidates(@Param('caseNo') caseNo: string, @Query('side') side: 'FROM' | 'TO', @Query('amount') amount: string) {
    return this.disposition.listReattributionCandidates(caseNo, side, amount);
  }
}
```

`reconciliation.module.ts`：controllers 加 `DispositionController`，providers 加 `DispositionService`（import 语句照文件既有分组风格补）。

- [ ] **Step 6: 跑测试确认通过 + 落库同步 + 提交**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/disposition.service.spec.ts
npx tsc --noEmit -p tsconfig.json
npm run db:base:sync     # 新路由进权限库；⚠ 收尾走查前还要重启后端才生效
git add -A src/modules/clearing-settle/reconciliation
git commit -m "feat(recon): 定性落库——record/linkAdjustment/改记候选 + RECON_DISPOSITION_RECORDED 审计（T4）"
```

---

### Task 5: 调账单接定性 + 第四族开单 + DRAFTED 审计

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/dto/adjustment.dto.ts`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`（createDraft / submit）
- Test: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`（追加）

**Interfaces:**
- Consumes: Task 2 `CUSTOMER_REATTRIBUTION`；Task 4 `DispositionService.linkAdjustment`（构造器注入）
- Produces: `CreateAdjustmentDto` + `dispositionNo?` / `toCaseNo?`；第四族草稿行（`direction: 'REATTRIBUTE'`、`toWalletRef`/`toOwnerNo` 落库）；每次 createDraft 记 `RECON_ADJUSTMENT_DRAFTED`

- [ ] **Step 1: 写失败的测试**（追加进 `adjustment.service.spec.ts`，mock 惯例沿用该文件既有写法；`DispositionService` 以 `{ linkAdjustment: jest.fn() }` 注入）

```ts
describe('createDraft 第四族（改记，spec §6）+ 定性联动 + DRAFTED 审计', () => {
  it('改记：两案同业务日校验、正主方必填原单、direction 落 REATTRIBUTE、toWalletRef/toOwnerNo 落库', async () => {
    // fromCase：CUSTOMER 账簿 OPEN；toCase：同 businessDate 同 assetCode
    // prisma mock：reconciliationCase.findUnique 按 caseNo 分别返回两案；
    // depositTransaction.findUnique 命中（原单守卫）；customerMain.findUnique 返回 from 客户
    const r = await service.createDraft({
      caseNo: 'REC-FROM', toCaseNo: 'REC-TO',
      reasonCode: 'CUSTOMER_REATTRIBUTION', direction: 'REDUCE',   // direction 入参被忽略
      amount: '730000', effectiveDate: '2026-09-01',
      explainedFlowId: 'flow-from', explainedExternalLineId: 'ext-to',
      relatedOrderNo: 'DEP001', reasonInternal: 'x', reasonCustomer: 'y',
      dispositionNo: 'RCD001',
    } as any, ACTOR);
    const created = prismaMock.reconciliationAdjustment.create.mock.calls[0][0].data;
    expect(created.direction).toBe('REATTRIBUTE');
    expect(created.toWalletRef).toBe('wallet-to-uuid');
    expect(created.toOwnerNo).toBe('CU-TO');
    expect(dispositionMock.linkAdjustment).toHaveBeenCalledWith('RCD001', r.adjustmentNo);
  });
  it('改记两案业务日不同 → 400（本轮不做跨日改记）', async () => { /* toCase.businessDate 改成 2026-08-31，expect rejects /业务日/ */ });
  it('改记缺 toCaseNo / 缺 relatedOrderNo → 各 400', async () => { /* 两断言 */ });
  it('每次 createDraft（四族通用）记 RECON_ADJUSTMENT_DRAFTED，requestId 显式', async () => {
    // 走既有三族任一路径，断言 auditMock.recordByActor 收到：
    // action=RECON_ADJUSTMENT_DRAFTED、reasonCode/amount 顶层、requestId 匹配 /^RECON_ADJUSTMENT_DRAFTED_ADJ/
  });
});
```

（`/* */` 内为断言要点，落地时写全——mock 台架抄同文件既有 describe 的搭法，不新造）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`
Expected: 新 describe FAIL，旧用例仍绿

- [ ] **Step 3: 实现**

1. `dto/adjustment.dto.ts` 追加两个可选字段：

```ts
  // 定性联动（spec §3.3）：带上则开单成功后回填 disposition.adjustmentNo 并锁定该定性
  @IsOptional() @IsString() dispositionNo?: string;
  // 第四族改记：正主方案件号（caseNo = 错记方案件）
  @IsOptional() @IsString() toCaseNo?: string;
```

2. `adjustment.service.ts`：
- 构造器注入 `private readonly dispositions: DispositionService`（module 里两者同级已注册）
- `createDraft` 在 `assertReasonAllowed` 之前加第四族分支：

```ts
    if (dto.reasonCode === 'CUSTOMER_REATTRIBUTION') {
      return this.createReattributionDraft(dto, kase, actor);
    }
```

- 新私有方法（放 `relatedOrderExists` 之后）：

```ts
  /**
   * 第四族改记开单（spec §6）：caseNo = 错记方案件，toCaseNo = 正主方案件。
   * 两案必须同业务日（跨日改记本轮不做）、同资产、都在 CUSTOMER 账簿、都 OPEN。
   * 正主方是加钱 → 原单守卫沿用（原单 = 记在错记方名下的那张真实充值单，
   * KYT 对这笔钱跑过——放行依据与一期边界线同源；换主后合规复核登记 BACKLOG）。
   * direction 落 'REATTRIBUTE'——它不参与 book×direction 语义，分录由族定。
   */
  private async createReattributionDraft(dto: CreateAdjustmentDto, fromCase: any, actor: ApprovalActorContext) {
    if (!dto.toCaseNo) throw new BadRequestException('改记必须指明正主方案件号（toCaseNo）');
    const toCase = await (this.prisma as any).reconciliationCase.findUnique({ where: { caseNo: dto.toCaseNo } });
    if (!toCase) throw new NotFoundException(`正主方案件不存在：${dto.toCaseNo}`);
    if (toCase.status !== 'OPEN') throw new BadRequestException('正主方案件不是打开状态');
    if (fromCase.book === 'FIRM' || toCase.book === 'FIRM') throw new BadRequestException('改记只发生在客户账簿之间');
    if (fromCase.businessDate !== toCase.businessDate) {
      throw new BadRequestException(`两案业务日不同（${fromCase.businessDate} vs ${toCase.businessDate}）——跨日改记本轮不做`);
    }
    if (fromCase.assetCode !== toCase.assetCode) throw new BadRequestException('两案资产不同，改记说不通');
    if (dto.effectiveDate > fromCase.businessDate) {
      throw new BadRequestException(`生效日 ${dto.effectiveDate} 晚于案件业务日 ${fromCase.businessDate}`);
    }
    const relatedOrderNo = dto.relatedOrderNo?.trim();
    if (!relatedOrderNo || !(await this.relatedOrderExists(relatedOrderNo))) {
      throw new BadRequestException('改记必须指向一张已存在的原单（记在错记方名下的那笔真实充值/提现）——KYT 对这笔钱跑过才放行');
    }
    const owner = fromCase.ownerNo
      ? await (this.prisma as any).customerMain.findUnique({ where: { customerNo: fromCase.ownerNo }, select: { id: true } })
      : null;
    const row = await (this.prisma as any).reconciliationAdjustment.create({
      data: {
        adjustmentNo: generateReferenceNo('ADJ'),
        caseNo: dto.caseNo,
        explainedFlowId: dto.explainedFlowId ?? null,           // 错记方内部流水锚
        explainedExternalLineId: dto.explainedExternalLineId ?? null, // 正主方外部行锚
        walletRef: fromCase.walletRef,
        toWalletRef: toCase.walletRef,
        toOwnerNo: toCase.ownerNo ?? null,
        book: 'CLIENT',
        direction: 'REATTRIBUTE',
        reasonCode: dto.reasonCode,
        relatedOrderNo,
        assetCode: fromCase.assetCode,
        amount: dto.amount,
        effectiveDate: dto.effectiveDate,
        reasonInternal: dto.reasonInternal,
        reasonCustomer: dto.reasonCustomer,
        ownerNo: fromCase.ownerNo ?? null,
        ownerId: owner?.id ?? null,
        traceId: fromCase.traceId ?? null,
        createdByUserId: actor.userNo ?? actor.userId,
        status: AdjustmentStatus.DRAFT,
      },
    });
    await this.afterDraftCreated(row, dto, actor);
    return { adjustmentNo: row.adjustmentNo };
  }
```

- 既有三族路径的 `create` 之后与上面分支共用收尾（抽私有方法）：

```ts
  /** 开单收尾（四族通用）：DRAFTED 审计（铁律①，销 BACKLOG「createDraft 零审计」）+ 定性联动。 */
  private async afterDraftCreated(row: any, dto: CreateAdjustmentDto, actor: ApprovalActorContext): Promise<void> {
    const actorDisplay = actor.userNo ?? actor.userId;
    await this.auditLogs.recordByActor(
      {
        action: 'RECON_ADJUSTMENT_DRAFTED',
        actionDomain: 'RECON',
        primarySubjectType: AuditEntityTypes.RECON_ADJUSTMENT,
        primarySubjectNo: row.adjustmentNo,
        ownerCustomerNo: row.ownerNo ?? undefined,
        reasonCode: row.reasonCode,        // requiredFields 顶层
        amount: row.amount,
        subjects: [
          { subjectType: AuditEntityTypes.RECON_ADJUSTMENT, subjectNo: row.adjustmentNo, subjectRole: 'PRIMARY' },
          { subjectType: 'RECONCILIATION_CASE', subjectNo: row.caseNo, subjectRole: 'RELATED' },
        ],
        reason: row.reasonInternal,
        requestId: `RECON_ADJUSTMENT_DRAFTED_${row.adjustmentNo}_${randomUUID()}`,
        metadata: { reasonCode: row.reasonCode, direction: row.direction, amount: row.amount, book: row.book, toOwnerNo: row.toOwnerNo ?? null },
        sourcePlatform: 'ADMIN',
      } as any,
      { actorType: 'ADMIN', actorNo: actorDisplay, actorDisplayName: actorDisplay, actorRolesAtTime: actor.roleCodes ?? [] },
    );
    if (dto.dispositionNo) await this.dispositions.linkAdjustment(dto.dispositionNo, row.adjustmentNo);
  }
```

既有 `createDraft` 主路径 `return { adjustmentNo: row.adjustmentNo }` 前插一行 `await this.afterDraftCreated(row, dto, actor);`。

3. `submit()` 的 `objectSnapshot` 加 `toOwnerNo: row.toOwnerNo ?? null`（审批页要看见正主）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment.service.spec.ts`
Expected: 新旧全绿（旧用例若因 afterDraftCreated 的 audit 调用多了一次而红，按行为更新断言——那是刻意的新行为）

- [ ] **Step 5: 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add -A src/modules/clearing-settle/reconciliation
git commit -m "feat(recon): 改记开单（两案守卫+双锚）+ 定性联动 + RECON_ADJUSTMENT_DRAFTED 审计（T5）"
```

---

### Task 6: 第四族落账 + 解释索引放宽 + 详情/审批文案

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts`（onApproved / describeImpact / getAdjustment）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/explained-difference.service.ts`
- Test: 追加 `adjustment.service.spec.ts`、`adjustment-approval.service.spec.ts` 用例

**Interfaces:**
- Consumes: Task 2 `resolveReattributionLegs`
- Produces: 第四族落账（一笔 TB transfer：借 from 应付 / 贷 to 应付；evidence 两腿各落各的钱包）；`indexForWallet` 对 `toWalletRef` 命中的调账单同样入索引

- [ ] **Step 1: 写失败的测试**

追加 `adjustment.service.spec.ts`：

```ts
describe('onApproved 第四族落账（spec §6）', () => {
  it('借 from 应付 / 贷 to 应付：两次 resolveTbAccountId 都是 CLIENT_PAYABLE、ownerUuid 各自的；executeTransfer evidence 两腿各落各的钱包、isExternalCrossing=false', async () => {
    // row：direction='REATTRIBUTE'，ownerId='uuid-from'，toOwnerNo='CU-TO'（customerMain mock 回 'uuid-to'）
    // 断言 accountingMock.resolveTbAccountId 调用两次，code 均 CLIENT_PAYABLE，
    // ownerUuid 分别 'uuid-from'/'uuid-to'；executeTransfer 入参
    // evidence.debitWalletRef='wallet-from'、creditWalletRef='wallet-to'、
    // isExternalCrossing=false、effectiveDate=row.effectiveDate
  });
});
describe('describeImpact 第四族', () => {
  it('输出「从 A 名下改记到 B 名下；客户资产总额不变」', () => {
    const text = service.describeImpact({
      book: 'CLIENT', ownerNo: 'CU-FROM', amount: '730000', assetCode: 'AED',
      direction: 'REATTRIBUTE', reasonCode: 'CUSTOMER_REATTRIBUTION',
      reasonInternal: '记错客户', toOwnerNo: 'CU-TO',
    } as any, 2);
    expect(text).toContain('CU-FROM');
    expect(text).toContain('CU-TO');
    expect(text).toContain('7300.00');
    expect(text).toContain('客户资产总额不变');
  });
});
```

追加 `explained-difference` 用例（该文件无独立 spec 则新建 `explained-difference.service.spec.ts`）：

```ts
it('indexForWallet 也收 toWalletRef 命中的改记单——正主方钱包能查到解释锚（spec §6 ⚠）', async () => {
  const prisma: any = { reconciliationAdjustment: { findMany: jest.fn().mockResolvedValue([]) } };
  const svc = new ExplainedDifferenceService(prisma);
  await svc.indexForWallet('wallet-to');
  expect(prisma.reconciliationAdjustment.findMany.mock.calls[0][0].where).toEqual({
    OR: [{ walletRef: 'wallet-to' }, { toWalletRef: 'wallet-to' }],
    status: 'POSTED',
  });
});
```

- [ ] **Step 2: 跑测试确认失败**，然后实现：

1. `explained-difference.service.ts` 的 `indexForWallet` where 改为：

```ts
      where: { OR: [{ walletRef }, { toWalletRef: walletRef }], status: AdjustmentStatus.POSTED },
```

（注释补一句：改记单挂在错记方名下、锚着正主方的外部行——按单一 walletRef 圈定会让正主方钱包查不到它，双案自愈就断一半。）

2. `adjustment.service.ts` `onApproved` 在 `const legs = resolvePostingLegs(...)` 之前加分支：

```ts
    if (row.direction === 'REATTRIBUTE') {
      return this.postReattribution(row, deciderId, deciderNo, deciderRole);
    }
```

新私有方法（ledger 解析 / assetRow 查询 / 审计信封整段照 `onApproved` 既有写法，差异只在账户与 evidence）：

```ts
  /** 第四族落账：借 错记方应付 / 贷 正主方应付。资产腿不动——托管里的钱没动。 */
  private async postReattribution(row: any, deciderId: string, deciderNo?: string | null, deciderRole?: string | null): Promise<void> {
    this.assertTransition(row.status, AdjustmentStatus.POSTED);
    const deciderDisplay = deciderNo ?? deciderId;
    const assetRow = await (this.prisma as any).asset.findUnique({ where: { code: row.assetCode }, select: { currency: true } });
    const ledger = TB_LEDGERS[assetRow?.currency as keyof typeof TB_LEDGERS];
    if (!ledger) throw new NotFoundException(`资产 ${row.assetCode} 解析不出账本 ledger（currency=${assetRow?.currency ?? '未找到该资产'}）`);

    const toOwner = row.toOwnerNo
      ? await (this.prisma as any).customerMain.findUnique({ where: { customerNo: row.toOwnerNo }, select: { id: true } })
      : null;
    if (!row.ownerId || !toOwner?.id) throw new NotFoundException('改记两端客户解析失败（ownerId / toOwnerNo）');

    const legs = resolveReattributionLegs();
    const debitAccountId = await this.accounting.resolveTbAccountId({ code: legs.debitCode, ledger, ownerType: 'CUSTOMER', ownerUuid: row.ownerId } as any);
    const creditAccountId = await this.accounting.resolveTbAccountId({ code: legs.creditCode, ledger, ownerType: 'CUSTOMER', ownerUuid: toOwner.id } as any);

    const { tbTransferId } = await this.accounting.executeTransfer({
      debitAccountId, creditAccountId,
      amount: BigInt(row.amount), ledger,
      code: TB_TRANSFER_CODES.RECON_ADJUSTMENT,
      evidence: {
        sourceType: 'RECON_ADJUSTMENT', sourceNo: row.adjustmentNo,
        eventCode: 'RECON_ADJUSTMENT_POSTED',
        traceId: row.traceId || row.adjustmentNo,
        debitCode: TB_CODE_TO_COA[legs.debitCode], creditCode: TB_CODE_TO_COA[legs.creditCode],
        assetCurrency: assetRow?.currency ?? row.assetCode,
        actorType: 'ADMIN', actorId: deciderDisplay, memo: row.reasonInternal,
        // 两腿各落各的钱包：错记方余额降、正主方余额升，两案各自的 delta 才归零
        debitWalletRef: row.walletRef,
        creditWalletRef: row.toWalletRef,
        isExternalCrossing: false,
        effectiveDate: row.effectiveDate,
      },
    });

    await (this.prisma as any).reconciliationAdjustment.update({
      where: { adjustmentNo: row.adjustmentNo },
      data: { status: AdjustmentStatus.POSTED, decidedByUserId: deciderDisplay, postedAt: new Date(), tbTransferId: tbTransferId.toString() },
    });
    // 审计信封与 onApproved 主路径逐字同构（RECON_ADJUSTMENT_POSTED、requiredFields 顶层、
    // 显式 requestId、subjects PRIMARY+OWNER+RELATED），仅 metadata 多 toOwnerNo/toCaseNo 线索：
    // metadata: { ..., toOwnerNo: row.toOwnerNo } ——照抄主路径那段，此处不重复誊。
  }
```

（审计信封段落地时从 `onApproved` 主路径复制后改 metadata，两处 `requestId` 都保持显式。）

3. `describeImpact` 开头加：

```ts
    if (row.direction === 'REATTRIBUTE') {
      const majorAmount = bigintToDecimal(BigInt(row.amount), decimals).toFixed(decimals);
      return `本单将把 ${majorAmount} ${row.assetCode} 从客户 ${row.ownerNo ?? '(未知)'} 名下改记到客户 ${(row as any).toOwnerNo ?? '(未知)'} 名下；`
           + `客户资产总额不变；理由：${row.reasonInternal}`;
    }
```

（签名的 row 类型加 `toOwnerNo?: string | null`；`submit()` 传 `describeImpact(row, ...)` 的 row 本来就是整行，无需改调用。）

4. `getAdjustment`：解构排除清单加 `toWalletRef: _toWalletRef`；返回体加 `toWalletNo`（照 walletNo 同款查法查 `row.toWalletRef`）与 `toOwnerNo`（rest 里已带）。分录预览：`direction === 'REATTRIBUTE'` 时用 `resolveReattributionLegs()` 取 legs。

- [ ] **Step 3: 跑测试确认通过 + 提交**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/
npx tsc --noEmit -p tsconfig.json
git add -A src/modules/clearing-settle/reconciliation
git commit -m "feat(recon): 改记落账（应付对转、两腿各落各钱包）+ 解释索引收 toWalletRef（T6）"
```

---

### Task 7: 案件读面——行附定性 / 双胞胎线索 / 成因菜单；列表附进度与 decimals

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts`
- Modify: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`
- Test: `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.spec.ts`（追加）

**Interfaces:**
- Consumes: Task 1 `menuFor`/`staticOutletLabel`/`CAUSE_REGISTRY`
- Produces（前端 Task 8/9/10 消费，字段名抄准）:
  - `FlowComparisonRow` 新增：
    - `disposition?: { dispositionNo: string; causeCode: string; causeLabel: string; outlet: string; outletLabel: string; findingNote: string; adjustmentNo: string | null; createdBy: string; createdAt: string } | null`
    - `duplicateTwinRef?: string | null`
    - `menu?: Array<{ code: string; label: string; clue: string; outletLabel: string }>`
  - `listCases` 每行新增 `dispositionCount: number`、`anomalyLineCount: number`、`decimals: number`

- [ ] **Step 1: 写失败的测试**（追加进 query.service.spec，mock 惯例沿用）

```ts
describe('getCase 行注解（spec §3/§8）', () => {
  it('ORPHAN_INTERNAL 行：已匹配里有同 ref 同额行 → duplicateTwinRef 命中；其余为 null', async () => { /* 构造 matcher 返回一对 MATCHED(ref R, amt X) + 两条 orphanInternal（一条 ref R amt X、一条 ref R2）*/ });
  it('三类差异行带 menu（该格成因清单）；MATCHED/IN_TRANSIT 不带', async () => { /* menu[0].code 断言 */ });
  it('行有定性记录 → disposition 注解（含 causeLabel/outletLabel/createdBy）', async () => { /* mock reconciliationDisposition.findMany 返回一条锚中 flowId 的记录 */ });
});
describe('listCases 进度与 decimals', () => {
  it('每行带 dispositionCount / anomalyLineCount / decimals', async () => { /* groupBy 两 mock + asset findMany mock */ });
});
```

- [ ] **Step 2: 实现**

1. `reconciliation.dto.ts` 在 `FlowComparisonRow` 里 `explainedByAdjustmentNo` 之后追加三字段（形状见 Interfaces，逐字）。

2. `reconciliation-query.service.ts` `getCase()` 里 `flowComparison = built.rows` 之后追加：

```ts
      // ── 平账一期半（spec §3/§8）：行注解 ──────────────────────────
      // ① 定性记录：按锚（flowId / externalLineId）回贴到行上
      const dispositions = (await (this.prisma as any).reconciliationDisposition.findMany({
        where: { caseNo },
      })) as any[];
      const dByFlow = new Map<string, any>();
      const dByExt = new Map<string, any>();
      for (const d of dispositions) {
        if (d.explainedFlowId) dByFlow.set(d.explainedFlowId, d);
        if (d.explainedExternalLineId) dByExt.set(d.explainedExternalLineId, d);
      }
      // ② 双胞胎线索（15 个成因里唯一机器认得出的证据，spec §0.3）：
      //    已匹配行的 (externalRef, amount) 集合——ORPHAN_INTERNAL 行命中即标
      const matchedKeys = new Set(
        flowComparison
          .filter((r) => r.matchType === 'MATCHED' && r.externalLine?.externalRef)
          .map((r) => `${r.externalLine!.externalRef}|${r.externalLine!.amount}`),
      );
      const caseBook = kase.book === 'FIRM' ? 'FIRM' : 'CLIENT';
      for (const r of flowComparison) {
        if (r.matchType === 'MATCHED' || r.matchType === 'IN_TRANSIT') continue;
        const d = (r.internalFlow && dByFlow.get(r.internalFlow.id)) || (r.externalLine && dByExt.get(r.externalLine.id)) || null;
        r.disposition = d ? {
          dispositionNo: d.dispositionNo, causeCode: d.causeCode,
          causeLabel: CAUSE_REGISTRY[d.causeCode as CauseCode]?.label ?? d.causeCode,
          outlet: d.outlet, outletLabel: staticOutletLabel(d.causeCode as CauseCode),
          findingNote: d.findingNote, adjustmentNo: d.adjustmentNo ?? null,
          createdBy: d.createdByUserId, createdAt: (d.updatedAt ?? d.createdAt).toISOString(),
        } : null;
        r.duplicateTwinRef = (r.matchType === 'ORPHAN_INTERNAL' && r.internalFlow?.externalRef
          && matchedKeys.has(`${r.internalFlow.externalRef}|${r.internalFlow.amount}`))
          ? r.internalFlow.externalRef : null;
        r.menu = menuFor(r.matchType as any, caseBook);
      }
```

（import：`CAUSE_REGISTRY, CauseCode, menuFor, staticOutletLabel` from `../disposition/cause-registry`。IN_TRANSIT 追加段生成的行不动。）

3. `listCases()` 返回映射前追加两个 groupBy + decimals join：

```ts
    const caseNos = rows.map((r: any) => r.caseNo);
    const dispositionCounts = caseNos.length
      ? await (this.prisma as any).reconciliationDisposition.groupBy({
          by: ['caseNo'], where: { caseNo: { in: caseNos } }, _count: { _all: true },
        })
      : [];
    const dispCountByCase = new Map<string, number>(dispositionCounts.map((g: any) => [g.caseNo, g._count._all]));
    const caseIds = rows.map((r: any) => r.id);
    const anomalyCounts = caseIds.length
      ? await (this.prisma as any).reconciliationLineItem.groupBy({
          by: ['caseId'],
          where: { caseId: { in: caseIds }, matchStatus: { in: ['AMOUNT_MISMATCH', 'ORPHAN_INTERNAL', 'ORPHAN_EXTERNAL'] } },
          _count: { _all: true },
        })
      : [];
    const anomalyByCaseId = new Map<string, number>(anomalyCounts.map((g: any) => [g.caseId, g._count._all]));
    // Δ 分→元（BACKLOG 在案）：decimals 随行下发，前端按行缩放
    const assetCodes = Array.from(new Set(rows.map((r: any) => r.assetCode)));
    const assets = assetCodes.length
      ? ((await (this.prisma as any).asset.findMany({ where: { code: { in: assetCodes } }, select: { code: true, decimals: true } })) as Array<{ code: string; decimals: number }>)
      : [];
    const decimalsByCode = new Map(assets.map((a) => [a.code, a.decimals]));
```

每行返回体追加：

```ts
        dispositionCount: dispCountByCase.get(r.caseNo) ?? 0,
        anomalyLineCount: anomalyByCaseId.get(r.id) ?? 0,
        decimals: decimalsByCode.get(r.assetCode) ?? 0,
```

- [ ] **Step 3: 跑测试确认通过 + 提交**

```bash
npx jest src/modules/clearing-settle/reconciliation/domain
npx tsc --noEmit -p tsconfig.json
git add -A src/modules/clearing-settle/reconciliation
git commit -m "feat(recon): 案件读面行附定性/双胞胎线索/成因菜单，列表附进度与 decimals（T7）"
```

---

### Task 8: 前端——处置弹层第一屏 + 动作列六态

**Files:**
- Create: `admin-web/src/utils/causeRegistry.ts`
- Create: `admin-web/src/components/ReconciliationDispositionModal.tsx`
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`

**Interfaces:**
- Consumes: Task 7 的 `FlowComparisonRow.menu/disposition/duplicateTwinRef`；`PERMISSIONS.RECON_DISPOSITION_CREATE`
- Produces:
  - `ReconciliationDispositionModal` props：`{ open; caseNo; row: FlowComparisonRow | null; caseStatus: string; onClose(); onRecorded(); onProceedToAdjust(handoff: AdjustHandoff) }`
  - `export interface AdjustHandoff { dispositionNo: string; family: 'CORRECT'|'REVERSE'|'RECORD'|'REATTRIBUTE'; reasonCode?: string; direction?: 'REDUCE'|'INCREASE'; directionNote: string; row: FlowComparisonRow }`

- [ ] **Step 1: 展示词表**

`admin-web/src/utils/causeRegistry.ts`（**不镜像成因表**——菜单/线索由后端行数据下发，这里只放前端自己要的展示词与行事实推导）：

```ts
// 平账一期半：前端不自建成因表——菜单（含文案与出口词）由后端 FlowComparisonRow.menu
// 下发（唯一真相 cause-registry.ts）。这里只有：出口徽标色、行事实推导、方向依据文案。
import type { FlowComparisonRow } from '../pages/reconTypes'; // 若无该类型文件，就地用页面里已有的 FlowComparisonRow 类型 import

export const OUTLET_TONE: Record<string, 'green' | 'blue' | 'amber' | 'red'> = {
  ADJUST_CORRECT: 'blue', ADJUST_REVERSE: 'blue', ADJUST_RECORD: 'blue', ADJUST_REATTRIBUTE: 'blue',
  HOLD_NEXT_PERIOD: 'amber', HOLD_INVESTIGATING: 'amber', DEFERRED: 'amber',
};

/** 行事实（出口判定的输入）——从被点的那一行原样取，POST 时带给后端。 */
export const rowFacts = (row: FlowComparisonRow) => ({
  deltaSign: row.deltaAmount != null ? (row.deltaAmount.startsWith('-') ? -1 : 1) as 1 | -1 : undefined,
  internalDirection: row.internalFlow?.direction,
  internalSourceType: row.internalFlow?.sourceType,
  externalDirection: row.externalLine?.direction,
});

/** 方向只读时的推导依据一句话（spec §3.3 表）。 */
export const directionNoteFor = (matchType: string): string =>
  matchType === 'AMOUNT_MISMATCH' ? '方向由差额符号推出（外部−内部：正→加，负→减），不可改'
  : matchType === 'ORPHAN_INTERNAL' ? '方向 = 内部流水方向取反（IN→减，OUT→加），不可改'
  : '方向 = 外部流水方向照搬（IN→加，OUT→减），不可改';
```

（`FlowComparisonRow` 的前端类型定义在 `ReconciliationCasesDetailPage.tsx` 内——把它抽出为 export 或在本文件重declare 与后端 DTO 同形，取页面现状最小改法。）

- [ ] **Step 2: 弹层组件**

`ReconciliationDispositionModal.tsx`（第一屏 + 挂起/留档确认；ADJUST 出口交给 `onProceedToAdjust`）：

```tsx
// 处置弹层第一屏（spec §3.2）：选成因（该格菜单，后端下发）→ 出口自动定。
// 机器只出线索不出结论：双胞胎线索仅在 row.duplicateTwinRef 命中时显示。
// 保存定性 = POST /admin/reconciliation/cases/:caseNo/dispositions；
// ADJUST 类出口把 handoff 交回父组件（父组件开调账弹层）；挂起/留档就地确认收尾。
import { useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { rowFacts, directionNoteFor } from '../utils/causeRegistry';

const ReconciliationDispositionModal = ({ open, caseNo, row, caseStatus, onClose, onRecorded, onProceedToAdjust }: Props) => {
  const [causeCode, setCauseCode] = useState('');
  const [findingNote, setFindingNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<null | { dispositionNo: string; outlet: string; outletLabel: string; family?: string; reasonCode?: string; direction?: 'REDUCE' | 'INCREASE'; deferredTarget?: string }>(null);

  useEffect(() => {
    if (open) { setCauseCode(''); setFindingNote(''); setError(''); setResult(null); }
  }, [open, row]);

  if (!open || !row) return null;
  const menu = row.menu ?? [];

  const submit = async () => {
    if (!causeCode || !findingNote.trim()) { setError('成因与查证说明都是必填——查证说明是这次调查的唯一留存物'); return; }
    setSubmitting(true); setError('');
    try {
      const r = await adminFetch(`/admin/reconciliation/cases/${encodeURIComponent(caseNo)}/dispositions`, {
        method: 'POST',
        body: JSON.stringify({
          matchType: row.matchType,
          explainedFlowId: row.internalFlow?.id,
          explainedExternalLineId: row.externalLine?.id,
          causeCode, findingNote: findingNote.trim(),
          ...rowFacts(row),
        }),
      });
      if (r.outlet.startsWith('ADJUST')) {
        onProceedToAdjust({
          dispositionNo: r.dispositionNo, family: r.family, reasonCode: r.reasonCode,
          direction: r.direction, directionNote: directionNoteFor(row.matchType), row,
        });
      } else {
        setResult(r); // 挂起/留档：显示确认屏（不落任何分录）
      }
    } catch (e) {
      if (e instanceof AdminSessionError) throw e;
      setError(getApiErrorMessage(e));
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-[560px] max-h-[80vh] overflow-y-auto rounded-lg border border-adm-line bg-adm-panel p-5" onClick={(e) => e.stopPropagation()}>
        {!result ? (
          <>
            <h3 className="mb-1 text-sm font-semibold text-adm-t1">处置 · 这条差异查下来的成因是？</h3>
            <p className="mb-3 font-mono text-[11px] text-adm-t3">
              {row.matchType} · {(row.externalLine ?? row.internalFlow)?.amount} · ref {(row.externalLine?.externalRef ?? row.internalFlow?.externalRef) ?? '—'}
            </p>
            <div className="space-y-1.5">
              {menu.map((m) => (
                <label key={m.code} className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs ${causeCode === m.code ? 'border-adm-blue/50 bg-adm-blue/10' : 'border-adm-line'}`}>
                  <input type="radio" name="cause" checked={causeCode === m.code} onChange={() => setCauseCode(m.code)} className="mt-0.5" />
                  <span className="flex-1">
                    <span className="text-adm-t1">{m.label}</span>
                    <span className="ml-2 text-adm-t3">→ {m.outletLabel}</span>
                    <div className="mt-0.5 text-[11px] text-adm-t3">线索：{m.clue}</div>
                  </span>
                </label>
              ))}
            </div>
            {row.duplicateTwinRef && (
              <div className="mt-3 rounded border border-adm-amber/30 bg-adm-amber/10 p-2 text-[11px] text-adm-t2">
                💡 机器线索：已匹配列表里有一条同参考号同金额的行（{row.duplicateTwinRef}）——银行只报一次、我方入了两次，指向「重复入账」。
              </div>
            )}
            <div className="mt-3">
              <label className="mb-1 block text-[11px] text-adm-t3">查证说明（必填——写清查了什么、依据什么下的结论）</label>
              <textarea value={findingNote} onChange={(e) => setFindingNote(e.target.value)} rows={3}
                className="w-full rounded border border-adm-line bg-adm-bg p-2 text-xs text-adm-t1" />
            </div>
            {error && <p className="mt-2 text-xs text-adm-red">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={adminButtonClass('ghost')}>取消</button>
              <button type="button" onClick={submit} disabled={submitting} className={adminButtonClass('primary')}>
                {submitting ? '提交中…' : '下一步 →'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-2 text-sm font-semibold text-adm-t1">已定性 · {result.outletLabel}</h3>
            <p className="text-xs text-adm-t2">
              {result.outlet === 'HOLD_NEXT_PERIOD' && '不落任何分录。案子保持现状，下期对账自然配平后自动销案。'}
              {result.outlet === 'HOLD_INVESTIGATING' && '不落任何分录。案子保持破口，标注「已定性 · 调查中」——查证记录已留档，账龄与核销归下一轮。'}
              {result.outlet === 'DEFERRED' && `不落任何分录。该差异的正确出口（${result.outletLabel.replace('留档·', '')}）本期未开放，结论已留档，案子继续挂。`}
            </p>
            <p className="mt-2 font-mono text-[11px] text-adm-t3">{result.dispositionNo}</p>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => { onRecorded(); onClose(); }} className={adminButtonClass('primary')}>完成</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
export default ReconciliationDispositionModal;
```

（Props/AdjustHandoff 类型按 Interfaces 定义写全；tone/按钮样式沿用页面既有 token，不新造色。）

- [ ] **Step 3: 动作列六态**

`ReconciliationCasesDetailPage.tsx`：
- 顶部：`const canRecordDisposition = hasPermission(PERMISSIONS.RECON_DISPOSITION_CREATE);`；state 加 `const [dispositionRow, setDispositionRow] = useState<FlowComparisonRow | null>(null);`
- 把 Task 7 一期注释那段动作 `<td>`（`{/* Task 7: 开调账单入口…所有 5 类行都给 */}` 起）整体替换为：

```tsx
                          {/* 平账一期半（spec §3.1）：动作列六态。同形状同按钮——
                              给不同按钮就是假装机器知道它不知道的东西；差异化发生在
                              定性弹层里人选完成因之后。 */}
                          <td className="px-3 py-3">
                            {row.explainedByAdjustmentNo ? (
                              <Link to={`/admin/reconciliation/adjustments/${encodeURIComponent(row.explainedByAdjustmentNo)}`}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-green/30 bg-adm-green/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-adm-green hover:underline">
                                已解释 · {row.explainedByAdjustmentNo}
                              </Link>
                            ) : row.matchType === 'MATCHED' ? null : row.matchType === 'IN_TRANSIT' ? (
                              row.fundsOrderNo ? (
                                <Link to={`/admin/funds-orders/${encodeURIComponent(row.fundsOrderNo)}`}
                                  className="whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline">
                                  去推单 →
                                </Link>
                              ) : <span className="text-[10px] text-adm-t3">在途 · 无资金单号</span>
                            ) : row.disposition ? (
                              <div className="flex flex-col gap-1">
                                <span title={row.disposition.findingNote}
                                  className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-amber/30 bg-adm-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-adm-t2">
                                  已定性 · {row.disposition.causeLabel} → {row.disposition.outletLabel} · {row.disposition.createdBy} {row.disposition.createdAt.slice(5, 10)}
                                </span>
                                {row.disposition.outlet.startsWith('ADJUST') && !row.disposition.adjustmentNo
                                  && canCreateAdjustment && kase.status === 'OPEN' && (
                                  <button type="button" onClick={() => openAdjustFromDisposition(row)}
                                    className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline">
                                    <Plus size={10} /> 开单
                                  </button>
                                )}
                              </div>
                            ) : (
                              canRecordDisposition && kase.status === 'OPEN' && (
                                <button type="button" onClick={() => setDispositionRow(row)}
                                  className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline">
                                  处置
                                </button>
                              )
                            )}
                          </td>
```

- 页面尾部挂 `<ReconciliationDispositionModal open={!!dispositionRow} row={dispositionRow} caseNo={caseNo} caseStatus={kase.status} onClose={() => setDispositionRow(null)} onRecorded={reload} onProceedToAdjust={handleAdjustHandoff} />`
- 本任务 `openAdjustFromDisposition` / `handleAdjustHandoff` 先落一个把 handoff 存进 state 并打开既有调账弹层的最小实现（Task 9 完成锁定视图）；`rowAdjustmentPrefill` 保留（Task 9 继续用它做金额/锚预填）。

- [ ] **Step 4: 编译 + 渲染验证 + 提交**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

起 preview（launch.json 既有配置）→ 用 self 栈管理台打开一个 break 案件页 → 确认六态渲染（此时改记/锁定视图未完，ADJUST 出口先到旧弹层为已知中间态）→ 截图存 `doc-final/superpowers/plans/artifacts/`（目录不存在则建）。

```bash
git add -A admin-web/src
git commit -m "feat(admin-recon): 处置弹层第一屏（成因菜单+机器线索+查证说明）+ 动作列六态（T8）"
```

---

### Task 9: 前端——ADJUST 通道锁定视图 + 改记对端确认

**Files:**
- Modify: `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx`
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（handoff 补全）

**Interfaces:**
- Consumes: Task 8 `AdjustHandoff`；Task 4 候选端点；Task 5 dto 的 `dispositionNo`/`toCaseNo`
- Produces: `ReconciliationAdjustmentCreateModalProps` 新增可选 `locked?: { dispositionNo: string; family: string; reasonCode?: string; direction?: 'REDUCE'|'INCREASE'; directionNote: string; toCandidatesUrl?: string }`

- [ ] **Step 1: 弹层 locked 模式**

`ReconciliationAdjustmentCreateModal.tsx`：
1. Props 加 `locked?`（形状见上）。
2. `locked` 存在时：
   - 成因区：不渲染下拉，渲染只读回显 `【{FAMILY_WORD[locked.family]}】{REASON_META[locked.reasonCode]?.label ?? '（改记）'}`（`FAMILY_WORD = { CORRECT: '冲正', REVERSE: '冲销', RECORD: '补记', REATTRIBUTE: '改记' }`，本文件内常量）；`reasonCode` state 初始化为 `locked.reasonCode ?? 'CUSTOMER_REATTRIBUTION'`
   - 方向区：只读文本 `减少 / 增加` + 小字 `locked.directionNote`；`direction` state 初始化 `locked.direction ?? ''`
   - 弹层标题带白话：`冲正 · 把金额改成对的` / `冲销 · 撤销这笔入账` / `补记 · 记一笔公司自己的收支` / `改记 · 把钱改记到正主名下`
3. **改记视图**（`locked.family === 'REATTRIBUTE'`）：
   - 打开时 `adminFetch` GET `/admin/reconciliation/cases/${caseNo}/reattribution-candidates?side=${row.matchType === 'ORPHAN_INTERNAL' ? 'FROM' : 'TO'}&amount=${row金额}` → 候选列表（walletNo / ownerNo / externalRef，单选；空列表显示「未找到同日同额的反向孤儿——先确认对端案件已跑出差异行」并禁用提交）
   - 金额只读（= 该行金额）；方向区隐藏（改记无方向）
   - 提交体：当前行是 FROM（我有外无）时 `caseNo=本案`、`toCaseNo=候选案`、`explainedFlowId=本行内部流水 id`、`explainedExternalLineId=候选.anchorId`；当前行是 TO（外有我无）时对调（`caseNo=候选案` 为错记方、`explainedFlowId=候选.anchorId`、`explainedExternalLineId=本行外部行 id`）——**改记单永远挂在错记方名下**（spec §6）
   - 摘要行：`从 {错记方 ownerNo}（{walletNo}）改记到 {正主 ownerNo}（{walletNo}）· 客户资产总额不变`（展示一律业务键，铁律⑥）
4. 提交体（四族通用）加 `dispositionNo: locked?.dispositionNo`。

- [ ] **Step 2: 页面 handoff 补全**

`ReconciliationCasesDetailPage.tsx`：`handleAdjustHandoff(h)` → `setCreatePrefill(rowAdjustmentPrefill(h.row)); setAdjustLocked({ dispositionNo: h.dispositionNo, family: h.family, reasonCode: h.reasonCode, direction: h.direction, directionNote: h.directionNote }); setDispositionRow(null);`；`openAdjustFromDisposition(row)` = 用 `row.disposition` 的 causeCode 反查不必——直接以 `row.disposition.outlet`（`ADJUST_X`→family）与 `rowAdjustmentPrefill(row)` 组一个同款 locked（reasonCode/direction 后端 record 已判定过，但徽标态没存它们——**再走一次 resolve 的最小实现：让「开单」按钮也弹 DispositionModal 的只读复核？不。** 直接方案：`disposition` 注解在 Task 7 已含 `outlet`；reasonCode/direction 用 `rowFacts(row)` + outlet 族在前端还原会造第二真相源——改为 Task 7 的 `disposition` 注解**再多带两个字段**：回到后端把 `resolved.reasonCode/direction` 也存进表？表无此列。**收口做法**：「开单」按钮点击时前端重放一次 POST record（同成因同说明幂等覆盖，后端返回完整 resolved）再进 handoff——一次网络往返换一个真相源，注释写明）。

- [ ] **Step 3: 编译 + 走查 + 提交**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

Preview 走查（self 栈 + break 数据）：任一 ORPHAN_INTERNAL 行 → 处置 → 选「重复入账」→ 弹层成因只读、方向只读带依据 → 提交 → 详情页出现草稿链。截图。

```bash
git add -A admin-web/src
git commit -m "feat(admin-recon): ADJUST 通道锁定视图（成因定死/方向只读）+ 改记对端确认（T9）"
```

---

### Task 10: 前端——列表定性进度列 + 两条同页债

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesListPage.tsx`
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`（tooltip 一处）

- [ ] **Step 1: 列表页**

1. 行类型加 `dispositionCount: number; anomalyLineCount: number; decimals: number;`
2. 表头加一列 `定性进度`；行渲染：

```tsx
                <td className="px-3 py-3 font-mono text-[11px] text-adm-t3">
                  {kase.anomalyLineCount > 0 ? `${kase.dispositionCount}/${kase.anomalyLineCount}` : '—'}
                </td>
```

3. **Δ decimals 修**（BACKLOG 在案）：`:297` 附近 `{kase.deltaAmount}` 改为按行缩放——引入本页局部工具（照 `ReconciliationAdjustmentCreateModal.tsx` 的 `minorToDisplay` 同款字符串切分实现，不过浮点）：`{minorToDisplay(kase.deltaAmount, kase.decimals)}`；符号判断沿用现状 `Number()` 只用于着色。

- [ ] **Step 2: tooltip 修**（BACKLOG 在案，铁律⑥）

`ReconciliationCasesDetailPage.tsx` 搜 `title={kase.walletRef ?? undefined}` → 直接删掉该 `title` 属性（可见文本已有 walletNo，够用）。

- [ ] **Step 3: 编译 + 截图 + 提交**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

Preview：列表页截图（进度列 + Δ 已按元显示）。

```bash
git add -A admin-web/src
git commit -m "fix(admin-recon): 列表定性进度列 + Δ 分→元 + 删 walletRef tooltip（T10，销两条 BACKLOG）"
```

---### Task 11: 种子重编号 14 条 + 场景 10 查无果

**Files:**
- Modify: `scripts/recon-demo.ts`

**Interfaces:**
- Consumes: Task 1 `CauseCode`（`import type { CauseCode } from '../src/modules/clearing-settle/reconciliation/disposition/cause-registry'`）
- Produces: manifest `rootCause` 值域 = 注册表成因码（同词原则的机器面）；14 场景 / 11 钱包期望

- [ ] **Step 1: 类型与映射**

1. `RootCause` 联合类型整体替换为 `type RootCause = CauseCode | 'IN_TRANSIT_TIMING';`（import 见上）——种子答案键与注册表**编译期同源**；唯一例外是场景 1：在途不是差异、不走定性菜单，成因表里没有它的条目，保留种子专用字面量 `'IN_TRANSIT_TIMING'` 并加注释说明。
2. 重编号 + 换码总表（scenarioId 与 rootCause 同步改；`dedupKey` 模板里的 `-sN-` 段一律换新号——dedupKey 是 `@@unique` 机器身份键，本轮必走整库重铺，正是唯一改名窗口，顺带销 BACKLOG「三处 dedupKey 场景号是旧的」陈账）：

| 旧 scenarioId / rootCause | 新 scenarioId / rootCause | dedupKey 段 |
|---|---|---|
| 1 / IN_TRANSIT_TIMING | 1 / `IN_TRANSIT_TIMING`（种子专用字面量，见上） | `-s1-` |
| 4 / SCALE_ERROR | 2 / `AMT_MISBOOKED` | `-s2-scale-error` |
| 10 / COUNTERPARTY_AMOUNT_ERROR | 3 / `AMT_MISBOOKED`（标签改「我方少记」，注入杠杆不变） | `-s3-underbooked` |
| 11 / ROUNDING_DIFF | 4 / `AMT_ROUNDING` | `-s4-rounding` |
| 2 / FEE_NETTED | 5 / `AMT_FEE_NETTED` | `-s5-fee-netted` |
| 7 / DUPLICATE_DEPOSIT | 6 / `DUP_BOOKING` | `-s6-duplicate` |
| 8 / VOIDED_SIGNAL | 7 / `PHANTOM_BOOKING` | `-s7-phantom` |
| 13 / MISROUTED_CREDIT | 8 / `MISATTRIBUTED_FROM`（detail.note 写明接收端成因是 `MISATTRIBUTED_TO`） | `-s8-misattributed` |
| 12 / CUTOFF_STRADDLE | 9 / `CUTOFF_STRADDLE` | `-s9-cutoff` |
| —（新增） | 10 / `UNEXPLAINED` | `-s10-unexplained` |
| 14 / BANK_CHARGE | 11 / `BANK_CHARGE_UNBOOKED` | `-s11-bank-charge` |
| 15 / BANK_INTEREST | 12 / `BANK_INTEREST_UNBOOKED` | `-s12-bank-interest` |
| 5 / MISSED_DEPOSIT | 13 / `MISSED_DEPOSIT` | `-s13-missed-deposit` |
| 6 / BANK_RETURN | 14 / `BOUNCED_FUNDS` | `-s14-bounced` |
| 3 / STATEMENT_MISSING_LINE | **删除** | — |
| 9 / STATEMENT_DUPLICATE_LINE | **删除** | — |

- [ ] **Step 2: 删旧③⑨（公理 1 下不存在的「对方错」类）**

1. 展示位乙块：删 `// ③ 银行漏报明细` 注释起到 `const s3Prev = await bumpClosing(...)` 两行 + `scenarios.push({ scenarioId: 3, rootCause: 'STATEMENT_MISSING_LINE', ... })` 整段；`lines` 取行从 `take: 3` 改 `take: 2`、解构 `[l3, lDup, l8]` 改 `[lDup, l8]`、行数守卫文案改 `≥2`；`wallets.push` 的 `scenarioIds: [3, 7, 8]` 改 `[6, 7]`、`bucketRationale` 重写：`'⑧(新7) 删一条外部行并压低同额收盘（外部少一笔）；⑦(新6) 内部多入一笔而外部不变。两者都把「外部 − 内部」推向负 → 残差 ≠ 0 → BREAK。'`
2. 展示位丙块：删 `// ⑨ 对账单重复行` 起到其 `scenarios.push({ scenarioId: 9, ... })` 整段（含 `s9Ref/s9Created/s9Prev`）；`wallets.push` 的 `scenarioIds: [5, 9]` 改 `[13]`、rationale 改单场景一句话。
3. 文件头注释矩阵（`成因按「谁错了」分三真相` 那段）整体重写为按处置分组的 14 行清单（照 spec §5 表），并删 `:329` 的 `DEMO-ORPHAN-ADDR` 悬空注释。

- [ ] **Step 3: 场景 10 注入**

`firmHedgedPlan` 选取之后加：

```ts
  // 场景 10 · 查无果（spec §5）：公司池一条外部行金额改 7 分 + 同步压收盘——
  // 「翻遍凭证也对不上」的小额差，答案键成因就是 UNEXPLAINED。放公司池是刻意的：
  // 下一轮核销上线时公司池核销 = 一笔分录进损益即结案，这条素材直接复用。
  const firmUnexplainedPlan = firmCandidates.find(
    (p) => p.walletRef !== firmHedgedPlan.walletRef && p.lines > 0,
  );
  if (!firmUnexplainedPlan) {
    throw new Error('场景 10 需要第二个带外部行的干净公司钱包——现有公司钱包要么被 11/12 占用要么无流水。');
  }
```

（`plans` 元素若无 `lines` 计数字段，就地 `externalStatementLine.count({ where: { subAccount: p.walletRef } })` 过滤。）`assertTargetWalletsClean` 数组追加 `{ walletRef: firmUnexplainedPlan.walletRef, allowNonTerminal: false }`。

在 ⑭⑮（新 11/12）注入块之前插入：

```ts
  // ── Scenario 10 — 查无果 (BREAK / AMOUNT_MISMATCH / 公司池) ─────────────
  {
    const line = (await (prisma as any).externalStatementLine.findFirst({
      where: { subAccount: firmUnexplainedPlan.walletRef, amount: { gt: 7 } },
      orderBy: { datetime: 'asc' },
    })) as { id: string; amount: Prisma.Decimal; direction: string; externalRef: string | null } | null;
    if (!line) throw new Error(`场景 10 需要钱包 ${firmUnexplainedPlan.walletRef} 至少一条金额 > 7 分的外部行`);
    const s10Delta = D('-7'); // 外部比内部少 7 分——差额无规律、查无可查
    const newAmount = line.amount.plus(s10Delta);
    await (prisma as any).externalStatementLine.update({ where: { id: line.id }, data: { amount: newAmount } });
    const signed = line.direction === 'IN' ? s10Delta : s10Delta.negated();
    const prevClose = await bumpClosing(firmUnexplainedPlan, signed);
    scenarios.push({
      scenarioId: 10, rootCause: 'UNEXPLAINED',
      expectedLines: [{
        walletRef: firmUnexplainedPlan.walletRef, lineType: 'AMOUNT_MISMATCH',
        amount: newAmount.toString(), externalRef: line.externalRef,
      }],
      detail: { lineId: line.id, internalAmount: line.amount.toString(), externalAmount: newAmount.toString(), prevClosingBalance: prevClose },
    });
    wallets.push({
      walletRef: firmUnexplainedPlan.walletRef, scenarioIds: [10], expectedBucket: 'BREAK',
      bucketRationale: '一条外部行金额 −7 分并压低同额收盘 → 残差 = −7 ≠ 0 → BREAK。成因查无果，处置 = 挂起·调查中（核销的前半段素材）。',
      hasNonTerminalFundsOrder: false,
    });
  }
```

- [ ] **Step 4: 重铺闸实跑（判据 §9-9 的种子半程）**

```bash
bash scripts/stack.sh down
bash scripts/stack.sh reset self       # 场景 6 真写账本，必须整库重铺验证
# reset 会拉起 TB，up 前 kill 之（baseline 注意事项），然后：
bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self recon:demo:break
```

Expected: `scenarios: 14/14 DETECTED ｜ wallets: 11/11 bucket OK ｜ casesOpened 11/11 ｜ identities OK`。⚠ reset 输出必须见 `✔ Capital injection` 行（TOOLING-DEBT 的坑）。

- [ ] **Step 5: 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add scripts/recon-demo.ts
git commit -m "feat(demo): 破口场景重编号 14 条——删「对方错」两条、⑩改标签、新增公司池查无果、答案键换注册表成因码、dedupKey 随重铺换齐（T11）"
```

---

### Task 12: e2e——改记一单双案自愈 + 定性行为

**Files:**
- Create: `test/recon-reattribution.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 4/5/6 全链；夹具搭法与 run/审批调用**照抄 `test/recon-adjustment-money-arcs.e2e-spec.ts`**（该文件已实证过「真 TB 转账 → 真 recon rerun → 案件自愈」全链，是本仓库现成范本；env 前置、crypto polyfill、fresh-wallet 策略、approve 流程逐段复用其写法）

- [ ] **Step 1: 写测试**（结构如下，夹具细节按范本抄）

```ts
/**
 * 平账一期半 e2e（判据 §9-2/§9-4/§9-6）：
 * 场景 A · 改记一单双案同愈：
 *   夹具：两个客户各造一个全新 AED 钱包；FROM 钱包真入一笔（TB 两跳，
 *   crossing ref R）、外部不给行、外部收盘 = 0 → ORPHAN_INTERNAL + BREAK；
 *   TO 钱包内部不动、外部给一行（ref R2，同金额）+ 收盘 = 金额 → ORPHAN_EXTERNAL + BREAK。
 *   ① run() → 两案 OPEN；
 *   ② DispositionService.record(FROM 案, MISATTRIBUTED_FROM, 锚 = from flow id)
 *      → outlet ADJUST_REATTRIBUTE；
 *   ③ listReattributionCandidates(FROM 案, 'FROM', amount) → 命中 TO 案（anchorId = 外部行 id）；
 *   ④ createDraft(CUSTOMER_REATTRIBUTION, caseNo=FROM, toCaseNo=TO, 双锚, relatedOrderNo=库里任一真实 depositNo, dispositionNo)
 *      → submit → ApprovalsService 真批 → 等 handler 落账（轮询 status=POSTED，照范本 waitFor）；
 *   ⑤ 断言 account_flows：FROM 钱包一条 OUT、TO 钱包一条 IN，同 sourceNo=ADJ 单号、
 *      isExternalCrossing=false（资产腿不动的行为证明：两条流水的科目对是 PAYABLE↔PAYABLE）；
 *   ⑥ 再 run() → 两案都 RESOLVED；getCase 两案 → 对应行 explainedByAdjustmentNo = 该单号；
 *   ⑦ 定性记录 adjustmentNo 已回填，再 record 同锚 → BadRequest（锁定）。
 * 场景 B · 挂起不许绿：
 *   第三个钱包造一条小额 AMOUNT_MISMATCH（FIRM 池免 ownerNo 牵连）→ run() 开案 →
 *   record(UNEXPLAINED) → outlet HOLD_INVESTIGATING → 再 run() → 案子仍 OPEN（不许 RESOLVED）
 *   → getCase 行带 disposition 注解（causeCode UNEXPLAINED）。
 */
```

- [ ] **Step 2: 跑通**

```bash
bash scripts/on-stack.sh self test:e2e -- --testPathPattern recon-reattribution
```

Expected: 全绿。随后按 baseline 提示补跑：

```bash
bash scripts/on-stack.sh self test:e2e -- --testPathPattern recon-adjustment-money-arcs
bash scripts/on-stack.sh self verify:coa
```

Expected: 既有 e2e 不回归；verify:coa 全绿（五种分录组合全落过账后的恒等式 + 负余额）。

- [ ] **Step 3: 提交**

```bash
git add test/recon-reattribution.e2e-spec.ts
git commit -m "test(recon): 改记一单双案自愈 + 挂起不许绿 e2e（T12）"
```

---

### Task 13: 财务手册

**Files:**
- Create: `doc-final/reference/recon-cause-handbook.md`

- [ ] **Step 1: 成文**（纯业务口径、说人话；页首注明「成因码以 `src/.../cause-registry.ts` 为准，改注册表必同步本册」）

结构与内容来源（誊写，不再创作新口径）：
1. **查证三结局模型** — spec §0.1 那张图 + 三条补充（账龄是核销前置 / 核销两池做法不同 / 容差是豁免的事前自动版）
2. **六格成因表** — spec §4 六张表逐格誊写，每条加一段「查证怎么做」：对什么凭证（银行回单 / 链上浏览器 / 通道费率表 / 客户单据）、看什么字段、判据是什么——从 `clue` 展开成 2–3 句操作指引
3. **处置操作手册** — spec §2 十件逐个：定义 / 账上发生什么（分录白话）/ 在哪操作按什么步骤（现有五个写实际路径：案件页→行→处置→…；未开放五个写「下一轮/二期/三期」+ 一句本轮留档法）
4. **附：演示场景对照** — spec §5 那张 14 行表（新号 / 成因码 / 处置 / 能不能平），供演示者按号索引

- [ ] **Step 2: 提交**

```bash
git add doc-final/reference/recon-cause-handbook.md
git commit -m "docs(reference): 平账查证手册——三结局模型 + 六格成因表 + 处置操作手册（T13）"
```

---

### Task 14: 收尾——文档分层收口 + 重铺闸全链 + 走查截图

**Files:**
- Modify: `doc-final/modules/v8-recon.md` ｜ `doc-final/demo/script.md` ｜ `doc-final/demo/baseline.md` ｜ `doc-final/BACKLOG.md` ｜ `doc-final/CHANGELOG.md` ｜ `doc-final/decisions.md`（业主过目后）

**本任务过哪几条（delivery-checklist 收尾清单，plan 写死）**：改页面/种子→data+script 同步 ｜ 改前端→截图 ｜ 动钱→verify:coa ｜ 每轮收尾三件套 ｜ 新端点→重启后端再走查

- [ ] **Step 1: 文档同步**

1. `v8-recon.md`：§2 状态机表加一行 `定性 Disposition ｜ 覆盖式记录（无状态机），唯一锁 = 挂单后不可覆盖`；§3 决策表加 `定性（记查证结论）｜ 运营 ｜ 注册表判出口 ｜ 成因菜单无兜底档` 与 `改记 ｜ 金库开单 ｜ 运营复核 ｜ 一单双案、资产腿不动`；§4 演示脚本按 spec §5 新号重写（走查顺序 = 1→14 = 处置家族顺序）；§5 技术节点补 `cause-registry.ts / disposition.service.ts / ReconciliationDispositionModal`；§6 缺口按 spec §11 更新
2. `script.md` 第六幕：按新号 14 条重写走查步骤（每条一行：场景号 · 讲什么 · 点什么 · 观众看到什么），挂起/留档条目写明「案子仍红——这是账实确实不符，不粉饰」
3. `baseline.md`：对账行改 `recon:demo:break 14/14 场景 + 11/11 钱包桶 + casesOpened 完整性断言`；重钉一行记 CHANGELOG
4. `data.md`：生成区由 `demo:all` 自写不手改；叙述区若引旧场景号则同步
5. `BACKLOG.md`：销「dedupKey 三处场景号是旧的」｜销「开调账单（DRAFT）零审计」｜G 节「真差异处置闭环」条目更新（挂起/改记已交付，补单/核销/豁免仍 deferred）｜新增一行「改记换主后对正主的合规复核缺口（KYT 按错记方身份跑的）」｜客户流水读模型条目追加改记行两侧设计句（错记方减一行、正主方加一行，均可追溯）
6. `CHANGELOG.md` 一行：`[2026-09-01] 平账一期半：成因定性驱动的处置收口——21 码注册表 / 定性落库 / 挂起 / 改记第四族（一单双案同愈）/ 场景重编号 14 条（新增公司池查无果）/ 财务查证手册`
7. `decisions.md`：把 spec §13 六条草案原文提请业主确认后追加（只追加，不改其余行）

- [ ] **Step 2: 收尾闸全链（worktree self 栈）**

```bash
npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd .. && cd client-web && npx tsc -b --noEmit && cd ..
npx jest                                   # 判据：全绿（退出码 0），不是净新 0
bash scripts/stack.sh down
bash scripts/stack.sh reset self           # 动了 schema+种子，重铺闸必走；确认 Capital injection 行
bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:all     # 花名册逐条 + COA 四恒等式
bash scripts/on-stack.sh self recon:demo:break   # 14/14 + 11/11
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self test:e2e -- --testPathPattern "recon-(adjustment-money-arcs|reattribution)"
bash scripts/on-stack.sh self verify:coa   # e2e 后再跑一次（五种组合全覆盖，baseline 惯例）
bash scripts/on-stack.sh self verify:audit
bash scripts/on-stack.sh self verify:rbac  # S1/S2/S2b/S5 全过
```

- [ ] **Step 3: 走查截图（判据 §9-7，重启后端后做——新路由权限要重启才生效）**

Preview 依次截：① 处置第一屏（成因菜单 + 双胞胎线索，场景 6 的行）② 冲正锁定视图 ③ 冲销 ④ 补记 ⑤ 改记对端确认（场景 8）⑥ 挂起确认 + 案件页「已定性」徽标（场景 9/10）⑦ 留档（场景 13）⑧ 列表页进度列。冲正闭环走一遍（§9-3）：定性 → 开单 → 原单号拦截 → 补号 → 审批 → 重对账 → RESOLVED + 已解释。改记闭环走一遍（§9-2 的界面面）：场景 8 一单批准 → 重对账 → **两案同愈**。

- [ ] **Step 4: 提交 + 报告**

```bash
git add -A doc-final
git commit -m "docs: 平账一期半收尾——v8-recon/script/baseline/BACKLOG/CHANGELOG 同步 + decisions 追加（T14）"
```

Thread 报告一行：`Documentation updated: modules§0-5 / demo / decisions — 平账一期半交付`

---

## 附：本计划自查

- **Spec 覆盖**：§0 公理（T11 删③⑨/Global Constraints 文案禁令）｜§1 做 1-10 → T11/T13/T3+T4/T4/T2+T5+T6/T1+T9/T4+T8/T7+T8+T10/T3+T4+T5/T14 ｜§2 六件 → 推单既有+T8 链接、三族 T9 锁定、挂起 T4+T8、改记 T2/T5/T6/T9 ｜§3 交互 → T8/T9/T10 ｜§4 注册表 → T1 ｜§5 场景 → T11 ｜§6 改记 → T2/T5/T6（含 ⚠ 解释索引 T6）｜§7 模型 → T3/T4 ｜§8 落点逐文件对号 ｜§9 判据 1-11 → T1/T12/T14-3/T14-3/T12+T7/T14-3/T14-3/各任务+T14-2/T14-2/T14-2/T14-2 ｜§10 手册 → T13 ｜§13 → T14-1-7
- **占位符**：Task 5 Step 1 与 Task 12 Step 1 的 `/* */` 为断言要点清单（落地写全），不是 TBD；无 "similar to Task N" 依赖
- **类型一致性**：`menuFor/resolveOutlet/staticOutletLabel/CAUSE_REGISTRY`（T1→T4/T7/T11）、`resolveReattributionLegs`（T2→T6）、`linkAdjustment`（T4→T5）、`AdjustHandoff`（T8→T9）、`disposition/duplicateTwinRef/menu` 行字段（T7→T8/T9）、`dispositionCount/anomalyLineCount/decimals`（T7→T10）逐一同名
