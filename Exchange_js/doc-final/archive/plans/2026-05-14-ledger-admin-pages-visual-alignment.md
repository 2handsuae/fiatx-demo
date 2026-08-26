# Ledger Admin Pages Visual Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 4 个 Accounting/TB 管理台页面在视觉上对齐 Asset 页面的设计语言，同时将命名和路由业务化。

**Architecture:** 纯前端视觉重构。先做路由和侧边栏基础设施变更（Task 1），然后逐页重写（Task 2-5），每个 Task 独立可提交。

**Tech Stack:** React, React Router, Tailwind CSS (adm-* tokens), 现有 admin 共享组件

---

## File Map

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `admin-web/src/App.tsx` | Modify | 更新 lazy import 和路由路径 |
| `admin-web/src/components/DashboardLayout.tsx` | Modify | 侧边栏分组名和菜单项 |
| `admin-web/src/pages/tb-account.constants.ts` | Rename → `ledger-account.constants.ts` | 常量文件重命名 |
| `admin-web/src/pages/TbAccountList.tsx` | Delete & Create `LedgerAccountList.tsx` | 列表页重写 |
| `admin-web/src/pages/TbAccountDetail.tsx` | Delete & Create `LedgerAccountDetail.tsx` | 详情页重写 |
| `admin-web/src/pages/TbTransferList.tsx` | Delete & Create `TransferEvidenceList.tsx` | 列表页重写 |
| `admin-web/src/pages/TbBacklogList.tsx` | Delete & Create `RetryQueueList.tsx` | 列表页重写 |

---

## Task 1: 路由、侧边栏与常量文件基础设施

**Files:**
- Modify: `admin-web/src/App.tsx:127-131,920-937`
- Modify: `admin-web/src/components/DashboardLayout.tsx:253-277`
- Rename: `admin-web/src/pages/tb-account.constants.ts` → `admin-web/src/pages/ledger-account.constants.ts`

- [ ] **Step 1: 重命名常量文件**

```bash
cd Exchange_js/admin-web/src/pages
git mv tb-account.constants.ts ledger-account.constants.ts
```

- [ ] **Step 2: 更新 App.tsx lazy imports**

将以下 4 行（约第 127-130 行）：

```typescript
const TbAccountList = lazy(() => import('./pages/TbAccountList'));
const TbAccountDetail = lazy(() => import('./pages/TbAccountDetail'));
const TbTransferList = lazy(() => import('./pages/TbTransferList'));
const TbBacklogList = lazy(() => import('./pages/TbBacklogList'));
```

改为：

```typescript
const LedgerAccountList = lazy(() => import('./pages/LedgerAccountList'));
const LedgerAccountDetail = lazy(() => import('./pages/LedgerAccountDetail'));
const TransferEvidenceList = lazy(() => import('./pages/TransferEvidenceList'));
const RetryQueueList = lazy(() => import('./pages/RetryQueueList'));
```

- [ ] **Step 3: 更新 App.tsx 路由路径**

将以下路由块（约第 920-937 行）：

```tsx
<Route path="/ledger">
  <Route
    path="tb-accounts"
    element={withPermission(<TbAccountList />, [PERMISSIONS.TB_ACCOUNTS_READ])}
  />
  <Route
    path="tb-accounts/:tbAccountId"
    element={withPermission(<TbAccountDetail />, [PERMISSIONS.TB_ACCOUNTS_READ])}
  />
  <Route
    path="tb-transfers"
    element={withPermission(<TbTransferList />, [PERMISSIONS.TB_TRANSFERS_READ])}
  />
  <Route
    path="tb-backlog"
    element={withPermission(<TbBacklogList />, [PERMISSIONS.TB_BACKLOG_READ])}
  />
</Route>
```

改为：

```tsx
<Route path="/ledger">
  <Route
    path="accounts"
    element={withPermission(<LedgerAccountList />, [PERMISSIONS.TB_ACCOUNTS_READ])}
  />
  <Route
    path="accounts/:id"
    element={withPermission(<LedgerAccountDetail />, [PERMISSIONS.TB_ACCOUNTS_READ])}
  />
  <Route
    path="transfers"
    element={withPermission(<TransferEvidenceList />, [PERMISSIONS.TB_TRANSFERS_READ])}
  />
  <Route
    path="retry-queue"
    element={withPermission(<RetryQueueList />, [PERMISSIONS.TB_BACKLOG_READ])}
  />
</Route>
```

