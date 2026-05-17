# V3 Batch 1 Fix — Design Spec

> **Status:** APPROVED | **Date:** 2026-05-17 | **Scope:** V3 Bug Fix + L1 补齐
> **目标：** 修复 V3 审查发现的 Critical/High bug，补齐 L1 Domain Service 方法，为 Batch 2 的 Workflow 重构铺路

---

## 背景

V3 代码审查（2026-05-17）发现系统性问题：
- Rule 5 违规：Workflow 直接写 Prisma 表（根因是 L1 方法不足）
- Rule 2 违规：多表变更无事务
- Critical bug：TB ledger:0、错误端口、证据静默丢失
- High bug：激活无状态校验、No 生成竞态

本 Batch 分两个 Round 解决前置问题，不涉及 Workflow 重构（Batch 2 处理）。

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| L1 方法是否写审计 | **不写（纯净模式）** | 遵循 backend-platform.md Layer 1 规范；审计由 L3 负责 |
| Wallet 软删除 vs 物理删除 | **保留物理 DELETE** | 与 RoleDefinition 一致；审计在 DELETE 前写入 |
| lazyActivateForCustomer 修复方式 | **Controller 调 Workflow** | 避免 L1→L3 循环依赖 |
| No 生成竞态修复 | **L1 方法内部封装 P2002 重试循环** | 简单有效，不需要额外基础设施 |

---

## Round 1 — 紧急 Bug 修复

### 1.1 TigerBeetle 端口配置

**文件:** `Exchange_js/.env`

添加：
```
TB_ADDRESS=127.0.0.1:3503
```

### 1.2 余额查询 ledger 修复

**文件:** `src/modules/accounting/tigerbeetle/accounting.service.ts`

修改 `getCustomerAvailableBalance` 方法：
- 接收 `assetCode: string` 参数
- 通过 `TB_LEDGERS[assetCode]` 获取正确 ledger（而非硬编码 `0`）
- 如果 assetCode 无对应 ledger，抛出 `BadRequestException`

### 1.3 Evidence 写入失败 rethrow

**文件:** `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`

修改 `writeEvidence` 的 catch 块：写入 backlog 后 **重新抛出** error，让调用方知道证据写入失败。

### 1.4 资产激活前置状态校验

**文件:** `src/modules/asset-treasury/assets/asset-activation-workflow.service.ts`

`executeActivation` 方法中：
1. 先 `findUnique({ where: { id: entityRef } })`
2. 校验 `asset.status === 'PROVISIONING'`，否则 throw `ConflictException('Asset is not in PROVISIONING status')`
3. 然后执行原有的 status update

### 1.5 审计 action 语义修正（资产更新）

**文件:** `src/modules/audit-logging/constants/audit-actions.constant.ts`

在 `AuditGovernanceActions.ASSET_CREATION` 下新增：
```typescript
ASSET_PROVISIONING_UPDATED: 'ASSET_PROVISIONING_UPDATED',
```

**文件:** `src/modules/asset-treasury/assets/asset-listing-workflow.service.ts`

`updateProvisioning` 方法的 audit action 从 `ASSET_CREATED_AND_PROVISIONED` 改为 `ASSET_PROVISIONING_UPDATED`。

### 1.6 审计 action 语义修正（暂停/恢复失败）

**文件:** `src/modules/audit-logging/constants/audit-actions.constant.ts`

新增：
```typescript
AuditGovernanceActions.ASSET_SUSPENSION.SUSPENSION_EXECUTION_FAILED = 'SUSPENSION_EXECUTION_FAILED';
AuditGovernanceActions.ASSET_REACTIVATION.REACTIVATION_EXECUTION_FAILED = 'REACTIVATION_EXECUTION_FAILED';
```

**文件:** `asset-suspension-workflow.service.ts` + `asset-reactivation-workflow.service.ts`

各自的 failure 分支 audit action 改用对应 `*_EXECUTION_FAILED` 常量。

### 1.7 lazyActivateForCustomer 审计覆盖

**文件:** `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.controller.ts`

Client controller 的 `list` 和 `getDetail` 端点中：
1. 在返回数据前，调用 `workflowService.batchActivateExpired(customerId)`
2. 该方法查找所有 `PENDING_ACTIVATION` 且 `activatesAt <= now()` 的地址
3. 对每个调用已有的 `workflowService.activateAddress(addressNo)`（含审计）

**文件:** `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts`

新增：
```typescript
async batchActivateExpired(customerId: string): Promise<void> {
  const expired = await this.addressService.findExpiredPending(customerId);
  for (const addr of expired) {
    await this.activateAddress(addr.addressNo);
  }
}
```

**文件:** `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts`

新增查询方法：
```typescript
async findExpiredPending(customerId: string): Promise<WithdrawalAddress[]> {
  return this.prisma.withdrawalAddress.findMany({
    where: { customerId, status: 'PENDING_ACTIVATION', activatesAt: { lte: new Date() } },
  });
}
```

移除或标记 `@deprecated` 原 `lazyActivateForCustomer` 方法。

