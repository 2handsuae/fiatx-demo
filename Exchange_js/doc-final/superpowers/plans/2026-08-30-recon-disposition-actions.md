# 对账案件处置动作收口 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把案件页那个"挂在所有差异行上的通用「开调账单」按钮"，收成按差异类型分派的会计动作（冲正 / 冲销 / 补记 / 去推单 / 无出口），并给「冲销」补一个说得通的演示案子。

**Architecture:** 判定逻辑集中在两个纯函数里——后端 `reasonsFor(book, family, direction)` 决定成因候选，前端 `rowAction(...)` 决定一行给什么动作。页面和弹层只消费这两个函数的结果，自己不做业务判断。后端除了 `adjustment-rules.ts` 加一个 `family` 字段外零改动：成因 × 账簿 × 方向的合法性已经被现有的 `assertReasonAllowed` 校住了，族只是分组呈现，不加第二道闸。

**Tech Stack:** NestJS + Prisma/SQLite + TigerBeetle ｜ React + Vite（admin-web）｜ jest（后端与 admin-web 的 `.spec.ts` 都跑在根 jest 上，`.spec.tsx` 不跑）

## Global Constraints

- 设计依据：`doc-final/superpowers/specs/2026-08-29-recon-disposition-actions-design.md`。**§0.1 的七条口径是结论，不要翻案。**
- **不做**：豁免 · 挂起 · 补单（充值域补录）· 账户归属 · 案件级开单入口 · 公司账簿的冲销成因码 · 豁免金额门槛 · 未归属账户的案件页说明。
- 七个成因码是全集，**不新增、不改名、不加兜底档**。
- 差额口径固定为 `差额 = 外部 − 内部`：内部偏高就减（REDUCE），偏低就加（INCREASE）。
- `REASON_SPECS`（后端）与 `REASON_META`（前端镜像）**两边都要改**，这是本仓库既有取舍。
- 前端 React 组件（`.tsx`）在本仓库**无法单测**（`.spec.tsx` 静默不跑）。组件改动靠 `tsc` + preview 渲染截图验收，不写 `.spec.tsx`。
- 测试的绿必须来自行为。**禁止**扫源码文本型断言。
- 栈命令一律走包装器：`bash scripts/on-stack.sh self <npm-script>`。
- 本工作树端口 3110–3113，DB `/tmp/exchange_js_wt_recon_adj1/dev.db`。

---

## 文件清单

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts` | 成因清单 + 族划分 + 候选查询（纯函数） | 改 |
| `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts` | 上者的单测 | 改 |
| `admin-web/src/utils/reconRowAction.ts` | 「一行给什么动作」判定表，唯一落点（纯函数） | **新建** |
| `admin-web/src/utils/reconRowAction.spec.ts` | 上者的单测 | **新建** |
| `admin-web/src/pages/ReconciliationCasesDetailPage.tsx` | 动作列改成消费判定表 | 改 |
| `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx` | 接族与方向；成因收窄；方向只读 | 改 |
| `scripts/recon-demo.ts` | 删旧场景 9，加「重复入账」场景 9 | 改 |
| `doc-final/demo/data.md`、`doc-final/demo/baseline.md` | 同步演示数据与基线 | 改 |

---

### Task 1: 后端——成因族划分与候选查询

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts`
- Test: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts`

**Interfaces:**
- Consumes: 现有 `ReasonCode` / `Book` / `Direction` / `REASON_SPECS`
- Produces:
  - `export type ReasonFamily = 'CORRECT' | 'REVERSE' | 'RECORD'`
  - `REASON_SPECS[code].family: ReasonFamily`（每一条都有）
  - `export const FAMILY_LABELS: Record<ReasonFamily, { label: string; gloss: string }>`
  - `export function reasonsFor(book: Book, family: ReasonFamily, direction: Direction): ReasonCode[]`

- [ ] **Step 1: 写失败的测试**

在 `adjustment-rules.spec.ts` 末尾追加：

```ts
import { FAMILY_LABELS, REASON_SPECS, ReasonCode, ReasonFamily, reasonsFor } from './adjustment-rules';

describe('成因族划分（spec §3.1）', () => {
  it('七个成因码被三族分完，无重叠无遗漏', () => {
    const byFamily: Record<ReasonFamily, ReasonCode[]> = { CORRECT: [], REVERSE: [], RECORD: [] };
    for (const code of Object.keys(REASON_SPECS) as ReasonCode[]) {
      byFamily[REASON_SPECS[code].family].push(code);
    }
    expect(byFamily.CORRECT.sort()).toEqual(['DEPOSIT_AMOUNT_CORRECTION', 'WITHDRAW_AMOUNT_CORRECTION']);
    expect(byFamily.REVERSE.sort()).toEqual(['DEPOSIT_DUPLICATE_REVERSAL', 'DEPOSIT_SIGNAL_VOID', 'WITHDRAW_VOID_REFUND']);
    expect(byFamily.RECORD.sort()).toEqual(['BANK_INTEREST', 'BANK_CHARGE'].sort());
    expect(byFamily.CORRECT.length + byFamily.REVERSE.length + byFamily.RECORD.length)
      .toBe(Object.keys(REASON_SPECS).length);
  });

  it('三族都有中文名与白话解释（弹层标题要用）', () => {
    for (const f of ['CORRECT', 'REVERSE', 'RECORD'] as ReasonFamily[]) {
      expect(FAMILY_LABELS[f].label.length).toBeGreaterThan(0);
      expect(FAMILY_LABELS[f].gloss.length).toBeGreaterThan(0);
    }
    expect(FAMILY_LABELS.CORRECT.label).toBe('冲正');
    expect(FAMILY_LABELS.REVERSE.label).toBe('冲销');
    expect(FAMILY_LABELS.RECORD.label).toBe('补记');
  });
});