- [ ] **Step 4: 更新 DashboardLayout.tsx 侧边栏**

将 Accounting 分组（约第 253-277 行）：

```typescript
// ─── Accounting ───────────────────────────────────────────────
{
  label: 'Accounting',
  icon: <Library size={12} />,
  children: [
    {
      path: '/ledger/tb-accounts',
      label: 'TB Accounts',
      icon: <Database size={13} />,
      requiredPermissions: [PERMISSIONS.TB_ACCOUNTS_READ],
    },
    {
      path: '/ledger/tb-transfers',
      label: 'TB Transfers',
      icon: <Database size={13} />,
      requiredPermissions: [PERMISSIONS.TB_TRANSFERS_READ],
    },
    {
      path: '/ledger/tb-backlog',
      label: 'TB Backlog',
      icon: <Database size={13} />,
      requiredPermissions: [PERMISSIONS.TB_BACKLOG_READ],
    },
  ],
},
```

改为：

```typescript
// ─── Ledger ───────────────────────────────────────────────────
{
  label: 'Ledger',
  icon: <Library size={12} />,
  children: [
    {
      path: '/ledger/accounts',
      label: 'Ledger Accounts',
      icon: <Database size={13} />,
      requiredPermissions: [PERMISSIONS.TB_ACCOUNTS_READ],
    },
    {
      path: '/ledger/transfers',
      label: 'Transfer Evidence',
      icon: <Database size={13} />,
      requiredPermissions: [PERMISSIONS.TB_TRANSFERS_READ],
    },
    {
      path: '/ledger/retry-queue',
      label: 'Retry Queue',
      icon: <Database size={13} />,
      requiredPermissions: [PERMISSIONS.TB_BACKLOG_READ],
    },
  ],
},
```

- [ ] **Step 5: Commit**

```bash
git add -A admin-web/src/App.tsx admin-web/src/components/DashboardLayout.tsx admin-web/src/pages/ledger-account.constants.ts admin-web/src/pages/tb-account.constants.ts
git commit -m "refactor: rename Accounting → Ledger, update routes and sidebar labels"
```

---

## Task 2: Ledger Accounts 列表页

**Files:**
- Create: `admin-web/src/pages/LedgerAccountList.tsx`
- Delete: `admin-web/src/pages/TbAccountList.tsx`

> **参考:** `AssetList.tsx` 的四段式布局（PageTitleBar → Filter → Table → Footer）。
> **数据源:** 现有 `TbAccountList.tsx` 的 fetchData / fetchAssets / handleCreate 逻辑完整保留，只重写 JSX 布局。

- [ ] **Step 1: 创建 LedgerAccountList.tsx**

完整重写页面。关键要求：
- 从 `./ledger-account.constants` 导入（替代 `./tb-account.constants`）
- Title: "Ledger Accounts"，subtitle: `${total} accounts · Account Registry`
- 按钮: "New Account"（`adminButtonClass('listPrimary')`），无 Refresh 图标按钮在标题栏
- 筛选栏: Asset code 输入框（`w-[180px]`）+ Account Type 下拉 + Owner Type 下拉 + Search 按钮（`adminButtonClass('listPrimary')`）+ Reset 按钮（`adminButtonClass('listSecondary')`）+ Refresh 图标（`adminIconButtonClass()`，`margin-left:auto`）
- 表格 8 列，每列单字段：Account（`rowKeyLink`）| Code | Ledger | Owner（`AdminBadge`）| Owner No | Asset | Status（`AdminBadge`）| Created
- Account 列：`adminButtonClass('rowKeyLink')`，显示 `${TB_CODE_LABELS[row.code] ?? 'CODE_' + row.code} · ${row.assetCode}`，点击导航到 `/ledger/accounts/${row.tbAccountId}`
- thead sticky，`bg-adm-panel`
- Footer: `Showing ${items.length} / ${total} accounts` + Pagination
- 行点击也导航到详情页
- Create Modal 标题改为 "New Ledger Account"
- 导航路径 `/ledger/tb-accounts` 改为 `/ledger/accounts`

- [ ] **Step 2: 删除旧文件**

```bash
git rm admin-web/src/pages/TbAccountList.tsx
```

- [ ] **Step 3: 验证编译**

```bash
cd admin-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/LedgerAccountList.tsx admin-web/src/pages/TbAccountList.tsx
git commit -m "refactor: rewrite TbAccountList → LedgerAccountList with AssetList visual pattern"
```

