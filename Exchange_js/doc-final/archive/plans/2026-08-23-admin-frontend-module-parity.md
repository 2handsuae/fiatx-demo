# 第五批 · admin 三域页面「模块级」前端统一 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 admin 的充值/提现/兑换六个页面在**模块级**上统一 —— 同一职责的模块用同一个组件，内容差异靠入参表达。

**Architecture:** 抽两个新共享件（`GateTile`、合并后的 `SumsubDetailSection`）、合并一个已漂移的三副本组件（`StatusTimeline`）、统一侧栏结构、补齐三处列表差异。**后端零改动。**

**Tech Stack:** React 18 + Vite + Tailwind（`admin-web`）｜ jest + ts-jest（仅用于 `.ts`，见 G6）

**设计稿：** `doc-final/superpowers/specs/2026-08-23-admin-frontend-module-parity-design.md`

---

## Global Constraints

**每个 Task 的要求都隐含包含本节全部内容。**

### G1 · 业主定的规则（一切判定的来源）

> 「我并不是要一对一一致，我要的是**基于流程把信息组成尽量通用的模块，然后同一模块就用同一个组件**。像 transaction detail 到了兑换拆成了三个，没问题的。但是既然都是 L1 和 L2 两个 gate，那么这两个就要一样。侧边栏是操作和次要信息载体，那么结构应该一样。」

1. **同一职责的模块 → 同一个组件。** 内容可多可少，承载物必须是同一个。
2. **内容差异允许。** 兑换交易信息拆三张卡是对的。
3. **侧栏结构必须一样。** 某域没有操作，就是操作段为空，不是换个顺序。

**不引入第四条标准。** 遇到判不了的，回来问，别自己发明规则。

### G2 · 严格只做前端

**一处改动只要碰到 `src/`（后端），就不属于本轮。**

已实证本轮 **零后端改动**：所有改动落在 `admin-web/src/` 下的 6 个页面 + 3 个组件文件。

若实施中发现某处非改后端不可，**停下来报告**，不要自作主张改后端，也不要为了绕开它而改坏前端语义。

### G3 · 基线与工作树

基线 `main @ 6236d9b9`（第四批已合入）。开新工作树 + 新分支：

```bash
git worktree add .claude/worktrees/parity5 -b feat/admin-module-parity main
```

在该工作树内 `bash scripts/stack.sh up`（self 栈，自动分端口）；查端口：`bash scripts/stack.sh status`。

**端口隔离铁律**：只准访问自己栈的端口与 DB。起服务与截图一律用 `127.0.0.1`，**不要用 `localhost`**。

### G4 · 行号会漂 —— 一律用 anchor 定位

本计划**只给 anchor（唯一字符串），不给行号**。同一文件做完第一处编辑后行号就不准了。

每处改动都给了 `currentCode` 原文，用它做锚点。找不到就 `grep` 符号名，**不要照着记忆改**。

### G5 · 前端编译约束（踩了当场红）

`admin-web/tsconfig.app.json`：

| 选项 | 约束 |
|---|---|
| `verbatimModuleSyntax: true` | 仅类型的 import 必须写 `import type`；**值导入不能写 `import type`**（运行时会拿到 undefined 组件） |
| `noUnusedLocals` / `noUnusedParameters` | **删代码后残留的未用 import / 变量一律编译失败** —— 每删一块就回头清 import |
| `erasableSyntaxOnly: true` | 不能用 `enum`、不能用构造函数参数属性 |
| `strict: true` | 无隐式 any |
| `exclude: ["src/**/*.spec.ts", ...]` | **admin-web 的 tsc 闸门不编译 spec 文件** —— 前端 spec 的类型错只有 `npx jest` 跑到才暴露 |

### G6 · 测试能力的硬限制

`jest.config.js` 实测：
```
moduleFileExtensions: ['js','json','ts']     ← 没有 tsx
testRegex: '.*\.spec\.ts$'                    ← .spec.tsx 静默不跑
testEnvironment: 'node'                       ← 无 jsdom
roots: [src, admin-web/src, client-web/src]   ← 这两处的 .spec.ts 会跑
```

**本仓库今天无法单测 React 组件。禁止写 `.spec.tsx`** —— 它不会跑，写了等于伪造绿灯（第四批栽过一次）。

本批统一用一个**文本扫描 spec**：`admin-web/src/pages/module-parity.spec.ts`，用 `fs.readFileSync` 读 `.tsx` 源文本做结构断言。它随 Task 逐步长大，每个 Task 往里加自己的 describe。

**这是把业主那三条规则写成可执行断言的唯一手段** —— 以后谁把某一域改回去，测试会红。

### G7 · 每个 Task 的收尾

**五道闸门：**
```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest
```

**jest 基线**：`3 suites / 4 tests failed`（已实证 main 上就是这个数：152 suites / 1932 passed）。**净新失败必须为 0。**

### G8 · 验收是肉眼并排比对

业主的验收方式是**并排打开三个页面对比**。tsc/jest 全绿跟「模块级相同」没有因果关系。

→ **每个动 UI 的 Task 收尾必须截三张并排图**，把截图路径写进完成记录。

### G9 · 提交

一个 Task 一个 commit，中文 message，格式 `feat(parity): <做了什么>` 或 `refactor(parity): <合并了什么>`。

---

## File Structure

### 新建（3 个）

| 文件 | 责任 |
|---|---|
| `admin-web/src/components/compliance/GateTile.tsx` | 闸门格子。三域 × L1/L2，共用 6 次。只认 `title` / `value` / `caption` / `style` 四个入参，内部零域分支 |
| `admin-web/src/components/compliance/SumsubDetailSection.tsx` | Sumsub getTxn 报告只读视图。取代三份本地副本 |
| `admin-web/src/components/compliance/StatusTimeline.tsx` | 状态历史时间线。取代三份已漂移的本地副本 |

### 新建（测试，1 个）

| 文件 | 责任 |
|---|---|
| `admin-web/src/pages/module-parity.spec.ts` | **B 档**文本扫描：把「同一模块同一组件」「侧栏结构一致」「列骨架一致」写成断言。随 Task 逐步长大 |

### 修改（6 个页面）

```
admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx
admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionList.tsx
```

### 不动

`src/`（后端）全部 ｜ `client-web/` 全部 ｜ `admin-web/src/components/ui/LinkedRelationCard.tsx` 与兑换的 `LegAttemptRow`（业主裁定乙）

---

## 任务总览

| # | 名称 | 覆盖设计稿 | 验证 |
|---|---|---|---|
| 1 | `GateTile` + 三域接入 + 兑换 Compliance 容器 | §3 | B + 渲染 |
| 2 | `SumsubDetailSection` 合并 | §7 | B + 渲染 |
| 3 | `StatusTimeline` 合并 | §8 | B + 渲染 |
| 4 | 侧栏收敛（兑换删两块 + Identity 统一 4 行） | §5 | B + 渲染 |
| 5 | `needsReview` 统一顶部横幅 + 兑换 Hero 补 Owner No | §6 | B + 渲染 |
| 6 | 兑换 `Technical` 卡归位 | §9 | 渲染 |
| 7 | `⚡ Simulation` 三域常显 + 终态置灰 | §9 | B + 渲染 |
| 8 | 列表页三处（含提现 Review 列 + `AdminBadge`） | §10、§2.1 | B + 渲染 |
| 9 | 六页并排终验 + 文档同步 + BACKLOG | §11、§12 | 渲染 |

**顺序**：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9。

Task 1–3、5–7 都动三个详情页，**必须顺序做**，并行会互相覆盖。

---

## Task 1: `GateTile` + 三域接入 + 兑换 Compliance 容器

> 覆盖设计稿 §3。业主点名「既然都是 L1 和 L2 两个 gate，那么这两个就要一样」。

### 背景（已实证）

**L1 格子**三域结构一致。**L2 格子三域三个样，而且两域的 L2 比自己的 L1 还轻一档：**

| | 排版 | 字号 |
|---|---|---|
| 充值 | `Finance:` ＋ verdict ＋ `Score: N` 一行三段横排 | `text-[11px] font-semibold` —— L1 是 `text-sm font-bold` |
| 提现 | `finance: approved · Score 40`，且 `finance` 是**原始字面量**没转人话 | 同样轻一档 |
| 兑换 | `KYT: approved` 大字 ＋ 小字 `Score 62` | 与 L1 同级 |

兑换的 `Compliance` 还是手写 `<div className="px-6 py-5">` + `<h3>`，另两域是 `<DetailCard>`。

底下那张 `<L1GateCard raw={data.l1Snapshot} />` 三域已经是同一个组件、同一个位置 —— **本轮不动它**。

### 业主逐条拍板的内容

| | L1 副行 | L2 主值 | L2 副行 |
|---|---|---|---|
| 充值 | `Post-arrival check` | `Finance:` / `Travel Rule:` ＋ verdict（按 `sumsubTxnType`） | `Score N` |
| 提现 | `Pre-creation check` | **与充值同款**（要转人话，支持 Travel Rule） | `Score N` |
| 兑换 | `Pre-creation check`（原 `Pre-execution gate`） | **锁死 `Finance:`** ＋ verdict（原 `KYT:`） | `Score N` |

**Files:**
- Create: `admin-web/src/components/compliance/GateTile.tsx`
- Create: `admin-web/src/pages/module-parity.spec.ts`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`
- Modify: `admin-web/src/pages/WithdrawTransactionDetail.tsx`
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`

**Interfaces:**
- Produces：`export const GateTile` —— props `{ title: string; value: string; caption: string; style: LayerStyle }`；`LayerStyle` 来自 `admin-web/src/utils/depositActionMap.ts`（字段：`borderColor` / `textColor` / `label`）
- Consumes：无（第一个 Task）

---

- [ ] **Step 1: 写失败的测试**

新建 `admin-web/src/pages/module-parity.spec.ts`：

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

/* B 档 · 文本扫描单测（见计划 G6）。
   本仓库无法单测 React 组件（jest.config.js 的 moduleFileExtensions 没有 tsx、
   testRegex 只匹配 .spec.ts、testEnvironment 是 node），所以这里直接读 .tsx
   源文本，把业主那三条规则写成可执行断言：
     ① 同一职责的模块 → 同一个组件
     ② 内容差异允许
     ③ 侧栏结构必须一样
   本文件不被 admin-web 的 tsc 闸门编译（tsconfig.app.json 的 exclude），
   只由 npx jest 执行。 */

export const DETAIL_PAGES = {
  DEPOSIT: 'DepositTransactionDetail.tsx',
  WITHDRAW: 'WithdrawTransactionDetail.tsx',
  SWAP: 'SwapTransactionDetail.tsx',
} as const;

export const srcOf = (file: string) => readFileSync(join(__dirname, file), 'utf8');