describe('reasonsFor —— 族 × 账簿 × 方向 的候选（spec §3.3 六格逐格）', () => {
  it('补记 · 减 → 只有银行杂费', () => {
    expect(reasonsFor('FIRM', 'RECORD', 'REDUCE')).toEqual(['BANK_CHARGE']);
  });
  it('补记 · 加 → 只有银行利息', () => {
    expect(reasonsFor('FIRM', 'RECORD', 'INCREASE')).toEqual(['BANK_INTEREST']);
  });
  it('冲销 · 减 → 重复入账撤销 + 充值撤销', () => {
    expect(reasonsFor('CLIENT', 'REVERSE', 'REDUCE').sort())
      .toEqual(['DEPOSIT_DUPLICATE_REVERSAL', 'DEPOSIT_SIGNAL_VOID']);
  });
  it('冲销 · 加 → 只有提现撤销退回', () => {
    expect(reasonsFor('CLIENT', 'REVERSE', 'INCREASE')).toEqual(['WITHDRAW_VOID_REFUND']);
  });
  it('冲正 · 减 → 只有充值金额更正', () => {
    expect(reasonsFor('CLIENT', 'CORRECT', 'REDUCE')).toEqual(['DEPOSIT_AMOUNT_CORRECTION']);
  });
  it('冲正 · 加 → 充值金额更正 + 提现金额更正', () => {
    expect(reasonsFor('CLIENT', 'CORRECT', 'INCREASE').sort())
      .toEqual(['DEPOSIT_AMOUNT_CORRECTION', 'WITHDRAW_AMOUNT_CORRECTION']);
  });

  it('跨账簿取不到：客户账簿问补记、公司账簿问冲正/冲销，一律空', () => {
    expect(reasonsFor('CLIENT', 'RECORD', 'INCREASE')).toEqual([]);
    expect(reasonsFor('CLIENT', 'RECORD', 'REDUCE')).toEqual([]);
    expect(reasonsFor('FIRM', 'CORRECT', 'INCREASE')).toEqual([]);
    expect(reasonsFor('FIRM', 'REVERSE', 'REDUCE')).toEqual([]);
  });

  it('返回的每一个码，拿回去过 assertReasonAllowed 都不抛（候选与闸门不许打架）', () => {
    const combos: Array<[typeof REASON_SPECS[ReasonCode]['book'], ReasonFamily, 'REDUCE' | 'INCREASE']> = [
      ['FIRM', 'RECORD', 'REDUCE'], ['FIRM', 'RECORD', 'INCREASE'],
      ['CLIENT', 'REVERSE', 'REDUCE'], ['CLIENT', 'REVERSE', 'INCREASE'],
      ['CLIENT', 'CORRECT', 'REDUCE'], ['CLIENT', 'CORRECT', 'INCREASE'],
    ];
    for (const [book, family, direction] of combos) {
      for (const code of reasonsFor(book, family, direction)) {
        expect(() => assertReasonAllowed(code, book, direction)).not.toThrow();
      }
    }
  });
});
```

⚠️ 文件顶部已有的 import 若未包含 `assertReasonAllowed`，一并补进去。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment-rules --silent
```

Expected: FAIL —— `reasonsFor is not a function` / `FAMILY_LABELS is not defined`。

- [ ] **Step 3: 实现**

在 `adjustment-rules.ts` 的 `ReasonCode` 类型定义之后插入：

```ts
/**
 * 成因族（spec §3.1）。七码分完，无重叠无遗漏：
 *   CORRECT 冲正 —— 金额记错了，改成对的
 *   REVERSE 冲销 —— 这笔本就不该记，撤掉
 *   RECORD  补记 —— 外部真发生了一笔我方还没记的事，新增一笔
 * ⚠️ 补记**不是纠错**：银行利息 / 银行杂费是真实发生的公司收支，账变对的方式
 * 是新增一笔，不是改掉原来那笔。三族并列，不要退回"冲正/冲销"两族。
 */
export type ReasonFamily = 'CORRECT' | 'REVERSE' | 'RECORD';

/** 按钮用 label（会计词），弹层标题用 `${label} · ${gloss}`。 */
export const FAMILY_LABELS: Record<ReasonFamily, { label: string; gloss: string }> = {
  CORRECT: { label: '冲正', gloss: '把金额改成对的' },
  REVERSE: { label: '冲销', gloss: '撤销这笔入账' },
  RECORD:  { label: '补记', gloss: '记一笔公司自己的收支' },
};
```

给 `REASON_SPECS` 的类型加一行 `family: ReasonFamily;`，并给七条各补 `family`：

```ts
export const REASON_SPECS: Record<ReasonCode, {
  book: Book; directions: Direction[];
  family: ReasonFamily;
  customerLabel: string | null;
  internalLabel: string;
}> = {
  DEPOSIT_AMOUNT_CORRECTION:  { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], family: 'CORRECT', customerLabel: '充值金额更正', internalLabel: '充值金额更正' },
  DEPOSIT_DUPLICATE_REVERSAL: { book: 'CLIENT', directions: ['REDUCE'],             family: 'REVERSE', customerLabel: '重复入账撤销', internalLabel: '重复入账撤销' },
  DEPOSIT_SIGNAL_VOID:        { book: 'CLIENT', directions: ['REDUCE'],             family: 'REVERSE', customerLabel: '充值撤销',     internalLabel: '充值撤销' },
  WITHDRAW_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['INCREASE'],           family: 'CORRECT', customerLabel: '提现金额更正', internalLabel: '提现金额更正' },
  WITHDRAW_VOID_REFUND:       { book: 'CLIENT', directions: ['INCREASE'],           family: 'REVERSE', customerLabel: '提现撤销退回', internalLabel: '提现撤销退回' },
  BANK_INTEREST:              { book: 'FIRM',   directions: ['INCREASE'],           family: 'RECORD',  customerLabel: null,           internalLabel: '银行利息' },
  BANK_CHARGE:                { book: 'FIRM',   directions: ['REDUCE'],             family: 'RECORD',  customerLabel: null,           internalLabel: '银行杂费' },
};
```

在 `assertReasonAllowed` 之后追加：

```ts
/**
 * 某个（账簿 × 族 × 方向）下允许的成因码。前端据此收窄下拉：
 * 返回 1 个就直接定死不给下拉，2 个才让人选（spec §3.3：六格里四格是 1 个）。
 * ⚠️ 这里**不新增闸门**——候选是 REASON_SPECS 的子集查询，实际拦截仍由
 * assertReasonAllowed 在 createDraft 里做。两者不许打架，见本函数的单测最后一条。
 */
export function reasonsFor(book: Book, family: ReasonFamily, direction: Direction): ReasonCode[] {
  return (Object.keys(REASON_SPECS) as ReasonCode[]).filter((code) => {
    const spec = REASON_SPECS[code];
    return spec.family === family && spec.book === book && spec.directions.includes(direction);
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/clearing-settle/reconciliation/disposition/adjustment-rules --silent
```

Expected: PASS，全部用例绿。

- [ ] **Step 5: 变异验证**

把 `DEPOSIT_SIGNAL_VOID` 的 `family` 从 `'REVERSE'` 改成 `'CORRECT'`，重跑上面的命令。

Expected: 「七个成因码被三族分完」与「冲销 · 减」两条**必须变红**。确认后改回。

- [ ] **Step 6: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 无输出（退出码 0）。

