# 客户端三域订单详情增强 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三域客户视图安全扩容（充值收款账户/业务日、提现报价链/地址标签、兑换报价号/费用明细/市场价点差）+ 客户可见收敛时间线 + 三详情页四区块重排与共享组件收编。

**Architecture:** 后端在三个 `toCustomer*View` 白名单上开口子，时间线由 `trading/shared` 新共享构建器按各域收敛函数生成（raw statusHistory 永不出服务端）；前端三页换四区块结构，重复的 Field/goBack/材料区块收编 `components/detail/`。零 schema 迁移。

**Tech Stack:** NestJS + Prisma（后端视图）｜ React + Tailwind fx-* token（client-web）｜ jest（后端）+ vitest（client utils）

**Spec:** `doc-final/superpowers/specs/2026-09-15-client-order-detail-enrichment-design.md`（含禁入清单 §2.4、时间线红线 §3、区块表 §4——本计划不重抄，冲突以 spec 为准）

## Global Constraints

- **禁入清单**（spec §2.4）：`statusHistory` 原文、`manualReason`、`sumsub*`/`kyt*`/`travelRule*`、`limitHoldReason`、`slaDeadline`/`slaBreached`、内部 UUID——每个视图测试都要 `not.toHaveProperty` 断言
- **feeBreakdown 原包 JSON 禁止下发**（内含 endpoint/symbol/bid/ask 技术字段）——服务端拆好业务行
- 零 schema 迁移；UI 零中文；客户端 interface 与后端白名单 lockstep 同改
- 执行环境：worktree（`superpowers:using-git-worktrees`，项目规矩 `.claude/worktrees/<名>/`，自动分栈）；闸随任务跑，收尾闸在 Task 9
- jest 在 `Exchange_js/` 根下跑且带 `DATABASE_URL="file:/tmp/exchange_js_main/dev.db"`（判例：缺它假红）
- 提交信息用业务语言，不带 attribution 行

**三域出生态与收敛函数（后面任务反复引用，抄这里）**：

| 域 | 出生态 | 收敛函数（已存在） | statusHistory 条目形状 |
|---|---|---|---|
| deposit | `PAYIN_PENDING` | `DepositTransactionsService.toCustomerStatus(s)`（public） | `{status, timestamp, operatorId, ...}` |
| withdraw | `COMPLIANCE_PENDING` | `toCustomerWithdrawStatus(s)`（private，Task 3 提为 public） | `{status, timestamp, operator, note}` |
| swap | `COMPLIANCE_PENDING` | `toCustomerSwapStatus(s)`（同名方法，Task 4 核可见性） | `{status, timestamp, operator, note}` |

共同底：每条有 `status` + `timestamp`（ISO 串）。

---

### Task 1: 共享时间线构建器（后端 TDD）

**Files:**
- Create: `src/modules/trading/shared/customer-timeline.util.ts`
- Test: `src/modules/trading/shared/customer-timeline.util.spec.ts`

**Interfaces:**
- Produces: `buildCustomerTimeline(rawStatusHistory: string | null, birthStatus: string, createdAt: Date | string, collapse: (status: string) => string): Array<{ status: string; at: string }>` —— Task 2/3/4 各域调它

- [ ] **Step 1: 写失败测试**

