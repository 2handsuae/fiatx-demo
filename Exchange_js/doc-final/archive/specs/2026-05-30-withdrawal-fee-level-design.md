# 提现费率等级（Withdrawal Fee Level）— 设计文档

> Scope: 费率等级 CRUD + 变更审批 + 客户绑定 + Quote 拆分重构
> 前置: V3（资产/钱包）、V5 提现 Happy Path 已完成
> 不含: Swap 费率改造（V6）、itemCode 枚举扩展（后续需求）、itemCode → TB 账户映射拆分（V7）

---

## 1. 设计决策总览

### 1.1 为什么不复用现有 PricingPolicy 表

现有 `PricingPolicy` 表用一个 `configJson` blob 存所有资产的全部费率配置，且 Swap 和 Withdrawal 共用同一张表靠 `business` 字段区分。问题：

1. **不同领域主体强行合并** — Withdrawal 按币种分档，Swap 按资产对分档，费用项类型完全不同
2. **粒度过粗** — 改一个资产的费率要提交整棵 JSON（含所有资产），审批人难以定位变更内容
3. **PricingCenterService 2927 行巨石** — 策略配置 + Quote 生命周期 + Swap + Withdrawal 混在一个 service 里，L1/L3 混合，domain service 写审计日志，多项架构违规

决策：
- **拆表** — 新建 `WithdrawalFeeLevel`，与 `PricingPolicy` 完全独立
- **拆服务** — Withdrawal 费率和 Quote 从 `PricingCenterService` 拆出，Swap 代码留原处不动（V6 处理）
- **Level 概念** — 每个 level 绑一个资产、存自己的分档配置，支持多 level 取最优

### 1.2 Level 概念

Level 是"一个资产的一套费率方案"。核心特性：

- 每个 level 绑定一个资产（如 USDT-TRC20）
- 同一资产可有多个 level（Standard / VIP Gold / Promo 等）
- `isDefault=true` 的 level 对所有客户适用
- 非 default 的 level 通过 `WithdrawalFeeLevelBinding` 绑定到特定客户
- 提现时，系统找到所有适用 level → 各自计算费用 → 取最低总费的给客户

### 1.3 itemCode

V5 阶段固定一个 itemCode：`WITHDRAW_SERVICE_FEE`（平台服务费）。

`NETWORK_FEE_EST`（矿工费估算）移除 — V7 Gas 记账机制完成后再按实际 gas 处理。

itemCode 枚举未来可扩展（新增枚举值），但不开放管理员自创。每个 itemCode 未来可能映射到不同 TB 账户，需受控新增。

### 1.4 TB 联动

V5 阶段不变 — 所有费用项合计为一个 `feeAmount`，走一笔 TB pending transfer 到 `FEE_RECEIVABLE`。itemCode 仅用于展示层拆分。

---

## 2. 数据模型

### 2.1 WithdrawalFeeLevel（费率等级）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | 内部主键 |
| `levelCode` | String unique | operator key，如 `STD-USDT-TRC20`、`VIP-GOLD-BTC` |
| `name` | String | 展示名 |
| `assetId` | String FK → Asset | 绑定一个资产 |
| `isDefault` | Boolean | 默认等级（所有客户适用） |
| `enabled` | Boolean | 开关 |
| `tiersJson` | String | 该 level 的分档(tier) + 费用项 JSON |
| `configHash` | String | tiersJson 的 SHA-256，冲突检测用 |
| `status` | String | `PENDING_APPROVAL` / `ACTIVE` |
| `approvalCaseId` | String? | 创建审批单 ID |
| `approvalCaseNo` | String? | 创建审批单 No |
| `createdByUserId` | String | 创建人 |
| `updatedByUserId` | String? | 最近修改人 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |

约束：
- 同一 asset 可有多个 level
- 同一 asset 的 `isDefault=true` 建议至多一个（业务约束，非 DB unique）

### 2.2 tiersJson 结构