```bash
git add src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.spec.ts
git commit -m "feat(recon): 成因三族划分 + 候选查询 reasonsFor"
```

---

### Task 2: 前端——「一行给什么动作」判定表

**Files:**
- Create: `admin-web/src/utils/reconRowAction.ts`
- Test: `admin-web/src/utils/reconRowAction.spec.ts`

**Interfaces:**
- Consumes: 无（纯函数，不 import 业务模块）
- Produces:
  - `export type ReasonFamily = 'CORRECT' | 'REVERSE' | 'RECORD'`（与后端同名同值，前端镜像）
  - `export type FlowMatchType = 'MATCHED' | 'ORPHAN_EXTERNAL' | 'ORPHAN_INTERNAL' | 'AMOUNT_MISMATCH' | 'IN_TRANSIT'`
  - `export type RowAction = { kind: 'ADJUST'; family: ReasonFamily } | { kind: 'PUSH'; fundsOrderNo: string } | { kind: 'NONE'; reason: string | null }`
  - `export function rowAction(input: { matchType: FlowMatchType; book: 'CLIENT' | 'FIRM'; fundsOrderNo?: string | null }): RowAction`

`reason` 为 `null` 表示**这一格什么都不显示**（已匹配行）；非空字符串是要显示给运营看的一句话。

- [ ] **Step 1: 写失败的测试**

新建 `admin-web/src/utils/reconRowAction.spec.ts`：

```ts
import { rowAction } from './reconRowAction';

describe('rowAction —— 差异行 → 动作判定表（spec §2）', () => {
  it('已匹配 → 什么都不给（reason 为 null，格子留空）', () => {
    expect(rowAction({ matchType: 'MATCHED', book: 'CLIENT' })).toEqual({ kind: 'NONE', reason: null });
    expect(rowAction({ matchType: 'MATCHED', book: 'FIRM' })).toEqual({ kind: 'NONE', reason: null });
  });

  it('在途 → 去推单，带上资金单号', () => {
    expect(rowAction({ matchType: 'IN_TRANSIT', book: 'CLIENT', fundsOrderNo: 'FO123' }))
      .toEqual({ kind: 'PUSH', fundsOrderNo: 'FO123' });
  });

  it('在途但没有资金单号 → 不给动作（链不过去，给不出正确入口）', () => {
    const r = rowAction({ matchType: 'IN_TRANSIT', book: 'CLIENT', fundsOrderNo: null });
    expect(r.kind).toBe('NONE');
    expect((r as { reason: string | null }).reason).toBeTruthy();
  });

  it('在途**绝不**给开调账单——钱在路上，改账会造成重复计账', () => {
    expect(rowAction({ matchType: 'IN_TRANSIT', book: 'CLIENT', fundsOrderNo: 'FO123' }).kind).not.toBe('ADJUST');
  });

  it('金额不对 · 客户 → 冲正', () => {
    expect(rowAction({ matchType: 'AMOUNT_MISMATCH', book: 'CLIENT' }))
      .toEqual({ kind: 'ADJUST', family: 'CORRECT' });
  });

  it('金额不对 · 公司 → 补记（公司账簿没有冲正码，差额本身就是一笔没记的杂费）', () => {
    expect(rowAction({ matchType: 'AMOUNT_MISMATCH', book: 'FIRM' }))
      .toEqual({ kind: 'ADJUST', family: 'RECORD' });
  });

  it('我有外无 · 客户 → 冲销', () => {
    expect(rowAction({ matchType: 'ORPHAN_INTERNAL', book: 'CLIENT' }))
      .toEqual({ kind: 'ADJUST', family: 'REVERSE' });
  });

  it('我有外无 · 公司 → 无出口（七码里公司账簿没有冲销码）', () => {
    const r = rowAction({ matchType: 'ORPHAN_INTERNAL', book: 'FIRM' });
    expect(r.kind).toBe('NONE');
    expect((r as { reason: string | null }).reason).toBe('本期公司账簿只做补记，没有冲销成因');
  });

  it('外有我无 · 客户 → 无出口（客户资金入账必须走充值域，过 KYT 与合规闸）', () => {
    const r = rowAction({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' });
    expect(r.kind).toBe('NONE');
    expect((r as { reason: string | null }).reason).toBe('客户资金入账须走充值域补录，本期未开放');
  });

  it('外有我无 · 客户**绝不**给开调账单——那等于凭空给客户加钱，绕过 KYT 与合规闸', () => {
    expect(rowAction({ matchType: 'ORPHAN_EXTERNAL', book: 'CLIENT' }).kind).not.toBe('ADJUST');
  });

  it('外有我无 · 公司 → 补记', () => {
    expect(rowAction({ matchType: 'ORPHAN_EXTERNAL', book: 'FIRM' }))
      .toEqual({ kind: 'ADJUST', family: 'RECORD' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest admin-web/src/utils/reconRowAction --silent
```

Expected: FAIL —— `Cannot find module './reconRowAction'`。

- [ ] **Step 3: 实现**

新建 `admin-web/src/utils/reconRowAction.ts`：