```typescript
// src/modules/trading/shared/customer-timeline.util.spec.ts
import { buildCustomerTimeline } from './customer-timeline.util';

/** 模拟充值域收敛：白名单放行，其余一律 COMPLIANCE_PENDING */
const PASS = new Set(['PAYIN_PENDING', 'COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'FAILED']);
const collapse = (s: string) => (PASS.has(s) ? s : 'COMPLIANCE_PENDING');
const entry = (status: string, t: string) => ({ status, timestamp: t });
const T0 = '2026-09-15T10:00:00.000Z';

describe('buildCustomerTimeline', () => {
  it('正常路径：出生条目 + 逐步推进', () => {
    const raw = JSON.stringify([
      entry('COMPLIANCE_PENDING', '2026-09-15T10:00:01.000Z'),
      entry('PROCESSING', '2026-09-15T10:00:05.000Z'),
      entry('SUCCESS', '2026-09-15T10:00:09.000Z'),
    ]);
    expect(buildCustomerTimeline(raw, 'COMPLIANCE_PENDING', T0, collapse)).toEqual([
      { status: 'COMPLIANCE_PENDING', at: T0 }, // 出生条目；后一条同态被去重吞掉
      { status: 'PROCESSING', at: '2026-09-15T10:00:05.000Z' },
      { status: 'SUCCESS', at: '2026-09-15T10:00:09.000Z' },
    ]);
  });

  it('★不变式：冻结→解冻的单与普通单时间线不可区分（tipping-off）', () => {
    const normal = JSON.stringify([
      entry('COMPLIANCE_PENDING', '2026-09-15T10:00:01.000Z'),
      entry('PROCESSING', '2026-09-15T10:03:00.000Z'),
      entry('SUCCESS', '2026-09-15T10:04:00.000Z'),
    ]);
    const frozen = JSON.stringify([
      entry('COMPLIANCE_PENDING', '2026-09-15T10:00:01.000Z'),
      entry('FROZEN', '2026-09-15T10:01:00.000Z'),              // 执法态
      entry('COMPLIANCE_PENDING', '2026-09-15T10:02:00.000Z'),  // 解冻回炉
      entry('PROCESSING', '2026-09-15T10:03:00.000Z'),
      entry('SUCCESS', '2026-09-15T10:04:00.000Z'),
    ]);
    const a = buildCustomerTimeline(normal, 'COMPLIANCE_PENDING', T0, collapse);
    const b = buildCustomerTimeline(frozen, 'COMPLIANCE_PENDING', T0, collapse);
    expect(b).toEqual(a); // 等长等形：FROZEN 收敛后与前条同态被吞，解冻回炉同理
  });

  it('坏 JSON / 空历史：只剩出生条目', () => {
    expect(buildCustomerTimeline('not-json{', 'PAYIN_PENDING', T0, collapse))
      .toEqual([{ status: 'PAYIN_PENDING', at: T0 }]);
    expect(buildCustomerTimeline(null, 'PAYIN_PENDING', T0, collapse))
      .toEqual([{ status: 'PAYIN_PENDING', at: T0 }]);
  });

  it('缺 status 或缺 timestamp 的脏条目跳过；createdAt 传 Date 也行', () => {
    const raw = JSON.stringify([
      { status: 'PROCESSING' }, // 无 timestamp → 跳过
      { timestamp: '2026-09-15T10:00:05.000Z' }, // 无 status → 跳过
      entry('SUCCESS', '2026-09-15T10:00:09.000Z'),
    ]);
    expect(buildCustomerTimeline(raw, 'COMPLIANCE_PENDING', new Date(T0), collapse)).toEqual([
      { status: 'COMPLIANCE_PENDING', at: T0 },
      { status: 'SUCCESS', at: '2026-09-15T10:00:09.000Z' },
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/trading/shared/customer-timeline.util.spec.ts`
Expected: FAIL — Cannot find module './customer-timeline.util'

- [ ] **Step 3: 最小实现**

