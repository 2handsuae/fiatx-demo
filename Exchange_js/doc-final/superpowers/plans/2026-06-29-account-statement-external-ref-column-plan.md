# Account Statement External Ref Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AccountStatementPage 表头加 External Ref 列（显化 chain txHash / 银行回执），Reference 列改名 Source No，EXT 列 fallback 从 `—` 升级成 `INT` badge。

**Architecture:** 单文件 UI 改造，纯前端 column 重组。后端 read model `StatementRow` 已含 `externalRef` + `isExternalCrossing`，无 backend 改动。先 tsc 编译门，再 preview 渲染验收。

**Tech Stack:** React 18 + Vite + Tailwind + adm-* design tokens

---

## Task 1: 表头 + 行渲染列重组

**Files:**
- Modify: `admin-web/src/pages/AccountStatementPage.tsx` (table head ~line 648, table body ~line 663-670)

- [ ] **Step 1: 读现有表格代码定位精确行号**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
grep -nE "Reference|isExternalCrossing|externalRef|sourceNo" admin-web/src/pages/AccountStatementPage.tsx | head -20
```

Expected output：列号附近含 `<th>Reference</th>` (around line 648) 和 `<td>` row 渲染（around line 663-680）和 EXT badge 段（around line 669）。

- [ ] **Step 2: 修改表头 — Reference 改名为 Source No，紧跟插入 External Ref 列**

定位 `<th className={th} style={{ width: 140 }}>Reference</th>`（约 line 648）。

**修改前**：
```tsx
<th className={th} style={{ width: 140 }}>Reference</th>
```

**修改后**（在同一位置替换 + 紧跟一行新 th）：
```tsx
<th className={th} style={{ width: 140 }}>Source No</th>
<th className={th} style={{ width: 160 }}>External Ref</th>
```

- [ ] **Step 3: 修改行渲染 — Source No 列保持，紧跟插入 External Ref 列**

定位现有 Source No `<td>` 段（约 line 663-665）：

**修改前**（已有）：
```tsx
<td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[140px]" title={row.sourceNo}>
  {row.sourceNo}
</td>
```

保留这段不动（这就是 Source No 列）。在它之后**紧跟插入** External Ref `<td>`：

```tsx
<td
  className={`px-3 py-2 font-mono text-[11px] truncate max-w-[160px] ${
    row.externalRef ? 'text-adm-amber' : 'text-adm-t3'
  }`}
  title={row.externalRef ?? ''}
>
  {row.externalRef ?? '—'}
</td>
```

- [ ] **Step 4: 升级 EXT 列 — fallback `—` 改为 `INT` 灰 badge**

定位 EXT 列段（约 line 668-674）：

**修改前**：
```tsx
<td className="px-3 py-2 font-mono text-[10px]">
  {row.isExternalCrossing ? (
    <span className="text-adm-amber" title={row.externalRef ?? ''}>EXT</span>
  ) : (
    <span className="text-adm-t3">—</span>
  )}
</td>
```

**修改后**（EXT 保留 amber，添加 `INT` 对仗 badge；不再 hover 透 externalRef，因为现在主显示在新列了）：
```tsx
<td className="px-3 py-2 font-mono text-[10px]">
  {row.isExternalCrossing ? (
    <span className="text-adm-amber">EXT</span>
  ) : (
    <span className="text-adm-t3">INT</span>
  )}
</td>
```

- [ ] **Step 5: tsc 编译门**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web && npx tsc --noEmit
```

Expected: 0 errors。

- [ ] **Step 6: 起 admin preview + 注入 token + 跳到任一客户 USDT account 看效果**

注入 token：
```javascript
// preview_eval:
(async () => {
  const r = await fetch('http://localhost:3000/auth/login', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({email:'admin@fiatx.com',password:'123456'})
  });
  const j = await r.json();
  localStorage.setItem('admin_token', j.access_token);
  localStorage.setItem('admin_user', JSON.stringify(j.user));
  return { ok: true };
})()
```

导航到 AccountStatement 页面（默认 mode=accounts）：
```javascript
window.location.href = 'http://localhost:3001/admin/ledger/account-statement';
```

`preview_screenshot` 截图。

- [ ] **Step 7: 视觉验收 — 6 个判据**

| # | 判据 | 期望 |
|---|---|---|
| 1 | 表头 9 列，Source No 与 External Ref 紧邻 | 列序：DATE / TYPE / Source No / External Ref / EVENT / EXT / IN / OUT / BALANCE |
| 2 | DEPOSIT 行 External Ref 显 `0xDEMO1USDT` 等 amber 字串 | 可见，不再藏 hover |
| 3 | SWAP 行 External Ref 显 `SWP...:N:1:pending` swap leg ref | 可见 |
| 4 | crossing=false 行 External Ref 显 `—`（灰），EXT 列显 `INT` 灰 | 对仗清晰 |
| 5 | crossing=true 行 EXT 列保持 `EXT`（amber），External Ref 突出 amber | 三列职责互补 |
| 6 | hover Source No / External Ref 显完整值（title 工作） | 截断不丢信息 |

通过 preview_eval 文本扫描验证：
```javascript
(() => {
  const txt = document.body.innerText;
  return {
    hasSourceNoHeader: txt.includes('Source No'),
    hasExternalRefHeader: txt.includes('External Ref'),
    hasINTBadge: txt.includes('INT'),
    hasEXTBadge: txt.includes('EXT'),
  };
})()
```

Expected：4 项全 true。

- [ ] **Step 8: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add admin-web/src/pages/AccountStatementPage.tsx
git commit -m "feat(admin): account statement adds External Ref column + INT badge for non-crossing rows"
```

---

## Self-Review

**Spec 覆盖（vs §3-§5）**:

| Spec 章节 | 对应 Step |
|---|---|
| §3 表头终态 9 列 + 列规范 | Step 2 (header) + Step 3 (body) |
| §3.2 EXT/INT badge 对仗 | Step 4 |
| §5 文件改动 admin-web/src/pages/AccountStatementPage.tsx | 所有 step |
| §6 不变量（adm-* token + truncate + title） | Step 3-4 代码块全部用 `adm-amber/adm-t3` + `truncate max-w-[160px]` + `title=...` |
| §7 验收方式（6 项判据） | Step 7 |

**Placeholder 扫描**：无 TBD/TODO。每个修改 step 都有完整 before/after 代码。

**Type 一致性**：
- `row.externalRef` 与 `row.sourceNo` 字段名贯穿一致
- `text-adm-amber` / `text-adm-t3` token 用法与现有页面对齐
- `max-w-[140px]` (Source No) / `max-w-[160px]` (External Ref) 宽度与 spec §3.1 严格一致

---

## 完整任务清单

- [ ] **Task 1** — 单文件 9 列重组（表头 + 行 + EXT badge 升级 + 验收）

共 **1 任务 / 8 步骤 / 1 commit**。