```ts
// admin-web/src/utils/reconRowAction.ts
//
// 「一条差异行该给什么动作」——判定表的唯一落点（spec §2）。
//
// 为什么要有这个文件：收口之前，案件页给**所有 5 类差异行**挂同一个「开调账单」
// 按钮。后果是在途行也能开调账单（钱在路上，改账把差额抹平，等钱真落地账本再记
// 一次 → 重复计账），已匹配行也有入口（没有任何业务含义），而客户侧「外有我无」
// 给了个近似的出口（那笔钱要过 KYT，只能走充值域补录）。
//
// 收口的价值就是「只让人做对的事」。所以没有正确动作的格子必须显式说没有，
// 而不是给一个看起来能用的——按钮写成「冲销」之后它是一句**肯定的会计指令**，
// 比原来那个中性的通用按钮更容易被照着点。
//
// 纯函数、无 IO、无业务模块依赖，可单测。
export type ReasonFamily = 'CORRECT' | 'REVERSE' | 'RECORD';

export type FlowMatchType =
  | 'MATCHED'
  | 'ORPHAN_EXTERNAL'
  | 'ORPHAN_INTERNAL'
  | 'AMOUNT_MISMATCH'
  | 'IN_TRANSIT';

export type RowAction =
  | { kind: 'ADJUST'; family: ReasonFamily }
  | { kind: 'PUSH'; fundsOrderNo: string }
  /** reason 为 null = 这一格什么都不显示（已匹配行）；非空 = 显示这句话。 */
  | { kind: 'NONE'; reason: string | null };

export function rowAction(input: {
  matchType: FlowMatchType;
  book: 'CLIENT' | 'FIRM';
  fundsOrderNo?: string | null;
}): RowAction {
  const { matchType, book, fundsOrderNo } = input;

  if (matchType === 'MATCHED') return { kind: 'NONE', reason: null };

  if (matchType === 'IN_TRANSIT') {
    return fundsOrderNo
      ? { kind: 'PUSH', fundsOrderNo }
      : { kind: 'NONE', reason: '在途行缺资金单号，无法跳转推单' };
  }

  if (matchType === 'AMOUNT_MISMATCH') {
    // 公司账簿没有冲正码，但差额本身就是一笔真实发生、我方还没记的杂费/利息，
    // 补记即可，不需要「改掉原来那笔」（spec §2.2）。
    return { kind: 'ADJUST', family: book === 'FIRM' ? 'RECORD' : 'CORRECT' };
  }

  if (matchType === 'ORPHAN_INTERNAL') {
    return book === 'CLIENT'
      ? { kind: 'ADJUST', family: 'REVERSE' }
      : { kind: 'NONE', reason: '本期公司账簿只做补记，没有冲销成因' };
  }

  // ORPHAN_EXTERNAL
  return book === 'FIRM'
    ? { kind: 'ADJUST', family: 'RECORD' }
    // 冲销的语义是「这笔本就不该记，撤掉」，而外有我无意味着我方压根没记过——
    // 撤销一个不存在的记录说不通。这一格的正解永远是补单（一期 §4 边界线：
    // 调账单不得用于补记真实发生的客户资金流入或流出）。
    : { kind: 'NONE', reason: '客户资金入账须走充值域补录，本期未开放' };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest admin-web/src/utils/reconRowAction --silent
```

Expected: PASS，12 条全绿。

- [ ] **Step 5: 变异验证**

把 `ORPHAN_EXTERNAL` 那一支的 `book === 'FIRM'` 改成 `book === 'CLIENT'`，重跑。

Expected:「外有我无 · 客户 → 无出口」「外有我无 · 客户**绝不**给开调账单」「外有我无 · 公司 → 补记」三条**必须变红**。确认后改回。

- [ ] **Step 6: 闸门 + 提交**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

Expected: 无输出（退出码 0）。

```bash
git add admin-web/src/utils/reconRowAction.ts admin-web/src/utils/reconRowAction.spec.ts
git commit -m "feat(admin): 对账差异行动作判定表 reconRowAction"
```

---

### Task 3: 弹层——接族与方向，成因收窄，方向只读

**Files:**
- Modify: `admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx`

**Interfaces:**
- Consumes: Task 2 的 `ReasonFamily`
- Produces:
  - `AdjustmentPrefill` 新增 `family: ReasonFamily` 与 `direction: AdjustmentDirection`（`direction` 从可选的猜测值升级为**必填的推导值**）
  - `REASON_META` 每条新增 `family: ReasonFamily`

⚠️ 本任务改的是 `.tsx`，**本仓库无法单测**（`.spec.tsx` 静默不跑）。验收靠 `tsc` + Task 6 的渲染截图。不要为此新建 `.spec.tsx`。

- [ ] **Step 1: 前端成因镜像加 family**

把 `REASON_META` 整块替换成（同时改类型与七条数据）：

```tsx
import type { ReasonFamily } from '../utils/reconRowAction';

interface ReasonMeta {
  book: AdjustmentBook;
  directions: AdjustmentDirection[];
  family: ReasonFamily;
  label: string;
}

// 前端镜像 backend REASON_SPECS（src/modules/clearing-settle/reconciliation/
// disposition/adjustment-rules.ts）。无兜底档——七个成因码是全集，新增成因需要
// 两边同时改。family 与后端 REASON_SPECS[].family 必须逐条一致。
export const REASON_META: Record<string, ReasonMeta> = {
  DEPOSIT_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['REDUCE', 'INCREASE'], family: 'CORRECT', label: '充值金额更正' },
  DEPOSIT_DUPLICATE_REVERSAL: { book: 'CLIENT', directions: ['REDUCE'], family: 'REVERSE', label: '重复入账撤销' },
  DEPOSIT_SIGNAL_VOID: { book: 'CLIENT', directions: ['REDUCE'], family: 'REVERSE', label: '充值撤销' },
  WITHDRAW_AMOUNT_CORRECTION: { book: 'CLIENT', directions: ['INCREASE'], family: 'CORRECT', label: '提现金额更正' },
  WITHDRAW_VOID_REFUND: { book: 'CLIENT', directions: ['INCREASE'], family: 'REVERSE', label: '提现撤销退回' },
  BANK_INTEREST: { book: 'FIRM', directions: ['INCREASE'], family: 'RECORD', label: '银行利息' },
  BANK_CHARGE: { book: 'FIRM', directions: ['REDUCE'], family: 'RECORD', label: '银行杂费' },
};

export const FAMILY_LABELS: Record<ReasonFamily, { label: string; gloss: string }> = {
  CORRECT: { label: '冲正', gloss: '把金额改成对的' },
  REVERSE: { label: '冲销', gloss: '撤销这笔入账' },
  RECORD: { label: '补记', gloss: '记一笔公司自己的收支' },
};
```

- [ ] **Step 2: prefill 升级为「族 + 已推导方向」**

把 `AdjustmentPrefill` 整块替换成：

```tsx
export interface AdjustmentPrefill {
  /** 由 rowAction() 判定，决定成因候选与弹层标题。 */
  family: ReasonFamily;
  /**
   * 由行数据推导，**不是猜测值**——差额口径固定「外部 − 内部」，内部偏高就减、
   * 偏低就加。表单里改成只读，不再让人选（spec §3.2/§4）。
   */
  direction: AdjustmentDirection;
  amountMinor: string;                       // 最小单位（分）整数字符串，来自 flowComparison 行
  relatedOrderNo: string;                     // 仅 IN_TRANSIT 行有（该行的 fundsOrderNo）
  /** 这张单在解释哪一条差异——锚在真实证据 id 上（内部流水 / 外部对账单行）。 */
  explainedFlowId?: string;
  explainedExternalLineId?: string;
  /** 方向推导依据，原样显示在只读方向下方。 */
  directionWhy: string;
}
```

- [ ] **Step 3: 弹层内部状态改由候选驱动**

把 `reasonOptions` / `directionOptions` / `pickReason` 三处替换成：