```typescript
// src/modules/trading/shared/customer-timeline.util.ts
/**
 * 客户可见时间线构建器（tipping-off 红线件，spec §3）。
 * raw statusHistory 只在服务端内存里过一道：每条 toStatus 过该域收敛函数，
 * 收敛后与上一条同态整条丢弃——冻结/执法骚动被去重规则吞没，冻结单时间线
 * 与普通单不可区分（不变式见 spec 同节，测试有变异式断言）。
 */
export function buildCustomerTimeline(
  rawStatusHistory: string | null,
  birthStatus: string,
  createdAt: Date | string,
  collapse: (status: string) => string,
): Array<{ status: string; at: string }> {
  const bornAt = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
  const out: Array<{ status: string; at: string }> = [
    { status: collapse(birthStatus), at: bornAt },
  ];
  let entries: any[] = [];
  try {
    entries = rawStatusHistory ? JSON.parse(rawStatusHistory) : [];
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
  for (const e of entries) {
    const status = typeof e?.status === 'string' ? e.status : null;
    const at = typeof e?.timestamp === 'string' ? e.timestamp : null;
    if (!status || !at) continue;
    const collapsed = collapse(status);
    if (collapsed === out[out.length - 1].status) continue;
    out.push({ status: collapsed, at });
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认绿**（命令同 Step 2，Expected: 4 passed）
- [ ] **Step 5: Commit** `git add src/modules/trading/shared/customer-timeline.util.ts src/modules/trading/shared/customer-timeline.util.spec.ts && git commit -m "feat(详情增强): 客户可见时间线共享构建器——收敛+连续去重,冻结单不可区分不变式入测"`

---

### Task 2: 充值客户视图扩容

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（`toCustomerDepositView`，约 :415）
- Test: Create `src/modules/trading/deposit-transactions/deposit-customer-view.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildCustomerTimeline`
- Produces: 视图新增键 `toAddress`、`toIban`、`effectiveDate`、`timeline`（Task 6 客户端接口对齐）

- [ ] **Step 1: 写失败测试**——new 一个 service 实例难（依赖多），照本目录 `deposit-transactions.service.spec.ts` 既有 Test.createTestingModule/mock 手法起最小实例（实现者先读该文件抄它的搭法），用例：

```typescript
// 用例骨架（搭法照抄本目录既有 spec；view 是同步纯函数调用）
const row = {
  id: 'uuid-x', depositNo: 'DEP1', status: 'FROZEN', amount: '100',
  createdAt: new Date('2026-09-15T10:00:00.000Z'), completedAt: new Date(),
  txHash: '0xabc', referenceNo: null, fromAddress: 'Txyz', fromIban: null,
  toAddress: 'Tplatform', toIban: null, effectiveDate: '2026-09-15',
  statusHistory: JSON.stringify([
    { status: 'COMPLIANCE_PENDING', timestamp: '2026-09-15T10:00:01.000Z' },
    { status: 'FROZEN', timestamp: '2026-09-15T10:01:00.000Z' },
  ]),
  manualReason: 'EDD_PEP', limitHoldReason: 'BELOW_MIN', slaDeadline: new Date(), slaBreached: true,
  sumsubTxnId: 'st-1', asset: { code: 'USDT-TRON', currency: 'USDT', network: 'TRON', decimals: 6 },
};
const view = (service as any).toCustomerDepositView(row);
// 新字段
expect(view.toAddress).toBe('Tplatform');
expect(view.effectiveDate).toBe('2026-09-15');
// 时间线：FROZEN 收敛后被吞，只剩出生 PAYIN_PENDING → COMPLIANCE_PENDING
expect(view.timeline).toEqual([
  { status: 'PAYIN_PENDING', at: '2026-09-15T10:00:00.000Z' },
  { status: 'COMPLIANCE_PENDING', at: '2026-09-15T10:00:01.000Z' },
]);
// 禁入清单（Global Constraints）逐个 not.toHaveProperty
for (const k of ['statusHistory', 'manualReason', 'limitHoldReason', 'slaDeadline', 'slaBreached', 'sumsubTxnId']) {
  expect(view).not.toHaveProperty(k);
}
// FROZEN 单 status 收敛 + completedAt 门控吞掉
expect(view.status).toBe('COMPLIANCE_PENDING');
expect(view.completedAt).toBeNull();
```

- [ ] **Step 2: 跑红** `DATABASE_URL=... npx jest src/modules/trading/deposit-transactions/deposit-customer-view.spec.ts` → FAIL（无 timeline/toAddress 键）
- [ ] **Step 3: 实现**——`toCustomerDepositView` 的 return 对象里加四行（文件头 import `buildCustomerTimeline`）：

```typescript
      toAddress: item.toAddress,
      toIban: item.toIban,
      effectiveDate: item.effectiveDate,
      timeline: buildCustomerTimeline(item.statusHistory, 'PAYIN_PENDING', item.createdAt, (s) => this.toCustomerStatus(s)),
