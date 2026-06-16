# Fee Accrual Admin Pages — 设计稿

**日期**：2026-06-16
**范围**：在 admin 侧新增 fee_accruals 列表 + 详情两个页面，紧邻 Swap Outstandings 之下，作为 Reconciliation 分组的第 5 项导航。
**基准**：复用 SwapOutstandingList/Detail 的页面结构、样式、过滤器模式作为 1:1 基线。

---

## 1. 问题陈述

`fee_accruals` 表 V7 funds-layer 建好（22 列、含 originTraceId / settlementBatchId / settledByTransferId 等关联键），后端 `fee-accrual.service.ts` 已实现写入逻辑（accrueForSwap / accrueForWithdraw / settle）但 **0 admin 暴露面**：

- 0 controller — admin 看不到 fee_accrual 数据
- 0 admin 页面 — 收对账只能查 SQL
- swap / withdraw / settlement_batch 详情页**已有跳转链路**但落地无页面

业务诉求：审计 / 对账 / 客户支持都需要按 feeAccrualNo / sourceNo / ownerNo 快速定位单条 accrual 并看其状态机 + 关联链。

---

## 2. 顶层设计

**底层逻辑**：fee_accrual 与 outstanding 是平行的两套"债权债务台账"——前者记平台收入应计、后者记客户应收应付。Outstanding 已有列表 + 详情对，fee_accrual 1:1 镜像建一对、复用所有视觉原子和交互模式。

**抓手**：
1. 后端：1 个 controller（`fee-accruals.controller.ts`）、2 个 endpoint（list + detail）、含 sibling 查询
2. 前端：2 个新页面（`FeeAccrualList.tsx` + `FeeAccrualDetail.tsx`），新增 1 条侧边栏菜单 + 2 条路由 + 2 条 permission
3. 详情页加 **sibling 区** —— 同 sourceId 的其他 accrual 一屏展示（对账强需求）

**闭环边界**：
- ✅ 做：list/detail 渲染、过滤器、跳转、sibling 展示
- ❌ 不做：批量操作（mark settled / csv 导出）、状态机推进按钮（accrual 是被动写入、admin 不该手动改状态）、新增/删除 accrual

---

## 3. 后端 API

### 3.1 路由

| Method | 路径 | 权限 | 功能 |
|---|---|---|---|
| GET | `/api/admin/fee-accruals` | `FEE_ACCRUALS_READ` | 列表分页 + 过滤 |
| GET | `/api/admin/fee-accruals/:id` | `FEE_ACCRUAL_DETAIL_READ` | 详情 + sibling |

### 3.2 列表 query 参数

| 参数 | 类型 | 含义 |
|---|---|---|
| `q` | string | 通用搜索（按 feeAccrualNo 前缀） |
| `feeAccrualNo` | string | 精确编号 |
| `sourceNo` | string | swap.swapNo / withdraw.withdrawNo 模糊 |
| `ownerNo` | string | 客户号模糊 |
| `status` | `ACCRUED \| LOCKED \| SETTLED` | 单选 |
| `category` | `SWAP_FEE \| WITHDRAW_FEE` | 单选 |
| `feeKind` | `SERVICE_FEE \| SPREAD` | 单选 |
| `assetCode` | string | 资产代码 |
| `startDate` | ISO date | 创建时间下限 |
| `endDate` | ISO date | 创建时间上限 |
| `page` | number | 默认 1 |
| `pageSize` | number | 默认 20 |

排序：默认 `createdAt DESC`。

### 3.3 列表返回

```ts
{
  items: Array<{
    id: string,
    feeAccrualNo: string | null,
    sourceType: string,
    sourceNo: string | null,
    ownerNo: string | null,
    feeKind: 'SERVICE_FEE' | 'SPREAD',
    category: 'SWAP_FEE' | 'WITHDRAW_FEE',
    assetCode: string | null,
    amount: string,
    status: 'ACCRUED' | 'LOCKED' | 'SETTLED',
    settlementBatch: { id: string, batchNo: string | null } | null,
    settledByTransfer: { id: string, internalTxNo: string | null } | null,
    createdAt: string,
  }>,
  total: number,
}
```