### 1.8 地址格式校验：未知网络拒绝

**文件:** `src/modules/asset-treasury/withdrawal-addresses/address-validator.util.ts`

修改 fallback 逻辑：
```typescript
if (!validator) return { valid: false, reason: `Unsupported network: ${network}` };
```

---

## Round 2 — 补齐 L1 Domain Service 方法

### 设计原则

- **纯净 L1：** 只做数据变更 + 不变量校验，不写审计日志
- **支持事务组合：** 所有方法接受 `tx?: Prisma.TransactionClient`
- **状态守卫：** 状态转换方法内部校验源状态，非法转换 throw `ConflictException`
- **重试安全：** No 生成方法内置 P2002 重试循环（最多 3 次）

---

### 2A — AssetsService 新增方法

**文件:** `src/modules/asset-treasury/assets/assets.service.ts`

#### `activateAsset(assetNo: string, tx?): Promise<Asset>`

```
前置校验: 查找 asset by assetNo; status must be 'PROVISIONING'
执行: update status → 'ACTIVE'
返回: 更新后的 Asset
```

#### `linkApprovalCase(assetNo: string, approvalCaseId: string, approvalCaseNo: string, tx?): Promise<void>`

```
执行: update asset set approvalCaseId, approvalCaseNo where assetNo
```

#### `findByAssetNo(assetNo: string, tx?): Promise<Asset | null>`

```
执行: findFirst where assetNo
```

#### `updateProvisioningFields(assetNo: string, dto: UpdateProvisioningFieldsDto, tx?): Promise<Asset>`

```
前置校验: status must be 'PROVISIONING'
执行: update 运营字段（minDeposit, maxDeposit, minWithdraw, maxWithdraw, depositEnabled, withdrawalEnabled, description, contractAddress）
返回: 更新后的 Asset
```

---

### 2B — WalletsService 新增方法

**文件:** `src/modules/asset-treasury/wallets/wallets.service.ts`

#### `createWalletRecord(dto, tx?): Promise<Wallet>`

```
参数 dto: { assetId, ownerType, ownerId?, ownerNo?, walletRole, status: 'PENDING_APPROVAL' | 'CREATING' }
前置校验:
  - 角色策略: allowedOwnerTypes, allowedAssetTypes, maxPerOwnerPerAsset
  - Asset 存在且状态允许:
    - ownerType=PLATFORM（系统钱包）: asset status in [PROVISIONING, ACTIVE]
    - ownerType=CUSTOMER（客户钱包）: asset status must be ACTIVE only
执行: 生成 walletNo（带 P2002 重试循环）, prisma.wallet.create
返回: 含 walletNo 的完整 Wallet
```

#### `linkApprovalCase(walletNo: string, caseId: string, caseNo: string, tx?): Promise<void>`

```
执行: update wallet set approvalCaseId, approvalCaseNo where walletNo
```

#### `transitionStatus(walletNo: string, from: string, to: string, extra?: Record<string,any>, tx?): Promise<Wallet>`

```
合法转换白名单:
  PENDING_APPROVAL → CREATING
  CREATING → ACTIVE
  CREATING → FAILED
  FAILED → CREATING (retry)
前置校验: 当前 status === from; 转换在白名单中
执行: update status → to, merge extra fields (vaultId, address, iban, memo)
返回: 更新后的 Wallet
```

#### `deleteWallet(walletNo: string, tx?): Promise<void>`

```
前置校验: status in ['PENDING_APPROVAL', 'FAILED'] (只有这些可删)
执行: prisma.wallet.delete where walletNo
```

#### `findByWalletNo(walletNo: string, tx?): Promise<Wallet | null>`

```
执行: findFirst where walletNo
```

---

### 2C — TransactionLimitsService 新增方法

**文件:** `src/modules/governance/transaction-limits/transaction-limits.service.ts`

#### `createPolicy(dto, tx?): Promise<TransactionLimitPolicy>`

```
参数: { tradingTier, operationType, period, limitAmount }
前置校验:
  - tradingTier/operationType/period 在常量白名单中
  - 无已存在的 [tradingTier, operationType, period] 组合
执行: 生成 policyNo（P2002 重试循环），create status='PENDING_APPROVAL'
返回: 含 policyNo 的完整记录
```

#### `linkApprovalCaseToPolicy(policyNo: string, caseId: string, tx?): Promise<void>`

```
执行: update policy set approvalCaseId where policyNo
```

#### `activatePolicy(policyNo: string, tx?): Promise<void>`

```
前置校验: status === 'PENDING_APPROVAL'
执行: update status → 'ACTIVE', clear approvalCaseId
```

#### `deleteRejectedPolicy(policyNo: string, tx?): Promise<void>`

```
前置校验: status === 'PENDING_APPROVAL'
执行: prisma.transactionLimitPolicy.delete where policyNo
```

#### `createChangeRequest(dto, tx?): Promise<TransactionLimitChangeRequest>`