describe('规则① 同一职责同一组件 · L1/L2 闸门格子（Task 1）', () => {
  it('三域各用 GateTile 恰好两次（L1 一次、L2 一次）', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const n = (srcOf(file).match(/<GateTile\b/g) ?? []).length;
      expect([domain, n]).toEqual([domain, 2]);
    }
  });

  /* 反面断言：内联手写的格子必须消失。只查 <GateTile> 出现过是不够的 ——
     加了新组件却留着旧 JSX，页面会渲染两遍，而正面断言照样绿。 */
  it('三域都不再内联手写闸门格子（旧 JSX 必须删干净）', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, /border-l-\[3px\]\} *`\}>/.test(src)]).toEqual([domain, false]);
      expect([domain, src.includes('>L1 · Eligibility<')]).toEqual([domain, false]);
      expect([domain, src.includes('>L2 · Transaction Screen<')]).toEqual([domain, false]);
    }
  });

  it('三域 L1 副行按业主口径：充值 Post-arrival、提现与兑换都是 Pre-creation', () => {
    expect(srcOf(DETAIL_PAGES.DEPOSIT)).toContain('Post-arrival check');
    expect(srcOf(DETAIL_PAGES.WITHDRAW)).toContain('Pre-creation check');
    expect(srcOf(DETAIL_PAGES.SWAP)).toContain('Pre-creation check');
    // 旧措辞必须消失
    expect(srcOf(DETAIL_PAGES.SWAP)).not.toContain('Pre-execution gate');
  });

  it('L2 主值：充值/提现按 sumsubTxnType 转人话；兑换锁死 Finance 且不再用 KYT:', () => {
    for (const d of ['DEPOSIT', 'WITHDRAW'] as const) {
      const src = srcOf(DETAIL_PAGES[d]).replace(/\s+/g, ' ');
      expect([d, src.includes("'travelRule' ? 'Travel Rule' : 'Finance'")]).toEqual([d, true]);
    }
    const swap = srcOf(DETAIL_PAGES.SWAP).replace(/\s+/g, ' ');
    expect(swap).toContain('Finance:');
    expect(swap).not.toContain('KYT:');
    // 兑换没有 Travel Rule（无第三方对手方），不许出现
    expect(swap).not.toContain('Travel Rule');
  });

  it('兑换 Compliance 改用 DetailCard，不再手写 div+h3', () => {
    const swap = srcOf(DETAIL_PAGES.SWAP).replace(/\s+/g, ' ');
    expect(swap).toContain('<DetailCard title="Compliance"');
    expect(swap).not.toContain('className="px-6 py-5"');
  });
});
```

> `expect([domain, x])` 这个写法是故意的：三个域循环跑，断言失败时错误信息里带域名，否则不知道是哪个域红了。

- [ ] **Step 2: 跑，确认真失败**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts
```

预期：5 条全 FAIL（第 1 条报 `n` 是 0）。

**⚠️ 若有任何一条直接 PASS，停下来** —— 说明断言写的不是你以为的东西（例如正则没匹配到任何东西而"意外通过"）。先让它真能失败。

- [ ] **Step 3: 建 `GateTile` 组件**

新建 `admin-web/src/components/compliance/GateTile.tsx`：

```tsx
import type { LayerStyle } from '../../utils/depositActionMap';

/**
 * 闸门格子（充值 / 提现 / 兑换三域详情页共用）。
 *
 * 三个详情页的 `Compliance` 卡里，`L1 · Eligibility` 与 `L2 · Transaction Screen`
 * 是同一种承载物：左侧一条 3px 彩色竖边 + 三行（标题 / 主值 / 副行）。此前三页各自
 * 内联手写，L2 演化出三套排版、字号还比自己的 L1 轻一档 —— 同一职责只应有一个组件，
 * 内容差异靠入参表达，排版不许分叉（第五批 §3，业主规则①）。
 *
 * 颜色（borderColor / textColor）一律由 `getComplianceLayerStyle()` 决定；
 * 本组件不做任何取值域判断 —— 要加新状态请改那个函数，别在这里开分支。
 */
export const GateTile = ({
  title,
  value,
  caption,
  style,
}: {
  /** 格子标题，如 `L1 · Eligibility` / `L2 · Transaction Screen`。 */
  title: string;
  /** 主值（大字），如 `ACTIVE` / `Finance: approved` / `PENDING`。 */
  value: string;
  /** 副行（小字），如 `Pre-creation check` / `Score 42`。 */
  caption: string;
  /** 边色 + 字色，来自 `getComplianceLayerStyle(...)`。 */
  style: LayerStyle;
}) => (
  <div className={`rounded-lg border bg-adm-bg p-3 border-l-[3px] ${style.borderColor}`}>
    <div className="font-mono text-[9px] uppercase tracking-wider text-adm-t3">{title}</div>
    <div className={`mt-1 text-sm font-bold ${style.textColor}`}>{value}</div>
    <div className="mt-0.5 font-mono text-[10px] text-adm-t3">{caption}</div>
  </div>
);
```

⚠️ `LayerStyle` 是**类型**，必须 `import type`（G5 的 `verbatimModuleSyntax`）。先确认 `depositActionMap.ts` 确实 `export interface LayerStyle`（`grep -n "export interface LayerStyle" admin-web/src/utils/depositActionMap.ts`）。

- [ ] **Step 4: 充值接入**

加 import（anchor：`import L1GateCard from '../components/L1GateCard';`）：

```tsx
import L1GateCard from '../components/L1GateCard';
import { GateTile } from '../components/compliance/GateTile';
```

替换整块（anchor：`{/* 3. Compliance Layers */}`）：

```tsx
          {/* 3. Compliance Layers */}
          <DetailCard title="Compliance" columns={1}>
            <div className="grid grid-cols-2 gap-3">
              {/* L1: Eligibility Guard — 读客户生命周期。充值独有：钱没到账
                  (PAYIN_PENDING) 时闸门根本没跑，主值恒 PENDING、副行改说明原因。 */}
              <GateTile
                title="L1 · Eligibility"
                value={eligibilityStyle.label}
                caption={gatesNotEvaluated ? 'Not evaluated until payin lands' : 'Post-arrival check'}
                style={eligibilityStyle}
              />
              {/* L2: Transaction Screen — 充值只送一笔 Sumsub txn（finance 或
                  travelRule，按 `sumsubTxnType`）；前缀跟着类型走，verdict 是 webhook
                  原值（approved/rejected/onHold/awaitUser，不翻译）。 */}
              <GateTile
                title="L2 · Transaction Screen"
                value={`${data.sumsubTxnType === 'travelRule' ? 'Travel Rule' : 'Finance'}: ${
                  gatesNotEvaluated ? '—' : (data.sumsubVerdict ?? '—')
                }`}
                caption={`Score ${gatesNotEvaluated ? '—' : (data.sumsubScore ?? '—')}`}
                style={l2Style}
              />
              <div className="col-span-2 mt-2">
                <L1GateCard raw={data.l1Snapshot} />
              </div>
            </div>
          </DetailCard>
```

⚠️ 上游的 `const gatesNotEvaluated / eligibilityStyle / l2Style` **一行不动** —— 它们仍要算出来喂给 `GateTile`。

⚠️ `gatesNotEvaluated` 是充值**独有**的真实语义（闸门要等钱到账才跑），**保留**，不要为了三域一致把它抹掉。

- [ ] **Step 5: 提现接入**

加同一行 import。替换整块（anchor：`{/* 3. Compliance Layers */}`）：

```tsx
          {/* 3. Compliance Layers */}
          <DetailCard title="Compliance" columns={1}>
            <div className="grid grid-cols-2 gap-3">
              {/* L1: Eligibility Guard — 读客户生命周期。提现的闸门在建单前跑。 */}
              <GateTile
                title="L1 · Eligibility"
                value={eligibilityStyle.label}
                caption="Pre-creation check"
                style={eligibilityStyle}
              />
              {/* L2: Transaction Screen — 提现只送一笔 Sumsub txn（finance 或
                  travelRule，按 `sumsubTxnType`）。2026-08-23：前缀改成与充值同款的
                  人话（此前裸显后端字面量 `finance`），Score 从主值行挪到副行，
                  主值字号升到与 L1 同级。 */}
              <GateTile
                title="L2 · Transaction Screen"
                value={`${data.sumsubTxnType === 'travelRule' ? 'Travel Rule' : 'Finance'}: ${
                  data.sumsubVerdict ?? '—'
                }`}
                caption={`Score ${data.sumsubScore ?? '—'}`}
                style={l2Style}
              />
              <div className="col-span-2 mt-2">
                <L1GateCard raw={data.l1Snapshot} />
              </div>
            </div>
          </DetailCard>
```

- [ ] **Step 6: 兑换接入（含容器换成 `DetailCard`）**

加同一行 import。替换整块（anchor：`{/* 4. Compliance — L1 真实资格`）：

```tsx
          {/* 4. Compliance — L1 真实资格 + L2 KYT 单闸。
              L1 读客户 lifecycle（与 L1GateService 的 CUSTOMER_ELIGIBILITY 同一口径）；
              L2 读本单 KYT 终裁。
              兑换无 TR/大额门 —— L2 只有 KYT 一道，这是设计而非缺失（无对手方），
              所以 L2 前缀锁死 Finance，不做 travelRule 分支。
              2026-08-23：容器从手写 div+h3 换成 DetailCard，两个格子换成共用的
              GateTile —— 与充值/提现同一承载物（第五批 §3）。 */}
          <DetailCard title="Compliance" columns={1}>
            <div className="grid grid-cols-2 gap-3">
              <GateTile
                title="L1 · Eligibility"
                value={eligibilityStyle.label}
                caption="Pre-creation check"
                style={eligibilityStyle}
              />
              <GateTile
                title="L2 · Transaction Screen"
                value={`Finance: ${data.sumsubDetail?.verdict ?? '—'}`}
                caption={`Score ${data.sumsubDetail?.score ?? '—'}`}
                style={l2Style}
              />
              <div className="col-span-2 mt-2">
                <L1GateCard raw={data.l1Snapshot} />
              </div>
            </div>
          </DetailCard>
```

⚠️ **兑换原来的 L2 主值有一段 `data.complianceAction` 兜底逻辑**（`Scoring action: ...` / `Awaiting Sumsub verdict`）。上面的写法把它去掉了 —— 请先 `grep -n "complianceAction" admin-web/src/pages/SwapTransactionDetail.tsx` 确认它在别处还有没有用；**若全页只此一处用，`noUnusedLocals` 不会报（它是 `data` 的字段不是局部变量），但信息就丢了**。若你判断这个兜底有价值，把它并进 `caption`：
```tsx
caption={
  data.sumsubDetail?.score != null
    ? `Score ${data.sumsubDetail.score}`
    : data.complianceAction
      ? `Scoring action: ${data.complianceAction}`
      : 'Awaiting Sumsub verdict'
}
```
**两种都可以，选一种并在完成记录里写明选了哪种、为什么。**

⚠️ 兑换确认已 import `DetailCard`（`grep -n "DetailCard" admin-web/src/pages/SwapTransactionDetail.tsx`）。

- [ ] **Step 7: 跑测试确认变绿 + 变异**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts
```

变异（每个做一次、确认指定断言变红、**改回来**）：

| 变异 | 应该红的 |
|---|---|
| 兑换只换 L1、L2 留着内联 JSX | 第 1、2 条 |
| 兑换 L1 副行改回 `Pre-execution gate` | 第 3 条 |
| 兑换 L2 主值改回 `KYT: ...` | 第 4 条 |
| 兑换容器改回手写 `<div className="px-6 py-5">` | 第 5 条 |

