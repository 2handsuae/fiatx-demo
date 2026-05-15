# Customer Deposit Wallet Creation Design

Date: 2026-05-13 | Scope: V3 Phase 1 | Status: DRAFT

---

## Overview

客户在 Deposit 页面选择币种后，系统自动通过托管商 API（HexTrust / ZandBank）创建充值地址或 VIBAN，无需管理员审批。

- **Crypto（C_DEP）：** 调用 HexTrust adapter 创建 vault + address
- **Fiat（C_VIBAN）：** 调用 ZandBank adapter 创建 VIBAN
- 每个客户每个币种最多一个充值钱包（幂等：已存在则直接返回）
- 同步调用，一次请求完成

**前置依赖：** 
- Custodian Wallet Create Workflow（admin 流程已实现，adapter 基础设施已就位）
- Asset 处于 ACTIVE 状态

---

## Section 1: 与 Admin 流程的关系

| 维度 | Admin 流程 | 客户自创建 |
|------|-----------|-----------|
| 触发方 | Admin（Maker/Checker） | 客户自己 |
| 审批 | PENDING_APPROVAL → CREATING → ACTIVE | 无审批，直接 CREATING → ACTIVE |
| 角色范围 | 所有 7 种角色 | 仅 C_DEP、C_VIBAN |
| 适配器 | 同一个 CustodianAdapter | 同一个 CustodianAdapter |
| 状态流转 | PENDING_APPROVAL → CREATING → ACTIVE/FAILED | CREATING → ACTIVE（失败直接抛错，不留 FAILED 记录） |

**关键区别：** 客户流程不产生 FAILED 记录。如果 adapter 调用失败，整个请求回滚（删除 CREATING 记录），客户可以重新点击生成。

---

## Section 2: 状态流转

```
客户点击生成
  → 准入检查（onboarding + adminStatus）
  → 幂等检查：已有 ACTIVE 钱包？→ 直接返回
  → 创建 Wallet 记录（status = CREATING）
  → 调用 CustodianAdapter.createVault()
  → 成功：回填 address/iban/vaultId → status = ACTIVE → 返回
  → 失败：删除 CREATING 记录 → 抛出错误
```

不保留 FAILED 记录的理由：客户无法执行 retry 操作，留下 FAILED 记录只会造成幂等检查歧义。

---

## Section 3: API

### 3.1 创建充值钱包

```
POST /client/deposit-wallets
Authorization: Bearer <customer-jwt>
Body: { "assetId": "<asset-uuid>" }
```

Response（成功）:
```json
{
  "id": "wallet-uuid",
  "walletNo": "WA2605130001",
  "walletRole": "C_DEP",
  "type": "CRYPTO_ADDRESS",
  "direction": "INBOUND",
  "status": "ACTIVE",
  "address": "0x1234...",
  "vaultId": "vault-123",
  "asset": { "code": "ETH", "type": "CRYPTO", "decimals": 18 }
}
```

Response（已存在，幂等返回）:
```
同上，返回已有的 ACTIVE 钱包
```

### 3.2 前置校验

| 校验项 | 失败码 | HTTP |
|--------|--------|------|
| Customer onboardingStatus !== APPROVED | `ONBOARDING_NOT_APPROVED` | 403 |
| Customer adminStatus !== ACTIVE | `ACCOUNT_SUSPENDED` | 403 |
| Asset 不存在 | `ASSET_NOT_FOUND` | 404 |
| Asset status !== ACTIVE | `ASSET_NOT_ACTIVE` | 400 |
| Asset type 不在 C_DEP/C_VIBAN 允许范围内 | 不会发生（自动推导） | — |
| 托管商 API 失败 | `CUSTODIAN_CREATE_FAILED` | 502 |

### 3.3 DTO

```typescript
class CreateDepositWalletDto {
  @IsUUID()
  assetId: string;
}
```

极简：`assetId` 是唯一输入。其余全部自动推导：
- `ownerId` = JWT 中的 customerId
- `ownerType` = CUSTOMER
- `walletRole` = asset.type === 'FIAT' ? C_VIBAN : C_DEP
- `type` = asset.type === 'FIAT' ? FIAT_BANK : CRYPTO_ADDRESS
- `direction` = INBOUND

---

## Section 4: 后端实现

### 4.1 文件结构

| 文件 | 职责 |
|------|------|
| `wallets/customer-deposit-wallet.controller.ts`（新增） | Client controller，JWT 守卫 |
| `wallets/customer-deposit-wallet.service.ts`（新增） | 业务逻辑：准入检查 → 幂等 → adapter → 审计 |
| `wallets/dto/create-deposit-wallet.dto.ts`（新增） | 极简 DTO |

### 4.2 执行流程

