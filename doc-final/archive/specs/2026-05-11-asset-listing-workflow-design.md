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

## Section 2: TB COA（Phase 0 最终版）

V1 COA 有 18 个科目。通过 TB 原生能力（two-phase pending transfer）替代中间状态科目，精简为 6 个：

### 资产类（Asset, debit-normal）

| Code | 名称 | 对应 V1 | 说明 | TB Flags |
|------|------|---------|------|----------|
| 1 | BANK | A.BANK + A.BANK_IN_TRANSIT | 法币托管总额 | none |
| 10 | CUSTODY | A.CUSTODY + A.CUSTODY_IN_TRANSIT | 加密托管总额 | none |

IN_TRANSIT 不再独立 — TB two-phase pending transfer 的 `credits_pending` 表达在途出金。
RESTRICTED 不再独立 — 合规待审状态由 CLIENT_AUDIT（负债侧）表达。

### 负债类（Liability, credit-normal）

| Code | 名称 | 对应 V1 | 说明 | TB Flags |
|------|------|---------|------|----------|
| 100 | CLIENT_CREDIT | L.CLIENT_CREDIT + L.CLIENT_HELD | 客户可用余额。锁定通过 `debits_pending` 表达 | `debits_must_not_exceed_credits` |
| 101 | CLIENT_AUDIT | L.CLIENT_AUDIT | 客户合规待审余额 | `debits_must_not_exceed_credits` |
| 110 | TRADE_CLEARING | （新增） | 已成交未结算中转 | **none**（允许 debit > credit，交易目标币种侧产生临时负余额） |
| 120 | FEE_RECEIVABLE | L.PLATFORM_PAYABLE | 已从客户扣除的手续费，待归集到公司运营账户 | `debits_must_not_exceed_credits` |

### 不进 TB 的 V1 科目

| V1 Code | 原因 |
|---------|------|
| A.BANK_RESTRICTED / A.CUSTODY_RESTRICTED | CLIENT_AUDIT 在负债侧表达 |
| A.BANK_IN_TRANSIT / A.CUSTODY_IN_TRANSIT | TB two-phase pending 替代 |
| L.CLIENT_HELD | TB `debits_pending` 替代 |
| L.LP_PAYABLE | 公司侧，不进 TB |
| Q.RETAINED_EARNINGS | 公司侧 |
| R.SWAP_FEE / R.WITHDRAW_FEE / R.DEPOSIT_FEE | 公司收入。FEE_RECEIVABLE 只负责客户侧"暂存" |
| E.LP_COST / E.BANK_FEE / E.NETWORK_FEE | 公司费用，不进 TB |

### 账户创建时机

| 账户 | 创建时机 | 数量 |
|------|----------|------|
| BANK | Asset Listing 审批通过（FIAT） | 1 per asset |
| CUSTODY | Asset Listing 审批通过（CRYPTO） | 1 per asset |
| TRADE_CLEARING | Asset Listing 审批通过（所有资产） | 1 per asset ledger |
| FEE_RECEIVABLE | Asset Listing 审批通过（所有资产） | 1 per asset ledger |
| CLIENT_CREDIT | 客户创建充值入口时（deposit wallet / vIBAN） | 1 per customer per asset |
| CLIENT_AUDIT | 客户首次充值到账时（合规待审） | 1 per customer per asset |

### 不变量

每个 ledger 独立成立：

```
CUSTODY/BANK = sum(CLIENT_CREDIT) + sum(CLIENT_AUDIT) + TRADE_CLEARING + FEE_RECEIVABLE
```

客户可用余额 = `CLIENT_CREDIT.credits_posted - CLIENT_CREDIT.debits_posted - CLIENT_CREDIT.debits_pending`

---

## Section 3: 记账模型参考

### 3.1 加密充值（USDT）

```
到账（合规待审）:  Transfer(debit=CUSTODY, credit=CLIENT_AUDIT, 1000 USDT)
合规通过:         Transfer(debit=CLIENT_AUDIT, credit=CLIENT_CREDIT, 1000 USDT)
合规拒绝:         Transfer(debit=CLIENT_AUDIT, credit=CUSTODY, 1000 USDT) [冲销，安排退回]
```

### 3.2 法币充值（AED）

同上，BANK 替换 CUSTODY。

### 3.3 交易（客户卖 1000 USDT 买 AED，执行价 3.4125）

```
兑换创建（锁定）:  Pending Transfer(debit=CLIENT_CREDIT, credit=TRADE_CLEARING, 1000 USDT, flags=pending)
                  → CLIENT_CREDIT.debits_pending += 1000（可用余额自动减少）

兑换成功:         Post pending → CLIENT_CREDIT -1000, TRADE_CLEARING +1000
                  Transfer(debit=TRADE_CLEARING, credit=CLIENT_CREDIT, 3412.50 AED)

兑换失败/拒绝:    Void pending → debits_pending 释放，客户余额恢复
```