```

同文件视图文档注释补一行：新四键为何安全（收款账户/业务日=客户自己的交易事实；timeline 经收敛构建器）。
- [ ] **Step 4: 跑绿**（同 Step 2 + 全目录 `npx jest src/modules/trading/deposit-transactions` 不红）
- [ ] **Step 5: Commit** `feat(详情增强): 充值客户视图+收款账户/业务日/时间线,禁入清单入测`

---

### Task 3: 提现客户视图扩容

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（`toCustomerWithdrawView` :438、`toCustomerWithdrawStatus` :461 提 public、`findOneForCustomer` :501）
- Test: Create `src/modules/trading/withdraw-transactions/withdraw-customer-view.spec.ts`

**Interfaces:**
- Produces: 视图新增 `timeline`；**仅详情路径**（`findOneForCustomer`）新增 `quote: { quoteNo, feeLevelCode, tierName } | null` 与 `addressLabel: string | null`（列表路径不背 N+1）

- [ ] **Step 1: 失败测试**（搭法照本目录 `withdraw-transactions.service.spec.ts`）：
  - `toCustomerWithdrawView`：timeline 出生 `COMPLIANCE_PENDING` + 冻结吞没（同 Task 2 手法，收敛函数用 withdraw 自己的）；禁入 keys `not.toHaveProperty`
  - `findOneForCustomer`：mock `findOneInternal` 回带 `pricingQuote: { quoteNo: 'WQT1', feeLevelCode: 'STD-USDT', matchedTierName: 'Tier 1 (0-500)' }` 的行 + mock `prisma.withdrawalAddress.findFirst` 回 `{ label: 'My cold wallet' }` → 断言 `view.quote` 三键与 `view.addressLabel`；pricingQuote 为 null → `quote: null`；findFirst 回 null → `addressLabel: null`
- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**：

```typescript
  // toCustomerWithdrawView 的 return 里加：
      timeline: buildCustomerTimeline(item.statusHistory, 'COMPLIANCE_PENDING', item.createdAt, (s) => this.toCustomerWithdrawStatus(s)),

  // findOneForCustomer 改为（detail 专属富化；findOneInternal 已 include pricingQuote）：
  async findOneForCustomer(id: string, customerId: string) {
    const item = await this.findOneInternal(id);
    if (item.ownerId !== customerId) {
      throw new ForbiddenException('Not your withdrawal');
    }
    const view: any = this.toCustomerWithdrawView(item);
    view.quote = item.pricingQuote
      ? { quoteNo: item.pricingQuote.quoteNo, feeLevelCode: item.pricingQuote.feeLevelCode, tierName: item.pricingQuote.matchedTierName }
      : null;
    // 地址标签：值匹配反查（无 FK；查不到 → null，前端整行不渲染）。spec §6 风险已载：改名跟着变，demo 语义可接受
    const addr = await (this.prisma as any).withdrawalAddress.findFirst({
      where: { customerId, OR: [{ address: item.toAddress ?? '__none__' }, { iban: item.toIban ?? '__none__' }] },
      select: { label: true },
    });
    view.addressLabel = addr?.label ?? null;
    return view;
  }
```

`toCustomerWithdrawStatus` 从 private 改 public（timeline 回调用它；照 deposit 域先例——它的收敛函数就是刻意 public 供复用）。
- [ ] **Step 4: 跑绿** + 全目录不红
- [ ] **Step 5: Commit** `feat(详情增强): 提现客户视图+时间线,详情路径+报价链/地址标签`

---

### Task 4: 兑换客户视图扩容

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`（`toCustomerSwapView` :705）
- Test: Create `src/modules/trading/swap-transactions/swap-customer-view.spec.ts`