---

## Task 3: Ledger Account 详情页

**Files:**
- Create: `admin-web/src/pages/LedgerAccountDetail.tsx`
- Delete: `admin-web/src/pages/TbAccountDetail.tsx`

> **参考:** `AssetDetail.tsx` 的 Pattern B 两栏布局（DetailPageHeader + 左侧 Cap 分节 + 右侧 272px Sidebar）。
> **数据源:** 现有 `TbAccountDetail.tsx` 的 fetchData 逻辑完整保留。

- [ ] **Step 1: 创建 LedgerAccountDetail.tsx**

完整重写页面。关键要求：
- 从 `./ledger-account.constants` 导入
- 路由参数改为 `useParams<{ id: string }>()`，变量名 `id`（值仍为 tbAccountId）
- 使用 `DetailPageHeader` 组件（从 `../components/compliance/DetailPageComponents` 导入）：
  - `title`: "LEDGER ACCOUNT"
  - `subtitle`: `${codeLabel} · ${assetCode}`
  - `onBack`: `() => navigate('/ledger/accounts')`
  - `onRefresh`: `() => void fetchData()`
  - `refreshing`: loading
- 使用 `InfoField` 组件（同上导入）
- 左侧内容区 4 个 section（`divide-y divide-adm-border`）：
  - ① Identity（`bg-adm-card`）: Cap "Ledger Account" + 大号标题 + AdminBadge(status) + summary 行
  - ② Balance (Real-Time): Cap + InfoField grid 2 列（Debits Posted/Credits Posted/Debits Pending/Credits Pending/Net Balance），保留颜色区分
  - ③ Details: Cap + InfoField grid 2 列（Owner Type/Owner No/Flags/Description）
  - ④ Audit: Cap + InfoField grid 2 列（Created）
- 右侧 Sidebar（`w-[272px]`）: 1 个 SidebarGroup "Quick Reference"，7 个 SidebarKV（Account/Status/Type/Code/Ledger/Asset/TB ID+copy）
- Cap/SidebarGroup/SidebarKV 定义与 AssetDetail 完全一致
- 移除 BalanceCard 组件
- Loading/Error 状态对齐 AssetDetail（spinner + centered message）

- [ ] **Step 2: 删除旧文件**

```bash
git rm admin-web/src/pages/TbAccountDetail.tsx
```

- [ ] **Step 3: 验证编译**

```bash
cd admin-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/LedgerAccountDetail.tsx admin-web/src/pages/TbAccountDetail.tsx
git commit -m "refactor: rewrite TbAccountDetail → LedgerAccountDetail with AssetDetail Pattern B"
```

---

## Task 4: Transfer Evidence 列表页

**Files:**
- Create: `admin-web/src/pages/TransferEvidenceList.tsx`
- Delete: `admin-web/src/pages/TbTransferList.tsx`

> **参考:** `AssetList.tsx` 四段式布局。
> **数据源:** 现有 `TbTransferList.tsx` 的 fetchData 逻辑完整保留。

- [ ] **Step 1: 创建 TransferEvidenceList.tsx**

完整重写页面。关键要求：
- Title: "Transfer Evidence"，subtitle: `${total} transfers · Ledger Evidence`
- 无创建按钮（evidence 只读）
- 筛选栏: Source 下拉 + Asset code 输入框 + Event code 输入框 + Transfer Type 下拉 + Search + Reset + Refresh（最右端）
- 表格 9 列，每列单字段：Source（`AdminBadge`）| Source No（mono）| Event | Debit（mono amber）| Credit（mono blue）| Amount（右对齐 tabular-nums 粗体）| Asset（粗体）| Type（`AdminBadge`）| Created
- Transfer ID 列从表格中移除
- thead sticky，`bg-adm-panel`
- Footer 与 AssetList 一致

- [ ] **Step 2: 删除旧文件**

```bash
git rm admin-web/src/pages/TbTransferList.tsx
```

- [ ] **Step 3: 验证编译**

```bash
cd admin-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/TransferEvidenceList.tsx admin-web/src/pages/TbTransferList.tsx
git commit -m "refactor: rewrite TbTransferList → TransferEvidenceList with AssetList visual pattern"
```

---

## Task 5: Retry Queue 列表页