### 3.4 日终结算（托管层追上 TB）

```
USDT 结算: Transfer(debit=TRADE_CLEARING, credit=CUSTODY, 1000 USDT)
AED 结算:  Transfer(debit=BANK, credit=TRADE_CLEARING, 3412.50 AED)
```

### 3.5 加密提现（100 USDT，手续费 2 USDT）

```
提现创建（锁定）:  Pending Transfer #1(debit=CLIENT_CREDIT, credit=CUSTODY, 100 USDT, flags=pending)
                  Pending Transfer #2(debit=CLIENT_CREDIT, credit=FEE_RECEIVABLE, 2 USDT, flags=pending)
                  → CLIENT_CREDIT.debits_pending += 102

提现成功:         Post #1 → CLIENT_CREDIT -100, CUSTODY -100（资金离开托管）
                  Post #2 → CLIENT_CREDIT -2, FEE_RECEIVABLE +2（手续费入账）

提现失败/退回:    Void #1 + Void #2 → 全部释放
```

法币提现同上，BANK 替换 CUSTODY。

### 3.6 手续费归集（FEE-COLLECT，定期）

```
Transfer(debit=FEE_RECEIVABLE, credit=CUSTODY/BANK, fee_amount)
→ 手续费从客户池转出到公司运营钱包，FEE_RECEIVABLE 清零
```

### 3.7 归集（deposit wallet → main wallet）

不产生 TB transfer，纯托管层操作。Gas 费用记录在 Prisma 运营记录中。

### 3.8 Spread

不在 TB 中显式记录。公司 P&L 从订单记录推导（执行价 vs 市场价）。

---

## Section 4: 审批 Payload

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

## Section 5: 执行流程

### 5.1 提交阶段（Maker）

```
1. 校验 payload（字段类型、必填、CRYPTO 必须有 network）
2. 校验唯一性：type + code + network 组合不能已存在（Asset 表，含 PENDING_APPROVAL 状态）
3. 生成 assetNo（generateReferenceNo('AS')，与现有 AssetsService 一致）
4. 创建 Asset 记录（status = PENDING_APPROVAL）
   → 写入所有 payload 字段 + assetNo
   → tbLedgerId 暂不分配（null）
5. 创建 ApprovalCase（type = ASSET_LISTING）
   → approvalsService.createAndSubmit()
   → entityRef = asset.id
   → objectSnapshot = payload
6. 关联：更新 Asset.approvalCaseId / approvalCaseNo
7. 审计日志：ASSET_LISTING_SUBMITTED
```

### 5.2 审批通过（@OnEvent 回调）

审批引擎通过事件分发，workflow 监听 `workflow.asset-listing.decided` 事件（与 Role 创建 workflow 模式一致）。

在 Prisma 事务内执行：

```
1. 校验 Asset.status = PENDING_APPROVAL（防止重复执行）
2. 分配 tbLedgerId
   → SELECT MAX(tbLedgerId) FROM Asset + 1（首个从 1 开始）
   → tbLedgerId 有 @unique 约束，并发安全
3. 调用 AccountingService.createAccounts() 创建 TB 系统账户（3 个）：
   → FIAT:   BANK(code=1) + TRADE_CLEARING(code=110) + FEE_RECEIVABLE(code=120)
   → CRYPTO: CUSTODY(code=10) + TRADE_CLEARING(code=110) + FEE_RECEIVABLE(code=120)
   （createAccounts 内部自动注册 TbAccountRegistry）
4. 更新 Asset：
   → tbLedgerId = 分配值
   → status = PROVISIONING
5. 标记审批执行结果：approvalsService.markExecutionResult()
6. 审计日志：ASSET_LISTING_APPROVED + ASSET_PROVISIONED
```

**失败处理：** TB 账户创建（Step 3）在 Prisma 事务外执行。如果 TB 成功但 Step 4 失败，TB 账户成为孤儿。可接受风险：TB 创建是幂等的（相同 ID 重复创建被拒绝但无副作用），重新触发回调即可修复。重试方式：手动通过 Admin 后台重新触发审批执行。

### 5.3 审批拒绝（@OnEvent 回调）

```
1. 删除 Asset 记录
2. 审计日志：ASSET_LISTING_REJECTED
```

### 5.4 激活（运营手动）

