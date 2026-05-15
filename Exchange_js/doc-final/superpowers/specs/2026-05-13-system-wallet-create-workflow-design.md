# Custodian Wallet Create Workflow Design

Date: 2026-05-13 | Scope: V3 Phase 1 | Status: DRAFT

---

## Overview

平台内所有我方控制的托管钱包/银行账号共用一个统一创建 workflow。不区分系统级/客户级——本质都是在托管商处创建 vault/address，只是赋予的 walletRole 不同。

- **本次实现：** Admin 创建路径（Maker/Checker 审批）
- **后续扩展：** 客户自创建充值入口（无审批门，加 client controller 即可）
- Workflow 层设计为 actor-agnostic，不硬编码 admin 逻辑

**前置依赖：** Asset Listing workflow（资产处于 PROVISIONING 或 ACTIVE 状态）。
**后续依赖：** V4-V7 充提、交易、内部转账的物理执行依赖托管钱包。

---

## Section 1: 钱包管理两大分类

| 分类 | 控制方 | 创建方 | Workflow |
|------|--------|--------|----------|
| 托管钱包（Custodian Wallet） | 平台 | Admin（全部角色）/ 客户（仅 C_DEP / C_VIBAN，后续） | 本 workflow |
| 提现目的地（Withdrawal Destination） | 客户 | 仅客户 | 独立 workflow（含安全冷却期） |

托管钱包的共同特征：地址/账号由我方在托管商处创建和控制，客户不持有私钥。

---

## Section 2: 状态生命周期

```
PENDING_APPROVAL → (审批通过) → CREATING → (托管商成功) → ACTIVE
                 → (审批拒绝) → 删除记录
                                CREATING → (托管商失败) → FAILED
                                            FAILED → (repair 重试) → CREATING → ...
```

| 状态 | 含义 | 可见性 |
|------|------|--------|
| PENDING_APPROVAL | Maker 已提交，等 Checker 审批 | Admin 后台可见 |
| CREATING | 审批通过，正在调用托管商 API 创建 vault/address | Admin 后台可见 |
| ACTIVE | 托管商创建成功，可用 | Admin + 客户端可见 |
| FAILED | 托管商创建失败，等待 repair 重试 | Admin 后台可见 |

**审批拒绝：** 直接删除 Wallet 记录（与 Asset Listing / Role Definition 保持一致）。审计日志已有完整拒绝记录。

**客户自创建路径（后续）：** 跳过 PENDING_APPROVAL，直接进入 CREATING。

---

## Section 3: 三层架构

| 层 | 文件（`wallets/` 目录下） | 职责 |
|---|---|---|
| L1 Domain | `wallets.service.ts`（已有，扩展） | 钱包 CRUD、状态转换、角色策略校验 |
| L2 Approval | `custodian-wallet-create-approval.service.ts`（新增） | 继承 `ApprovalHandlerBase`，4 常量 + 标准 `@OnEvent` 处理 |
| L3 Workflow | `custodian-wallet-create-workflow.service.ts`（新增） | 编排：校验 → 创建记录 → [审批] → 托管商调用 → 审计 |
| Adapter | `custodian-adapter.interface.ts` + `mock-custodian.adapter.ts`（新增） | 托管商接口抽象 + Mock 实现 |

现有 `system-wallet-provisioning.service.ts` 废弃，由 workflow service 替代。

---

## Section 4: 角色策略（硬编码常量）

```typescript
const WALLET_ROLE_POLICIES: Record<WalletRole, WalletRolePolicy> = {
  C_DEP:  { maxPerOwnerPerAsset: 1, allowedOwnerTypes: ['CUSTOMER'], allowedAssetTypes: ['CRYPTO'], requiresCustodian: true },
  C_VIBAN:{ maxPerOwnerPerAsset: 1, allowedOwnerTypes: ['CUSTOMER'], allowedAssetTypes: ['FIAT'],   requiresCustodian: true },
  C_MAIN: { maxPerOwnerPerAsset: 1, allowedOwnerTypes: ['PLATFORM'], allowedAssetTypes: ['CRYPTO'], requiresCustodian: true },
  C_OUT:  { maxPerOwnerPerAsset: 1, allowedOwnerTypes: ['PLATFORM'], allowedAssetTypes: ['CRYPTO'], requiresCustodian: true },
  C_CMA:  { maxPerOwnerPerAsset: 1, allowedOwnerTypes: ['PLATFORM'], allowedAssetTypes: ['FIAT'],   requiresCustodian: true },
  F_LIQ:  { maxPerOwnerPerAsset: 1, allowedOwnerTypes: ['PLATFORM'], allowedAssetTypes: ['CRYPTO','FIAT'], requiresCustodian: true },
  F_OPS:  { maxPerOwnerPerAsset: 1, allowedOwnerTypes: ['PLATFORM'], allowedAssetTypes: ['CRYPTO','FIAT'], requiresCustodian: true },
};
```