**Files:**
- Create: `admin-web/src/pages/RetryQueueList.tsx`
- Delete: `admin-web/src/pages/TbBacklogList.tsx`

> **参考:** `AssetList.tsx` 四段式布局。
> **数据源:** 现有 `TbBacklogList.tsx` 的 fetchData 逻辑完整保留。
> **注意:** 这是改动最小的页面——列结构完全保持不变，主要是命名和筛选栏样式对齐。

- [ ] **Step 1: 创建 RetryQueueList.tsx**

完整重写页面。关键要求：
- Title: "Retry Queue"，subtitle: `${total} entries · Failed Transfer Retries`
- 无创建按钮
- 筛选栏: Status 下拉 + Search + Reset + Refresh（最右端）
- 表格 6 列（与当前完全一致，每列单字段）：Transfer ID（mono truncate）| Error（adm-red truncate）| Retries（mono 居中）| Status（`AdminBadge`）| Created | Resolved
- thead sticky，`bg-adm-panel`
- Footer 与 AssetList 一致

- [ ] **Step 2: 删除旧文件**

```bash
git rm admin-web/src/pages/TbBacklogList.tsx
```

- [ ] **Step 3: 验证编译**

```bash
cd admin-web && npx tsc --noEmit 2>&1 | head -20
```

Expected: 无 TypeScript 错误。

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/pages/RetryQueueList.tsx admin-web/src/pages/TbBacklogList.tsx
git commit -m "refactor: rewrite TbBacklogList → RetryQueueList with AssetList visual pattern"
```

---

## Task 6: 端到端验证

- [ ] **Step 1: TypeScript 全量检查**

```bash
cd admin-web && npx tsc --noEmit
```

Expected: 无错误。

- [ ] **Step 2: 确认旧文件已删除**

```bash
ls admin-web/src/pages/Tb*.tsx 2>/dev/null && echo "ERROR: old files still exist" || echo "OK: old files removed"
ls admin-web/src/pages/tb-account.constants.ts 2>/dev/null && echo "ERROR: old constants file" || echo "OK: constants renamed"
```

Expected: 两行 OK。

- [ ] **Step 3: 启动 admin-web 开发服务器并验证**

启动服务并在浏览器中验证：
1. 侧边栏显示 "Ledger" 分组，包含 "Ledger Accounts"、"Transfer Evidence"、"Retry Queue" 三个菜单项
2. 点击 "Ledger Accounts" 导航到 `/ledger/accounts`，页面标题为 "Ledger Accounts"
3. 点击行导航到 `/ledger/accounts/:id`，详情页标题为 "LEDGER ACCOUNT"，两栏布局正常
4. 点击 "Transfer Evidence" 导航到 `/ledger/transfers`，9 列表格正常
5. 点击 "Retry Queue" 导航到 `/ledger/retry-queue`，6 列表格正常
6. Create Account Modal 标题为 "New Ledger Account"

- [ ] **Step 4: 确认无遗留引用**

```bash
grep -r "TbAccountList\|TbAccountDetail\|TbTransferList\|TbBacklogList\|tb-account\.constants\|tb-accounts\|tb-transfers\|tb-backlog" admin-web/src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v ".constants.ts"
```

Expected: 无匹配（或只有 API URL 中的 `/admin/tb/` 路径，这是预期内的后端端点）。

---

## Self-Review

**Spec coverage:**
- ✅ 命名变更（Accounting→Ledger, TB Accounts→Ledger Accounts 等）→ Task 1
- ✅ 路由变更（tb-accounts→accounts 等）→ Task 1
- ✅ 文件重命名 → Task 1 (constants) + Task 2-5 (pages)
- ✅ Ledger Accounts 列表页对齐 AssetList → Task 2
- ✅ Ledger Account 详情页对齐 AssetDetail Pattern B → Task 3
- ✅ Transfer Evidence 列表页对齐 AssetList → Task 4
- ✅ Retry Queue 列表页对齐 AssetList → Task 5
- ✅ 每列单字段规则 → Task 2-5 各自的列定义
- ✅ 筛选栏 Search+Reset 模式 → Task 2-5
- ✅ 端到端验证 → Task 6

**Placeholder scan:** 无 TBD / TODO。

**Type consistency:** 所有文件名（LedgerAccountList/LedgerAccountDetail/TransferEvidenceList/RetryQueueList）和导入路径在 Task 1-6 中保持一致。常量导入统一为 `./ledger-account.constants`。