```json
{
  "tiers": [
    {
      "id": "TIER-001",
      "name": "小额",
      "priority": 1,
      "enabled": true,
      "conditions": {
        "amountMin": "0",
        "amountMax": "1000"
      },
      "feeItems": [
        {
          "id": "FEE-001",
          "itemCode": "WITHDRAW_SERVICE_FEE",
          "calcType": "FLAT",
          "value": "1",
          "currency": "USDT",
          "min": null,
          "cap": null,
          "roundingDp": 6,
          "roundingMode": "ROUND"
        }
      ]
    },
    {
      "id": "TIER-002",
      "name": "大额",
      "priority": 2,
      "enabled": true,
      "conditions": {
        "amountMin": "1000",
        "amountMax": null
      },
      "feeItems": [
        {
          "id": "FEE-001",
          "itemCode": "WITHDRAW_SERVICE_FEE",
          "calcType": "PERCENT",
          "value": "0.1",
          "currency": "USDT",
          "min": "1",
          "cap": "50",
          "roundingDp": 6,
          "roundingMode": "ROUND"
        }
      ]
    }
  ]
}
```

分档匹配逻辑：按 `priority` 排序，找到 amount 落在 `[amountMin, amountMax)` 区间的第一个 enabled tier。复用现有 `PricingEngineService.findMatchedWithdrawalTier()`。

### 2.3 WithdrawalFeeLevelChangeRequest（变更请求）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | 内部主键 |
| `requestNo` | String unique | operator key，自增 `WFLC-NNN` |
| `levelId` | String FK | 关联 WithdrawalFeeLevel |
| `levelCode` | String | 冗余，审计用 |
| `currentTiersJson` | String | 提交时的完整快照 |
| `currentConfigHash` | String | 提交时的 hash |
| `proposedTiersJson` | String | 提案的新配置 |
| `changeReason` | String | 变更理由 |
| `status` | String | `PENDING_APPROVAL` / `APPROVED` / `REJECTED` / `CANCELLED` / `FAILED` |
| `requestedByUserId` | String | 发起人 |
| `approvalCaseId` | String? | 审批单 ID |
| `approvalCaseNo` | String? | 审批单 No |
| `executedAt` | DateTime? | 执行时间 |
| `failureReason` | String? | 执行失败原因 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |

冲突检测：执行时比较 `currentConfigHash` 与 level 当前 `configHash`，不一致则失败。与 TransactionLimitChange 同构。

### 2.4 WithdrawalFeeLevelBinding（客户绑定）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | 内部主键 |
| `customerId` | String FK | 客户 |
| `levelId` | String FK | 费率等级 |
| `boundByUserId` | String | 操作人 |
| `boundAt` | DateTime | 绑定时间 |
| `createdAt` | DateTime | 创建时间 |

约束：`@@unique([customerId, levelId])` — 同一客户不重复绑定同一 level。

### 2.5 WithdrawPricingQuote（已有，补全 + 新增字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID PK | 内部主键 |
| `quoteNo` | String unique | 报价单号 |
| `status` | String | `ACTIVE` / `USED` / `EXPIRED` / `CANCELLED` |
| `ownerType` | String | 所有者类型 |
| `ownerId` | String | 所有者 ID |
| `ownerNo` | String? | 所有者编号 |
| `assetId` | String FK → Asset | 资产 ID |
| `assetCode` | String | 资产代码（冗余） |
| `amount` | Decimal | 提现金额 |
| `segment` | String | 客户分段 |
| `riskTier` | String | 风险等级 |
| `matchedAssetId` | String | 旧 policy 匹配的 asset entry（迁移后废弃） |
| `matchedTierId` | String | 匹配的分档(tier) ID |
| `matchedTierName` | String | 匹配的分档名称 |
| `feeBreakdown` | String (JSON) | 费用明细 |
| `totalsJson` | String (JSON) | 费用汇总 |
| `policyRef` | String | 旧 policy 引用（迁移后废弃） |
| `expiresAt` | DateTime | 过期时间（TTL 30s） |
| `usedAt` | DateTime? | 消费时间 |
| `cancelledAt` | DateTime? | 取消时间 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |
| **`feeLevelId`** | **String? 新增** | **命中的 WithdrawalFeeLevel ID** |
| **`feeLevelCode`** | **String? 新增** | **命中的 WithdrawalFeeLevel code** |

索引：
- `@@index([status, expiresAt])`
- `@@index([ownerType, ownerId])`
- `@@index([assetId, createdAt])`

关系：`withdrawals WithdrawTransaction[]` — 一个 quote 对应一笔提现。

---

## 3. 状态机

### 3.1 WithdrawalFeeLevel 状态机

```
Admin 创建
    │
    ▼
PENDING_APPROVAL ──审批通过──→ ACTIVE
    │                            │
    审批拒绝                     可修改(走 ChangeRequest)
    │                            可启用/禁用(enabled 字段)
    ▼
  (物理删除)
```

状态只有两个：`PENDING_APPROVAL`（创建待审批）、`ACTIVE`（生效中）。