```tsx
  // 候选 = 该（账簿 × 族 × 方向）下允许的成因（后端 reasonsFor 的前端镜像）。
  // 六格里四格只有 1 个 → 直接定死不给下拉；2 个才让人选。
  const reasonOptions = Object.entries(REASON_META).filter(
    ([, meta]) =>
      meta.book === book &&
      meta.family === prefill.family &&
      meta.directions.includes(prefill.direction),
  );
  const soleReason = reasonOptions.length === 1 ? reasonOptions[0][0] : '';
```

并把初始化 `useEffect` 里的 `setReasonCode('')` / `setDirection('')` 改为：

```tsx
    setReasonCode(reasonOptions.length === 1 ? reasonOptions[0][0] : '');
    setDirection(prefill.direction);
```

⚠️ `reasonOptions` 在 `useEffect` 之前定义，且 `soleReason` 参与初始化——把这两行的定义挪到 `useEffect` 之上。`pickReason` 整个函数删除（方向不再由成因反推），下拉的 `onChange` 直接 `setReasonCode(e.target.value)`。

- [ ] **Step 4: 渲染改成收窄 + 只读**

把「成因」与「方向」两块渲染替换成：

```tsx
          <label className={labelCls}>成因 / Reason</label>
          {reasonOptions.length === 1 ? (
            <p className="mb-4 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1">
              {REASON_META[soleReason].label} · {soleReason}
              <span className="ml-2 text-[9px] text-adm-t3">本族本方向只有这一个成因，已锁定</span>
            </p>
          ) : (
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              disabled={submitting}
              className={`mb-4 ${selectCls}`}
            >
              <option value="">请选择成因…</option>
              {reasonOptions.map(([code, meta]) => (
                <option key={code} value={code}>
                  {meta.label} · {code}
                </option>
              ))}
            </select>
          )}

          <label className={labelCls}>方向 / Direction</label>
          <p className="mb-1 rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1">
            {prefill.direction === 'REDUCE' ? '减少 REDUCE' : '增加 INCREASE'}
          </p>
          <p className="mb-4 font-mono text-[9px] text-adm-t3">{prefill.directionWhy}</p>
```

- [ ] **Step 5: 标题带上族的白话**

把弹层标题那一行（`开调账单 / Open Adjustment`）改成：

```tsx
            {FAMILY_LABELS[prefill.family].label} · {FAMILY_LABELS[prefill.family].gloss}
```

- [ ] **Step 6: 提交体带上推导方向**

`submit()` 里的 `direction` 改为取 `prefill.direction`（不再取可编辑 state）：

```tsx
        direction: prefill.direction,
```

`submitDisabled` 里的 `!direction` 一项删除（方向恒有值），`needsRelatedOrder` 改为：

```tsx
  const needsRelatedOrder = book === 'CLIENT' && prefill.direction === 'INCREASE';
```

- [ ] **Step 7: 闸门**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

Expected: 报错指向 `ReconciliationCasesDetailPage.tsx`（它还在按旧的 prefill 形状传参）—— **这是预期的**，Task 4 修。先确认弹层自身没有别的类型错。

- [ ] **Step 8: 提交**

```bash
git add admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx
git commit -m "feat(admin): 调账弹层按族收窄成因、方向改只读"
```

---

### Task 4: 案件页——动作列接判定表

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`

**Interfaces:**
- Consumes: Task 2 的 `rowAction`；Task 3 的 `AdjustmentPrefill`
- Produces: 无（页面是叶子）

- [ ] **Step 1: 引入判定表**

在 import 区加：

```tsx
import { rowAction } from '../utils/reconRowAction';
```

- [ ] **Step 2: prefill 构造函数改成带族与推导依据**

把 `rowAdjustmentPrefill` 整个函数替换成：

```tsx
// 从被点击的那一行构造开单预填。方向不再是「猜测性默认值」——差额口径固定
// 「外部 − 内部」，内部偏高就减、偏低就加，三类异常各有确定的推导路径，
// 所以表单里方向是只读的（spec §3.2）。
//   AMOUNT_MISMATCH  — 差额符号即答案：负 → 减，正 → 加
//   ORPHAN_INTERNAL  — 内部记了外部没有，这笔要冲销，方向与它自己相反
//   ORPHAN_EXTERNAL  — 外部有我方没记，按外部方向直接入账
// 两个解释锚一律按行原样带上（内部流水 id / 外部对账单行 id），后端据此在下一轮
// 对账里把这条差异从异常数里摘掉——没有它们，调账只补得平余额、案子仍卡在
// SOFT_FLAG 关不掉。
const rowAdjustmentPrefill = (
  row: FlowComparisonRow,
  family: ReasonFamily,
): AdjustmentPrefill => {
  const ext = row.externalLine;
  const intl = row.internalFlow;
  const anchors = { explainedFlowId: intl?.id, explainedExternalLineId: ext?.id };

  if (row.matchType === 'AMOUNT_MISMATCH' && row.deltaAmount != null) {
    const reduce = row.deltaAmount.startsWith('-');
    return {
      family,
      direction: reduce ? 'REDUCE' : 'INCREASE',
      directionWhy: `差额 ${row.deltaAmount.startsWith('-') ? '为负' : '为正'}（外部 − 内部），内部${reduce ? '偏高，要减' : '偏低，要加'}`,
      amountMinor: row.deltaAmount.replace(/^-/, ''),
      relatedOrderNo: '',
      ...anchors,
    };
  }
  if (row.matchType === 'ORPHAN_INTERNAL' && intl) {
    const reduce = intl.direction === 'IN';
    return {
      family,
      direction: reduce ? 'REDUCE' : 'INCREASE',
      directionWhy: `内部记了一笔${reduce ? '进账' : '出账'}、外部没有，冲销方向与它相反`,
      amountMinor: intl.amount,
      relatedOrderNo: '',
      ...anchors,
    };
  }
  if (row.matchType === 'ORPHAN_EXTERNAL' && ext) {
    const increase = ext.direction === 'IN';
    return {
      family,
      direction: increase ? 'INCREASE' : 'REDUCE',
      directionWhy: `外部有一笔${increase ? '进账' : '出账'}、我方没记，按外部方向补记`,
      amountMinor: ext.amount,
      relatedOrderNo: '',
      ...anchors,
    };
  }
  // 走到这里说明 rowAction 判定与本函数不一致（判定表已排除 MATCHED / IN_TRANSIT，
  // 且三类异常各自的必需字段都在上面判过）。给一个不会误导的兜底。
  return {
    family,
    direction: 'REDUCE',
    directionWhy: '该行数据不完整，方向请人工复核',
    amountMinor: ext?.amount ?? intl?.amount ?? '0',
    relatedOrderNo: '',
    ...anchors,
  };
};
```

在文件的 `FlowComparisonRow` 类型定义之前加：

```tsx
import type { ReasonFamily } from '../utils/reconRowAction';
```

（若 Step 1 已合并 import，此处并入同一条即可。）

- [ ] **Step 3: 动作列改成三分支**

把动作列那个 `<td>` 整块替换成：

```tsx
                          <td className="px-3 py-3">
                            {row.explainedByAdjustmentNo ? (
                              <Link
                                to={`/admin/reconciliation/adjustments/${encodeURIComponent(row.explainedByAdjustmentNo)}`}
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-adm-green/30 bg-adm-green/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-adm-green hover:underline"
                              >
                                已解释 · {row.explainedByAdjustmentNo}
                              </Link>
                            ) : (
                              (() => {
                                const action = rowAction({
                                  matchType: row.matchType,
                                  book: adjustmentBook,
                                  fundsOrderNo: row.fundsOrderNo,
                                });
                                if (action.kind === 'PUSH') {
                                  return (
                                    <Link
                                      to={`/admin/funds-orders/${encodeURIComponent(action.fundsOrderNo)}`}
                                      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline"
                                    >
                                      <ArrowRight size={10} />
                                      去推单
                                    </Link>
                                  );
                                }
                                if (action.kind === 'ADJUST') {
                                  if (!canCreateAdjustment || kase.status !== 'OPEN') return null;
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => setCreatePrefill(rowAdjustmentPrefill(row, action.family))}
                                      className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[10px] font-medium text-adm-blue hover:underline"
                                    >
                                      <Plus size={10} />
                                      {FAMILY_LABELS[action.family].label}
                                    </button>
                                  );
                                }
                                if (!action.reason) return null;
                                return (
                                  <span
                                    title={action.reason}
                                    className="font-mono text-[10px] text-adm-t3"
                                  >
                                    无处置动作
                                  </span>
                                );
                              })()
                            )}
                          </td>