⚠️ **变异要选编译得过的**。本项目踩过两次「类型系统吃掉变异」（`if (false)` 触发 TS18047、改字面量触发 TS2367）—— 上面四个都是纯文本差异，编译得过。

- [ ] **Step 8: 渲染验收**

起栈，找三笔**已有 Sumsub 裁决**的单（三域各一），并排截图，逐项核对：

- 三个页面的 L1 与 L2 两个格子**大小、字号、间距逐一相同**
- **L2 的主值与 L1 的主值一样大**（这是本 Task 的核心，改之前充值/提现的 L2 比 L1 小一档）
- 提现的 L2 显示 `Finance: approved` 而不是 `finance: approved`
- 兑换的 L2 显示 `Finance: ...` 而不是 `KYT: ...`
- 兑换的 `Compliance` 卡边框/内边距与另两域一致

再找一笔充值的 `PAYIN_PENDING` 单，确认 L1 显示 `Not evaluated until payin lands`、L2 显示 `Finance: —` / `Score —`（充值独有分支没被抹掉）。

- [ ] **Step 9: 五道闸门 + Commit**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit) && npx jest
```

```bash
git add admin-web/src/components/compliance/GateTile.tsx admin-web/src/pages/module-parity.spec.ts admin-web/src/pages/DepositTransactionDetail.tsx admin-web/src/pages/WithdrawTransactionDetail.tsx admin-web/src/pages/SwapTransactionDetail.tsx
git commit -m "refactor(parity): 抽 GateTile 收敛 L1/L2 闸门格子(三域六处)，兑换 Compliance 换 DetailCard"
```

---

## Task 2: `SumsubDetailSection` 合并

> 覆盖设计稿 §7。**三条合并里风险最低的一条。**

### 背景（已实证，与设计稿初版不同）

设计稿初版说「三份哈希全不同」是**错的** —— 那是 awk 取范围越界造成的假象。去掉注释与空白后逐字节比对：

| | 渲染体哈希 |
|---|---|
| 充值 | `a47bc04b629d` |
| 提现 | `a47bc04b629d` ← **与充值逐字节相同** |
| 兑换 | `05b8c2429786` |

而兑换那份与充值的完整 diff **只有一行实质差异**：

```diff
-  detail: SumsubTxnDetail | null | undefined;
+  detail: SwapSumsubDetail | null | undefined;
```

其余全是注释。四个字段标签（`Score` / `Verdict` / `Review Status` / `Review Answer`）与 props 名（`{ detail }`）三域完全一致。

**Files:**
- Create: `admin-web/src/components/compliance/SumsubDetailSection.tsx`
- Modify: `admin-web/src/pages/module-parity.spec.ts`
- Modify: 三个详情页

**Interfaces:**
- Consumes：Task 1 的 `module-parity.spec.ts`（已存在，往里加 describe）
- Produces：`export const SumsubDetailSection`（props `{ detail: SumsubDetailView | null | undefined }`）与 `export interface SumsubDetailView`

---

- [ ] **Step 1: 先把三份原文摆出来对照**

```bash
cd admin-web/src/pages
for f in DepositTransactionDetail WithdrawTransactionDetail SwapTransactionDetail; do
  echo "=== $f ==="
  awk '/const SumsubDetailSection = /,/^};|^\);/' $f.tsx
done
```

**逐行读一遍**，确认下面第 3 步的合并版没有漏掉任何一域的渲染分支。若发现某域有独有分支（当前实证是没有），**停下来报告**，不要静默丢弃。

- [ ] **Step 2: 写失败的测试**

追加到 `admin-web/src/pages/module-parity.spec.ts`：

```ts
describe('规则① 同一职责同一组件 · SumsubDetailSection（Task 2）', () => {
  it('三个详情页都不再本地定义 SumsubDetailSection', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      expect([domain, srcOf(file).includes('const SumsubDetailSection = ')]).toEqual([domain, false]);
    }
  });

  it('三个详情页都从共享路径 import 它', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, /import \{[^}]*SumsubDetailSection[^}]*\} from '\.\.\/components\/compliance\/SumsubDetailSection'/.test(src)]).toEqual([domain, true]);
    }
  });

  it('三个详情页仍各渲染它一次（合并不等于删功能）', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const n = (srcOf(file).match(/<SumsubDetailSection\b/g) ?? []).length;
      expect([domain, n]).toEqual([domain, 1]);
    }
  });
});
```

> 第 3 条是防「合并时手滑把某域的调用一起删了」—— 只有前两条的话，把整块删掉测试反而更绿。

- [ ] **Step 3: 跑，确认真失败**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "SumsubDetailSection"
```

预期：第 1、2 条 FAIL，第 3 条 PASS（现在确实各渲染一次）。

- [ ] **Step 4: 建共享件**

新建 `admin-web/src/components/compliance/SumsubDetailSection.tsx`：

```tsx
import { InfoField } from './DetailPageComponents';

/** Sumsub getTxn scoring result 里的一条命中规则。充值/提现/兑换三域此前各自
 *  声明过一份（`SumsubMatchedRule` / `SwapMatchedRule`），四个键逐字段同形。 */
export interface SumsubMatchedRuleView {
  id?: string;
  name?: string;
  action?: string;
  score?: number;
}

/**
 * 三域共用的 Sumsub getTxn 报告只读入参。
 *
 * 这是**公共父类型**、不是任何一域的 DTO：字段全部可选，各域自己的
 * `SumsubTxnDetail`（充值/提现）与 `SwapSumsubDetail`（兑换，多带 txnIdOut/txnIdIn）
 * 靠结构化子类型直接可赋值进来，**不需要改各页面里的 DTO 声明** —— 那些 DTO 还带
 * 域内独有字段（兑换的双腿 txnId 由 References 卡消费），必须留在各自页面。
 */
export interface SumsubDetailView {
  verdict?: string | null;
  reviewStatus?: string | null;
  reviewAnswer?: string | null;
  score?: number | null;
  matchedRules?: SumsubMatchedRuleView[] | null;
  applicantActionIds?: string[] | null;
  raw?: unknown;
}

/**
 * 渲染某一笔交易解析后的 Sumsub getTxn 报告。三域（充值/提现/兑换）共用同一个
 * 承载物 —— 合并前三份本地副本的渲染体逐字节相同，唯一差异是 props 的类型名
 * （第五批 §7 实证）。本组件内部没有任何按域分支。
 *
 * 四个标量字段一律出行：「没有值」的表现交给 `InfoField` 自己的空值占位（`—`），
 * 这正是合并前三域的既有行为。不要在它之上再叠一层「字段缺席就抽掉整行」——
 * 那会把「Sumsub 还没打分」这条信息从卡上抹掉，且格子位置会跳。
 */
export const SumsubDetailSection = ({
  detail,
}: {
  detail: SumsubDetailView | null | undefined;
}) => {
  const matchedRules = detail?.matchedRules ?? [];
  const applicantActionIds = detail?.applicantActionIds ?? [];

  if (!detail) {
    return <p className="font-mono text-[11px] text-adm-t3">No Sumsub transaction detail yet</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <InfoField label="Score" value={detail.score} mono />
        <InfoField label="Verdict" value={detail.verdict} />
        <InfoField label="Review Status" value={detail.reviewStatus} />
        <InfoField label="Review Answer" value={detail.reviewAnswer} />
      </div>
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Matched Rules</div>
        {matchedRules.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {matchedRules.map((r, idx) => (
              <li key={r.id ?? idx} className="font-mono text-[11px] text-adm-t1">
                {r.name ?? '—'} · {r.action ?? '—'} · {r.score ?? '—'}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-1 font-mono text-[11px] text-adm-t3">—</div>
        )}
      </div>
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Applicant Action IDs</div>
        <div className="mt-1 font-mono text-[11px] text-adm-t1">
          {applicantActionIds.length > 0 ? applicantActionIds.join(', ') : '—'}
        </div>
      </div>
      <details>
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">
          Raw payload
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-gray-900 p-3 font-mono text-[11px] text-gray-100">
          {JSON.stringify(detail.raw, null, 2)}
        </pre>
      </details>
    </div>
  );
};
```

⚠️ **上面这份是按 Step 1 读到的原文重写的**。若你在 Step 1 发现原文与此不同（例如 `InfoField` 的 props 名、栅格类名、`details/summary` 的结构），**以原文为准**，把差异改进来，别照抄本计划 —— 本计划的这段是重建，不是逐字复制。

- [ ] **Step 5: 三域改用共享件**

每个详情页做三件事：
1. **删掉**本地的 `const SumsubDetailSection = ...` 整块
2. 加 import：`import { SumsubDetailSection } from '../components/compliance/SumsubDetailSection';`
3. 调用处**不改**（props 名仍是 `detail`）

⚠️ 删完后，本地那份用到的类型（`SumsubMatchedRule` / `SwapMatchedRule`）与 `InfoField` 可能变成未用 → `noUnusedLocals` 编译失败。**逐个清**：

```bash
cd admin-web && npx tsc -b --noEmit
```
按报错清理。**若某个类型别处还在用（例如页面的 DTO 声明里），保留。**