`enabled` 字段是运营开关，不属于状态机 — ACTIVE 的 level 可以 enabled=false（暂停使用但保留配置）。

### 3.2 WithdrawalFeeLevelChangeRequest 状态机

```
Admin 提交变更
    │
    ▼
PENDING_APPROVAL
    │
    ├── 审批通过 → APPROVED (执行: 更新 level.tiersJson + configHash)
    ├── 审批拒绝 → REJECTED (终态)
    ├── 发起人取消 → CANCELLED (终态)
    └── 执行失败 → FAILED (hash 冲突等)
```

与 TransactionLimitChange 同构。

---

## 4. 工作流

### 4.1 Level Creation Workflow

**触发：** Admin 提交创建请求

**流程：**
1. Admin 提交 `{ levelCode, name, assetId, isDefault, tiersJson }`
2. L1 校验：asset 存在且 ACTIVE、levelCode 唯一、tiersJson 格式合法（tier 区间无重叠、feeItem itemCode 合法）
3. L1 创建 WithdrawalFeeLevel，status=`PENDING_APPROVAL`
4. L3 创建审批单（L2 处理），objectSnapshot 含完整配置
5. 审批通过 → L3 调 L1 将 status 改为 `ACTIVE`
6. 审批拒绝 → L3 调 L1 物理删除该行
7. L3 全程写审计日志

**审计 Actions：**
- `WITHDRAWAL_FEE_LEVEL_CREATION_REQUESTED`
- `WITHDRAWAL_FEE_LEVEL_CREATION_APPROVED`
- `WITHDRAWAL_FEE_LEVEL_CREATION_REJECTED`

### 4.2 Level Change Workflow

**触发：** Admin 对 ACTIVE 的 level 提交变更

**流程：**
1. Admin 提交 `{ levelCode, proposedTiersJson, changeReason }`
2. L3 校验：level 存在且 ACTIVE、无同 level 的 PENDING 变更请求
3. L3 调 L1 创建 ChangeRequest — L1 校验 proposedTiersJson 格式合法 + 快照 currentTiersJson + currentConfigHash
4. L3 创建审批单（L2 处理），objectSnapshot 含新旧配置
5. 审批通过 → L3 冲突检测（currentConfigHash vs level 当前 configHash）→ 无冲突则 L3 调 L1 更新 level.tiersJson + configHash
6. 审批拒绝 → L3 调 L1 标记 request REJECTED
7. 冲突 → L3 调 L1 标记 request FAILED + failureReason
8. L3 全程写审计日志

**审计 Actions：**
- `WITHDRAWAL_FEE_LEVEL_CHANGE_REQUESTED`
- `WITHDRAWAL_FEE_LEVEL_CHANGE_APPROVED`
- `WITHDRAWAL_FEE_LEVEL_CHANGE_REJECTED`
- `WITHDRAWAL_FEE_LEVEL_CHANGE_FAILED`

### 4.3 Level Binding Workflow

**触发：** Admin 给客户绑定或解绑 level

**流程（绑定）：**
1. Admin 提交 `{ customerId, levelId }`
2. L3 校验：客户存在、level 存在且 ACTIVE
3. L3 调 L1 创建 binding 记录
4. L3 写审计日志

**流程（解绑）：**
1. Admin 提交 `{ customerId, levelId }`
2. L3 调 L1 删除 binding 记录
3. L3 写审计日志

**无 L2 审批门。**

**审计 Actions：**
- `WITHDRAWAL_FEE_LEVEL_BOUND`
- `WITHDRAWAL_FEE_LEVEL_UNBOUND`

---

## 5. 费率解析与 Quote 生成

### 5.1 解析流程

```
输入: assetId, amount, customerId
    │
    ├─ 1. 查 WithdrawalFeeLevel
    │     WHERE assetId = ? AND enabled = true AND status = 'ACTIVE'
    │
    ├─ 2. 过滤适用 levels:
    │     - isDefault = true 的 level（所有客户适用）
    │     - 该 customerId 通过 binding 绑定的 level
    │
    ├─ 3. 每个适用 level:
    │     findMatchedTier(amount) → calculateFeeLines()
    │     得到 { levelCode, totalFee, feeBreakdown }
    │
    ├─ 4. 取 totalFee 最低的 level
    │
    └─ 5. 生成 WithdrawPricingQuote
          记录 feeLevelId, feeLevelCode, matchedTierId, feeBreakdown, totalsJson
          TTL = 30 秒
```

