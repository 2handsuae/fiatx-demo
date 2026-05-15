# Ledger Admin Pages — Visual Alignment Redesign

**Goal:** 将 Accounting 域下的 4 个管理台页面（TB Accounts 列表、TB Account 详情、TB Transfers 列表、TB Backlog 列表）在视觉和布局上对齐 Asset 页面的设计语言，同时将命名和路由业务化。

**Scope:** 纯前端视觉重构，不涉及后端 API 变更、字段增减或功能逻辑修改。

---

## 1. 命名与路由变更

### 侧边栏分组

| 当前 | 重构后 |
|------|--------|
| Accounting | **Ledger** |

### 菜单项与路由

| 当前菜单 | 当前路由 | 重构菜单 | 重构路由 |
|----------|---------|---------|---------|
| TB Accounts | `/ledger/tb-accounts` | **Ledger Accounts** | `/ledger/accounts` |
| — | `/ledger/tb-accounts/:tbAccountId` | — | `/ledger/accounts/:id`（路由参数改为 `:id`，值仍为 tbAccountId） |
| TB Transfers | `/ledger/tb-transfers` | **Transfer Evidence** | `/ledger/transfers` |
| TB Backlog | `/ledger/tb-backlog` | **Retry Queue** | `/ledger/retry-queue` |

### 文件重命名

| 当前文件 | 重构文件 |
|---------|---------|
| `TbAccountList.tsx` | `LedgerAccountList.tsx` |
| `TbAccountDetail.tsx` | `LedgerAccountDetail.tsx` |
| `TbTransferList.tsx` | `TransferEvidenceList.tsx` |
| `TbBacklogList.tsx` | `RetryQueueList.tsx` |
| `tb-account.constants.ts` | `ledger-account.constants.ts` |

---

## 2. 设计规则（全局）

以下规则适用于所有 4 个页面：

- **每列单字段**：表格中每一列只放一个数据字段，禁止在一个单元格内堆叠两个字段（badge + 副行文本等）
- **筛选栏**：统一为 Search + Reset 双按钮模式，Refresh 图标移到筛选栏最右端（对齐 AssetList）
- **表头**：sticky `thead`，使用 `bg-adm-panel` 背景，`th` 样式统一为 `font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3`
- **Footer**：`Showing X / Y items` + `Pagination` 组件，与 AssetList 一致
- **组件复用**：使用 `PageTitleBar`、`AdminBadge`、`Pagination`、`adminButtonClass`、`adminIconButtonClass`，不自定义等效组件

---

## 3. Ledger Accounts — 列表页

### 参考模式

AssetList 四段式：PageTitleBar → Filter Bar → Table → Footer

### 标题栏

- Title: **"Ledger Accounts"**
- Subtitle: `${total} accounts · Account Registry`
- 按钮: **"New Account"**（对齐 AssetList 的 "New Asset"），使用 `adminButtonClass('listPrimary')`

### 筛选栏

- Asset code 输入框（`w-[180px]`）
- Account Type 下拉：All types / BANK / CUSTODY / CLIENT_CREDIT / CLIENT_AUDIT / TRADE_CLEARING / FEE_RECEIVABLE
- Owner Type 下拉：All owners / SYSTEM / CUSTOMER / LP
- Search 按钮（`adminButtonClass('listPrimary')`）
- Reset 按钮（`adminButtonClass('listSecondary')`）
- Refresh 图标（`adminIconButtonClass()`，最右端）

### 表格列（8 列，每列单字段）

| 列名 | 字段 | 样式 |
|------|------|------|
| Account | `codeLabel · assetCode`（如 "BANK · AED"） | `adminButtonClass('rowKeyLink')`，点击跳转详情 |
| Code | `code` | mono |
| Ledger | `ledger` | mono |
| Owner | `ownerType` | `AdminBadge` |
| Owner No | `ownerNo` | mono，null 显示 "—" |
| Asset | `assetCode` | 粗体 |
| Status | `status` | `AdminBadge` |
| Created | `createdAt` | mono 时间戳 |

### 行为

- 行点击导航到 `/ledger/accounts/${tbAccountId}`
- 首列使用 `rowKeyLink` 样式（amber 色链接，与 AssetList 首列一致）

### Create Account Modal

保持当前 Modal 逻辑不变，仅修改标题文案：
- "Create TB Account" → **"New Ledger Account"**

---

## 4. Ledger Account — 详情页

### 参考模式

AssetDetail Pattern B 两栏布局：DetailPageHeader + 左侧内容区（Cap 分节）+ 右侧 272px Sidebar

### Header

使用 `DetailPageHeader` 组件（替代当前手写 header）：
- `title`: "LEDGER ACCOUNT"
- `subtitle`: `${codeLabel} · ${assetCode}`（如 "BANK · AED"）
- `onBack`: 导航到 `/ledger/accounts`
- `onRefresh`: 刷新数据
- `refreshing`: loading 状态

### 左侧内容区（4 个 section，`divide-y divide-adm-border`）