### 3.4 详情返回

```ts
{
  // fee_accrual 自身全字段
  id, feeAccrualNo, sourceType, sourceId, sourceNo, ownerType, ownerId, ownerNo,
  feeKind, category, assetId, assetCode, amount, status,
  lockedAt, closedAt, closedByInternalFundId, createdAt, updatedAt, originTraceId,

  // 关联实体的业务键（用于跳转 + 显示）
  settlementBatch: { id, batchNo } | null,
  settledByTransfer: { id, internalTxNo } | null,
  closedByInternalFund: { id, internalFundNo } | null,

  // 同源其他 accrual（排除自身）
  siblings: Array<{
    id, feeAccrualNo, feeKind, amount, assetCode, status, createdAt,
  }>,
}
```

`siblings` 查询：`WHERE sourceType=? AND sourceId=? AND id != ?` 按 createdAt ASC。

---

## 4. 前端列表页（`FeeAccrualList.tsx`）

### 4.1 复用基线

复制 `SwapOutstandingList.tsx` 整体结构：
- Header 用 `PageTitleBar` "Fee Accruals"
- 顶部 filter 区（chips + Search/Reset 按钮）—— 复用 `adminButtonClass` / `adminIconButtonClass`
- 中部 table —— 复用 `<table className="min-w-full divide-y divide-slate-200">` 模式
- 底部 `<Pagination>` 组件
- loading / error state 同款

### 4.2 列表列定义（10 列）

| # | 列标题 | 字段 | 渲染 |
|---|---|---|---|
| 1 | Accrual No | `feeAccrualNo` | 文本、整行 onClick 跳详情 |
| 2 | Source | `sourceType` + `sourceNo` | "SWAP SWP2606165444"、点击跳源详情（swap/withdraw） |
| 3 | Category | `category` | `<AdminBadge>` SWAP_FEE 蓝 / WITHDRAW_FEE 紫 |
| 4 | Fee Kind | `feeKind` | `<AdminBadge>` SERVICE_FEE 灰 / SPREAD 琥珀 |
| 5 | Owner | `ownerNo` | 文本、点击跳客户详情 |
| 6 | Amount | `amount` + `assetCode` | `formatAssetAmount` 右对齐 |
| 7 | Status | `status` | colored badge（ACCRUED 灰 / LOCKED 蓝 / SETTLED 绿） |
| 8 | Batch | `settlementBatch.batchNo` | 可跳 batch 详情、null 显 "—" |
| 9 | Transfer | `settledByTransfer.internalTxNo` | 可跳 transfer 详情、null 显 "—" |
| 10 | Created | `createdAt` | `toLocaleString()` |

### 4.3 过滤器

顶部一行（与 SwapOutstandingList 一致风格）：

- `Accrual No` 文本输入
- `Source No` 文本输入
- `Owner No` 文本输入
- `Status` 下拉（空 / ACCRUED / LOCKED / SETTLED）
- `Category` 下拉（空 / SWAP_FEE / WITHDRAW_FEE）
- `Fee Kind` 下拉（空 / SERVICE_FEE / SPREAD）
- `Asset Code` 文本
- `Start Date` / `End Date` 日期选择

按钮：`Search` / `Reset`。

---

## 5. 前端详情页（`FeeAccrualDetail.tsx`）

### 5.1 路由参数

`/dashboard/reconciliation/fee-accruals/:id` —— `id` = `fee_accrual.id`（UUID）。Header 上展示业务键 `feeAccrualNo`、不展示 UUID。

### 5.2 布局（4 区）

#### Header 区
- 业务标题：`Accrual {feeAccrualNo}` + 状态 badge
- 右上：返回按钮