```
1. 从 JWT 提取 customerId
2. 查询 CustomerMain：
   - onboardingStatus !== 'APPROVED' → 403 ONBOARDING_NOT_APPROVED
   - adminStatus !== 'ACTIVE' → 403 ACCOUNT_SUSPENDED
3. 查询 Asset（by id）：
   - 不存在 → 404 ASSET_NOT_FOUND
   - status !== 'ACTIVE' → 400 ASSET_NOT_ACTIVE
4. 推导角色和类型：
   - walletRole = asset.type === 'FIAT' ? C_VIBAN : C_DEP
   - walletType = asset.type === 'FIAT' ? FIAT_BANK : CRYPTO_ADDRESS
5. 幂等检查：查询现有 ACTIVE 钱包
   WHERE ownerType=CUSTOMER, ownerId=customerId, assetId, walletRole, status=ACTIVE
   → 找到则直接返回（include asset）
6. 生成 walletNo（generateReferenceNo('WA')）
7. 创建 Wallet 记录：status = CREATING
8. 调用 CustodianAdapter.createVault({
     assetCode: asset.code,
     network: asset.network,
     role: walletRole,
   })
9. 成功：
   → wallet.update({ status: ACTIVE, vaultId, address, iban })
   → 审计日志：DEPOSIT_WALLET_CREATED
   → 返回 wallet（include asset）
10. 失败：
    → wallet.delete()
    → 审计日志：DEPOSIT_WALLET_CREATE_FAILED
    → throw BadGatewayException('CUSTODIAN_CREATE_FAILED')
```

### 4.3 Controller 路由

```typescript
@Controller('client/deposit-wallets')
@UseGuards(AuthGuard('jwt'))
```

不挂 `AdminPermissionGuard`（这是 RBAC 守卫，客户端不用）。通过 JWT 中的 `type === 'CUSTOMER'` 来限制。

---

## Section 5: 审计日志

不走 governance workflow 审计（无审批流程），直接用 `AuditActions` 记录。

```typescript
// audit-actions.constant.ts 新增
DEPOSIT_WALLET_CREATED: 'DEPOSIT_WALLET_CREATED',
DEPOSIT_WALLET_CREATE_FAILED: 'DEPOSIT_WALLET_CREATE_FAILED',
```

审计记录字段：
- `entityType`: WALLET
- `entityId`: wallet.id
- `entityNo`: wallet.walletNo
- `entityOwnerType`: CUSTOMER
- `entityOwnerId`: customerId
- `sourcePlatform`: CLIENT_API
- `metadata`: { assetCode, assetType, walletRole, vaultId?, address?, iban?, error? }

使用 `auditLogsService.recordSystem()` —— 因为是系统自动执行，没有 admin actor。但 metadata 中包含 customerId 以便追踪。

---

## Section 6: 前端改动

### Deposit.tsx

改动范围极小，只改 `handleGenerate` 函数：

**Before:**
```typescript
const payload = {
  ownerType: 'CUSTOMER',
  ownerId: user.id,
  direction: 'INBOUND',
  type: activeTab === 'crypto' ? 'CRYPTO_ADDRESS' : 'FIAT_BANK',
  assetId: selectedAssetId,
};
const response = await customerFetch(`${VITE_API_URL}/wallets`, {
  method: 'POST',
  body: JSON.stringify(payload),
});
```

**After:**
```typescript
const response = await customerFetch(
  `${VITE_API_URL}/client/deposit-wallets`,
  {
    method: 'POST',
    body: JSON.stringify({ assetId: selectedAssetId }),
  },
);
```

同时更新 `fetchWallet` 中查询已有钱包的逻辑：
- `walletRole` 过滤从 `'DEPOSIT'` 改为按 tab 区分：`activeTab === 'crypto' ? 'C_DEP' : 'C_VIBAN'`

---

## Section 7: 对现有系统的影响

| 模块 | 影响 |
|------|------|
| `wallets.service.ts` | 不改。现有 `POST /wallets` 保留给 outbound wallet 手动创建 |
| `custodian-wallet-create-workflow.service.ts` | 不改。Admin 流程独立 |
| `CustodianAdapter` | 不改。复用同一接口和 mock 实现 |
| `wallets.module.ts` | 注册新 controller + service |
| `audit-actions.constant.ts` | 新增 2 个 action |
| `Deposit.tsx` | 改 `handleGenerate` + `fetchWallet` |
| 现有 `POST /wallets` 的 mock 地址生成 | 保留（outbound wallet 仍用） |

---

## Section 8: 不在本设计范围

| 排除项 | 原因 |
|--------|------|
| 提现目的地（Withdrawal Destination）创建 | 独立 workflow，客户手动填写地址 |
| 充值钱包停用/删除 | 后续 wallet lifecycle 管理 |
| 充值钱包 retry（FAILED 状态） | 本设计不产生 FAILED 记录，失败即回滚 |
| HexTrust / ZandBank 真实 API 对接 | MVP 用 mock adapter |
| WalletManagement 页面改动 | 该页面只管 outbound wallets，不涉及 |
