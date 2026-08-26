# Case 详情页瘦身（问题优先重排）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 spec `doc-final/superpowers/specs/2026-07-03-case-detail-slim-design.md`——case 详情页去冗余 + 问题优先重排 + 六档结论句。

**Architecture:** 纯前端单页改造：新增一个零依赖结论句纯函数 util，页面按"Hero 三徽章 → 结论句 → 差额五格 → 身份单行 → 观察历史 → 流水表"重排，删除重复渲染点；后端/DTO 零改动。

**Tech Stack:** React + TypeScript（admin-web，adm-* tokens）。**admin-web 无单测跑器**（package.json 无 test/vitest/jest 脚本，已核实）——验证手段 = `npx tsc -b` + claude 栈 preview 截图（3201，库里有 9 场景 break 数据）。

**执行约定：**
- 工作分支：`feat/recon-round3-cockpit`（主 worktree `Exchange_js/`）；截图验收前 ff 同步到 claude 栈 worktree（Task 3 有具体命令）
- 每任务收尾：`cd admin-web && npx tsc -b` 0 错 → commit
- 双语文案沿用 `{中文} / {English}` 既有模式；颜色只用 adm-* tokens

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `admin-web/src/utils/caseConclusion.ts` | Create | 六档结论句纯函数（可独立读懂/演化，页面只消费） |
| `admin-web/src/pages/ReconciliationCasesDetailPage.tsx` | Modify | Hero 徽章化、区块重排、身份单行、侧栏 4 行 |
| `doc-final/rules/frontend-admin.md` | Modify | Per-entity Sidebar Fields 表 ReconciliationCase 行登记 |

---

### Task 1: 结论句纯函数 `buildCaseConclusion`

**Files:**
- Create: `admin-web/src/utils/caseConclusion.ts`

- [ ] **Step 1: 写实现**（无单测跑器，正确性由 tsc + Task 3 四张截图验收；函数保持纯函数零 React 依赖）

```ts
// admin-web/src/utils/caseConclusion.ts
//
// Case 详情页 Hero 下的一句话结论（spec 2026-07-03-case-detail-slim §3）。
// 纯函数：输入 = getCase 返回体字段子集 + 金额格式化器；输出 = 文案 + 色调。
// 规则变更零后端成本——判定全部基于已有 API 字段前端派生。
import type { ReconBucket } from './reconBucketMap';

export type ConclusionTone = 'red' | 'blue' | 'amber' | 'neutral';

export interface CaseConclusionInput {
  bucket: ReconBucket | null | undefined;
  status: string;                 // OPEN | RESOLVED
  assetCode: string;
  walletRef: string | null;
  walletNo: string | null;        // 无主头判据之一：wallet 表解析不到 → null
  coaCode: string | null;         // 无主头判据之二
  deltaAmount: string;            // human decimal string（Prisma Decimal.toString()）
  actualExternal: string;
  explain?: { inTransitSigned: string; residual: string } | null;
  flowSummary?: { orphanInternal: number; orphanExternal: number; mismatch: number } | null;
}

export interface CaseConclusion { text: string; tone: ConclusionTone; }

const isZeroStr = (s: string | null | undefined): boolean =>
  s == null || parseFloat(s) === 0 || Number.isNaN(parseFloat(s));

const absStr = (s: string): string => s.replace(/^-/, '');

/** bucket=null（历史 case）返回 null → 调用方不渲染结论行。 */
export function buildCaseConclusion(
  k: CaseConclusionInput,
  fmt: (v: string) => string,
): CaseConclusion | null {
  if (!k.bucket) return null;

  let base: CaseConclusion;
  if (k.walletNo == null && k.coaCode == null) {
    // 规则1 无主外部账户（后端 caseReason 未持久化，用前端判据）
    base = {
      text: `外部账户 ${k.walletRef ?? '—'} 无法归属任何钱包，余额 ${fmt(k.actualExternal)} 待认领`,
      tone: 'red',
    };
  } else if (k.bucket === 'BREAK') {
    const transit = k.explain?.inTransitSigned ?? '0';
    if (isZeroStr(transit)) {
      // 规则2 无在途解释
      const dir = parseFloat(k.deltaAmount) < 0 ? '少' : '多';
      base = {
        text: `外部比内部${dir} ${fmt(absStr(k.deltaAmount))} ${k.assetCode}，无在途解释 → 全额待排查`,
        tone: 'red',
      };
    } else {
      // 规则3 部分解释
      base = {
        text: `差额 ${fmt(k.deltaAmount)} 中 ${fmt(transit)} 由在途解释，残差 ${fmt(k.explain?.residual ?? '0')} 待排查`,
        tone: 'red',
      };
    }
  } else if (k.bucket === 'IN_TRANSIT') {
    // 规则4
    base = { text: `差额 ${fmt(k.deltaAmount)} 已被在途单全额解释，等待外部确认后自愈`, tone: 'blue' };
  } else if (k.bucket === 'SOFT_FLAG') {
    // 规则5
    const n = (k.flowSummary?.orphanInternal ?? 0) + (k.flowSummary?.orphanExternal ?? 0) + (k.flowSummary?.mismatch ?? 0);
    base = { text: `余额已对平，但 ${n} 笔流水配不上 → 假匹配待核`, tone: 'amber' };
  } else {
    return null; // MATCHED 不会有 case，防御性兜底
  }

  if (k.status === 'RESOLVED') {
    return { text: `已解决 · ${base.text}`, tone: 'neutral' };
  }
  return base;
}
```