```

`FAMILY_LABELS` 从弹层导入：

```tsx
import ReconciliationAdjustmentCreateModal, {
  FAMILY_LABELS,
  REASON_META,
  type AdjustmentBook,
  type AdjustmentPrefill,
} from '../components/ReconciliationAdjustmentCreateModal';
```

- [ ] **Step 4: 闸门**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

Expected: 无输出（退出码 0）。若报 `ArrowRight` 未使用/未导入，检查文件顶部 lucide-react 那行是否已含 `ArrowRight`（原文件已有）。

- [ ] **Step 5: 渲染验证**

起栈与预览：

```bash
bash scripts/stack.sh up self
```

用种子管理员登录取 token 注入 `localStorage` 的 `admin_token`（`admin@fiatx.com` / `123456`，登录端点 `POST http://localhost:3110/auth/login`），然后逐个打开当前 OPEN 案件页，确认动作列：

- 在途行 → `去推单`（链到资金单）
- 金额不对 · 客户 → `冲正`
- 我有外无 · 客户 → `冲销`
- 外有我无 · 公司 → `补记`
- 外有我无 · 客户 → 灰字 `无处置动作`，悬停出「客户资金入账须走充值域补录，本期未开放」
- 已匹配行 → 空白

- [ ] **Step 6: 提交**

```bash
git add admin-web/src/pages/ReconciliationCasesDetailPage.tsx
git commit -m "feat(admin): 案件页动作列按差异类型收口"
```

---

### Task 5: 演示种子——删「未归属账户」，加「重复入账」

**Files:**
- Modify: `scripts/recon-demo.ts`

**Interfaces:**
- Consumes: 无
- Produces: manifest 里第 9 条的 `rootCause` 从 `'ORPHAN_DEPOSIT'` 换成 `'DUPLICATE_DEPOSIT'`

**背景**：业主拍板移除「未归属外部账户」演示场景。⚠️ **只删种子注入，引擎的 `unattributedBalances` 分支与它的单测保留**（`wallet-recon-run.service.spec.ts` 「无主外部余额头（walletRef=null）→ 开 BREAK case」）——真遇到未归属账户照样开案子，只是演示里不铺这个局。

**为什么加「重复入账」**：收口之后「冲销」按钮唯一的落点是场景 3（对账单缺行），而那条的真相是**我方账其实是对的**（银行漏报），按下去业务上站不住。三个族里有一个没有干净的演示位，等于这次收口只演出了三分之二。

**为什么这条要自建钱包**：演示库只有 6 个客户钱包，场景 1 占 1 个、场景 2/3/4/6/8 各占 1 个，**一个都不空**。本场景自建一个专用钱包，不动任何既有场景。

- [ ] **Step 1: 删掉旧的场景 9**

删除 `scripts/recon-demo.ts` 里从 `// ── Scenario 9 — 孤儿充值 (BREAK, unattributed head, no line item) ──────` 开始、到该 `{ ... }` 块结束（`injections.push({ scenarioId: 9, rootCause: 'ORPHAN_DEPOSIT', ... });` 之后的 `}`）为止的整段。

同时：
- 把 `RootCause` 联合类型里的 `| 'ORPHAN_DEPOSIT'` 改成 `| 'DUPLICATE_DEPOSIT'`
- 把文件头注释第 27 行 `//                    9. ORPHAN_DEPOSIT        — ORPHAN_EXTERNAL (BREAK, unattributed head)` 改成 `//                    9. DUPLICATE_DEPOSIT     — ORPHAN_INTERNAL (BREAK, 同一笔充值入账两次)`
- 常量 `DEMO_ORPHAN_ACCOUNT_REF` 若再无引用则删除（用 `grep -n DEMO_ORPHAN_ACCOUNT_REF scripts/recon-demo.ts` 确认）

- [ ] **Step 2: 在原位置写新的场景 9**

在删掉的位置插入：