```
参数: { policyId, policyNo, proposedAmount, changeReason, requestedByUserId }
前置校验:
  - 同一 policyId 无其他 PENDING_APPROVAL 的 request
  - 快照当前 policy.limitAmount 为 currentAmount
执行: 生成 requestNo（P2002 重试），create status='PENDING_APPROVAL'
返回: 含 requestNo 的完整记录
```

#### `linkApprovalCaseToRequest(requestNo: string, caseId: string, caseNo: string, tx?): Promise<void>`

```
执行: update request set approvalCaseId, approvalCaseNo where requestNo
```

#### `executeChange(requestNo: string, tx?): Promise<{ policy, request }>`

```
前置校验:
  - request.status === 'PENDING_APPROVAL'
  - policy.status === 'ACTIVE'
  - 冲突检测: request.currentAmount === policy.limitAmount（snapshot vs actual）
执行:
  - policy.limitAmount = request.proposedAmount
  - request.status = 'EXECUTED', executedAt = now()
返回: { policy, request }
```

#### `rejectChangeRequest(requestNo: string, tx?): Promise<void>`

```
前置校验: status === 'PENDING_APPROVAL'
执行: update status → 'REJECTED'
```

#### `cancelChangeRequest(requestNo: string, tx?): Promise<void>`

```
前置校验: status === 'PENDING_APPROVAL'
执行: update status → 'CANCELLED'
```

---

### 2D — No 生成竞态修复

**涉及文件:**
- `wallets.service.ts` — walletNo 生成
- `transaction-limits.service.ts` — policyNo / requestNo 生成
- `withdrawal-address.service.ts` — addressNo 生成（检查是否已有重试）
- `asset-listing-workflow.service.ts` — assetNo 生成（检查是否已有重试）

**统一模式:** 在每个新增的 `create*` 方法内部：

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  const no = await this.generateNextXxxNo(tx);
  try {
    const record = await (tx ?? this.prisma).xxx.create({ data: { ...dto, xxxNo: no } });
    return record;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      if (attempt === 2) throw new ConflictException('Failed to generate unique No after 3 attempts');
      continue;
    }
    throw e;
  }
}
```

已有的 `WalletsService.create()` 中已实现类似重试循环，新方法参照其模式。

---

### 2E — Internal Domain Events Registry

**文件:** `src/common/events/domain-events.constants.ts`（新建）

```typescript
/**
 * Internal Domain Events Registry
 * 
 * Rules:
 * - All internal domain events must be declared here before use
 * - Emitters: Domain Services or Ingestion/Adapter layers only
 * - Subscribers: Workflow Services only
 */
export const DOMAIN_EVENTS = {
  ASSET_PROVISIONED: {
    name: 'asset.provisioned',
    emitter: 'AssetListingWorkflowService',
    subscribers: ['TbAccountBatchService (to be refactored to workflow in Batch 2)'],
    payload: '{ assetId: string, assetNo: string, assetCode: string, tbLedgerId: number }',
  },
} as const;

/** Type-safe event name accessor */
export const DomainEventNames = {
  ASSET_PROVISIONED: DOMAIN_EVENTS.ASSET_PROVISIONED.name,
} as const;
```

---

## 文件变更清单

### Round 1 (8 处)

| 文件 | 变更类型 |
|------|---------|
| `.env` | 追加 TB_ADDRESS |
| `accounting.service.ts` | 修改方法 |
| `tb-evidence.service.ts` | 修改 catch 块 |
| `asset-activation-workflow.service.ts` | 添加状态校验 |
| `audit-actions.constant.ts` | 新增 3 个 action 常量 |
| `asset-listing-workflow.service.ts` | 改 action 引用 |
| `asset-suspension-workflow.service.ts` | 改 failure action 引用 |
| `asset-reactivation-workflow.service.ts` | 改 failure action 引用 |
| `withdrawal-address.controller.ts` | 调用 workflow 激活 |
| `withdrawal-address-workflow.service.ts` | 新增 batchActivateExpired |
| `withdrawal-address.service.ts` | 新增 findExpiredPending, deprecate lazyActivateForCustomer |
| `address-validator.util.ts` | 修改 fallback |

### Round 2 (~15 个新方法)

| 文件 | 变更类型 |
|------|---------|
| `assets.service.ts` | +4 方法 |
| `wallets.service.ts` | +5 方法 |
| `transaction-limits.service.ts` | +8 方法 |
| `src/common/events/domain-events.constants.ts` | 新建文件 |

---

## 验收标准

- [ ] `npm run build` 编译通过（零 error）
- [ ] `getCustomerAvailableBalance` 对 AED/USDT 返回正确结果
- [ ] TB 连接到 3503 端口（日志确认）
- [ ] 地址激活（含 lazy 路径）有审计记录
- [ ] 未知网络地址注册被拒绝
- [ ] 资产激活时非 PROVISIONING 状态返回 409
- [ ] 新增 L1 方法可独立编译（不依赖 L3）
- [ ] No 生成在重试后不报 500（可通过 mock 重复 No 验证）