**Interfaces:**
- Produces: 视图新增 `quoteNo`、`feeLines: [{itemCode, amount, currency}]`、`marketRate: string | null`、`spreadPercent: number | null`、`timeline`

**数据源事实（已核）**：`SwapTransaction.feeBreakdown` = 单元素数组 JSON `[{ policyRef, matched, fx: { baseRate, quotedRate, markupBps, endpoint, symbol, bid, ask, ... }, fees: [{ itemCode, calcType, currency, amount }], totals }]`（从 SwapQuote 抄写入单，`swap-workflow.service.ts:470`）。**fx 块技术字段禁止透传**。

- [ ] **Step 1: 失败测试**：row 带上述形状的 feeBreakdown + statusHistory（含 FROZEN 条目）→ 断言 `feeLines` 只剩 `{itemCode, amount, currency}` 三键、`marketRate === fx.baseRate`、`spreadPercent === fx.markupBps / 100`、view 无 `feeBreakdown` 键、timeline 冻结吞没；feeBreakdown 为 null / 坏 JSON → 三键都 null/[]
- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——`toCustomerSwapView` return 里加：

```typescript
      quoteNo: item.quoteNo ?? null,
      ...this.toCustomerPricingFacts(item.feeBreakdown),
      timeline: buildCustomerTimeline(item.statusHistory, 'COMPLIANCE_PENDING', item.createdAt, (s) => this.toCustomerSwapStatus(s)),
```

新增私有方法（同文件）：

```typescript
  /** feeBreakdown 原包含 fx 技术字段（endpoint/symbol/bid/ask），只拆业务事实下发（spec §2.3）。 */
  private toCustomerPricingFacts(rawFeeBreakdown: string | null): {
    feeLines: Array<{ itemCode: string; amount: string; currency: string }>;
    marketRate: string | null;
    spreadPercent: number | null;
  } {
    try {
      const head = rawFeeBreakdown ? JSON.parse(rawFeeBreakdown)?.[0] : null;
      const fees = Array.isArray(head?.fees) ? head.fees : [];
      return {
        feeLines: fees
          .filter((f: any) => typeof f?.itemCode === 'string' && f?.amount != null)
          .map((f: any) => ({ itemCode: f.itemCode, amount: String(f.amount), currency: String(f.currency ?? '') })),
        marketRate: typeof head?.fx?.baseRate === 'string' ? head.fx.baseRate : null,
        spreadPercent: typeof head?.fx?.markupBps === 'number' ? head.fx.markupBps / 100 : null,
      };
    } catch {
      return { feeLines: [], marketRate: null, spreadPercent: null };
    }
  }
```

`toCustomerSwapStatus` 可见性核一下，private 就提 public（同 Task 3 理由）。
- [ ] **Step 4: 跑绿** + 全目录不红 + 随手闸 `npx tsc --noEmit -p tsconfig.json`
- [ ] **Step 5: Commit** `feat(详情增强): 兑换客户视图+报价号/费用明细/市场价点差/时间线,fx技术字段拆净`

---

### Task 5: 客户端共享组件收编

**Files:**
- Create: `client-web/src/components/detail/Field.tsx`、`client-web/src/components/detail/useGoBack.ts`、`client-web/src/components/detail/Timeline.tsx`、`client-web/src/components/detail/MaterialRequestSection.tsx`

**Interfaces（Produces，Task 6/7/8 消费）：**