- [ ] **Step 2: 类型检查**

Run: `cd admin-web && npx tsc -b && echo OK`
Expected: `OK`（零输出零错误）。

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/utils/caseConclusion.ts
git commit -m "feat(admin/recon): case 结论句六档纯函数（spec §3）"
```

---

### Task 2: 页面重排 + 删减

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`

开工先通读全文（~750 行），锚点：Hero grid（~:398-408 的 STATUS/BOOK/ASSET/Δ 四行）、Account Identity 卡（~:413 起，含 Wallet/Owner/Linked Run/Lifecycle 四子卡）、差额解释卡（~:486）、观察历史（~:590）、侧栏（~:737-747）。行号以实读为准。

- [ ] **Step 1: Hero 徽章化 + 结论句**

1. 删除 Hero 内 STATUS/BOOK/ASSET/Δ 的 grid 行块（保留 caseNo 标题 + 桶徽章 + severity 徽章）。
2. severity 徽章之后追加 status 徽章：`<StatusPill value={kase.status} size="md" />`（复用文件已 import 的 StatusPill）。
3. 徽章行下方渲染结论句：

```tsx
{(() => {
  const c = buildCaseConclusion(kase, (v) => formatAmount(v));
  if (!c) return null;
  const toneCls =
    c.tone === 'red' ? 'text-adm-red'
    : c.tone === 'blue' ? 'text-adm-blue'
    : c.tone === 'amber' ? 'text-adm-amber'
    : 'text-adm-t2';
  return <div className={`mt-2 font-mono text-[12px] ${toneCls}`}>{c.text}</div>;
})()}
```

import：`import { buildCaseConclusion } from '../utils/caseConclusion';`。`kase` 的 TS 接口若缺 `walletNo` 字段则补上（`walletNo: string | null;`——API 已返回，页面 Wallet 卡已在用）。

- [ ] **Step 2: 区块重排 + 身份单行**

1. 差额解释 DetailCard 整块移动到原 Account Identity 位置之前（成为 Hero 后第一个区块；卡内五格内容与标题 `(assetCode)` 不动）。
2. `Account Identity` DetailCard 内容替换为单行（删除 Wallet/Owner/Linked Run/Lifecycle 四张子卡）：

```tsx
<DetailCard title="账户身份 / Account Identity" columns={1}>
  <div className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-[12px]">
    <span><span className="text-adm-t3">钱包 </span><span className="text-adm-t1" title={kase.walletRef ?? undefined}>{kase.walletNo ?? (kase.walletRef ? kase.walletRef.slice(0, 12) : '—')}</span></span>
    <span><span className="text-adm-t3">客户 </span><span className="text-adm-t1">{kase.ownerNo ?? '—'}</span></span>
    <span><span className="text-adm-t3">科目 </span><span className="text-adm-t1">{kase.coaCode ?? '—'}</span></span>
    <span><span className="text-adm-t3">币种 </span><span className="text-adm-t1">{kase.assetCode}{kase.book ? ` · ${kase.book}` : ''}</span></span>
  </div>
</DetailCard>
```

3. 观察历史 / 流水下钻 / Related Views 三块保持原样与相对顺序（现在依次排在身份行之后）。
4. 删除动作产生的孤儿（未再使用的局部变量/子组件/import）一并清理——只清本次改动造成的。

- [ ] **Step 3: 侧栏 4 行**

Identity Summary 组改为（删 Book/Asset 两行，加桶行；formatBucketBilingual 从 `../utils/reconBucketMap` import）：

```tsx
<SidebarGroup title="Identity Summary">
  <SidebarKV label="Case No" value={kase.caseNo} mono />
  <SidebarKV label="Status" value={<StatusPill value={kase.status} />} />
  <SidebarKV label="Bucket" value={kase.bucket ? formatBucketBilingual(kase.bucket) : '—'} />
  <SidebarKV label="Δ" value={deltaZero ? formatAmount(kase.deltaAmount) : `${sign}${formatAmount(kase.deltaAmount).replace(/^-/, '')}`} mono />
</SidebarGroup>
```