- [ ] **Step 6: 跑测试 + 变异**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "SumsubDetailSection"
```

| 变异 | 应该红的 |
|---|---|
| 在兑换页保留本地定义（不删） | 第 1 条 |
| 把兑换的 import 路径改成相对本地 | 第 2 条 |
| 删掉兑换的 `<SumsubDetailSection ... />` 调用 | 第 3 条 |

- [ ] **Step 7: 渲染验收**

三个详情页并排，找**有 Sumsub 报告**的单，确认：四个字段、Matched Rules、Applicant Action IDs、Raw payload 折叠块三域一模一样；再找**没有报告**的单，确认三域都显示 `No Sumsub transaction detail yet`。

- [ ] **Step 8: 五道闸门 + Commit**

```bash
git add admin-web/src && git commit -m "refactor(parity): 合并三份 SumsubDetailSection 为共享件(渲染体本就逐字节相同)"
```

---

## Task 3: `StatusTimeline` 合并 —— ⚠️ 不是「挑一份留下」

> 覆盖设计稿 §8。**三条合并里唯一有真实质量差异的一条。**

### 背景（已实证：三份是三个不同版本）

| | 非数组守卫 | 排序 | 日期兜底 | 读 note/reason | 读 operator |
|---|---|---|---|---|---|
| 充值 | ❌ 无 | 原地 `sort`（改原数组） | ❌ 无 | 只读 `item.reason` | `operatorId \|\| actorType` |
| 提现 | ❌ 无 | 原地 | ❌ 无 | `note \|\| reason` ✅ | `operator \|\| operatorId \|\| actorType` ✅ |
| 兑换 | ✅ `Array.isArray` | `[...parsed].sort` 不可变 ✅ | ✅ `\|\| 0` | `note \|\| reason` ✅ | `operator \|\| operatorId` |

**充值那份如果 `statusHistory` 存进非数组 JSON，`history.sort` 直接抛错、整页白屏。**

后端三域实际写入形状（已实证）：

| 域 | 写入字段 |
|---|---|
| 充值 | `status, timestamp, operatorId, actorType, actorRole, reason, context` |
| 提现 | `status, timestamp, operator, note` |
| 兑换 | `status, timestamp, operator, note` |

→ `item.note || item.reason` 与 `item.operator || item.operatorId || item.actorType` **三种形状全覆盖**，合并后读字段可以完全统一，不需要按域分支。

**合并规则：取兑换的守卫 ＋ 提现的字段兜底链 ＋ 各域自己的 `get*StatusMeta` 作为入参。**

**Files:**
- Create: `admin-web/src/components/compliance/StatusTimeline.tsx`
- Modify: `admin-web/src/pages/module-parity.spec.ts`
- Modify: 三个详情页

**Interfaces:**
- Produces：`export const StatusTimeline` —— props `{ historyJson: string | null; getStatusMeta: (status: string) => { badgeClass: string; label: string } }`

---

- [ ] **Step 1: 先确认三个 `get*StatusMeta` 的返回类型能统一**

```bash
grep -n "export const getDepositStatusMeta\|export const getWithdrawStatusMeta\|export const getSwapStatusMeta" -A 6 admin-web/src/utils/{deposit,withdraw,swap}StatusMap.ts
```

需要确认三者返回的对象**都有 `badgeClass` 与 `label`**（本计划的 props 只用这两个字段）。

⚠️ **若三者返回类型不一致（例如某个没有 `label`），停下来报告** —— 那会让统一签名变成需要额外适配层，是本 Task 的前提被推翻。

- [ ] **Step 2: 写失败的测试**

追加到 `module-parity.spec.ts`：

```ts
describe('规则① 同一职责同一组件 · StatusTimeline（Task 3）', () => {
  it('三个详情页都不再本地定义 StatusTimeline', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      expect([domain, srcOf(file).includes('const StatusTimeline = ')]).toEqual([domain, false]);
    }
  });

  it('三个详情页都从共享路径 import，且各渲染一次', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, src.includes("from '../components/compliance/StatusTimeline'")]).toEqual([domain, true]);
      expect([domain, (src.match(/<StatusTimeline\b/g) ?? []).length]).toEqual([domain, 1]);
    }
  });

  /* 三域各传自己的 statusMeta —— 传错域会让颜色/文案串味（改之前兑换那份
     硬编码绿色，同一条 FROZEN 事件充值页红、兑换页绿）。 */
  it('三域各传自己域的 getStatusMeta', () => {
    expect(srcOf(DETAIL_PAGES.DEPOSIT).replace(/\s+/g, ' ')).toContain('getStatusMeta={getDepositStatusMeta}');
    expect(srcOf(DETAIL_PAGES.WITHDRAW).replace(/\s+/g, ' ')).toContain('getStatusMeta={getWithdrawStatusMeta}');
    expect(srcOf(DETAIL_PAGES.SWAP).replace(/\s+/g, ' ')).toContain('getStatusMeta={getSwapStatusMeta}');
  });
});

describe('合并后的 StatusTimeline 保住了最健壮那份的守卫（Task 3）', () => {
  const shared = readFileSync(
    join(__dirname, '..', 'components', 'compliance', 'StatusTimeline.tsx'),
    'utf8',
  ).replace(/\s+/g, ' ');

  /* 合并前充值那份没有这三样，statusHistory 存进非数组 JSON 会整页白屏。
     这三条钉住「合并时取的是最健壮的一份，不是随便挑一份」。 */
  it('有非数组守卫', () => {
    expect(shared).toContain('Array.isArray');
  });
  it('排序不可变（不原地改传入数组）', () => {
    expect(shared).toContain('[...parsed].sort');
  });
  it('日期有兜底', () => {
    expect(shared).toContain('|| 0');
  });
  it('读字段覆盖三域三种后端写入形状', () => {
    expect(shared).toContain('item.note || item.reason');
    expect(shared).toContain('item.operator || item.operatorId || item.actorType');
  });
});
```

- [ ] **Step 3: 跑，确认真失败**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "StatusTimeline"
```

预期：第一组 3 条 FAIL；第二组会因为**文件不存在**整个 suite 报错 —— 这是对的，建完文件就好。

- [ ] **Step 4: 建共享件**

新建 `admin-web/src/components/compliance/StatusTimeline.tsx`：

