# Withdrawal Fee Level Admin Pages — Design Spec

## 1. Overview

为 Withdrawal Fee Level 功能增加 admin-web 前端页面，覆盖费率等级的完整生命周期管理：列表浏览、详情查看、创建（触发审批）、变更（触发审批）、客户绑定/解绑。

后端 API 已就绪（`admin/withdrawal-fee-levels`，7 个端点），本 spec 仅覆盖 admin-web React 页面。

## 2. Page Structure

两页模式，镜像 TransactionLimitList / TransactionLimitDetail 模式：

| 文件 | 职责 |
|------|------|
| `admin-web/src/pages/WithdrawalFeeLevelList.tsx` | 列表 + 创建 Modal |
| `admin-web/src/pages/WithdrawalFeeLevelDetail.tsx` | 详情 + Change Modal + Bind Modal + Bindings 展示 |

路由注册在 `App.tsx`，导航入口加入 DashboardLayout 的 Pricing 分组。

## 3. WithdrawalFeeLevelList.tsx

### 3.1 Layout

```
┌─────────────────────────────────────────────────────┐
│ PageTitleBar: "Withdrawal Fee Levels"  [+ Create]   │
├─────────────────────────────────────────────────────┤
│ Filter: [Asset ▼] [Status ▼] [☐ Default Only] [🔄] │
├─────────────────────────────────────────────────────┤
│ Table (7 columns)                                   │
│ ┌──────────┬──────┬───────┬───┬─────┬────────┬────┐ │
│ │LevelCode │Name  │Asset  │Def│Tiers│Status  │Upd │ │
│ ├──────────┼──────┼───────┼───┼─────┼────────┼────┤ │
│ │STD-USDT  │Std.. │USDT-T │ ✅│  1  │ACTIVE  │... │ │
│ │VIP-USDT  │VIP.. │USDT-T │ — │  1  │PENDING │... │ │
│ └──────────┴──────┴───────┴───┴─────┴────────┴────┘ │
├─────────────────────────────────────────────────────┤
│ Footer: "N levels total"                            │
└─────────────────────────────────────────────────────┘
```

### 3.2 Table Columns

| 列 | 数据源 | 显示 |
|----|--------|------|
| Level Code | `levelCode` | amber mono，点击行跳转 Detail |
| Name | `name` | 原文 |
| Asset | `asset.code` | badge 带类型色标（CRYPTO=蓝 `bg-blue-100`, FIAT=黄 `bg-amber-100`） |
| Default | `isDefault` | ✅ / — |
| Tiers | `JSON.parse(tiersJson).tiers.length` | 数字 |
| Status | `status` | AdminBadge（ACTIVE=green, PENDING_APPROVAL=amber, REJECTED=red） |
| Updated | `updatedAt` | `fmt()` 格式化日期 |

### 3.3 Filters

- **Asset**: Select 下拉，从 `GET /assets?status=ACTIVE&take=200` 加载选项，传 `assetId` query param
- **Status**: Select 下拉，选项 `['ACTIVE', 'PENDING_APPROVAL', 'REJECTED']`，传 `status` query param
- **Default Only**: Checkbox，客户端过滤（后端无此 filter param）
- **Refresh**: 按钮，重新调用 API

### 3.4 API

- `GET /admin/withdrawal-fee-levels?assetId=&status=&skip=&take=20`
- Response: `{ items: [...], total: number }`

### 3.5 Create Modal

点击 "+ Create Level" 按钮弹出 Modal，字段：

| 字段 | 类型 | 验证 |
|------|------|------|
| Level Code | text input | 必填，大写字母+连字符格式 |
| Name | text input | 必填 |
| Asset | select（从 `/assets` 加载） | 必填 |
| Is Default | checkbox | — |
| Tiers | 结构化 Tier 编辑器（见 §5） | 至少 1 个 tier，每个 tier 至少 1 个 feeItem |
| Reason | textarea | 必填（审批理由） |

提交: `POST /admin/withdrawal-fee-levels`，body: `{ levelCode, name, assetId, isDefault, tiersJson, reason }`

成功后关闭 Modal，刷新列表。

## 4. WithdrawalFeeLevelDetail.tsx

### 4.1 Layout