```typescript
// Field.tsx —— 三页现有 Field 逐字上移（DepositDetail.tsx:172-177 原样),export default
const Field = ({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) => ( /* 原样式原类名 */ );

// useGoBack.ts —— goBack 判据上移（DepositDetail.tsx:56-57 逻辑 + 原注释一并搬）
export const useGoBack = (fallback: string) => { /* location.key==='default' ? navigate(fallback) : navigate(-1) */ };

// Timeline.tsx —— 渲染收敛时间线；label 由调用页用各自 get*StatusView 预映射
export interface TimelineItem { label: string; at: string; }
const Timeline = ({ items }: { items: TimelineItem[] }) => ( /* 竖点线列表：fx-brass 圆点 + fx-rule 连线 + label + 本地化时间(mono, text-fx-dust) */ );

// MaterialRequestSection.tsx —— Deposit/Withdraw 两份重复区块合一（fetch+过滤+渲染整块上移）
const MaterialRequestSection = ({ domain, orderRef, orderIsTerminal }:
  { domain: 'DEPOSIT' | 'WITHDRAW'; orderRef: string; orderIsTerminal: boolean }) => ( /* 现 DepositDetail 82-98 fetch + 132-155 渲染整段上移，MaterialRequestEntry 接口与文件头长注释随行 */ );
```

- [ ] **Step 1: 建四个文件**——**行为零变化搬家**：样式类名、注释（含 goBack 与材料请求两段长注释）原样随行，Timeline 是唯一新造（样式对齐 mockup：`border-l border-fx-rule` 竖线 + `bg-fx-brass` 圆点）
- [ ] **Step 2: 验证** `cd client-web && npx tsc -b --noEmit`（此刻组件尚无消费者，tsc 过即可）
- [ ] **Step 3: Commit** `refactor(详情增强): Field/useGoBack/材料区块收编共享,新增 Timeline 组件`

---

### Task 6: 充值详情页重排

**Files:**
- Modify: `client-web/src/pages/DepositDetail.tsx`

**Interfaces:**
- Consumes: Task 2 视图新键；Task 5 四组件

- [ ] **Step 1: 改造**——接口与区块（spec §4 区块表为准）：
  - `DepositDetailData` 加 `toAddress: string | null; toIban: string | null; effectiveDate: string | null; timeline: { status: string; at: string }[]`
  - 页内 `Field`/`goBack`/材料 fetch+渲染段删除，改 import 共享（`useGoBack('/deposit')`、`<MaterialRequestSection domain="DEPOSIT" orderRef={depositNo} orderIsTerminal={...现有终态判据} />`）
  - Details 单节拆两节：**Amounts**（Submitted、业务日 `Value date`、Completed）｜**Route**（Reference、From address/IBAN、**Received at`(平台收款账户 toAddress/toIban)`**、Transaction hash——条件渲染手法沿用现状 `&&` 短路）
  - 尾部加 **Timeline** 节：`<Timeline items={tx.timeline.map(t => ({ label: getDepositStatusView(t.status).label, at: t.at }))} />`
- [ ] **Step 2: 验证** `cd client-web && npx tsc -b --noEmit` + `npm run test:client`（根目录跑）全绿
- [ ] **Step 3: preview 截图**——worktree 自家栈起 client，Alice 登录 → 任一充值单详情页截图（新区块齐、无空区块壳）
- [ ] **Step 4: Commit** `feat(详情增强): 充值详情页四区块+收款账户/业务日/时间线`

---

### Task 7: 提现详情页重排

**Files:** Modify `client-web/src/pages/WithdrawDetail.tsx`（手法与 Task 6 全同，此处只列差异）

- [ ] **Step 1: 改造**——接口加 `quote: { quoteNo: string; feeLevelCode: string | null; tierName: string } | null; addressLabel: string | null; timeline: {...}[]`；区块：**Amounts**（金额/Fee/Net/Submitted/Completed）｜**Route**（Destination address/IBAN、**Address label**、Reference、txHash）｜**Pricing**（Quote No `quote.quoteNo` mono、Fee level `${feeLevelCode} · ${tierName}`——`quote` 为 null 整节不渲染）｜**Timeline**（label 映射用 `getWithdrawStatusView`）｜材料区块换共享组件
- [ ] **Step 2: tsc + vitest 全绿**
- [ ] **Step 3: 截图**（有报价链的提现单一张）
- [ ] **Step 4: Commit** `feat(详情增强): 提现详情页四区块+报价链/地址标签/时间线`