#### § 1. Identity（4 个字段卡 2×2）
| | |
|---|---|
| **Accrual No** `feeAccrualNo` | **Category** `category`（badge） |
| **Fee Kind** `feeKind`（badge） | **Amount** `{amount} {assetCode}` |
| **Owner** `ownerNo`（跳客户详情） | **Source** `{sourceType} {sourceNo}`（跳源详情） |

#### § 2. Settlement linkage（4 个字段卡 2×2）
| | |
|---|---|
| **Status** `status`（badge） | **Locked At** `lockedAt`（"—" 若 null） |
| **Closed At** `closedAt`（"—" 若 null） | — |
| **Settlement Batch** `settlementBatch.batchNo`（跳 batch 详情，可空） | **Settled By Transfer** `settledByTransfer.internalTxNo`（跳，可空） |
| **Closed By Fund** `closedByInternalFund.internalFundNo`（跳，可空） | — |

#### § 3. Traceability
- **Origin Trace ID** `originTraceId` —— 等宽字体显示、右侧复制按钮（点击 navigator.clipboard）。"—" 若 null。

#### § 4. Sibling accruals（同源其他 accrual）
- 标题：`Sibling Accruals ({siblings.length})`
- 表格 5 列：feeAccrualNo / feeKind / amount + assetCode / status / createdAt
- 整行 onClick → 跳该 sibling 详情
- 0 行时显示 "No other accruals from this source."

### 5.3 跳转链路汇总

| 字段 | 跳转目标 | 路径 |
|---|---|---|
| `sourceNo` (SWAP) | swap 详情 | `/dashboard/trading/swap-transactions/:swapId` |
| `sourceNo` (WITHDRAW) | withdraw 详情 | `/dashboard/trading/withdraw-transactions/:withdrawId` |
| `ownerNo` | 客户详情 | `/dashboard/customers/:customerId` |
| `settlementBatch.batchNo` | settlement batch 详情 | `/dashboard/reconciliation/outstanding-settlements/:batchId` |
| `settledByTransfer.internalTxNo` | internal transfer 详情 | `/dashboard/treasury/internal-transactions/:txId` |
| `closedByInternalFund.internalFundNo` | internal fund 详情 | `/dashboard/treasury/internal-funds/:fundId` |
| sibling 行 | 该 sibling 详情 | `/dashboard/reconciliation/fee-accruals/:siblingId` |

实际路径以现有代码为准（T1 plan 阶段确认）。所有跳转用 React Router `navigate()`、不用 `<a href>`。

---

## 6. 侧边栏 + 路由

### 6.1 侧边栏（`DashboardLayout.tsx`）

在 Reconciliation 分组、`Swap Outstandings` 紧下方追加：

```tsx
{
  path: '/dashboard/reconciliation/fee-accruals',
  label: 'Fee Accruals',
  icon: <ClipboardList size={13} />,  // 与 Outstanding 一致
  requiredPermissions: [PERMISSIONS.FEE_ACCRUALS_READ],
},
```

### 6.2 路由（`App.tsx`）

```tsx
const FeeAccrualList = lazy(() => import('./pages/FeeAccrualList'));
const FeeAccrualDetail = lazy(() => import('./pages/FeeAccrualDetail'));

// 在 SwapOutstanding 路由之后追加：
<Route
  path="reconciliation/fee-accruals"
  element={withPermission(<FeeAccrualList />, [PERMISSIONS.FEE_ACCRUALS_READ])}
/>
<Route
  path="reconciliation/fee-accruals/:id"
  element={withPermission(<FeeAccrualDetail />, [PERMISSIONS.FEE_ACCRUAL_DETAIL_READ])}
/>
```

### 6.3 权限（`permissions.ts`）

新增常量 + 后端 controller 加同名 guard：

```ts
FEE_ACCRUALS_READ: 'fee_accruals:read',
FEE_ACCRUAL_DETAIL_READ: 'fee_accrual_detail:read',
```

---

## 7. 关键约束（红线）