```
┌───────────────────────────────────────┬────────────┐
│ ← Withdrawal Fee Levels         [🔄] │ ACTIONS    │
├───────────────────────────────────────┤ [Edit Tiers]│
│ HERO                                  │ [Bind Cust] │
│ STD-USDT-TRON  [ACTIVE] [DEFAULT]     │ approval注  │
│ Standard USDT                         ├────────────┤
│ Asset: USDT-TRON (CRYPTO) · 1 tier    │ IDENTITY   │
├───────────────────────────────────────┤ Level Code │
│ FEE TIERS                             │ Status     │
│ ┌─────────────────────────────────┐   │ Asset      │
│ │ Default Tier  #TIER-001         │   │ Default    │
│ │ Range: 0 — ∞                    │   │ Config Hash│
│ │ ┌────────┬────┬─────┬────┐      │   │ Approval → │
│ │ │FeeItem │Type│Value│Cur │      │   ├────────────┤
│ │ │SVC_FEE │FLAT│  0  │USDT│      │   │ LIFECYCLE  │
│ │ │NET_FEE │FLAT│  0  │USDT│      │   │ Created    │
│ │ └────────┴────┴─────┴────┘      │   │ Updated    │
│ └─────────────────────────────────┘   │            │
├───────────────────────────────────────┤            │
│ CUSTOMER BINDINGS (1)                 │            │
│ ┌──────────┬──────┬────────┬──────┐   │            │
│ │CustNo    │Name  │BoundAt │Action│   │            │
│ │CU260101..│Helen │29 May  │Unbind│   │            │
│ └──────────┴──────┴────────┴──────┘   │            │
├───────────────────────────────────────┤            │
│ ▶ Technical (Raw JSON)                │            │
└───────────────────────────────────────┴────────────┘
```

### 4.2 Main Sections

**Hero**: levelCode（amber mono, 20px）+ Status AdminBadge + DEFAULT 标签（isDefault 时显示蓝色 badge）+ name + asset 概要行

**Fee Tiers**: 从 `tiersJson` 解析，每个 tier 一张卡片：
- 卡片头部：tier name + tier id（灰色小字）+ priority + enabled 状态
- 卡片体：金额区间（amountMin — amountMax，null 显示 ∞）+ fee items 表格

Fee items 表格列：Fee Item / Calc Type / Value / Currency / Min / Cap
- `calcType` 用小 badge 显示（FLAT / PERCENT / PERCENT_WITH_MIN）
- `value` 用 monospace
- `min` / `cap` 为 null 时显示 `—`

**Customer Bindings**: 纯展示表格（操作按钮在 sidebar）
- 列：Customer No（amber mono）/ Name / Bound At / Action（Unbind 按钮）
- Unbind: 确认弹窗 → `DELETE /admin/withdrawal-fee-levels/bindings/unbind` body `{ customerId, levelId }`
- 空状态：灰色文字 "No customers bound to this level"

**Technical**: 可折叠区域，展示 raw JSON（同 PayinDetail 模式）

### 4.3 Sidebar (272px)

**Actions**（仅 status=ACTIVE 时显示）:
- "✏️ Edit Tiers" — amber 主按钮（`adminButtonClass('workflowPrimary')`），点击打开 Change Modal
- "👤 Bind Customer" — outline 次按钮（`adminButtonClass('listSecondary')`），点击打开 Bind Modal
- 底部注释文字："Edit Tiers requires MLRO → SMO approval"

**Identity**:
- Level Code
- Status（AdminBadge）
- Asset（code + type）
- Default（Yes / No）
- Config Hash（truncated，可复制）
- Approval（approvalCaseNo 有值时显示为链接，否则 —）

**Lifecycle**:
- Created（`createdAt` fmt）
- Updated（`updatedAt` fmt）

### 4.4 API

- Detail fetch: `GET /admin/withdrawal-fee-levels/:levelCode`
- Bindings fetch: `GET /admin/withdrawal-fee-levels/:levelCode/bindings`
- Change submit: `POST /admin/withdrawal-fee-levels/:levelCode/change` body `{ proposedTiersJson, changeReason }`
- Bind: `POST /admin/withdrawal-fee-levels/bindings/bind` body `{ customerId, levelId }`
- Unbind: `DELETE /admin/withdrawal-fee-levels/bindings/unbind` body `{ customerId, levelId }`

### 4.5 Change Modal (Edit Tiers)

点击 "Edit Tiers" 弹出 Modal：
- 预加载当前 `tiersJson` 到结构化 Tier 编辑器（见 §5）
- 额外字段：Change Reason（textarea，必填）
- 提交: `POST /admin/withdrawal-fee-levels/:levelCode/change`
- 成功后关闭 Modal，刷新页面

### 4.6 Bind Modal

点击 "Bind Customer" 弹出 Modal：
- 字段：Customer ID（text input，输入 UUID）
- 提交: `POST /admin/withdrawal-fee-levels/bindings/bind` body `{ customerId, levelId }`
- 成功后关闭 Modal，刷新 bindings 列表

## 5. Tier Editor Component

Create Modal 和 Change Modal 共用的结构化 Tier 编辑器。

### 5.1 结构