| 策略字段 | 说明 |
|----------|------|
| `maxPerOwnerPerAsset` | 同一 owner + 同一 asset 下该角色的最大数量 |
| `allowedOwnerTypes` | 该角色允许的 ownerType |
| `allowedAssetTypes` | 该角色允许的 asset type（FIAT / CRYPTO） |
| `requiresCustodian` | 是否需要调用托管商 API（当前全部为 true） |

Workflow 创建前统一通过策略表校验：ownerType 是否匹配、asset type 是否匹配、是否超出 maxPerOwnerPerAsset。

---

## Section 5: API

### 5.1 提交创建请求（Maker，本次实现）

```
POST /admin/custodian-wallets
Body: {
  "assetNo": "AS-xxx",
  "role": "F_LIQ",
  "ownerId"?: "customer-uuid"   // 客户级钱包时传，系统级不传
}
```

- 系统级钱包（PLATFORM）：不传 ownerId，ownerType 由角色策略推导
- 客户级钱包（Admin 代创建）：传 ownerId，ownerType 由角色策略推导

Response: `{ wallet, approvalCase }`

### 5.2 Repair 重试（FAILED 状态）

```
POST /admin/custodian-wallets/:walletNo/retry
```

Response: 重新调用托管商 API，成功则 ACTIVE，再次失败则保持 FAILED。

### 前置校验

| 校验项 | 失败码 |
|--------|--------|
| Asset 状态必须为 `PROVISIONING` 或 `ACTIVE` | `INVALID_ASSET_STATUS` |
| role 必须存在于角色策略表 | `INVALID_WALLET_ROLE` |
| asset type 必须在角色策略的 allowedAssetTypes 内 | `ASSET_TYPE_MISMATCH` |
| ownerType 必须在角色策略的 allowedOwnerTypes 内 | `OWNER_TYPE_MISMATCH` |
| 同 owner + 同 asset + 同 role 不超过 maxPerOwnerPerAsset（含所有状态） | `WALLET_ALREADY_EXISTS` |
| ownerId 对应的 customer 必须存在（如传了 ownerId） | `CUSTOMER_NOT_FOUND` |

---

## Section 6: 托管商 Adapter

```typescript
interface CustodianAdapter {
  createVault(params: {
    assetCode: string;
    network?: string;
    role: WalletRole;
  }): Promise<{ vaultId: string; address?: string; iban?: string }>;
}
```

MVP 用 `MockCustodianAdapter`：
- CRYPTO 角色：生成 `0x` + 40 hex 随机地址
- FIAT 角色：生成 `AE` + 随机 IBAN

通过 NestJS DI token `CUSTODIAN_ADAPTER` 注入，后续替换为 `HexTrustCustodianAdapter` 只需改 provider 配置。

---

## Section 7: 审计日志

`workflowType: CUSTODIAN_WALLET_CREATE`

```typescript
CUSTODIAN_WALLET_CREATE: {
  CREATE_REQUESTED:      'CREATE_REQUESTED',
  APPROVAL_GRANTED:      'APPROVAL_GRANTED',
  APPROVAL_DECLINED:     'APPROVAL_DECLINED',
  APPROVAL_CANCELLED:    'APPROVAL_CANCELLED',
  APPROVAL_EXPIRED:      'APPROVAL_EXPIRED',
  WALLET_CREATED:        'WALLET_CREATED',
  WALLET_CREATE_FAILED:  'WALLET_CREATE_FAILED',
  CREATE_CANCELLED:      'CREATE_CANCELLED',
},
```

结构与 `ROLE_DEFINITION` 同构。traceId 贯穿全链路。

---

## Section 8: 执行流程

### 8.1 提交阶段（Maker）

