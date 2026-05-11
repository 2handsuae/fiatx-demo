# Asset Listing Workflow Design

Date: 2026-05-11 | Scope: V3 Phase 0 | Status: DRAFT

---

## Overview

V3 第一个激活 TigerBeetle 的业务 workflow：通过 Maker/Checker 审批流上架新资产，审批通过后自动创建 Asset 记录并开通 TB 系统账户。

**前置依赖：** TigerBeetle 基础设施层（已完成）。
**后续依赖：** 所有充提、交易、结算 workflow 依赖本层创建的资产和 TB 系统账户。

---

## Section 1: 状态生命周期

```
PENDING_APPROVAL → PROVISIONING → ACTIVE
                 ↘ (rejected) → 删除 Asset 记录
```

| 状态 | 含义 | 可见性 |
|------|------|--------|
| PENDING_APPROVAL | Maker 已提交，等 Checker 审批 | Admin 后台可见 |
| PROVISIONING | 审批通过，Asset + TB 账户已创建，运营配置基础设施中 | Admin 后台可见 |
| ACTIVE | 运营手动激活，完全可用 | Admin + 客户端可见 |

**审批拒绝：** 直接删除 Asset 记录（与 Role 创建 workflow 保持一致）。

**客户端过滤：** 客户端查询 Asset 列表时只返回 `status = ACTIVE` 的资产。

---

## Section 2: 更新后的 COA（Phase 0 最终版）

通过对记账模型的完整推演（充值 → 归集 → 交易 → 结算），确定 Phase 0 最小 COA：

| Code | 名称 | 类型 | 说明 |
|------|------|------|------|
| 1 | BANK | Asset (debit-normal) | 法币托管总额 |
| 10 | CUSTODY | Asset (debit-normal) | 加密托管总额 |
| 50 | TRADE_CLEARING | Liability (credit-normal) | 已成交未结算中转 |
| 100 | CLIENT_CREDIT | Liability (credit-normal) | 客户余额（按需创建） |

### 账户创建时机

| 账户 | 创建时机 | 数量 |
|------|----------|------|
| BANK | Asset Listing 审批通过（FIAT 资产） | 1 per asset |
| CUSTODY | Asset Listing 审批通过（CRYPTO 资产） | 1 per asset |
| TRADE_CLEARING | Asset Listing 审批通过（所有资产） | 1 per asset |
| CLIENT_CREDIT | 客户创建充值入口时（crypto deposit wallet 或 bank vIBAN） | 1 per customer per asset |

### 记账模型参考

以 "客户充值 1000 USDT → 交易换 AED → 日终结算" 为例的完整 TB transfer 链：

**充值：**
- Transfer(debit=CUSTODY, credit=CLIENT_CREDIT, 1000 USDT)

**交易（T+0，客户余额即时更新）：**
- Transfer(debit=CLIENT_CREDIT, credit=TRADE_CLEARING, 1000 USDT) — 客户释放 USDT
- Transfer(debit=TRADE_CLEARING, credit=CLIENT_CREDIT, 3412.50 AED) — 客户获得 AED

**结算（日终，托管层追上 TB）：**
- Transfer(debit=TRADE_CLEARING, credit=CUSTODY, 1000 USDT) — USDT 物理转出客户池
- Transfer(debit=CUSTODY, credit=TRADE_CLEARING, 3412.50 AED) — AED 物理转入客户池

**不变量：** `CUSTODY = sum(CLIENT_CREDIT) + TRADE_CLEARING`（每个 ledger 独立成立）

**归集（deposit wallet → main wallet）：** 不产生 TB transfer，纯托管层操作。Gas 费用记录在 Prisma 运营记录中。

**Spread：** 不在 TB 中显式记录。公司 P&L 从订单记录推导（执行价 vs 市场价）。

---

## Section 3: 审批 Payload

Maker 提交上架申请时填写的参数，整体存入 `ApprovalCase.payload`（JSON）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | Y | 币种代码（AED, USDT） |
| type | enum | Y | FIAT / CRYPTO |
| network | string | CRYPTO 必填 | 链网络（TRON, BITCOIN） |
| decimals | int | Y | 精度位数 |
| contractAddress | string | N | 合约地址（TRC20 等） |
| minDepositAmount | decimal | Y | 最小充值金额 |
| maxDepositAmount | decimal | Y | 最大充值金额 |
| minWithdrawAmount | decimal | Y | 最小提现金额 |
| maxWithdrawAmount | decimal | Y | 最大提现金额 |
| depositEnabled | boolean | Y | 是否允许充值 |
| withdrawalEnabled | boolean | Y | 是否允许提现 |
| description | string | N | 资产描述 |

---

## Section 4: 执行流程

### 4.1 提交阶段（Maker）

```
1. 校验 payload（字段类型、必填、CRYPTO 必须有 network）
2. 校验唯一性：type + code + network 组合不能已存在（Asset 表）
3. 创建 Asset 记录（status = PENDING_APPROVAL）
   → 写入所有 payload 字段
   → tbLedgerId 暂不分配（null）
4. 创建 ApprovalCase（type = ASSET_LISTING）
   → entityRef = asset.id
   → objectSnapshot = payload
5. 关联：更新 Asset.approvalCaseId / approvalCaseNo
6. 审计日志：ASSET_LISTING_SUBMITTED
```

