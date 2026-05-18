# Asset 前端展示优化 — Design Spec

> **Status:** DRAFT | **Date:** 2026-05-18 | **Scope:** 纯前端展示变更
> **目标：** 修正 Asset 列表页和详情页的 UI 问题，使其符合 admin 平台规范

---

## 背景

Asset 列表页和详情页存在以下问题：
- 列表页 Asset No 列内叠显了 code，一列两个字段
- 列表页有 Action 列，但所有操作都在详情页，冗余
- 列表页行不可整行点击跳转
- 详情页多处不符合 `frontend-admin.md` 规范
- contractAddress 字段在系统中无业务消费方，仅存储展示，前端应移除

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| contractAddress | 前端移除展示，后端字段保留 | 无消费方，后续再决定是否删库字段 |
| 编辑功能 | 不动 | 本次只做展示优化 |
| 列表页 Description 列 | 移除 | 详情页可看，列表页信息密度已够 |

---

## 变更 1：列表页（AssetList.tsx）

### 列定义变更

| 当前列 | 变更 |
|--------|------|
| Asset No（含 code 叠显） | **拆分**：Asset No 单独一列，Code 独立一列 |
| Type | 保留 |
| Network | 保留 |
| Decimals | 保留 |
| Description | **移除** |
| Status | 保留 |
| Updated | 保留 |
| Action | **移除** |

最终 7 列顺序：**Asset No → Code → Type → Network → Decimals → Status → Updated**

### 行为变更

- 整行可点击，点击跳转 `/dashboard/system/assets/${assetNo}`
- hover 行高亮（cursor: pointer）
- Asset No 列不再是单独的链接，而是跟随整行点击

---

## 变更 2：详情页（AssetDetail.tsx）

### 规范违规修正（5 处）

| # | 当前 | 修正 | 规范依据 |
|---|------|------|---------|
| 1 | `DetailPageHeader` 传了 `title="ASSET"` `subtitle={assetNo}` | 不传 title/subtitle | Nav Header 规范：MUST NOT pass title or subtitle |
| 2 | Hero 区域有 `<Cap>Asset</Cap>` 标签 | 移除 Cap 标签 | Hero 规范：MUST NOT render Cap entity-type label |
| 3 | 侧边栏显示 UUID `id` 字段 | 移除 id 字段 | Sidebar 规范：no UUID |
| 4 | 时间戳在主体 "Audit" section | 移到侧边栏 Lifecycle block（mono 字体） | Sidebar block order 规范 |
| 5 | 侧边栏标题 "Quick Reference" | 改为 "Identity" | Sidebar 规范名称 |

### 主体 Section 结构（修正后）

| # | Section | 内容 |
|---|---------|------|
| 1 | Hero（bg-adm-card） | assetNo（大号 amber mono）、Status badge、Code · Type · Network |
| 2 | Asset Details | Code、Type（badge）、Network、Decimals、Description |
| 3 | Deposit & Withdrawal Limits | minDeposit、maxDeposit、minWithdraw、maxWithdraw、depositEnabled、withdrawalEnabled |
| 4 | Suspension Info（仅 SUSPENDED 时显示） | suspendedAt、suspendReason |

### 侧边栏结构（修正后）

| # | Block | 内容 |
|---|-------|------|
| 1 | Actions（条件显示） | 按状态显示操作按钮（Edit Asset / Activate / Suspend / Reactivate） |
| 2 | Identity | assetNo、Status（badge）、Code、Type — 共 4 字段 |
| 3 | Lifecycle | createdAt、updatedAt（mono 字体） |

### contractAddress 移除

- 从 Details section 移除 contractAddress 行
- 从 AssetCreate.tsx 创建表单移除 contractAddress 输入框
- 从 AssetEdit.tsx 编辑表单移除 contractAddress 输入框
- 后端 DTO 和数据库字段保留不动

---

## 不涉及范围

- 后端 API 不做任何变更
- 编辑功能行为不变（仅 PROVISIONING 可编辑）
- 审批流程不变
- contractAddress 后端字段不删除

---

## 文件变更清单

| 文件 | 变更类型 |
|------|---------|
| `admin-web/src/pages/AssetList.tsx` | 列定义重构 + 行点击 + 移除 Action |
| `admin-web/src/pages/AssetDetail.tsx` | 5 处规范修正 + 移除 contractAddress |
| `admin-web/src/pages/AssetCreate.tsx` | 移除 contractAddress 输入框 |
| `admin-web/src/pages/AssetEdit.tsx` | 移除 contractAddress 输入框 |

---

## 验收标准

- [ ] 列表页 7 列，每列单字段，无 Action 列
- [ ] 列表页整行可点击跳转详情
- [ ] 详情页 NavHeader 无 title/subtitle
- [ ] 详情页 Hero 无 Cap 标签
- [ ] 详情页侧边栏无 UUID id
- [ ] 详情页时间戳在侧边栏 Lifecycle block
- [ ] 详情页侧边栏标题为 "Identity"
- [ ] 创建/编辑/详情页均无 contractAddress 字段
