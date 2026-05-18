# Asset 数据模型：code → currency 重命名 — Design Spec

> **Status:** DRAFT | **Date:** 2026-05-18 | **Scope:** 全栈变更（DB + 后端 + 前端）

---

## 背景

当前 Asset 模型的 `code` 字段存储的是币种标识（如 USDT、AED），语义上是 currency。而真正的"资产代码"应该是 `currency + network` 的复合标识（如 USDT-TRON），目前不存在。

这导致：
- 前端到处手工拼接 `${code}-${network}` 或 `${code} · ${network}`，格式不统一
- `code` 字段名与实际语义不符，误导开发者
- 缺乏一个可直接引用的唯一复合标识

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| `code` 字段处理 | 重命名为 `currency`，新建 `code` = `${currency}-${network}` | 语义归位 |
| 新 `code` 存储方式 | 存储字段（非计算属性） | currency/network 不可变，无 desync 风险；可索引、可查询 |
| 新 `code` 格式 | `{currency}-{network}`，无 network 时 `{currency}` | 与现有 `formatAssetLabel` 一致 |
| 新 `code` 唯一性 | 添加 `@unique` 约束 | 复合标识天然唯一（type+currency+network 唯一 → code 唯一） |
| 前端格式统一 | 所有 `code-network` 拼接改用新 `code` 字段 | 消除 6+ 种格式不一致 |

---

## 数据模型变更

### 当前

```prisma
model Asset {
  code      String                // 实际是币种：USDT, AED
  network   String?               // 链网络：TRON, ETHEREUM
  // ...
  @@unique([type, code, network])
}
```

### 变更后

```prisma
model Asset {
  currency  String                // 币种标识：USDT, AED, BTC
  code      String     @unique    // 复合标识：USDT-TRON, AED（自动生成，不可变）
  network   String?               // 链网络：TRON, ETHEREUM
  // ...
  @@unique([type, currency, network])
}
```

### 字段语义

| 字段 | 示例 | 说明 |
|------|------|------|
| `currency` | USDT | 币种/货币标识（原 code） |
| `network` | TRON | 链网络（crypto 有，fiat 无） |
| `code` | USDT-TRON | 复合唯一标识 = `${currency}-${network}`；无 network 时等于 `currency` |

---

## 迁移策略

SQLite 迁移步骤：

1. **新增 `currency` 列**，从当前 `code` 复制数据
2. **重写 `code` 列** 为复合值：`currency || CASE WHEN network IS NOT NULL AND network != '' THEN '-' || network ELSE '' END`
3. **更新约束**：`@@unique([type, currency, network])`，`code` 加 `@unique`
4. **更新种子数据**：manifest 文件同步改字段名

注意：SQLite 不支持 `ALTER COLUMN RENAME`，Prisma 会自动处理为 recreate table。

---

## 后端变更范围

### 14 个 asset-treasury 模块文件

所有 `asset.code` / `data.code` / `dto.code` 引用改为 `asset.currency` / `data.currency` / `dto.currency`。

关键文件：
- `assets.service.ts` — L1 domain service，查询和创建逻辑
- `asset-listing-workflow.service.ts` — 创建 + provisioning 编辑
- `asset-activation-workflow.service.ts` — 审批对象快照
- `asset-suspension-workflow.service.ts` — 审批对象快照
- `asset-reactivation-workflow.service.ts` — 审批对象快照
- `assets.controller.ts` — API 查询参数

### DTO 变更

- `CreateAssetDto`：`code` → `currency`，新增只读 `code`（后端自动生成）
- `SubmitAssetListingDto`：同上
- API query 参数：`?code=USDT` → `?currency=USDT`（或同时支持 `?code=USDT-TRON`）

### 新增 code 生成逻辑

在 `assets.service.ts` 的 `createAsset` 方法中：

```typescript
const code = data.network ? `${data.currency}-${data.network}` : data.currency;
```

创建时自动生成，不接受外部传入。

### `formatAssetLabel` 消除

`pricing-policies.manifest.ts` 和 `pricing-center.service.ts` 中的 `formatAssetLabel()` 函数可删除，直接用 `asset.code`。

---

## 前端变更范围

### ~46 个文件，~108 处引用

变更模式：

| 当前模式 | 变更后 |
|----------|--------|
| `asset.code` 显示币种 | `asset.currency` |
| `${asset.code}-${asset.network}` 拼接 | `asset.code`（直接用） |
| `${asset.code} · ${asset.network}` 拼接 | `asset.code` 或按需保留分开显示 |
| `${asset.code} (${asset.network})` 拼接 | `asset.code` |
| 下拉选项 `{a.code} ({a.type}) - {a.network}` | `{a.code} ({a.type})` |

### 列表页（AssetList.tsx）

当前 7 列：Asset No, Code, Type, Network, Decimals, Status, Updated

变更后 6 列：**Code, Currency, Type, Network, Decimals, Status, Updated**

- Code 列（USDT-TRON）作为主标识（amber mono，整行可点击）
- Currency 列（USDT）显示币种
- 移除 Asset No 列（assetNo 移到详情页 sidebar Identity）

### 详情页（AssetDetail.tsx）

- Hero：显示 `code`（如 USDT-TRON）作为大号标题
- Details section：添加 Currency 字段
- Sidebar Identity：保留 assetNo

### 创建/编辑页

- 输入字段：Currency（用户输入），Network（用户输入）
- Code 自动生成，不可手动输入
- 显示预览：输入 USDT + TRON → 预览 code = USDT-TRON

---

## 不涉及范围

- `contractAddress` 已在前一轮移除，不再涉及
- 编辑工作流（AssetEditChangeRequest）将在下一个 spec 中单独处理
- 后端 API 路由路径不变（仍使用 `:id` UUID）
- TigerBeetle 集成不变（tbLedgerId 与 currency/network 绑定关系不变）

---

## 文件变更清单（估算）

| 层 | 文件数 | 变更类型 |
|----|--------|---------|
| Prisma schema | 1 | 模型重命名 + 新字段 |
| DB migration | 1 | 数据迁移脚本 |
| Seed/manifest | 2 | 字段名更新 |
| Backend services | ~14 | `code` → `currency` 引用替换 |
| Backend DTOs | ~4 | 字段重命名 |
| Backend controller | ~2 | 查询参数重命名 |
| Frontend pages | ~46 | 引用替换 + 拼接简化 |

---

## 验收标准

- [ ] Prisma schema 中 Asset 有 `currency` 和 `code`（@unique）两个字段
- [ ] `code` = `${currency}-${network}` 格式，由后端自动生成
- [ ] 数据库中现有资产数据正确迁移（AED code=AED, USDT code=USDT-TRON）
- [ ] 前端无任何手工 code+network 拼接
- [ ] 列表页使用 Code 作为主标识列
- [ ] API 查询支持 `?currency=USDT` 过滤
- [ ] `formatAssetLabel` 辅助函数已删除
- [ ] tsc 编译零错误