```
1. 查找 Asset（by assetNo），校验状态为 PROVISIONING 或 ACTIVE
2. 从角色策略表获取 policy，校验：
   a. asset.type 在 policy.allowedAssetTypes 内
   b. 推导 ownerType（从 policy.allowedOwnerTypes）
   c. 如 ownerType=CUSTOMER，校验 ownerId 存在且 customer 存在
   d. 唯一性：同 owner + 同 asset + 同 role 未超过 maxPerOwnerPerAsset
3. 生成 walletNo（generateReferenceNo('WA')）
4. 创建 Wallet 记录：
   → status = PENDING_APPROVAL
   → ownerType 由策略推导
   → type = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS'
   → direction = 'BIDIRECTIONAL'（系统级）或由角色推导（客户级：C_DEP→INBOUND）
5. 创建 ApprovalCase（type = CUSTODIAN_WALLET_CREATE）
   → entityRef = wallet.id
   → objectSnapshot = { assetNo, assetCode, role, ownerType, ownerId? }
6. 关联：更新 Wallet.approvalCaseId / approvalCaseNo
7. 审计日志：CREATE_REQUESTED
```

### 8.2 审批通过（@OnEvent 回调）

```
1. 校验 Wallet.status = PENDING_APPROVAL（防止重复执行）
2. 更新 Wallet.status → CREATING
3. 调用 CustodianAdapter.createVault()
4. 成功：
   → 回填 address / iban / vaultId 到 Wallet 记录
   → 更新 status → ACTIVE
   → approvalsService.markExecutionResult(true)
   → 审计日志：WALLET_CREATED
5. 失败：
   → 更新 status → FAILED
   → approvalsService.markExecutionResult(false, errorMessage)
   → 审计日志：WALLET_CREATE_FAILED
```

### 8.3 审批拒绝（@OnEvent 回调）

```
1. 删除 Wallet 记录
2. 审计日志：CREATE_CANCELLED
```

### 8.4 Repair 重试

```
POST /admin/custodian-wallets/:walletNo/retry

1. 校验 Wallet.status = FAILED
2. 更新 status → CREATING
3. 调用 CustodianAdapter.createVault()
4. 同 8.2 步骤 4/5（成功→ACTIVE / 失败→FAILED）
```

---

## Section 9: 数据模型变更

### Wallet 表扩展

新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| approvalCaseId | String? | 关联审批单 ID |
| approvalCaseNo | String? | 关联审批单编号 |
| vaultId | String? | 托管商返回的 vault 标识 |

**已有字段变更：**
- `status`：新增枚举值 `PENDING_APPROVAL`、`CREATING`、`FAILED`（原有 ACTIVE / FROZEN / DISABLED 不变）

现有 seed 数据和手动创建的钱包保持 `status = ACTIVE`，不受影响。

### 常量注册

| 常量 | 新增值 |
|------|--------|
| ApprovalActionTypes | `CUSTODIAN_WALLET_CREATE` |
| AuditBusinessWorkflowTypes | `CUSTODIAN_WALLET_CREATE` |
| AuditGovernanceActions | `CUSTODIAN_WALLET_CREATE: { ... }` 组（Section 7） |
| AuditEntityTypes | 复用已有 `WALLET` |

---

## Section 10: 对现有系统的影响

| 模块 | 影响 |
|------|------|
| Wallet model (Prisma) | 新增 3 个字段 + migration |
| WalletStatus enum (DTO) | 新增 PENDING_APPROVAL / CREATING / FAILED |
| WalletsModule | 注册新的 workflow + approval + adapter provider |
| wallets.service.ts | 扩展：角色策略校验方法 |
| ApprovalActionTypes | 新增 CUSTODIAN_WALLET_CREATE |
| AuditGovernanceActions | 新增 CUSTODIAN_WALLET_CREATE 组 |
| AuditBusinessWorkflowTypes | 新增 CUSTODIAN_WALLET_CREATE |
| AssetListingController | 移除 `POST :assetNo/provision-wallets` 端点 |
| system-wallet-provisioning.service.ts | 废弃 |

---

## Section 11: 后续扩展点

### 客户自创建充值入口（独立任务）

加 `POST /client/custodian-wallets` 端点，调用同一个 workflow service，但：
- 跳过审批门（直接进入 CREATING）
- actorContext 为 customer JWT
- 只允许 C_DEP / C_VIBAN 角色
- 角色策略校验复用

### 不在本设计范围

| 排除项 | 原因 |
|--------|------|
| 客户自创建充值入口 | 后续独立任务，workflow 层已预留扩展点 |
| 提现目的地（Withdrawal Destination） | 独立 workflow，含安全冷却期，不同 model |
| 钱包停用 / 删除 | 后续 Asset Suspension workflow |
| HexTrust 真实 API 对接 | MVP 用 mock adapter |
| Admin 前端页面 | 后续设计单独处理 |