```ts
  // ── Scenario 9 — 重复入账 (BREAK / ORPHAN_INTERNAL / 客户账簿) ───────────
  // 银行报了一笔充值（外部一条 statement line + 收盘 +X），我方在账本上入了
  // **两次**（两笔 X）。于是：
  //   余额：internal = 2X，external = X → delta = −X → BREAK
  //   流水：Pass 1 按 externalRef 配对，一笔匹配上、另一笔成 ORPHAN_INTERNAL，
  //         **两行同 ref 同额**，重复一眼可见 → 「冲销」按钮的干净落点
  //
  // 自建专用钱包：演示库 6 个客户钱包已被场景 1/2/3/4/6/8 占满，没有空位。
  //
  // ⚠️ 本场景是**唯一会写账本**的注入（其余八条只伪造外部数据）。用固定 sourceNo
  // 保证可重复执行：TB 的 transfer id 是 (sourceType, sourceNo, eventCode) 的确定性
  // 哈希，重跑时 TB 判为已存在直接跳过，不会二次入账。注意 `recon:demo:reset`
  // **不回滚账本**（它只清外部数据与 WALLET_V1 的 run/case），要彻底归零得走
  // `stack.sh reset self`（会重建 TigerBeetle）。
  {
    const s9Amount = D('50000');            // 分 —— AED 500.00
    const s9Currency = 'AED';
    const s9Asset = await (prisma as any).asset.findFirst({
      where: { currency: s9Currency }, select: { id: true, code: true },
    });
    if (!s9Asset) throw new Error('Scenario 9 needs the AED asset seeded.');
    const s9Customer = await (prisma as any).customerMain.findFirst({
      orderBy: { customerNo: 'asc' }, select: { id: true, customerNo: true },
    });
    if (!s9Customer) throw new Error('Scenario 9 needs at least one seeded customer.');

    // 专用钱包（按 walletNo upsert —— 重跑复用同一个，不会越铺越多）
    const s9WalletNo = `WA-DEMO-DUP-${cutoffDate.replace(/-/g, '')}`;
    const s9Wallet = await (prisma as any).wallet.upsert({
      where: { walletNo: s9WalletNo },
      update: {},
      create: {
        walletNo: s9WalletNo,
        ownerType: 'CUSTOMER', ownerId: s9Customer.id, ownerNo: s9Customer.customerNo,
        type: 'FIAT_BANK', walletRole: 'C_VIBAN', assetId: s9Asset.id,
        iban: `AE_DEMO_DUP_${cutoffDate.replace(/-/g, '')}`, status: 'ACTIVE',
      },
      select: { id: true },
    });

    // 账本：同一个 externalRef 入账两次（每次都是真实充值的两步：
    // CLIENT_ASSET→DEPOSIT_SUSPENSE 外部穿越 + DEPOSIT_SUSPENSE→CLIENT_PAYABLE 重分类）
    const s9Ref = refFor(s9Currency, 'DUPDEP');
    const ledger = TB_LEDGERS[s9Currency as keyof typeof TB_LEDGERS];
    const clientAssetId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_ASSET, ledger, ownerType: 'SYSTEM' });
    const suspenseId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, ledger, ownerType: 'CUSTOMER', ownerUuid: s9Customer.id });
    const payableId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_PAYABLE, ledger, ownerType: 'CUSTOMER', ownerUuid: s9Customer.id });

    for (const copy of ['A', 'B']) {
      const sourceNo = `DEMO-DUP-${cutoffDate}-${copy}`;   // 固定 → 重跑幂等
      await accounting.executeTransfer({
        debitAccountId: clientAssetId, creditAccountId: suspenseId,
        amount: BigInt(s9Amount.toFixed(0)), ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_ASSET_TO_SUSPENSE,
        evidence: {
          sourceType: 'DEPOSIT', sourceNo, eventCode: 'DEPOSIT_ASSET_TO_SUSPENSE',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_ASSET],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
          assetCurrency: s9Currency, traceId: sourceNo,
          actorType: 'SYSTEM', actorId: 'RECON_DEMO',
          memo: `Demo duplicate deposit copy ${copy}`,
          debitWalletRef: s9Wallet.id, creditWalletRef: s9Wallet.id,
          isExternalCrossing: true,          // 这一腿要参与流水匹配
          externalRef: s9Ref,                // 两笔同 ref → 一笔匹配、一笔成孤儿
          effectiveDate: cutoffDate,
        },
      });
      await accounting.executeTransfer({
        debitAccountId: suspenseId, creditAccountId: payableId,
        amount: BigInt(s9Amount.toFixed(0)), ledger,
        code: TB_TRANSFER_CODES.DEPOSIT_SUSPENSE_TO_PAYABLE,
        evidence: {
          sourceType: 'DEPOSIT', sourceNo, eventCode: 'DEPOSIT_SUSPENSE_TO_PAYABLE',
          debitCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE],
          creditCode: TB_CODE_TO_COA[TB_ACCOUNT_CODES.CLIENT_PAYABLE],
          assetCurrency: s9Currency, traceId: sourceNo,
          actorType: 'SYSTEM', actorId: 'RECON_DEMO',
          memo: `Demo duplicate deposit copy ${copy} (reclass)`,
          debitWalletRef: s9Wallet.id, creditWalletRef: s9Wallet.id,
          isExternalCrossing: false,         // 纯账面重分类，不参与匹配
          effectiveDate: cutoffDate,
        },
      });
    }

    // 外部：银行只有一笔
    await (prisma as any).externalBalance.upsert({
      where: { source_accountRef_cutoffDate: { source: sourceFor(s9Currency), accountRef: s9Wallet.id, cutoffDate } },
      update: { closingBalance: s9Amount },
      create: {
        source: sourceFor(s9Currency), accountRef: s9Wallet.id, currency: s9Currency,
        book: 'CLIENT', cutoffDate, closingBalance: s9Amount, openingBalance: D(0),
        asOfAt: cutoff, status: 'INGESTED', walletRef: s9Wallet.id,
        ownerNo: s9Customer.customerNo, lineCount: 1,
      },
    });
    await (prisma as any).externalStatementLine.upsert({
      where: { dedupKey: `DEMO-INJ-${cutoffDate}-${s9Wallet.id}-s9-duplicate-deposit` },
      update: {},
      create: {
        source: sourceFor(s9Currency), accountRef: s9Wallet.id, subAccount: s9Wallet.id,
        book: 'CLIENT', currency: s9Currency, direction: 'IN', amount: s9Amount,
        externalRef: s9Ref, datetime: cutoff,
        description: 'Demo duplicate deposit — bank reported ONE credit, our books took it twice',
        dedupKey: `DEMO-INJ-${cutoffDate}-${s9Wallet.id}-s9-duplicate-deposit`,
      },
    });

    injections.push({
      scenarioId: 9,
      rootCause: 'DUPLICATE_DEPOSIT',
      walletRef: s9Wallet.id,
      expectedBucket: 'BREAK',
      expectedLineType: 'ORPHAN_INTERNAL',
      amount: s9Amount.toString(),
      externalRef: s9Ref,
      detail: {
        walletNo: s9WalletNo,
        bookedTimes: 2,
        bankReportedTimes: 1,
        closingBalance: s9Amount.toString(),
      },
    });
  }
```

- [ ] **Step 3: 补齐 import 与服务句柄**