**① Identity（`bg-adm-card`）**
- `Cap`: "Ledger Account"
- 大号标题: `${codeLabel} · ${assetCode}`，font-mono text-[19px] font-bold text-adm-amber
- 下方: `AdminBadge(status)` + `Code ${code} · Ledger ${ledger} · ${ownerType}`

**② Balance (Real-Time)**
- `Cap`: "Balance (Real-Time)"
- `InfoField` grid（2 列，`gap-x-8 gap-y-4`）：
  - Debits Posted — mono，amber 色
  - Credits Posted — mono，blue 色
  - Debits Pending — mono，amber/60 色
  - Credits Pending — mono，blue/60 色
  - Net Balance — mono，正数 green / 负数 red

**③ Details**
- `Cap`: "Details"
- `InfoField` grid（2 列）：
  - Owner Type — `AdminBadge`
  - Owner No — mono，null 显示 "—"
  - Flags — mono，hex 格式 `0x${flags.toString(16).padStart(2, '0')}`
  - Description — 文本，null 显示 "—"

**④ Audit**
- `Cap`: "Audit"
- `InfoField` grid（2 列）：
  - Created — mono 时间戳

### 右侧 Sidebar（272px）

1 个 `SidebarGroup`："Quick Reference"

| Label | Value | 样式 |
|-------|-------|------|
| Account | `${codeLabel} · ${assetCode}` | — |
| Status | `AdminBadge(status)` | — |
| Type | `ownerType` | — |
| Code | `${code} · ${codeLabel}` | mono |
| Ledger | `ledger` | mono |
| Asset | `assetCode` | mono |
| TB ID | `tbAccountId` + copy 按钮 | mono，truncate |

### 移除的组件

- `BalanceCard` 组件：不再使用，改为 `InfoField` 布局
- 手写 `Cap`/`SidebarGroup`/`SidebarKV`：改为从 `AssetDetail` 或 `DetailPageComponents` 导入共享组件（如果已提取）；否则保持 inline 定义但确保与 AssetDetail 完全一致

---

## 5. Transfer Evidence — 列表页

### 参考模式

AssetList 四段式

### 标题栏

- Title: **"Transfer Evidence"**
- Subtitle: `${total} transfers · Ledger Evidence`
- 无创建按钮（evidence 是只读记录）

### 筛选栏

- Source 下拉：All sources / DEPOSIT / WITHDRAWAL / SWAP / INTERNAL / FEE
- Asset code 输入框
- Event code 输入框
- Transfer Type 下拉：All types / POSTED / PENDING / POST_PENDING / VOID_PENDING / CORRECTING
- Search 按钮
- Reset 按钮
- Refresh 图标（最右端）

### 表格列（9 列，每列单字段）

| 列名 | 字段 | 样式 |
|------|------|------|
| Source | `sourceType` | `AdminBadge` |
| Source No | `sourceNo` | mono |
| Event | `eventCode` | 文本 |
| Debit | `debitCode` | mono，amber 色 |
| Credit | `creditCode` | mono，blue 色 |
| Amount | `amount` | 右对齐，tabular-nums，粗体 |
| Asset | `assetCode` | 粗体 |
| Type | `transferType` | `AdminBadge` |
| Created | `createdAt` | mono 时间戳 |

### 移除的列

- Transfer ID（`tbTransferId`）：裸 hex 字符串对 operator 无意义，从表格中移除

---

## 6. Retry Queue — 列表页

### 参考模式

AssetList 四段式

### 标题栏

- Title: **"Retry Queue"**
- Subtitle: `${total} entries · Failed Transfer Retries`
- 无创建按钮（运维只读页面）

### 筛选栏

- Status 下拉：All statuses / PENDING / RESOLVED / FAILED
- Search 按钮
- Reset 按钮
- Refresh 图标（最右端）

### 表格列（6 列，每列单字段）

| 列名 | 字段 | 样式 |
|------|------|------|
| Transfer ID | `tbTransferId` | mono，truncate + title tooltip |
| Error | `errorMessage` | adm-red 色，truncate + title tooltip |
| Retries | `retryCount` | mono，居中 |
| Status | `status` | `AdminBadge` |
| Created | `createdAt` | mono 时间戳 |
| Resolved | `resolvedAt` | mono 时间戳，null 显示 "—" |

### 注意

列结构与当前完全一致，只做命名和筛选栏样式对齐。

---

## 7. 涉及的联动文件

| 文件 | 变更内容 |
|------|---------|
| `App.tsx` | 路由路径更新：`tb-accounts` → `accounts`，`tb-transfers` → `transfers`，`tb-backlog` → `retry-queue` |
| `DashboardLayout.tsx` | 侧边栏分组名 Accounting → Ledger；菜单项 label 和 path 更新 |
| `tb-account.constants.ts` → `ledger-account.constants.ts` | 文件重命名，导出名不变 |

---

## 8. 不在范围内

- 后端 API 端点不变（`/admin/tb/accounts`、`/admin/tb/transfers`、`/admin/tb/backlog`）
- 字段不增不减
- 功能逻辑不变（Create Modal、筛选、分页、行点击导航等行为保持原样）
- TB Backlog 列表不加行点击/详情页