```tsx
import { User } from 'lucide-react';

/** `get*StatusMeta()` 返回值里本组件用到的两个字段。三域各传自己的函数。 */
export interface StatusMetaView {
  badgeClass: string;
  label: string;
}

/**
 * 订单状态历史时间线（充值 / 提现 / 兑换三域共用）。
 *
 * 合并自三份已漂移的本地副本（第五批 §8）。合并规则不是「挑一份留下」：
 *   · 守卫取兑换那份 —— Array.isArray + 不可变排序 + 日期兜底。合并前充值那份
 *     没有这三样，statusHistory 存进非数组 JSON 会让 sort 抛错、整页白屏。
 *   · 读字段取提现那份的兜底链，并补上 actorType —— 后端三域写入形状不同：
 *       充值 {status, timestamp, operatorId, actorType, actorRole, reason, context}
 *       提现 {status, timestamp, operator, note}
 *       兑换 {status, timestamp, operator, note}
 *     下面的 || 链把三种全覆盖，所以本组件内部不需要按域分支。
 *   · 颜色与文案由各域传进来的 getStatusMeta 决定 —— 合并前兑换那份硬编码
 *     bg-adm-green，同一条 FROZEN 事件充值页红、兑换页绿。
 */
export const StatusTimeline = ({
  historyJson,
  getStatusMeta,
}: {
  historyJson: string | null;
  getStatusMeta: (status: string) => StatusMetaView;
}) => {
  if (!historyJson) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
  }

  let history: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(historyJson);
    if (!Array.isArray(parsed)) {
      return <div className="p-4 text-center text-sm italic text-adm-t3">No history available</div>;
    }
    history = [...parsed].sort(
      (a, b) =>
        new Date(b.timestamp || b.changedAt || 0).getTime() -
        new Date(a.timestamp || a.changedAt || 0).getTime(),
    );
  } catch {
    return <div className="p-4 text-sm text-adm-red">Error parsing history</div>;
  }

  if (history.length === 0) {
    return <div className="p-4 text-center text-sm italic text-adm-t3">No events</div>;
  }

  return (
    <div className="relative my-2 ml-4 space-y-6 border-l-2 border-adm-border">
      {history.map((item, idx) => (
        <div key={`${item.timestamp || item.changedAt || idx}`} className="relative ml-8">
          <span className="absolute -left-[44px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-adm-panel ring-4 ring-adm-panel">
            <div className={`h-3 w-3 rounded-full ${getStatusMeta(item.status).badgeClass}`} />
          </span>
          <div className="rounded-lg border border-adm-border bg-adm-bg p-3 transition-colors hover:bg-adm-hover">
            <div className="flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${getStatusMeta(item.status).badgeClass}`}>
                {getStatusMeta(item.status).label}
              </span>
            </div>
            <p className="mt-1 text-sm text-adm-t2">
              {item.note || item.reason || 'No reason provided'}
            </p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-adm-t3">
              <User size={10} />
              <span className="font-mono">
                {item.operator || item.operatorId || item.actorType || 'SYSTEM'}
              </span>
              <span>·</span>
              <span className="font-mono">
                {new Date(item.timestamp || item.changedAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
```

- [ ] **Step 5: 三域改用共享件**

每个详情页：
1. 删掉本地 `const StatusTimeline = ...` 整块
2. 加 `import { StatusTimeline } from '../components/compliance/StatusTimeline';`
3. 调用处补 `getStatusMeta` 入参：
   - 充值：`<StatusTimeline historyJson={data.statusHistory} getStatusMeta={getDepositStatusMeta} />`
   - 提现：`getStatusMeta={getWithdrawStatusMeta}`
   - 兑换：`getStatusMeta={getSwapStatusMeta}`
4. 确认各页已 import 自己的 `get*StatusMeta`；**兑换很可能没 import**，要补

⚠️ 删完后 `User` 图标（`lucide-react`）在页面里可能变成未用 → `noUnusedLocals` 红。跑 `cd admin-web && npx tsc -b --noEmit` 逐个清。**但若页面别处还用 `User`，保留。**

⚠️ 调用处的 prop 名是 `historyJson`，三域现状可能写法不同（有的可能直接传 `data.statusHistory`）—— **先 grep 现状再改**。

- [ ] **Step 6: 跑测试 + 变异**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "StatusTimeline"
```

| 变异 | 应该红的 |
|---|---|
| 共享件里删掉 `if (!Array.isArray(parsed))` 那三行 | 第二组「有非数组守卫」 |
| `[...parsed].sort` 改回 `parsed.sort` | 第二组「排序不可变」 |
| `item.note \|\| item.reason` 改回 `item.reason` | 第二组「读字段覆盖」 |
| 兑换调用处传 `getDepositStatusMeta` | 第一组第 3 条 |

- [ ] **Step 7: 渲染验收（本 Task 最直观的证据）**

找三笔**状态流转过多次**的单，其中**必须有一笔兑换的 `FROZEN` 单**。并排截图确认：

- 同一状态三域**同色**（改之前兑换所有事件恒绿）
- 徽章显示**人话 label**（`COMPLIANCE PENDING`）而不是原始枚举（`COMPLIANCE_PENDING`）
- **兑换的 `FROZEN` 是红的**（改之前是绿的）
- 操作人与时间三域格式一致

- [ ] **Step 8: 五道闸门 + Commit**

```bash
git add admin-web/src && git commit -m "refactor(parity): 合并三份 StatusTimeline(取兑换的守卫+提现的字段兜底)，修兑换事件恒绿+显示原始枚举"
```

---

## Task 4: 侧栏收敛（兑换删两块 + `Identity` 统一 4 行）

> 覆盖设计稿 §5。业主：「侧边栏是操作和次要信息载体，那么结构应该一样。」

### 目标结构（三域恒定）

```
【操作段】 处置组 —— 按订单状态条件出现
【信息段】 SLA → Identity → Lifecycle
```

| | 操作段 | 信息段 |
|---|---|---|
| 充值 | `Ops Disposition` + `Frozen Disposition` | SLA → Identity → Lifecycle |
| 提现 | `Payout Disposition` + `Frozen Disposition` | SLA → Identity → Lifecycle |
| 兑换 | **整段为空** | SLA → Identity → Lifecycle |

三域信息段真实顺序**已实测确认都是 SLA → Identity → Lifecycle**，本 Task 不需要重排 —— 兑换删掉两块之后顺序自然就对了。

**本轮一个 disposition 按钮都不增删**（充值 5、提现 3、兑换 0）。

**Files:**
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`
- Modify: `admin-web/src/pages/module-parity.spec.ts`

**Interfaces:** 无跨 Task 接口

---

- [ ] **Step 1: 写失败的测试**

追加到 `module-parity.spec.ts`：

```ts
describe('规则③ 侧栏结构必须一样（Task 4）', () => {
  /** 抽出侧栏区（从 w-[272px] 到文件末）里 SidebarGroup 的 title，按出现顺序。 */
  const sidebarGroupsOf = (file: string): string[] => {
    const src = srcOf(file);
    const i = src.indexOf('w-[272px]');
    if (i < 0) throw new Error(`${file}: 找不到侧栏容器`);
    return [...src.slice(i).matchAll(/<SidebarGroup title="([^"]*)"/g)].map((m) => m[1]);
  };

  it('三域信息段逐字相同：SLA → Identity → Lifecycle', () => {
    const INFO = ['SLA', 'Identity', 'Lifecycle'];
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const tail = sidebarGroupsOf(file).slice(-3);
      expect([domain, tail]).toEqual([domain, INFO]);
    }
  });

  it('兑换操作段为空 —— 侧栏只有信息段三组', () => {
    expect(sidebarGroupsOf(DETAIL_PAGES.SWAP)).toEqual(['SLA', 'Identity', 'Lifecycle']);
  });

  /* 反面断言：兑换的 Ops Disposition 装的是客户合规信息（Restrictions / Hard Line），
     业主裁定「客户合规信息不放在订单里」。这条钉住它不会被谁"顺手加回来"。 */
  it('兑换侧栏不再出现客户级合规信息', () => {
    const swap = srcOf(DETAIL_PAGES.SWAP);
    expect(swap).not.toContain('label="Restrictions"');
    expect(swap).not.toContain('label="Hard Line"');
    expect(swap).not.toContain('<SidebarGroup title="Frozen Disposition">');
  });

  it('三域 Identity 都是纯身份 4 行，且第 4 行按域给（充值/提现 Asset、兑换 Pair）', () => {
    const identityKVsOf = (file: string): string[] => {
      const src = srcOf(file);
      const i = src.indexOf('<SidebarGroup title="Identity">');
      const j = src.indexOf('</SidebarGroup>', i);
      return [...src.slice(i, j).matchAll(/<SidebarKV\s+label="([^"]*)"/g)].map((m) => m[1]);
    };
    expect(['DEPOSIT', identityKVsOf(DETAIL_PAGES.DEPOSIT)]).toEqual(
      ['DEPOSIT', ['Deposit No', 'Owner', 'Owner Type', 'Asset']]);
    expect(['WITHDRAW', identityKVsOf(DETAIL_PAGES.WITHDRAW)]).toEqual(
      ['WITHDRAW', ['Withdraw No', 'Owner', 'Owner Type', 'Asset']]);
    expect(['SWAP', identityKVsOf(DETAIL_PAGES.SWAP)]).toEqual(
      ['SWAP', ['Swap No', 'Owner', 'Owner Type', 'Pair']]);
  });
});
```

⚠️ 第 4 条会顺带验出充值/提现的 Identity 是不是真的 4 行 —— **实测它们已经是**，所以那两条应当一开始就 PASS。**只有兑换那条该红。**

- [ ] **Step 2: 跑，确认失败的是该失败的那几条**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "侧栏结构"
```

预期：第 1 条 SWAP 红（尾三组是 `Frozen Disposition, Ops Disposition, Lifecycle`）、第 2 条红、第 3 条红、第 4 条只有 SWAP 红。

- [ ] **Step 3: 兑换 —— 删 `Frozen Disposition` 与 `Ops Disposition` 两整块**

两块在文件里**紧邻**。用 anchor `<SidebarGroup title="Frozen Disposition">` 定位，往下一直删到 `<SidebarGroup title="Lifecycle">` **之前**（含它们各自的外层条件渲染与上方注释块）。

删除范围的起点是这段注释：
```tsx
          {/* Frozen Disposition —— 兑换的 FROZEN 是零出边终态 …
```
终点是 `<SidebarGroup title="Lifecycle">` 的前一行。

⚠️ **删的时候连同上方的注释块一起删** —— 那两段注释讲的就是被删掉的东西，留着是悬空说明。

⚠️ 删完确认侧栏剩下的是 `SLA → Identity → Lifecycle` 三组，中间不留空行。

- [ ] **Step 4: 兑换 —— 清理变成未用的 `restrictionCaps`**

`restrictionCaps` 的唯一消费点就是刚删掉的 `Ops Disposition`，留着必报 TS6133。

用 anchor `const restrictionCaps: string[] = Array.from(` 定位，**连同它上方那 5 行注释一起删**。

⚠️ **只删这一个。** `ownerNo`、`ownerLink`、`isTerminal` 都还有别的消费点，一个都不能删。

⚠️ **不要删兑换的 `AdminBadge` import** —— `LegAttemptRow` 里 `<AdminBadge value={status} />` 还在用。

- [ ] **Step 5: 兑换 —— `Identity` 收敛为纯身份 4 行**

替换整块（anchor：`<SidebarGroup title="Identity">`），目标：

```tsx
          <SidebarGroup title="Identity">
            <SidebarKV label="Swap No" value={data.swapNo} mono />
            <SidebarKV label="Owner" value={ownerLink} />
            <SidebarKV label="Owner Type" value={data.ownerType} />
            <SidebarKV label="Pair" value={pairDisplay} />
          </SidebarGroup>
```

⚠️ **`ownerLink` / `pairDisplay` 用文件里已有的那两个局部变量** —— 先 `grep -n "ownerLink\|pairDisplay\|Pair" admin-web/src/pages/SwapTransactionDetail.tsx` 确认它们的真实名字与形状，**不要照抄本计划的变量名**。

⚠️ 删掉的是 `Status` / `Current Stage` / `Net Received` / `Needs Review` 四行：
- `Status` / `Current Stage` —— Hero 已显示
- `Net Received` —— `Conversion` 卡已显示
- `Needs Review` —— 改走顶部横幅（Task 5）

**四项信息一条都没丢**，只是不再在侧栏重复。

⚠️ `data.ownerType` 已实证存在（`SwapTransactionDetailData` 有 `ownerType: string`，DB 有该列，`findOne` 用 `include` 不裁字段）—— **零后端改动**。

⚠️ `SidebarKV` 对空值会**整行不渲染**（`SidebarPrimitives.tsx` 里 `if (value === null || undefined || '') return null`）。所以「4 行」实为「最多 4 行」，三域行为一致，不是缺陷。

- [ ] **Step 6: 跑测试确认变绿 + 变异**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "侧栏结构"
```

| 变异 | 应该红的 |
|---|---|
| 把兑换的 `Ops Disposition` 整块加回来 | 第 1、2、3 条 |
| 兑换 Identity 里加回 `Status` 一行 | 第 4 条 |
| 兑换 Identity 的 `Pair` 改成 `Asset` | 第 4 条 |

- [ ] **Step 7: 渲染验收**

三个详情页并排截图，逐项核对：

- 三个侧栏**从下往上数三组都是 Lifecycle / Identity / SLA**
- **兑换侧栏只有三组**（没有任何处置卡）
- 三个 Identity 都是 4 行，前三行标签一致，第 4 行充值/提现是 `Asset`、兑换是 `Pair`
- 找一笔兑换的 `FROZEN` 单，确认侧栏**不再有** `Frozen Disposition` 那段中文说明

- [ ] **Step 8: 五道闸门 + Commit**

```bash
git add admin-web/src && git commit -m "refactor(parity): 侧栏三域同构 —— 兑换删两块假处置卡(客户合规信息不属订单)，Identity 统一纯身份4行"
```

---

## Task 5: `needsReview` 统一为顶部横幅（抽共享件）

> 覆盖设计稿 §6。业主：「need review 放 hero 里面。」

### 现状（三域三样，且 markup 也不一致）

| | 顶部横幅 | 侧栏 KV |
|---|---|---|
| 充值 | ❌ | ✅ 在 `Lifecycle` |
| 提现 | ✅ | ❌ |
| 兑换 | ✅ | ✅ 在 `Identity`（Task 4 已删） |

两份现有横幅的 markup 还不一样：
```
提现  shrink-0 border-b border-adm-border bg-adm-red/5  px-6 py-2.5 …          无图标
兑换  flex items-center gap-2 border-b border-adm-border bg-adm-red/10 px-6 py-2 …  + AlertTriangle
```

按规则①，这是同一职责的模块 → 抽共享件。

### ⚠️ 文案必须按域给，不能照抄

| 域 | `needsReview` 的真实语义 |
|---|---|
| 充值 | **处置资金腿重试三级梯耗尽、单子卡在原地**（`deposit-workflow.service.ts` 三处 `markNeedsReview`，对应 CONFISCATING / RETURNING / SEIZING） |
| 提现 | 放款已广播后才到的 KYT 裁决，没有合法边可走 |
| 兑换 | 成交后才到的 KYT 裁决，订单终态不可逆 |

**充值那句照抄提现会说错话。**

**Files:**
- Create: `admin-web/src/components/compliance/NeedsReviewBanner.tsx`
- Modify: 三个详情页
- Modify: `admin-web/src/pages/module-parity.spec.ts`

**Interfaces:**
- Produces：`export const NeedsReviewBanner` —— props `{ show: boolean; message: string }`

---

- [ ] **Step 1: 写失败的测试**

追加到 `module-parity.spec.ts`：

```ts
describe('规则① 同一职责同一组件 · needsReview 横幅（Task 5）', () => {
  it('三域都用共享的 NeedsReviewBanner，各一次', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, src.includes("from '../components/compliance/NeedsReviewBanner'")]).toEqual([domain, true]);
      expect([domain, (src.match(/<NeedsReviewBanner\b/g) ?? []).length]).toEqual([domain, 1]);
    }
  });

  /* 反面断言：手写横幅与侧栏 KV 都必须消失。业主裁定这面旗只在页顶出现一次。 */
  it('三域都不再手写横幅、也不再有 needsReview 侧栏 KV', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, src.includes('bg-adm-red/5 px-6 py-2.5')]).toEqual([domain, false]);
      expect([domain, src.includes('bg-adm-red/10 px-6 py-2 ')]).toEqual([domain, false]);
      expect([domain, src.includes('label="Needs Review"')]).toEqual([domain, false]);
    }
  });

  /* 三域文案必须**不同** —— 三个域的 needsReview 语义不是一回事，
     照抄会说错话（充值那面旗是资金腿重试耗尽，不是迟到的 KYT 裁决）。 */
  it('三域文案各不相同', () => {
    const msgOf = (file: string) => {
      const m = srcOf(file).replace(/\s+/g, ' ').match(/<NeedsReviewBanner[^>]*message=\{?["'`]([^"'`]+)/);
      return m?.[1] ?? '';
    };
    const msgs = Object.values(DETAIL_PAGES).map(msgOf);
    expect(msgs.every((m) => m.length > 0)).toBe(true);
    expect(new Set(msgs).size).toBe(3);
  });
});
```

- [ ] **Step 2: 跑，确认真失败**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "needsReview 横幅"
```

- [ ] **Step 3: 建共享件**

新建 `admin-web/src/components/compliance/NeedsReviewBanner.tsx`：

```tsx
import { AlertTriangle } from 'lucide-react';

/**
 * 「这单卡住了，要人看」的顶部横幅（充值 / 提现 / 兑换三域共用）。
 *
 * 业主定的形态：这面旗只在页顶出现一次，不埋进侧栏 KV（第五批 §6）。
 * 合并前三域三样：充值只有侧栏 KV 没有横幅、提现有横幅无图标、兑换有横幅带图标，
 * 连底色浓度和内边距都不同（bg-adm-red/5 + py-2.5 vs bg-adm-red/10 + py-2）。
 *
 * ⚠️ 文案由各域传入，**不是共用一句** —— 三个域的 needsReview 语义不同：
 *   充值 = 处置资金腿重试三级梯耗尽、单子卡在原地
 *   提现 = 放款已广播后才到的 KYT 裁决，没有合法边可走
 *   兑换 = 成交后才到的 KYT 裁决，订单终态不可逆
 * 共用一句会说错话。
 */
export const NeedsReviewBanner = ({ show, message }: { show: boolean; message: string }) => {
  if (!show) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-adm-border bg-adm-red/10 px-6 py-2.5 font-mono text-[11px] text-adm-red">
      <AlertTriangle size={12} className="shrink-0" />
      {message}
    </div>
  );
};
```

> 底色取兑换的 `/10`（更醒目，这面旗就是要人看见），内边距取提现的 `py-2.5`，图标保留，并给图标补 `shrink-0`（长文案换行时图标不会被压扁）。

- [ ] **Step 4: 三域接入**

三处都插在**同一位置**：Notice 之后、Body 之前。

充值（anchor：`{/* ── Confiscation in-transit banner ── */}`，插在它之前）：
```tsx
      <NeedsReviewBanner
        show={!!data.needsReview}
        message="Needs review — a disposition leg exhausted its retries; the order is parked and needs manual intervention"
      />
```

提现（替换现有手写横幅整块）：
```tsx
      <NeedsReviewBanner
        show={!!data.needsReview}
        message="Needs review — a KYT verdict arrived after the payout broadcast; no automatic action was taken"
      />
```

兑换（替换现有手写横幅整块，连同上方注释）：
```tsx
      <NeedsReviewBanner
        show={!!data.needsReview}
        message="Needs review — a KYT verdict arrived after approval/execution; no automatic action was taken on this order"
      />
```

三处都加 import：`import { NeedsReviewBanner } from '../components/compliance/NeedsReviewBanner';`

- [ ] **Step 5: 删充值的侧栏 `Needs Review` KV + 清 import**

充值 `Lifecycle` 组里那行 `<SidebarKV label="Needs Review" ... />` 删掉。

⚠️ 删完后 **充值的 `AdminBadge` import 变成零消费**（全文件只有 import + 这一处），必须一起删，否则 TS6133 编译失败。

先确认：
```bash
grep -c "AdminBadge" admin-web/src/pages/DepositTransactionDetail.tsx
```
若删 KV 后只剩 import 那一处，把 import 也删掉。

⚠️ **兑换的 `AdminBadge` import 不要删** —— `LegAttemptRow` 还在用。

⚠️ 兑换的侧栏 `Needs Review` KV 在 Task 4 已删，本 Task 不用再动。

- [ ] **Step 6: 跑测试 + 变异**

| 变异 | 应该红的 |
|---|---|
| 三域文案改成同一句 | 第 3 条 |
| 充值不加横幅（只删 KV） | 第 1 条 |
| 提现保留手写横幅 | 第 2 条 |

- [ ] **Step 7: 渲染验收**

找三笔 `needsReview = true` 的单（三域各一），并排截图确认：

- 三个页面**同一位置**出现红色横幅，底色/高度/图标一致
- **文案各不相同**且各自说的是自己域的事
- 三个侧栏都**没有** `Needs Review` 那一行

⚠️ 造 `needsReview` 单的办法：兑换用 `⑦ 硬线` 之类的裁决按钮；充值要造资金腿重试耗尽比较难，**若造不出来，用 SQL 直接把某单的 `needsReview` 置 true**（本栈是隔离 DB，随便改）：
```bash
sqlite3 /tmp/exchange_js_wt_parity5/dev.db "update deposit_transactions set needsReview=1 where depositNo=(select depositNo from deposit_transactions limit 1);"
```
（DB 路径以 `bash scripts/stack.sh status` 显示的为准。）

- [ ] **Step 8: 五道闸门 + Commit**

```bash
git add admin-web/src && git commit -m "refactor(parity): 抽 NeedsReviewBanner 三域共用，充值补横幅、删两处侧栏 KV，文案按域给"
```

---

## Task 6: 兑换 `Technical` 卡归位

> 覆盖设计稿 §9。

### 背景

兑换的交易信息拆成 `Conversion` + `Pricing` + `Technical` 三张卡（**业主认可，内容差异**），但 `Technical` 被甩到了 `Verification Requests` **之后**，离它的两张兄弟卡隔了 6 张卡：

```
Conversion → Pricing → Sumsub References → Sumsub Transaction Detail
→ Internal Approvals → Linked Funds Orders → Status History
→ Verification Requests → Technical ← 在这
```

充值/提现的对应模块是单张 `Transaction Details`，排在第 1 位。

**目标**：`Technical` 挪到 `Pricing` 之后，三张卡连续，与充值/提现的「交易信息在最前」对齐。

**Files:**
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`
- Modify: `admin-web/src/pages/module-parity.spec.ts`

**Interfaces:** 无

---

- [ ] **Step 1: 写失败的测试**

追加到 `module-parity.spec.ts`：

```ts
describe('规则② 内容差异允许，但同族卡片要连续（Task 6）', () => {
  /** 抽出主列 DetailCard 的 title，按出现顺序。 */
  const mainCardsOf = (file: string): string[] =>
    [...srcOf(file).matchAll(/<DetailCard\s+title="([^"]*)"/g)].map((m) => m[1]);

  it('兑换的交易信息三张卡连续出现在最前', () => {
    const cards = mainCardsOf(DETAIL_PAGES.SWAP);
    expect(cards.slice(0, 3)).toEqual(['Conversion', 'Pricing', 'Technical']);
  });

  it('充值/提现的交易信息卡也在最前（对照组，本轮不改）', () => {
    expect(mainCardsOf(DETAIL_PAGES.DEPOSIT)[0]).toBe('Transaction Details');
    expect(mainCardsOf(DETAIL_PAGES.WITHDRAW)[0]).toBe('Transaction Details');
  });
});
```

- [ ] **Step 2: 跑，确认第 1 条失败、第 2 条通过**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "同族卡片"
```

预期：第 1 条 FAIL（`Technical` 不在前三）；第 2 条 PASS（对照组现状就对）。

- [ ] **Step 3: 挪卡**

把 `<DetailCard title="Technical" ...>` 整块（含上方注释）从 `Verification Requests` 之后剪切，粘到 `<DetailCard title="Pricing" ...>` 整块之后。

⚠️ **只挪位置，一个字段都不改。**

⚠️ 挪之前先 `grep -n '<DetailCard title=' admin-web/src/pages/SwapTransactionDetail.tsx` 把当前顺序抄下来，挪完再 grep 一次对照。

- [ ] **Step 4: 跑测试确认变绿 + 变异**

| 变异 | 应该红的 |
|---|---|
| 把 `Technical` 挪回原位 | 第 1 条 |
| 把 `Pricing` 与 `Technical` 换个位置 | 第 1 条 |

- [ ] **Step 5: 渲染验收**

兑换详情页截图，确认 `Conversion` / `Pricing` / `Technical` 三张卡**连续挨着**，其后是 `Compliance`。与充值/提现并排，确认「交易信息在最前」这条对齐。

- [ ] **Step 6: 五道闸门 + Commit**

```bash
git add admin-web/src && git commit -m "refactor(parity): 兑换 Technical 卡归位到 Pricing 之后，交易信息三卡连续"
```

---

## Task 7: `⚡ Simulation` 三域常显 + 终态置灰

> 覆盖设计稿 §9。

### 背景

```
充值   {simEnabled && (
提现   {simEnabled && (
兑换   {simEnabled && data.status === 'COMPLIANCE_PENDING' && (   ← 整块消失
```

兑换那个条件**有真实理由**（终态后投递裁决会被后端忽略），而且这条规则**三域都成立** —— 充值/提现同样有「裁决被忽略」的状态集合，只是没写进 UI。

所以多数那个是「少做了一层」，不是另一种做法。**目标：三域都常显；进终态/处置态时按钮全部置灰 + 一句说明。**

### 三个后端集合（已逐字实证）

| 域 | 常量名 | 内容 |
|---|---|---|
| 充值 | `DepositWorkflowService.KYT_VERDICT_IGNORED_STATUSES` | `SUCCESS` `FAILED` `CONFISCATED` `RETURNED` `SEIZED` ＋ `CONFISCATING` `RETURNING` `SEIZING`（8） |
| 提现 | `WithdrawWorkflowService.`**`KYT_VERDICT_TERMINAL_STATUSES`** | `SUCCESS` `REJECTED` `FAILED` `RETURNED`（4） |
| 兑换 | `SwapWorkflowService.`**`KYT_VERDICT_TERMINAL_STATUSES`** | `SUCCESS` `REJECTED` `FAILED` `REVERSED`（4） |

⚠️ **提现与兑换那两个都叫 `TERMINAL` 不叫 `IGNORED`** —— grep `IGNORED` 在那两个域搜不到集合定义。

⚠️ **`FROZEN` 三域都在集合之外**，都是 `decideVerdictLanding` / `applyKytVerdict` 里**单独一行**判 IGNORE。所以前端数组严格照抄集合，`FROZEN` 放在谓词函数的第二支 —— 与后端两行结构同形。**不要把 FROZEN 塞进数组。**

⚠️ **两个刻意不置灰的状态**：提现 `PAYOUT_PENDING` 后端判 `EVIDENCE_ONLY`（落证据 + 打 needsReview，不是 no-op）；兑换 `PROCESSING` 同理。**按钮保持可点。**

⚠️ 这些是后端 `private static`，admin-web 独立 tsconfig **import 不过来**，只能各页硬抄一份，注释里写死同步源的**文件名 + 符号名，不写行号**。

**Files:**
- Modify: 三个详情页
- Modify: `admin-web/src/pages/module-parity.spec.ts`

**Interfaces:** 无

---

- [ ] **Step 1: 写失败的测试**

追加到 `module-parity.spec.ts`：

```ts
describe('规则① 同一模块显示逻辑一致 · ⚡ Simulation（Task 7）', () => {
  it('三域面板都常显 —— 渲染条件里不许再有 data.status 判断', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const gate = srcOf(file).match(/\{simEnabled[^\n]*/);
      expect([domain, gate?.[0]?.trim()]).toEqual([domain, '{simEnabled && (']);
    }
  });

  it('三域都按自家忽略集合置灰，且集合内容与后端逐字一致', () => {
    const EXPECTED: Record<string, string[]> = {
      DEPOSIT: ['SUCCESS', 'FAILED', 'CONFISCATED', 'RETURNED', 'SEIZED', 'CONFISCATING', 'RETURNING', 'SEIZING'],
      WITHDRAW: ['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED'],
      SWAP: ['SUCCESS', 'REJECTED', 'FAILED', 'REVERSED'],
    };
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file);
      const m = src.match(/_VERDICT_(?:IGNORED|TERMINAL)_STATUSES = new Set\(\[([\s\S]*?)\]\)/);
      const got = [...(m?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
      expect([domain, got.sort()]).toEqual([domain, [...EXPECTED[domain]].sort()]);
    }
  });

  /* FROZEN 三域都在集合之外、走谓词第二支 —— 与后端两行结构同形。
     塞进数组就与后端语义脱节（后端那个集合另有含义）。 */
  it('FROZEN 不在数组里，但谓词认它', () => {
    for (const [domain, file] of Object.entries(DETAIL_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      const setBody = src.match(/_VERDICT_(?:IGNORED|TERMINAL)_STATUSES = new Set\(\[([^\]]*)\]/)?.[1] ?? '';
      expect([domain, setBody.includes('FROZEN')]).toEqual([domain, false]);
      expect([domain, /\|\| status === 'FROZEN'/.test(src)]).toEqual([domain, true]);
    }
  });

  it('提现 PAYOUT_PENDING、兑换 PROCESSING 刻意不置灰', () => {
    const w = srcOf(DETAIL_PAGES.WITHDRAW);
    const s = srcOf(DETAIL_PAGES.SWAP);
    expect(w.match(/_VERDICT_TERMINAL_STATUSES = new Set\(\[([^\]]*)\]/)?.[1]).not.toContain('PAYOUT_PENDING');
    expect(s.match(/_VERDICT_TERMINAL_STATUSES = new Set\(\[([^\]]*)\]/)?.[1]).not.toContain('PROCESSING');
  });
});
```

- [ ] **Step 2: 跑，确认真失败**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "Simulation"
```

预期：第 1 条 SWAP 红；第 2、3 条三域全红（常量还不存在）；第 4 条会因为 `match` 返回 undefined 而红。

- [ ] **Step 3: 充值加常量 + 谓词**

在 `DEPOSIT_VERDICT_BUTTONS` 数组之后插入：

```tsx
/* 硬抄件（admin-web 有独立 tsconfig，后端那份是 private static，import 不过来）。
   同步源：src/modules/trading/deposit-transactions/deposit-workflow.service.ts
   的 DepositWorkflowService.KYT_VERDICT_IGNORED_STATUSES —— 5 个终态 + 3 个在途
   处置态。改了后端务必同步改这里，否则按钮置灰与后端实际 no-op 脱节。
   ⚠️ FROZEN **刻意不在这个数组里**：后端那个集合的语义是「终态 + 在途处置态」，
   FROZEN 属于另一族，加进去会影响别处对该集合的读取。后端是在 decideVerdictLanding
   里单独一行 `if (status === FROZEN) return 'IGNORE'`，这里也照样单独一支。 */
const DEPOSIT_KYT_VERDICT_IGNORED_STATUSES = new Set([
  // 终态
  'SUCCESS',
  'FAILED',
  'CONFISCATED',
  'RETURNED',
  'SEIZED',
  // 在途处置态
  'CONFISCATING',
  'RETURNING',
  'SEIZING',
]);

/** 该状态下投递的裁决会被后端 no-op（只落审计，不改状态）。 */
const isDepositVerdictIgnored = (status: string): boolean =>
  DEPOSIT_KYT_VERDICT_IGNORED_STATUSES.has(status) || status === 'FROZEN';
```

面板里加说明 + 按钮置灰（anchor：`{DEPOSIT_VERDICT_BUTTONS.map((s) => (`，改它上方与 `disabled`）：

```tsx
              {isDepositVerdictIgnored(data.status) && (
                <p className="font-mono text-[11px] text-adm-amber">
                  本单已进终态/处置态，投递的裁决会被后端记录但不改状态。
                </p>
              )}
              {simError && <p className="text-[11px] text-adm-red">{simError}</p>}
              <div className="flex flex-wrap gap-2">
                {DEPOSIT_VERDICT_BUTTONS.map((s) => (
                  <button
                    key={s.key}
                    disabled={simSubmitting !== null || isDepositVerdictIgnored(data.status)}
                    onClick={() => handleRunVerdict(s.key)}
                    className={adminButtonClass('simulationAction')}
                  >
                    {simSubmitting === s.key ? 'Running...' : s.label}
                  </button>
                ))}
              </div>
```

⚠️ **置灰不需要额外 CSS** —— `adminButtonClass` 的 `blockBase` 已含 `disabled:cursor-not-allowed disabled:opacity-40`（已实证）。**不要再往 className 里塞 opacity 类**，`twMerge` 会和 `blockBase` 打架。

- [ ] **Step 4: 提现同款**

常量（注意名字是 `TERMINAL`）：

```tsx
/* 硬抄件。同步源：src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
   的 WithdrawWorkflowService.KYT_VERDICT_TERMINAL_STATUSES。
   ⚠️ 名字就是 TERMINAL —— 提现域**没有**跟着充值域改名成 IGNORED，grep 'IGNORED'
   在这个域里搜不到集合定义。
   ⚠️ PAYOUT_PENDING 刻意**不**在这里：后端判它 EVIDENCE_ONLY（证据照落 + 打
   needsReview），不是 no-op，所以按钮不置灰。 */
const WITHDRAW_KYT_VERDICT_TERMINAL_STATUSES = new Set([
  'SUCCESS',
  'REJECTED',
  'FAILED',
  'RETURNED',
]);

const isWithdrawVerdictIgnored = (status: string): boolean =>
  WITHDRAW_KYT_VERDICT_TERMINAL_STATUSES.has(status) || status === 'FROZEN';
```

面板改动与充值同形（把 `DEPOSIT_` 换成 `WITHDRAW_`、`isDepositVerdictIgnored` 换成 `isWithdrawVerdictIgnored`）。

- [ ] **Step 5: 兑换同款 + 去掉 status 闸门**

常量：

```tsx
/* 硬抄件。同步源：src/modules/trading/swap-transactions/swap-workflow.service.ts
   的 SwapWorkflowService.KYT_VERDICT_TERMINAL_STATUSES，以及同文件 applyKytVerdict
   顶部那一行单独的 FROZEN 判断。
   ⚠️ 兑换域没有叫 *_IGNORED_STATUSES 的常量，别去 grep IGNORED。
   ⚠️ PROCESSING 刻意**不**在这里：后端在 PROCESSING 上落证据 + 打 needsReview +
   写审计，不是 no-op，所以按钮不置灰。 */
const SWAP_KYT_VERDICT_TERMINAL_STATUSES = new Set([
  'SUCCESS',
  'REJECTED',
  'FAILED',
  'REVERSED',
]);

const isSwapVerdictIgnored = (status: string): boolean =>
  SWAP_KYT_VERDICT_TERMINAL_STATUSES.has(status) || status === 'FROZEN';
```

**去掉 status 闸门**（anchor：`{simEnabled && data.status === 'COMPLIANCE_PENDING' && (`）—— 连同它上方那段讲这个闸门的注释一起重写：

```tsx
          {/* 11. Simulation（demo only —— 由本地 simulation-mode 开关控制，
              与后端 SUMSUB_MOCK_MODE 标志无关）。
              2026-08-23：与充值/提现统一为**常显**。此前这里额外挂了一道
              `data.status === 'COMPLIANCE_PENDING'` 闸门，兑换是三域里唯一整块
              消失的一个 —— operator 在别的状态下看不到面板，分不清「没这功能」和
              「这单不适用」。改成常显 + 终态/处置态置灰 + 一句说明，把
              applyKytVerdict 的 no-op 语义如实摊在页面上。 */}
          {simEnabled && (
```

面板改动与充值同形。

⚠️ 兑换原有那句「⑦/⑧ act on the customer…」**保留** —— 它讲的是另一件事。

- [ ] **Step 6: 跑测试 + 变异**

| 变异 | 应该红的 |
|---|---|
| 兑换改回带 status 闸门 | 第 1 条 |
| 充值集合里删掉 `CONFISCATING` | 第 2 条 |
| 把 `FROZEN` 塞进任一集合数组 | 第 3 条 |
| 提现集合里加 `PAYOUT_PENDING` | 第 2、4 条 |

- [ ] **Step 7: 渲染验收（本 Task 核心）**

并排截**两组**图：

1. **三笔在途单**（三域各一，充值/提现 `COMPLIANCE_PENDING`、兑换 `COMPLIANCE_PENDING`）—— 面板都在、按钮都可点
2. **三笔终态单**（三域各一 `SUCCESS`）—— 面板**都还在**（不消失）、按钮**都灰**、都显示那句说明

再单独看两笔：提现 `PAYOUT_PENDING`、兑换 `PROCESSING` —— **按钮应当仍可点**（后端不是 no-op）。

- [ ] **Step 8: 五道闸门 + Commit**

```bash
git add admin-web/src && git commit -m "feat(parity): ⚡ Simulation 三域常显+终态置灰(兑换此前整块消失)，判据硬抄各域后端集合"
```

---

## Task 8: 列表页三处

> 覆盖设计稿 §10 与 §2.1。

| 项 | 现状 | 改成 |
|---|---|---|
| 资产类型筛选 | 充值/提现有 `All types`，**兑换没有** | 兑换补 |
| `Review` 列 + 「只看需复核」勾选框 | 充值/兑换都有，**提现两样都没有** | 提现补（**新增一列**） |
| 状态下拉「全部」文案 | 充值 `All`、兑换 `All`、提现 `All status` | 统一为 `All status` |

⚠️ **三域的 type / needsReview / slaBreached 三个筛子本来就都是页内客户端过滤**（后端 DTO 无这些字段）。补给兑换的资产类型筛选**只能是页内过滤**，注释里写明是刻意对齐现状，不在本批扩后端。

⚠️ **提现补 Review 列是新增一列**，要连带改：表头数组、两处 `colSpan` 7→8、tbody 加一格、列表项类型加 `needsReview`。

⚠️ **提现的 `needsReview` 后端带得出来**（已实证三处：Prisma 有该列；`findAll` 是 `...item` 整行展开；controller 直接 return 无 DTO 白名单）→ **零后端改动**。

⚠️ **提现 detail 不补 `AdminBadge`**（设计稿 §2.1）—— 那些位置提现要么没那个信息、要么已用 `LinkedRelationCard`（内部就渲染 `AdminBadge`）。本 Task 只补 list 的 Review 列。

**Files:**
- Modify: `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionList.tsx`
- Modify: `admin-web/src/pages/module-parity.spec.ts`

**Interfaces:** 无

---

- [ ] **Step 1: 写失败的测试**

追加到 `module-parity.spec.ts`：

```ts
const LIST_PAGES = {
  DEPOSIT: 'DepositTransactionList.tsx',
  WITHDRAW: 'WithdrawTransactionList.tsx',
  SWAP: 'SwapTransactionList.tsx',
} as const;

describe('列表页三域对齐（Task 8）', () => {
  const columnsOf = (file: string): string[] =>
    [...srcOf(file).matchAll(/\[\s*'([^']+)',\s*'\d+px'\s*\]/g)].map((m) => m[1]);

  it('三域都有 Review 列', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      expect([domain, columnsOf(file).includes('Review')]).toEqual([domain, true]);
    }
  });

  it('列数与 colSpan 对得上（改了列忘改 colSpan 会串行）', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const spans = [...srcOf(file).matchAll(/colSpan=\{(\d+)\}/g)].map((m) => Number(m[1]));
      expect([domain, [...new Set(spans)]]).toEqual([domain, [columnsOf(file).length]]);
    }
  });

  it('三域都有「只看需复核」勾选框与资产类型筛选', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const src = srcOf(file).replace(/\s+/g, ' ');
      expect([domain, src.includes('needsReviewOnly')]).toEqual([domain, true]);
      expect([domain, src.includes('All types')]).toEqual([domain, true]);
    }
  });

  it('三域状态下拉的「全部」文案统一为 All status', () => {
    for (const [domain, file] of Object.entries(LIST_PAGES)) {
      const src = srcOf(file);
      expect([domain, src.includes('>All status<')]).toEqual([domain, true]);
      expect([domain, /<option value="">All<\/option>/.test(src)]).toEqual([domain, false]);
    }
  });
});
```

- [ ] **Step 2: 跑，确认真失败**

```bash
npx jest admin-web/src/pages/module-parity.spec.ts -t "列表页三域对齐"
```

- [ ] **Step 3: 提现补 Review 列（四处一起改，漏一处就串列）**

**① 表头数组**（anchor：`['Withdraw No', '160px'],`）—— 在 `SLA` 之后、`Created` 之前插入：
```tsx
                  ['Review',      '80px'],
```

**② 两处 `colSpan={7}` → `colSpan={8}`**（Loading 行与空态行）。

**③ tbody 补一格**（anchor：`{/* Created */}`，插在它之前）：
```tsx
                {/* Review */}
                <td className="px-4 py-2.5">
                  {item.needsReview ? <AdminBadge value="NEEDS_REVIEW" /> : <span className="text-adm-t3">—</span>}
                </td>

```

**④ 列表项类型加字段 + 补 import**：
```tsx
import { AdminBadge } from '../components/ui/AdminBadge';
```
在 `WithdrawItem`（或该文件实际的类型名）里加 `needsReview: boolean;`。

⚠️ `AdminBadge` 是**值**导入，**不能写 `import type`**（G5）。

⚠️ 先 `grep -n "AdminBadge" admin-web/src/pages/DepositTransactionList.tsx` 看充值那格怎么写的，**以充值原文为准**，本计划这段是重建。

- [ ] **Step 4: 提现补「只看需复核」勾选框**

照抄充值那份（先 grep `needsReviewOnly` 看充值/兑换的写法），并在 `FilterState`、`DEFAULT_FILTERS`、`hasActiveFilters`、Reset、页内过滤五处一起接上。

⚠️ 五处**缺一处都会出问题**：漏 `DEFAULT_FILTERS` 会 undefined；漏 `hasActiveFilters` 会让 Reset 按钮不亮；漏页内过滤则勾了没反应。

- [ ] **Step 5: 兑换补资产类型筛选**

照抄充值那份 select，并在 `FilterState`、`DEFAULT_FILTERS`、`hasActiveFilters`、Reset、页内过滤五处接上。

兑换的过滤要判**两侧资产**（from/to 任一命中）。注释写明：

```tsx
      // 与充值/提现同为**页内过滤**（后端 DTO 没有 type 字段）——刻意对齐现状，
      // 不在本批扩后端。兑换一笔单有买卖两侧资产，任一命中即算。
```

- [ ] **Step 6: 三域「全部」文案统一**

充值与兑换的 `<option value="">All</option>` → `<option value="">All status</option>`。提现已经是，不动。

- [ ] **Step 7: 跑测试 + 变异**

| 变异 | 应该红的 |
|---|---|
| 提现表头加了 Review 但 colSpan 留 7 | 第 2 条 |
| 删掉兑换新加的 `All types` | 第 3 条 |
| 把充值改回 `<option value="">All</option>` | 第 4 条 |

- [ ] **Step 8: 渲染验收**

三个列表页并排截图，确认：

- 三个页面都有 `Review` 列，位置都在 `SLA` 与 `Created` 之间
- 三个筛选栏的控件**种类与顺序一致**（单号 / Owner No / 状态 / 资产类型 / 起止日期 / 两个勾选框）
- 三个状态下拉的第一项都是 `All status`
- **提现表格没有串列**（表头写 Review、格子里就是 Review）

- [ ] **Step 9: 五道闸门 + Commit**

```bash
git add admin-web/src && git commit -m "feat(parity): 列表页三域对齐 —— 提现补 Review 列与需复核勾选，兑换补资产类型筛选，全部文案统一"
```

---

## Task 9: 六页并排终验 + 文档同步 + BACKLOG

> 覆盖设计稿 §11、§12。**本 Task 不产生功能 diff**，产出的是验收记录、文档与欠账登记。

---

- [ ] **Step 1: 六页并排终验**

起栈，六个页面全开，对着设计稿逐节打勾：

| 设计稿 | 验什么 |
|---|---|
| §2 违规 5 条 | 1 `GateTile` 用了 6 次 ｜ 2 `SumsubDetailSection` 只剩一份 ｜ 3 `StatusTimeline` 只剩一份 ｜ 4 关联资金单**本轮不动**（确认兑换 `LegAttemptRow` 还在、重试历史还看得见）｜ 5 提现 list 有 `AdminBadge`、detail **仍是 0 且这是对的** |
| §3 `GateTile` | L1/L2 三域同大小；提现 `Finance:` 不是 `finance:`；兑换 `Finance:` 不是 `KYT:` |
| §5 侧栏 | 三域信息段都是 SLA→Identity→Lifecycle；兑换无处置卡；Identity 都是 4 行 |
| §6 `needsReview` | 三域同位置横幅、文案各不同、侧栏无 KV |
| §9 主列 | 兑换三张交易卡连续；三域 Simulation 常显、终态置灰 |
| §10 列表页 | 三域 Review 列、资产类型筛选、`All status` |

产出一张**逐条打勾表**写进完成记录。**没打勾的要写明为什么。**

- [ ] **Step 2: 截最终对比图（至少 4 组）**

1. 三个列表页（默认视图）
2. 三个详情页（在途单）
3. 三个详情页（终态单 —— 模拟面板置灰）
4. 三个详情页的侧栏特写

- [ ] **Step 3: 同步 truth 文档**

```bash
grep -rn "侧栏\|Ops Disposition\|Frozen Disposition\|Simulation\|StatusTimeline" doc-final/reference/truth/ | head -20
```

至少要改：凡描述「兑换详情页侧栏有哪些卡」「模拟面板什么时候显示」的地方。

- [ ] **Step 4: 登记 BACKLOG**

写进 `doc-final/BACKLOG.md`：

1. **三域 Owner 按客户号搜索全是坏的**（已实证）：充值/提现前端发 `ownerNo`、DTO 只有 `ownerId` → `main.ts` 的 `ValidationPipe({whitelist:true})` 静默丢弃 → **输什么都返回全量**；兑换把客户号塞进 `ownerId` → 比 UUID → **恒 0 行**。实测 `30/30/0`、`83/83/0`、`59/59/0`。修它要动后端三个 QueryDto + service
2. **充值/提现详情页看不到资金腿重试次数**（后端有、前端没显示）；统一关联资金单模块前需先确认详情响应带不带 `attempt`
3. **兑换 `SwapTransactionDetailData` 里 `customer.restrictionRows` 与 `customer.hardLineDispositionedAt` 变成有声明无消费**（Task 4 删了 Ops Disposition 之后）。它们是 interface 成员不是局部变量，`noUnusedLocals` 不报，但已是死字段
4. **`Terminal` 提示三域三个样**：提现在操作段、兑换在 Lifecycle 之后、充值**根本没有**。本轮设计稿未收口，需业主拍板
5. **三域 SLA 徽章与 `Simulate SLA Timeout` 用裸 Tailwind 色**（`text-red-600` 等），违反 `rules/frontend-admin.md` 的「只用 adm-* token」—— 三域 3/3 一致，要改就独立一轮三域一把改
6. **三域 `fetchData` 里的原生 `alert()`** —— 同上，3/3 一致
7. **兑换时间线 `operator` 恒为 `'SYSTEM'` 字面量**（后端 `statusHistory` 写入行为），永远看不到是谁操作的
8. **`admin-web` 的 `.spec.ts` 不在任何 tsc 闸门内**（`tsconfig.app.json` 的 exclude），类型错只有 `npx jest` 跑到才暴露 —— 本批新建的 `module-parity.spec.ts` 即受此影响
9. **充值/提现的「⑧ On hold」按钮在非 `COMPLIANCE_PENDING` 状态下也会被后端 no-op**（`decideVerdictLanding` 里有按钮级判据 `verdict === 'onHold' && status !== COMPLIANCE_PENDING`），但本批只做整块置灰、不做逐按钮置灰。要不要做是业主口径问题

- [ ] **Step 5: 最终五道闸门**

```bash
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit) && npx jest
```

对着 G7 基线核对：**净新失败必须为 0**。

- [ ] **Step 6: Commit**

```bash
git add doc-final && git commit -m "docs(parity): 第五批收尾 —— 六页并排验收表、truth 同步、BACKLOG 登记 9 条"
```

---

## 附录 · 本计划相对设计稿的四处订正

写计划时逐条实证，发现设计稿有四处与代码不符，**已全部回填到设计稿**。实施时以本计划为准。

| # | 设计稿初版 | 实证结果 |
|---|---|---|
| 1 | 「`SumsubDetailSection` 三份哈希全不同（已漂移）」 | **错**。充值与提现渲染体**逐字节相同**；兑换与充值的完整 diff 只有一行（props 类型名）。是 2 个版本不是 3 个，合并风险极低 |
| 2 | 「兑换没有 `KYT_VERDICT_*_STATUSES` 同名常量」 | **错**。兑换有 `KYT_VERDICT_TERMINAL_STATUSES`，与提现同名，内容 `SUCCESS/REJECTED/FAILED/REVERSED` |
| 3 | 「兑换 Hero 缺 `Owner No`」 | **错**。兑换那处用局部变量 `ownerNo` + `ownerLink`，不是 `data.ownerNo`，初版 grep 漏了。**Hero 本轮无需改动** |
| 4 | 「提现两个页面都接上 `AdminBadge`」 | **过度**。提现 detail 的那些位置要么没那个信息（`limitHoldReason` 是充值独有、`hardLineDispositionedAt` 是兑换独有），要么已用 `LinkedRelationCard`（内部就渲染 `AdminBadge`）。**只补 list 的 Review 列** |

另有两条实施时必须知道、设计稿未提的事实：

- **三域 `needsReview` 的语义不同**：充值是「处置资金腿重试三级梯耗尽、单子卡在原地」，提现/兑换是「放款/成交后迟到的 KYT 裁决」。**横幅文案不能三域照抄**
- **`SidebarKV` 对空值整行不渲染**（`if (value === null || undefined || '') return null`），所以 Identity「4 行」实为「最多 4 行」。三域行为一致，不是缺陷