```
┌─────────────────────────────────────────────┐
│ Tier 1: [Name ___________] Priority: [1]    │
│ Range: [0 _____] — [_____ ] (空=无上限)      │
│ ┌────────────────┬────────┬───────┬────┐    │
│ │Fee Item (select)│Type ▼ │Value  │Cur │    │
│ │WITHDRAW_SVC_FEE │FLAT   │ 0     │USDT│    │
│ │NETWORK_FEE_EST  │FLAT   │ 0     │USDT│    │
│ │              [+ Add Fee Item]          │    │
│ └────────────────┴────────┴───────┴────┘    │
│                              [🗑 Remove Tier]│
├─────────────────────────────────────────────┤
│                   [+ Add Tier]               │
└─────────────────────────────────────────────┘
```

### 5.2 Tier Fields

| 字段 | 类型 | 说明 |
|------|------|------|
| Name | text | Tier 名称 |
| Priority | number | 排序优先级 |
| Amount Min | number | 最低金额（默认 0） |
| Amount Max | number \| null | 最高金额（空 = 无上限） |
| Enabled | checkbox | 默认 true |

### 5.3 Fee Item Fields

| 字段 | 类型 | 说明 |
|------|------|------|
| Item Code | select | `WITHDRAW_SERVICE_FEE` / `NETWORK_FEE_EST` |
| Calc Type | select | `FLAT` / `PERCENT` / `PERCENT_WITH_MIN` |
| Value | number | 费率值 |
| Currency | text | 币种（从 asset 继承，只读或可编辑） |
| Min | number \| null | 最低收费（仅 PERCENT 类型有意义） |
| Cap | number \| null | 封顶收费 |
| Rounding DP | number | 小数位数（默认从 asset.decimals） |
| Rounding Mode | select | `ROUND` / `CEIL` / `FLOOR`（默认 ROUND） |

### 5.4 Serialization

编辑器状态 → `tiersJson` string：

```typescript
// 每个 tier 自动生成 id（如 "TIER-{index+1}"）
// 每个 feeItem 自动生成 id（如 "TIER-1-FEE-{index+1}"）
const tiersJson = JSON.stringify({
  tiers: tiers.map((t, ti) => ({
    id: t.id || `TIER-${ti + 1}`,
    name: t.name,
    priority: t.priority,
    enabled: t.enabled,
    conditions: { amountMin: t.amountMin, amountMax: t.amountMax || null },
    feeItems: t.feeItems.map((f, fi) => ({
      id: f.id || `TIER-${ti + 1}-FEE-${fi + 1}`,
      itemCode: f.itemCode,
      calcType: f.calcType,
      value: String(f.value),
      currency: f.currency,
      min: f.min ? String(f.min) : null,
      cap: f.cap ? String(f.cap) : null,
      roundingDp: f.roundingDp,
      roundingMode: f.roundingMode,
      adjustable: false,
    })),
  })),
});
```

Change Modal 加载时反向解析已有 `tiersJson` 填充编辑器状态。

## 6. Route & Navigation

### 6.1 Routes（App.tsx）

```typescript
const WithdrawalFeeLevelList = lazy(() => import('./pages/WithdrawalFeeLevelList'));
const WithdrawalFeeLevelDetail = lazy(() => import('./pages/WithdrawalFeeLevelDetail'));

// 在 pricing 分组内：
<Route path="pricing/withdrawal-fee-levels"
  element={withPermission(<WithdrawalFeeLevelList />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])} />
<Route path="pricing/withdrawal-fee-levels/:levelCode"
  element={withPermission(<WithdrawalFeeLevelDetail />, [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ])} />
```

### 6.2 Navigation（DashboardLayout.tsx）

在 Pricing 分组内添加：

```typescript
{
  path: '/dashboard/pricing/withdrawal-fee-levels',
  label: 'Withdrawal Fee Levels',
  icon: <Layers size={13} />,
  requiredPermissions: [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ],
}
```

### 6.3 Permissions

在权限常量中添加 `WITHDRAWAL_FEE_LEVELS_READ`。对应后端 guard 的 permission code 前缀 `GET:/admin/withdrawal-fee-levels`。

## 7. Status Badge Colors

复用 `AdminBadge` 组件，映射：

| Status | Badge Variant |
|--------|---------------|
| ACTIVE | green |
| PENDING_APPROVAL | amber |
| REJECTED | red |

## 8. Error Handling

- API 错误: 顶部 notice bar 展示错误消息（同 TransactionLimitDetail 模式）
- Modal 提交失败: Modal 内显示错误文本，不关闭 Modal
- 404: 显示 "Level not found" 占位

## 9. Out of Scope

- 审批流程操作（在 Approval Cases 页面处理）
- Change Request 历史列表（后续可扩展）
- 客户搜索/自动补全（Bind Modal 直接输入 Customer ID）