文件顶部补（**四个常量分散在三个文件里**，已核实；`recon-demo.ts` 现有 import 里一个都没有，不会重复）：

```ts
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES, TB_CODE_TO_COA } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
```

注入函数需要 `accounting`：在它的参数里加 `accounting: AccountingService`，并在调用处（`main()` 里 `const plans = await planWallets(...)` 附近）传入 `app.get(AccountingService)`。

✅ 已核实 `executeTransfer` 的 `evidence` **支持 `externalRef`**（`accounting.service.ts:146/215` 落库）——本场景「两笔同 ref、一笔匹配一笔成孤儿」的设计成立，不需要额外改动记账层。

- [ ] **Step 4: 跑一遍看新场景被检出**

```bash
bash scripts/on-stack.sh self recon:demo:reset
bash scripts/on-stack.sh self recon:demo:break
```

Expected: `score: 9/9 DETECTED`，其中第 9 条显示 `#9  DUPLICATE_DEPOSIT ... expect=BREAK/ORPHAN_INTERNAL  DETECTED`。

- [ ] **Step 5: 人工确认重复一眼可见**

```bash
sqlite3 -header -column /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT c.caseNo, li.matchStatus, li.internalAmount, li.externalRef FROM reconciliation_line_items li JOIN reconciliation_cases c ON c.id=li.caseId WHERE c.walletRef=(SELECT id FROM wallets WHERE walletNo LIKE 'WA-DEMO-DUP-%');"
```

Expected: 该案子有一条 `ORPHAN_INTERNAL`，`externalRef` 与同钱包那条 MATCHED 行相同。

- [ ] **Step 6: 幂等确认**

再跑一次 `bash scripts/on-stack.sh self recon:demo:break`，然后：

```bash
sqlite3 /tmp/exchange_js_wt_recon_adj1/dev.db "SELECT COUNT(*) FROM account_flows WHERE sourceNo LIKE 'DEMO-DUP-%';"
```

Expected: 数字与第一次跑完之后一致（账本没有二次入账）。

- [ ] **Step 7: 提交**

```bash
git add scripts/recon-demo.ts
git commit -m "feat(demo): 演示场景 9 换成重复入账，退役未归属账户注入"
```

---

### Task 6: 收尾——重铺闸、走查截图、文档同步

**Files:**
- Modify: `doc-final/demo/data.md`
- Modify: `doc-final/demo/baseline.md`

- [ ] **Step 1: 从零重铺**

动了种子，必须走重铺闸。**顺序不能错**（`reset` 会自己拉起 TigerBeetle，`up` 之前要先把它停掉）：

```bash
bash scripts/stack.sh down
```

```bash
bash scripts/stack.sh reset self
```

```bash
lsof -ti:3113
```

Expected: 打印出一个 pid —— 那是 `reset` 拉起来的 TigerBeetle。`kill <pid>` 之后再：

```bash
bash scripts/stack.sh up self
```

- [ ] **Step 2: 跑金闸门**

```bash
bash scripts/on-stack.sh self demo:all
```

Expected: `asserts: 8/8 PASS`。

```bash
bash scripts/on-stack.sh self recon:demo:break
```

Expected: `score: 9/9 DETECTED` + `ALL 9 SCENARIOS DETECTED PER MANIFEST`。

```bash
bash scripts/on-stack.sh self verify:coa
```

Expected: `ALL INVARIANTS PASS`。

- [ ] **Step 3: 全量 jest 对红名单**

```bash
npx jest --silent 2>&1 | tail -6
```

Expected: 失败套数仍是 **4 套 / 8 例**，且逐字是 `baseline.md` 上那四个（`role-definition-create-workflow` / `system-wallet.util` / `wallets.service` / `client-web restrictedCapabilities`）。**不在名单上的新红即事故**，必须查清再往下。

- [ ] **Step 4: 走查截图**

起预览、注入 admin token，逐张截：

1. `冲正` —— 金额不对 · 客户（小数点错位那条）
2. `冲销` —— 重复入账那条新案子
3. `补记` —— 公司账簿利息/杂费那条
4. `去推单` —— 在途那条
5. `无处置动作` —— 客户侧外有我无（悬停出完整句子）

- [ ] **Step 5: 走一遍冲正完整闭环**

在小数点错位那条案子上：点 `冲正` → 确认成因是二选一、方向只读且写着推导依据 → **不填关联原单号直接提交，确认被拦** → 补上真实原单号 → 提交 → 换一个人审批 → 回案件页点「重新对账」。

Expected: 案子变 `RESOLVED`；那条差异行显示 `已解释 · ADJxxx`；本轮 run 的 `walletCount` 是全部钱包数、`closedCount` 只有 1（**不是**把所有案子一起关掉）。

- [ ] **Step 6: 同步文档**

`doc-final/demo/data.md`：把第 9 条从「未归属外部账户」改写成「重复入账（自建专用钱包 `WA-DEMO-DUP-<日期>`，银行报一笔、账本入两笔，差 500.00 AED）」。

`doc-final/demo/baseline.md`：
- jest 例数按 Step 3 的实测更新（本轮新增 Task 1 与 Task 2 的用例）
- `recon:demo:break` 那条注明第 9 条已换成重复入账
- 若 `walletCount` 因新建钱包变化，一并订正

- [ ] **Step 7: 提交**

```bash
git add doc-final/demo/data.md doc-final/demo/baseline.md
git commit -m "docs(demo): 同步处置动作收口后的演示数据与基线"
```

---

## 附：本计划自查

**Spec 覆盖**

| spec 节 | 落在哪 |
|---|---|
| §2 判定表 | Task 2（纯函数 + 单测）、Task 4（页面消费） |
| §2.1 / §2.2 两处无出口与公司金额不符 | Task 2 的判定分支与用例 |
| §3.1 族划分 | Task 1 |
| §3.2 方向推导 | Task 4 Step 2 |
| §3.3 候选表 | Task 1 的六格用例 |
| §4 表单收窄 | Task 3 |
| §5 种子变更 | Task 5 |
| §6 落点 | 文件清单 |
| §7 验收 1–6 | Task 1 Step 5、Task 2 Step 5、Task 6 Step 4/5/2/3 |

**遗留提醒**

- spec §8 五条已知短板本轮**不修**，`BANK_RETURN` 数据自相矛盾那条尤其别顺手动它。
- Task 5 是本仓库**第一个会写账本的演示注入**。若评审认为这条越界，退路是把它改成「只伪造外部数据的 ORPHAN_INTERNAL」——但那样重复入账在页面上看不出是重复（与场景 3 同形），冲销的演示位就不干净了。这个取舍已在 Task 5 的注释里写明。