Lifecycle 组（SLA/Created/Updated）不动。

- [ ] **Step 4: 类型检查 + Commit**

Run: `cd admin-web && npx tsc -b && echo OK` → Expected `OK`。

```bash
git add admin-web/src/pages/ReconciliationCasesDetailPage.tsx
git commit -m "feat(admin/recon): case 详情页瘦身——问题优先重排+结论句+身份单行（spec §2/§4）"
```

---

### Task 3: 文档登记 + claude 栈截图验收 + 冗余复查

**Files:**
- Modify: `doc-final/rules/frontend-admin.md`（Per-entity Sidebar Fields 表）

- [ ] **Step 1: rules 登记**

找到表中 `| **ReconciliationCase** |` 行，替换为：

```markdown
| **ReconciliationCase** | `caseNo`, `status` badge, `bucket` badge, `deltaAmount` | `slaDeadline`, `createdAt`, `updatedAt` |
```

- [ ] **Step 2: 同步 claude 栈 worktree（截图数据在那边——claude 栈库里有 9 场景 break 数据，main 栈库已 reset）**

```bash
git -C /Users/songshengwei/Documents/codex/projects/重做版/.wt/claude merge --ff-only feat/recon-round3-cockpit
```
Expected: Fast-forward（claude 分支与 feat 同源无分叉，已核实）。vite（preview 管理，3201）HMR 自动生效。

- [ ] **Step 3: 四张截图验收**（preview 工具，登录方式沿用：POST `http://localhost:3200/auth/login` admin@fiatx.com/123456 → localStorage `admin_token`）

| Case | 桶 | 必须核对 |
|---|---|---|
| `REC20260703-004` | BREAK | 红色规则2句"外部比内部少 0.000047 USDT-TRON…全额待排查"；Hero 无 STATUS/BOOK/ASSET/Δ 格子；五格在身份行之前 |
| `REC20260703-002` | IN_TRANSIT | 蓝色规则4句；差额五格残差=0 |
| `REC20260703-001` | SOFT_FLAG | 琥珀规则5句含流水笔数；Δ=0 |
| walletRef=DEMO-ORPHAN-ADDR 的 case（cases 列表 API 按 walletRef 找 caseNo） | BREAK 无主 | 红色规则1句"无法归属任何钱包…待认领"；身份行钱包段显示原始 accountRef 截断 |

同时 `preview_console_logs` 无 error。

- [ ] **Step 4: 冗余复查（spec §6 量化验收）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
grep -c 'kase.assetCode' admin-web/src/pages/ReconciliationCasesDetailPage.tsx   # 期望 ≤3（身份行+五格标题+侧栏已删→实际应为2；结论句内用参数不直引则2）
grep -c 'kase.book' admin-web/src/pages/ReconciliationCasesDetailPage.tsx        # 期望 ≤2（身份行1处+null判断）
grep -c 'Linked Run\|LINKED RUN' admin-web/src/pages/ReconciliationCasesDetailPage.tsx  # 期望 0
grep -c 'First seen' admin-web/src/pages/ReconciliationCasesDetailPage.tsx       # 期望 0（Lifecycle 卡已删；观察历史用"首见"中文）
```
超标即回 Task 2 收敛，不达标不许提交。

- [ ] **Step 5: Commit**

```bash
git add doc-final/rules/frontend-admin.md
git commit -m "docs(rules): ReconciliationCase 侧栏字段登记更新（case 瘦身）"
```

---

## 自审记录

- **Spec 覆盖**：§1 审计（背景）；§2→Task 2 Step 1/2；§3→Task 1（六档全实现，含 RESOLVED 前缀与 bucket=null 返回 null）；§4 删减清单→Task 2；§5→Task 3 Step 1；§6 验收→Task 3 Step 3/4（四截图含无主 case + 量化 grep）；§7 不做清单未越界 ✓
- **占位符**：无 TBD；行号标注"以实读为准"为防漂移说明非占位
- **类型一致性**：`buildCaseConclusion(k, fmt)` 签名 Task 1 定义、Task 2 Step 1 调用一致；`ConclusionTone` 四值与 Task 2 的 toneCls 映射一一对应；`formatBucketBilingual` 为 T7 已交付导出 ✓
- **发现并回修 spec 的问题**：规则 1 原判据 `caseReason` 未持久化（schema/API 零命中），已改为 `walletNo==null && coaCode==null` 前端判据并同步修订 spec §3