---

### Task 8: 兑换详情页重排

**Files:** Modify `client-web/src/pages/SwapDetail.tsx`（同手法，差异如下）

- [ ] **Step 1: 改造**——接口加 `quoteNo: string | null; feeLines: { itemCode: string; amount: string; currency: string }[]; marketRate: string | null; spreadPercent: number | null; timeline: {...}[]`；区块：**Amounts**（You sold/Gross receive(`toAmount`)/Fee(−)/Net received(`netToAmount ?? toAmount`)/Exchange rate/**Market · Spread**`(marketRate && `${marketRate} · ${spreadPercent}%`)`）｜**Pricing**（Quote No、feeLines 逐行 `itemCode → amount currency`，itemCode 展示做词化：`SERVICE_FEE → Service fee` 简单 replace('_',' ')+首字母大写，勿建映射表）｜**Timeline**（`getSwapStatusView`）；无 Route、无材料区块（spec §1 不做）；页头保持 `100 USDT → 353.58 AED` 现构。**白名单头注同步**：本页文件头有字段白名单纪律注释，新增键逐个补进白名单说明
- [ ] **Step 2: tsc + vitest 全绿**
- [ ] **Step 3: 截图**
- [ ] **Step 4: Commit** `feat(详情增强): 兑换详情页四区块+报价号/费用明细/点差/时间线`

---

### Task 9: 冻结对照走查 + 文档同步 + 收尾闸

**Files:**
- Modify: `doc-final/modules/v4-deposit.md`、`v5-withdraw.md`、`v6-swap.md`（各 §5 前端可见面小节：详情页字段清单更新）
- Modify: `doc-final/BACKLOG.md`（销「client 三域详情 Field/goBack 三份重复」观察项——复检报告 §二-9 登记项）

- [ ] **Step 1: 冻结单对照走查（不变式的整链实证）**——worktree 栈 `bash scripts/on-stack.sh self demo:all` 铺数据后，**Frank**（判例：Carol 恒零余额）名下造一笔冻结单（⚡面板 MLRO freeze 或制裁路径），客户端登 Frank：冻结单详情页截图 vs 同域普通在途单截图——状态徽章、时间线**肉眼不可区分**；DevTools Network 里检查详情响应 JSON：无 FROZEN 字样、无禁入字段
- [ ] **Step 2: 收尾闸**——`bash scripts/on-stack.sh self demo:all` 全绿（29/29 + asserts）；三 tsc + 全量相关 jest（`npx jest src/modules/trading`）+ `npm run test:client` 全绿
- [ ] **Step 3: 文档同步**——三篇 §5 按实改后的字段清单重写详情页段；BACKLOG 销账行附证据
- [ ] **Step 4: Commit** `docs(详情增强): modules 三篇§5 详情页字段同步+BACKLOG 观察项销账`
- [ ] **Step 5:** 汇报走查证据（截图落盘路径写明——判例），交主会话终审后走 `superpowers:finishing-a-development-branch` 合并

## Self-Review 记录

- Spec 覆盖：§2.1→T2 ｜ §2.2→T3（`levelName/feeTotal` 落地为实际列 `feeLevelCode`+`matchedTierName`，feeTotal 即订单 `feeAmount` 已显示，不重复下发——与 admin"summary only"裁定一致）｜ §2.3→T4 ｜ §3→T1+各域接线 ｜ §4→T5-T8 ｜ §5 验收→各任务 Step + T9 ｜ 禁入清单→Global Constraints + 每视图测试
- 占位扫描：无 TBD；T2/T3 测试"搭法照本目录既有 spec"是指向真实文件的搭法引用，用例断言全部给足
- 类型一致性：`buildCustomerTimeline` 四参签名 T1 定义、T2/3/4 调用一致；`TimelineItem {label, at}` T5 定义、T6/7/8 映射一致