### 5.2 Quote 生命周期（不变）

```
ACTIVE ──消费──→ USED (绑定 WithdrawTransaction)
  │
  ├── TTL 过期 → EXPIRED
  └── 客户取消 → CANCELLED
```

现有 `WithdrawPricingQuote` 模型和生命周期不动，新增 `feeLevelId` / `feeLevelCode` 字段。

---

## 6. 架构分层

| 文件 | 层 | 职责 |
|------|---|------|
| `WithdrawalFeeLevelService` | L1 Domain | Level CRUD + 状态转换 + tiersJson 校验，不写审计 |
| `WithdrawalFeeLevelCreationApprovalService` | L2 Approval | 创建审批处理器 |
| `WithdrawalFeeLevelCreationWorkflowService` | L3 Workflow | 创建流程编排 + 审计 |
| `WithdrawalFeeLevelChangeApprovalService` | L2 Approval | 变更审批处理器 |
| `WithdrawalFeeLevelChangeWorkflowService` | L3 Workflow | 变更流程编排（request-record + snapshot 冲突检测）+ 审计 |
| `WithdrawalFeeLevelBindingService` | L1 Domain | bind/unbind CRUD，不写审计 |
| `WithdrawalFeeLevelBindingWorkflowService` | L3 Workflow | 绑定/解绑编排 + 审计，无 L2 |
| `WithdrawQuoteService` | L3 Workflow | 费率解析（多 level 取最优）+ quote 生命周期 + 审计 |
| `PricingEngineService` | 共享计算 | 不动 — calculateFeeLines() / findMatchedWithdrawalTier() 复用 |

### 6.1 模块归属

新建 `src/modules/trading/withdrawal-fee-level/` 模块，包含 Level + Binding + Quote 所有服务。

`PricingCenterService` 中 Withdrawal 相关代码迁出后，Swap 代码留原处不动（V6 处理）。

---

## 7. 迁移策略

### 7.1 数据迁移

现有 `PricingPolicy` 表中 `WITHDRAWAL_PRICING` 行的 `configJson` → 拆成多个 `WithdrawalFeeLevel` 行：

- 每个 `assets[]` entry → 一个 `WithdrawalFeeLevel`（`isDefault=true`, `status=ACTIVE`）
- `levelCode` = `STD-{asset.currency}-{asset.network || 'FIAT'}`
- `tiersJson` = 该 entry 的 `tiers` 数组

### 7.2 代码迁移

从 `PricingCenterService` 迁出：
- `createWithdrawPricingQuote()` → `WithdrawQuoteService`
- `consumeWithdrawQuoteForWithdraw()` → `WithdrawQuoteService`
- `cancelWithdrawPricingQuote()` → `WithdrawQuoteService`
- `getActiveWithdrawQuoteOrThrow()` → `WithdrawQuoteService`
- `resolveWithdrawalQuote()` → `WithdrawQuoteService`（重构为多 level 取最优逻辑）
- `getWithdrawalPolicy()` → 不再需要（被 `WithdrawalFeeLevelService.findByAsset()` 替代）
- `simulateWithdrawal()` → `WithdrawQuoteService`
- `assertWithdrawExtremeVolatilityNotBlocked()` → 评估是否保留

保留在 `PricingCenterService` 中：所有 Swap 相关方法。

### 7.3 调用方适配

- `WithdrawTransactionsService.create()` — 将 `pricingCenterService` 调用替换为 `withdrawQuoteService`
- `PricingCenterCustomerController` — Withdrawal quote 端点迁到新 controller
- `PricingCenterAdminController` — Withdrawal policy 端点迁到新 controller

---

## 8. Roadmap 写入

以下工作流写入 V5 MVP：

- Withdrawal Fee Level Creation（费率等级创建审批）
- Withdrawal Fee Level Change（费率等级变更审批）
- Withdrawal Fee Level Binding（客户费率等级绑定/解绑）

Supporting Features：
- WithdrawQuoteService 拆分重构
- 数据迁移（PricingPolicy → WithdrawalFeeLevel）
- PricingCenterService Withdrawal 代码迁出

---

## 9. 不含（后续）

- Swap 费率改造 — V6
- itemCode 枚举扩展机制 — 后续需求
- itemCode → TB 账户映射拆分 — V7 Gas 记账完成后
- Level enabled/disabled 审批门 — 评估后决定是否需要
- Level 删除/归档工作流 — 后续需求