### 4.2 审批通过（Checker → 回调）

在事务内执行：

```
1. 校验 Asset.status = PENDING_APPROVAL（防止重复执行）
2. 分配 tbLedgerId
   → SELECT MAX(tbLedgerId) FROM Asset + 1（首个从 1 开始）
3. 创建 TB 系统账户（2 个）：
   → FIAT:   BANK(code=1) + TRADE_CLEARING(code=50)，ledger = tbLedgerId
   → CRYPTO: CUSTODY(code=10) + TRADE_CLEARING(code=50)，ledger = tbLedgerId
4. 注册 TbAccountRegistry（2 条记录）
5. 更新 Asset：
   → tbLedgerId = 分配值
   → status = PROVISIONING
6. 审计日志：ASSET_LISTING_APPROVED + ASSET_PROVISIONED
```

**失败处理：** TB 账户创建（Step 3）在 Prisma 事务外执行。如果 TB 成功但 Step 4-5 失败，TB 账户成为孤儿。可接受风险：TB 创建是幂等的（相同 ID 重复创建被拒绝但无副作用），重新触发回调即可修复。

### 4.3 审批拒绝（Checker → 回调）

```
1. 删除 Asset 记录
2. 审计日志：ASSET_LISTING_REJECTED
```

### 4.4 激活（运营手动）

```
POST /admin/assets/:assetNo/activate

1. 校验 Asset.status = PROVISIONING
2. 更新 status = ACTIVE
3. 审计日志：ASSET_ACTIVATED
```

Phase 0 不做前置校验（如检查钱包是否配好）。后续迭代可加。

---

## Section 5: 三层架构

```
AssetListingController
  POST /admin/assets/listing              ← Maker 提交申请
  POST /admin/assets/listing/:id/approve  ← Checker 审批
  POST /admin/assets/:assetNo/activate    ← 运营激活

AssetListingWorkflow（编排层）
  ├─ submitListing(payload, actor)
  │    → 校验 → 创建 Asset(PENDING_APPROVAL) → 创建 ApprovalCase → 关联
  │
  ├─ onApproved(caseId)    [event listener]
  │    → AssetProvisioningService.provision()
  │
  ├─ onRejected(caseId)    [event listener]
  │    → 删除 Asset 记录
  │
  └─ activateAsset(assetNo, actor)
       → 校验 status = PROVISIONING → 更新 ACTIVE

AssetProvisioningService（新 domain service）
  └─ provision(asset, tbLedgerId)
       → 创建 TB 系统账户 → 注册 Registry → 更新 Asset
       ├─ AccountingService.createAccounts()  ← Phase 0 已实现
       └─ TbAccountRegistryService.register() ← Phase 0 已实现

复用:
  ├─ ApprovalCaseService      ← V1 Maker/Checker 引擎
  ├─ AssetsService             ← 现有，扩展 status 和新字段
  └─ AuditLogsService          ← 审计日志
```

---

## Section 6: 数据模型变更

### Asset 表扩展

新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| status | String | PENDING_APPROVAL / PROVISIONING / ACTIVE（default: PENDING_APPROVAL） |
| contractAddress | String? | 合约地址 |
| minDepositAmount | Decimal? | 最小充值 |
| maxDepositAmount | Decimal? | 最大充值 |
| minWithdrawAmount | Decimal? | 最小提现 |
| maxWithdrawAmount | Decimal? | 最大提现 |
| depositEnabled | Boolean | 是否允许充值（default: true） |
| withdrawalEnabled | Boolean | 是否允许提现（default: true） |
| approvalCaseId | String? | 关联审批单 ID |
| approvalCaseNo | String? | 关联审批单编号 |

**已有字段：** tbLedgerId（Phase 0 基础设施已添加）。

**注意：** 现有 seed 创建的 AED/USDT/BTC 资产 status 默认保持 ACTIVE（通过 migration 设默认值）。

### TB Account Codes 常量更新

```typescript
TB_ACCOUNT_CODES = {
  BANK: 1,
  CUSTODY: 10,
  TRADE_CLEARING: 50,
  CLIENT_CREDIT: 100,
} as const;
```

---

## Section 7: 对现有系统的影响

| 模块 | 影响 |
|------|------|
| Asset model (Prisma) | 新增 8 个字段 + migration |
| AssetsService | 扩展 create() 支持新字段，新增 findByAssetNo()（如不存在） |
| 客户端 Asset 查询 | 加 `WHERE status = 'ACTIVE'` 过滤 |
| Admin Asset 列表 | 显示所有状态，展示 status 标签 |
| tb-account-codes.constant.ts | 新增 TRADE_CLEARING = 50 |
| Seed 数据 | 现有 AED/USDT/BTC migration 设 status 默认 ACTIVE |

---

## Section 8: 不在本设计范围

| 排除项 | 原因 |
|--------|------|
| 系统钱包创建 | 不同币种钱包架构不同，独立流程管理 |
| CLIENT_CREDIT 账户创建 | 按需创建，在客户开通充值入口时触发 |
| Gas 费用记账 | TRX gas 不进 TB，运营记录兜底，后续费用核算模块处理 |
| Spread 记账 | 隐含在订单数据中，公司 P&L 从订单推导 |
| Asset 停用/下架 | 后续迭代 |
| Admin 前端页面 | 后续实现计划单独处理 |