1. ✅ **业务键展示**：列表/详情**只显示业务编号**（feeAccrualNo / swapNo / customerNo / batchNo），**绝不显示 UUID**（CLAUDE.md 不可违反规则 #4）
2. ✅ **跳转用 navigate**：不用 `<a href>`，避免页面刷新
3. ✅ **复用现有原子**：`adminButtonClass` / `AdminBadge` / `Pagination` / `formatAssetAmount` / `PageTitleBar` —— 不引入新样式
4. ✅ **后端只读**：controller 只有 GET endpoints、不暴露 PATCH/POST/DELETE（accrual 是被动写入实体）
5. ✅ **权限门控**：列表 + 详情各自独立 permission；前端 `withPermission` + 后端 guard 双层

---

## 8. 影响清单

| 文件 | 操作 | 净行数 |
|---|---|---|
| `src/modules/funds-layer/domain/fee-accruals.controller.ts` | 新建 | ~120 行 |
| `src/modules/funds-layer/funds-layer.module.ts` | 注册 controller | +1 行 |
| `admin-web/src/constants/permissions.ts` | 加 2 常量 | +2 行 |
| `admin-web/src/pages/FeeAccrualList.tsx` | 新建 | ~280 行（参考 SwapOutstandingList ~300 行） |
| `admin-web/src/pages/FeeAccrualDetail.tsx` | 新建 | ~220 行 |
| `admin-web/src/App.tsx` | 加 2 lazy + 2 route | +6 行 |
| `admin-web/src/components/DashboardLayout.tsx` | 加 1 菜单条目 | +6 行 |

**净改动**：~640 行（含模板大量复用）、7 个文件。

---

## 9. 任务拆解预告（plan 阶段细化）

预计 6 任务（每个独立交付）：

1. **T1 后端 controller + DTO**：list + detail endpoint、含 sibling 查询、jest 测试（query 过滤 + permission guard）
2. **T2 前端 permissions + 路由 + 侧边栏菜单**：3 个文件同步、admin tsc 0 错
3. **T3 前端 `FeeAccrualList.tsx`**：列表渲染 + 过滤器 + 分页（参考 SwapOutstandingList）
4. **T4 前端 `FeeAccrualDetail.tsx`**：Identity + Settlement linkage + Traceability 三区
5. **T5 详情页 Sibling 区**：sibling 表格 + 跳转
6. **T6 终验**：admin 启动 → 渲染截图（列表、详情含 sibling）、跳转链路逐个点击验证

---

## 10. 验收

1. ✅ `npx jest` 0 failed（含 fee-accruals.controller.spec）
2. ✅ `npm run build` clean、`admin-web npx tsc --noEmit` clean
3. ✅ 启 admin → 登录 → 侧边栏看到 "Fee Accruals" → 进列表页 → 4 笔 SWP2606165857 等 AED→USDT swap 的 fee accrual 可见 → 进详情看到 SERVICE_FEE 主体 + SPREAD sibling
4. ✅ 详情页所有跳转都能落地（swap / customer / batch / transfer / fund）
5. ✅ originTraceId 复制按钮工作
6. ✅ 无 UUID 直接展示

---

## 11. 决策记录

| 决策点 | 选择 | 原因 |
|---|---|---|
| 列表颗粒度 | 单条 accrual 一行 | 与 Swap Outstandings 同模式、字段直观、记账/审计场景刚需 |
| 详情 sibling 区 | 展示 | 对账场景常需"一笔 swap 所有 fee 一屏看清" |
| controller 位置 | `funds-layer/domain/` | fee-accrual.service 已在此模块，归属一致 |
| 状态机推进按钮 | 不做 | accrual 是被动写入、admin 不该手动改 |
| 批量操作 | 不做 | YAGNI，等需求驱动 |
| URL 路径用 id 还是 No | `id` (UUID) | 与 Swap Outstandings 一致；展示不暴露 UUID（业务键 feeAccrualNo 在 Header） |
