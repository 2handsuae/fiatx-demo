# Custodian Wallet Admin Frontend Design

Date: 2026-05-13 | Scope: V3 Phase 1 | Status: APPROVED

---

## Overview

为已完成的 Custodian Wallet Create 后端 workflow 补充管理台前端页面，使 Admin 用户可以独立完成全流程钱包创建：选 asset → 选角色 → 选托管商 → 选/建 vault → 提交审批 → 审批通过后自动创建 → FAILED 可重试。

**前置依赖：** 后端 API 已完成（`POST /admin/custodian-wallets`、`POST /admin/custodian-wallets/:walletNo/retry`）。

---

## Section 1: 页面重命名

| 现有文件 | 改为 | 路由 |
|----------|------|------|
| WalletList.tsx | CustodianWalletList.tsx | `/dashboard/treasury/custodian-wallets` |
| WalletDetail.tsx | CustodianWalletDetail.tsx | `/dashboard/treasury/custodian-wallets/:walletNo` |

- App.tsx 路由同步更新
- DashboardLayout.tsx 侧边栏 "Wallets" → "Custodian Wallets"
- 权限守卫不变（`WALLETS_READ` / `WALLET_DETAIL_READ`）

---

## Section 2: 创建 Modal

### 入口

列表页右上角 "+ Create Wallet" 按钮，需 `CUSTODIAN_WALLET_CREATE` 权限（按钮级守卫）。

### 表单字段

| 字段 | 组件 | 数据源 | 规则 |
|------|------|--------|------|
| Asset | Select 下拉 | `GET /assets`，过滤 status 为 PROVISIONING 或 ACTIVE | 必填 |
| Role | Select 下拉 | `WALLET_ROLE_OPTIONS`，根据所选 asset 的 type 过滤可选角色 | 必填，依赖 Asset |
| Custodian Provider | Select 下拉 | 硬编码 `[{ label: 'HexTrust', value: 'HEXTRUST' }]` | 必填，默认选中 HexTrust |
| Vault | Select 下拉 + "Create New Vault" 选项 | 后端 mock：传 vaultId 用已有 vault，不传则自动创建新 vault | 可选 |
| Owner ID | Text Input | 手动输入 customer UUID | 条件显示：仅当 role 的 allowedOwnerTypes 包含 CUSTOMER 时 |

### 角色-Asset Type 过滤规则

```
CRYPTO assets → C_DEP, C_MAIN, C_OUT, F_LIQ, F_OPS
FIAT assets   → C_VIBAN, C_CMA, F_LIQ, F_OPS
```

### 提交

`POST /admin/custodian-wallets` body:

```json
{
  "assetNo": "AS-xxx",
  "role": "F_LIQ",
  "custodianProvider": "HEXTRUST",
  "vaultId": "vault-xxx-or-null",
  "ownerId": "customer-uuid-or-undefined"
}
```

成功后关闭 Modal，刷新列表。

---

## Section 3: 列表页增强

### 新增列

| 列 | 字段 | 说明 |
|----|------|------|
| Vault ID | `vaultId` | 托管商 vault 标识，PENDING_APPROVAL/CREATING 时显示 "—" |
| Status | `status` | Badge 展示 |

### Status Badge 颜色

| Status | 颜色 | Token |
|--------|------|-------|
| PENDING_APPROVAL | 黄色 | warning |
| CREATING | 蓝色 | info |
| ACTIVE | 绿色 | success |
| FAILED | 红色 | error |

### FAILED Retry

FAILED 行的 Status 列旁显示 "Retry" 按钮（需 `CUSTODIAN_WALLET_RETRY` 权限）。

点击 → `POST /admin/custodian-wallets/:walletNo/retry` → 成功刷新列表。

---

## Section 4: 详情页增强

### Sidebar — Vault Info 区块

使用 `SidebarGroup` + `SidebarKV` 展示：

| 字段 | 值 |
|------|-----|
| Vault ID | `wallet.vaultId` 或 "—" |
| Custodian | "HexTrust"（当前硬编码） |

### Sidebar — Approval Info 区块

| 字段 | 值 |
|------|-----|
| Approval Case | `wallet.approvalCaseNo`，可点击跳转 `/dashboard/governance/approvals/:id` |
| Status | 当前 wallet status badge |

### FAILED 状态操作

Header 区域显示 "Retry Creation" 按钮（需 `CUSTODIAN_WALLET_RETRY` 权限），调用 retry API。

---

## Section 5: 后端 DTO 小调整

`CreateCustodianWalletDto` 新增两个可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `custodianProvider` | `string` | 默认 'HEXTRUST'，预留多托管商扩展 |
| `vaultId` | `string?` | 传则用已有 vault 创建 address，不传则创建新 vault |

Workflow service 将 `vaultId` 透传给 `CustodianAdapter.createVault()`，mock adapter 据此决定行为。

---

## Section 6: 不在本次范围

| 排除项 | 原因 |
|--------|------|
| Withdrawal Destination 页面 | 独立 workflow，后续单独设计 |
| 客户端自创建入口 | 后续扩展 |
| 真实 HexTrust API 对接 | MVP 用 mock adapter |
| Vault 独立管理页面 | 当前 vault 信息内嵌在钱包页面即可 |