```
POST /admin/assets/:assetNo/activate

1. 校验 Asset.status = PROVISIONING（其他状态返回 400）
2. 更新 status = ACTIVE
3. 审计日志：ASSET_ACTIVATED
```

Phase 0 不做前置校验（如检查钱包是否配好）。后续迭代可加。

---

## Section 6: 三层架构

```
AssetListingController
  POST /admin/assets/listing              ← Maker 提交申请
  POST /admin/assets/:assetNo/activate    ← 运营激活
  （审批通过/拒绝通过 @OnEvent 回调，不需要独立 HTTP 端点）

AssetListingWorkflow（编排层）
  ├─ submitListing(payload, actor)
  │    → 校验 → 创建 Asset(PENDING_APPROVAL) → 创建 ApprovalCase → 关联
  │
  ├─ @OnEvent('workflow.asset-listing.decided')
  │    → decision = APPROVED → AssetProvisioningService.provision()
  │    → decision = DECLINED → 删除 Asset 记录
  │
  └─ activateAsset(assetNo, actor)
       → 校验 status = PROVISIONING → 更新 ACTIVE

AssetProvisioningService（新 domain service）
  └─ provision(asset, tbLedgerId)
       → AccountingService.createAccounts()  ← 内部处理 TB 创建 + Registry 注册
       → 更新 Asset (tbLedgerId, status=PROVISIONING)

复用:
  ├─ ApprovalCaseService      ← V1 Maker/Checker 引擎
  ├─ AssetsService             ← 现有，扩展 status 和新字段
  └─ AuditLogsService          ← 审计日志
```

---

## Section 7: 数据模型变更

### Asset 表扩展

新增字段（9 个）：

| 字段 | 类型 | 说明 |
|------|------|------|
| contractAddress | String? | 合约地址 |
| minDepositAmount | Decimal? | 最小充值 |
| maxDepositAmount | Decimal? | 最大充值 |
| minWithdrawAmount | Decimal? | 最小提现 |
| maxWithdrawAmount | Decimal? | 最大提现 |
| depositEnabled | Boolean | 是否允许充值（default: true） |
| withdrawalEnabled | Boolean | 是否允许提现（default: true） |
| approvalCaseId | String? | 关联审批单 ID |
| approvalCaseNo | String? | 关联审批单编号 |

**已有字段变更：**
- `status`：已有（default: ACTIVE），新增枚举值 PENDING_APPROVAL / PROVISIONING。现有 seed 数据保持 ACTIVE。Prisma `@default` 保持 `"ACTIVE"` 不变——workflow 创建时显式传入 `PENDING_APPROVAL`。
- `tbLedgerId`：Phase 0 基础设施已添加。

### TB Account Codes 常量更新

```typescript
TB_ACCOUNT_CODES = {
  BANK: 1,
  CUSTODY: 10,
  CLIENT_CREDIT: 100,
  CLIENT_AUDIT: 101,
  TRADE_CLEARING: 110,
  FEE_RECEIVABLE: 120,
} as const;
```

---

## Section 8: 对现有系统的影响

| 模块 | 影响 |
|------|------|
| Asset model (Prisma) | 新增 9 个字段 + migration |
| Asset DTO / enum | 新增 PENDING_APPROVAL、PROVISIONING 枚举值 |
| AssetsService | 扩展 create() 支持新字段 |
| ApprovalActionTypes 常量 | 新增 ASSET_LISTING |
| AuditBusinessWorkflowTypes | 新增 ASSET_LISTING |
| 客户端 Asset 查询 | 加 `WHERE status = 'ACTIVE'` 过滤 |
| Admin Asset 列表 | 显示所有状态，展示 status 标签 |
| tb-account-codes.constant.ts | 新增 CLIENT_AUDIT=101, TRADE_CLEARING=110, FEE_RECEIVABLE=120 |
| Seed 数据 | 现有 AED/USDT/BTC 保持 status=ACTIVE（@default 不变） |

---

## Section 9: 不在本设计范围

| 排除项 | 原因 |
|--------|------|
| 系统钱包创建 | 不同币种钱包架构不同，独立流程管理 |
| CLIENT_CREDIT / CLIENT_AUDIT 账户创建 | 按需创建：充值入口开通时创建 CLIENT_CREDIT，首次充值到账时创建 CLIENT_AUDIT |
| Gas 费用记账 | TRX gas 不进 TB，Prisma 运营记录兜底 |
| Spread 记账 | 隐含在订单数据中，公司 P&L 从订单推导 |
| 公司侧科目（LP_PAYABLE, Revenue, Expense） | 不进 TB，公司会计系统单独处理 |
| Asset 停用/下架 | 后续迭代 |
| Admin 前端页面 | 后续实现计划单独处理 |
