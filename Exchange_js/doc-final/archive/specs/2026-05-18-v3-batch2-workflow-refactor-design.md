# V3 Batch 2 — Workflow Refactor Design Spec

> **Status:** APPROVED | **Date:** 2026-05-18 | **Scope:** Rule 5 消除 + 清理
> **目标：** 将 5 个 V3 Workflow 的 26 处 Rule 5 违规重构为调用 L1 Domain Service 方法

---

## 背景

Batch 1（2026-05-17）完成了：
- Round 1：8 处紧急 bug 修复
- Round 2：18 个纯 L1 Domain Service 方法

Batch 2 的任务是让 Workflow 层消费这些 L1 方法，消除所有 `this.prisma.*.create/update/delete` 直接写入。

---

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| `createAsset` L1 校验级别 | 最小校验（assetCode 唯一性 + assetNo P2002 重试） | 业务规则由 Workflow 负责 |
| 执行失败状态处理 | 新增 `markRequestExecutionFailed` L1 方法 | 语义清晰，status 为 `EXECUTION_FAILED` |
| 法币钱包直接激活路径 | 扩展 `transitionStatus` 白名单 | 简单直接，复用通用方法 |
| Workflow 是否完全移除 PrismaService | 仅读取路径保留，写入全部走 L1 | 渐进清理，不引入新 bug |

---

## 新增 L1 方法（2 个）

### AssetsService.createAsset

**文件:** `src/modules/asset-treasury/assets/assets.service.ts`

```typescript
async createAsset(
  dto: {
    code: string;
    name: string;
    type: string;
    network?: string;
    decimals?: number;
  },
  tx?: Prisma.TransactionClient,
): Promise<Asset>
```

**逻辑：**
1. 校验 `code` 唯一性（findFirst where code）
2. P2002 重试循环生成 `assetNo`（格式 `AST-NNN`）
3. 创建记录，status = `PROVISIONING`
4. 返回完整 Asset 记录

### TransactionLimitsService.markRequestExecutionFailed

**文件:** `src/modules/governance/transaction-limits/transaction-limits.service.ts`

```typescript
async markRequestExecutionFailed(
  requestNo: string,
  reason: string,
  tx?: Prisma.TransactionClient,
): Promise<void>
```

**逻辑：**
1. 查找 request by requestNo
2. 前置校验：status in ['PENDING_APPROVAL', 'APPROVED']（允许从这两种状态转入失败）
3. 更新 status → `EXECUTION_FAILED`，failureReason = reason

---

## 白名单扩展

**文件:** `src/modules/asset-treasury/wallets/wallets.service.ts`

```typescript
private static readonly WALLET_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING_APPROVAL: ['CREATING', 'ACTIVE'],  // ACTIVE added for fiat shortcut
  CREATING: ['ACTIVE', 'FAILED'],
  FAILED: ['CREATING'],
};
```

---

## Workflow 重构明细

### 1. asset-activation-workflow.service.ts

| 行 | 当前代码 | 替换为 |
|----|---------|--------|
| 178 | `this.prisma.asset.update({ where: { id }, data: { status: 'ACTIVE' } })` | `this.assetsService.activateAsset(asset.assetNo, tx)` |

**额外变更：**
- 注入 `AssetsService`
- 移除 `PrismaService` 注入（该文件有读取需求，检查是否可完全移除）

### 2. asset-listing-workflow.service.ts

| 行 | 当前代码 | 替换为 |
|----|---------|--------|
| 52 | `tx.asset.create({ data: {...} })` | `this.assetsService.createAsset(dto, tx)` |
| 170 | `this.prisma.asset.update({ where, data })` | `this.assetsService.updateProvisioningFields(assetNo, dto)` |

**额外变更：**
- 注入 `AssetsService`
- 移除对 `PrismaService` 的直接写入依赖

### 3. custodian-wallet-create-workflow.service.ts（11 处）

| 行 | 当前代码 | 替换为 |
|----|---------|--------|
| 111 | `this.prisma.wallet.create(...)` | `this.walletsService.createWalletRecord(dto)` |
| 148 | `this.prisma.wallet.delete(...)` | `this.walletsService.deleteWallet(walletNo)` |
| 152 | `this.prisma.wallet.update({...approvalCaseId})` | `this.walletsService.linkApprovalCase(walletNo, caseId, caseNo)` |
| 227 | `this.prisma.wallet.update({status: 'ACTIVE'})` | `this.walletsService.transitionStatus(walletNo, 'PENDING_APPROVAL', 'ACTIVE', { iban, ... })` |
| 246 | `this.prisma.wallet.update({status: 'CREATING'})` | `this.walletsService.transitionStatus(walletNo, 'PENDING_APPROVAL', 'CREATING')` |
| 256 | `this.prisma.wallet.update({status: 'ACTIVE', vaultId, ...})` | `this.walletsService.transitionStatus(walletNo, 'CREATING', 'ACTIVE', { vaultId, address, iban })` |
| 284 | `this.prisma.wallet.update({status: 'FAILED'})` | `this.walletsService.transitionStatus(walletNo, 'CREATING', 'FAILED')` |
| 305 | `this.prisma.wallet.delete(...)` | `this.walletsService.deleteWallet(walletNo)` |
| 338 | `this.prisma.wallet.update({status: 'CREATING'})` | `this.walletsService.transitionStatus(walletNo, 'FAILED', 'CREATING')` |
| 348 | `this.prisma.wallet.update({status: 'ACTIVE', ...})` | `this.walletsService.transitionStatus(walletNo, 'CREATING', 'ACTIVE', { vaultId, address })` |
| 380 | `this.prisma.wallet.update({status: 'FAILED'})` | `this.walletsService.transitionStatus(walletNo, 'CREATING', 'FAILED')` |

**额外变更：**
- 注入 `WalletsService`
- 移除 `PrismaService` 的写入使用（保留读取用途如 findFirst）

### 4. transaction-limit-creation-workflow.service.ts（3 处）

| 行 | 当前代码 | 替换为 |
|----|---------|--------|
| 131 | `this.prisma.transactionLimitPolicy.update({...approvalCaseId})` | `this.limitsService.linkApprovalCaseToPolicy(policyNo, caseId)` |
| 207 | `this.prisma.transactionLimitPolicy.update({status: 'ACTIVE'})` | `this.limitsService.activatePolicy(policyNo)` |
| 277 | `this.prisma.transactionLimitPolicy.delete(...)` | `this.limitsService.deleteRejectedPolicy(policyNo)` |

### 5. transaction-limit-change-workflow.service.ts（9 处）

| 行 | 当前代码 | 替换为 |
|----|---------|--------|
| 97 | `this.prisma.transactionLimitChangeRequest.create(...)` | `this.limitsService.createChangeRequest(dto)` |
| 143 | `this.prisma.transactionLimitChangeRequest.delete(...)` | `this.limitsService.cancelChangeRequest(requestNo)` 或直接删除（rollback 场景） |
| 148 | `this.prisma.transactionLimitChangeRequest.update({...approvalCaseId})` | `this.limitsService.linkApprovalCaseToRequest(requestNo, caseId, caseNo)` |
| 231 | `this.prisma.transactionLimitChangeRequest.update({status, failureReason})` | `this.limitsService.markRequestExecutionFailed(requestNo, reason)` |
| 248 | `this.prisma.transactionLimitChangeRequest.update({status, failureReason})` | `this.limitsService.markRequestExecutionFailed(requestNo, reason)` |
| 280 | `this.prisma.transactionLimitPolicy.update({limitAmount})` | `this.limitsService.executeChange(requestNo)` |
| 287 | `this.prisma.transactionLimitChangeRequest.update({status: 'EXECUTED'})` | *(covered by executeChange)* |
| 327 | `this.prisma.transactionLimitChangeRequest.update({failureReason})` | `this.limitsService.markRequestExecutionFailed(requestNo, reason)` |
| 369 | `this.prisma.transactionLimitChangeRequest.update({status: 'REJECTED'/'CANCELLED'})` | `this.limitsService.rejectChangeRequest(requestNo)` / `cancelChangeRequest(requestNo)` |

---

## 清理工作

### PrismaService 移除策略

| 文件 | 当前用途 | 重构后 |
|------|---------|--------|
| asset-activation-workflow | 读取(findUnique) + 写入 | 读取可通过 AssetsService.findByAssetNo 替代 → 完全移除 |
| asset-listing-workflow | 读取(findFirst) + $transaction + 写入 | $transaction 改为 domain 级事务 → 尽量移除 |
| custodian-wallet-create-workflow | 读取(findFirst/findUnique) + 写入 | 读取通过 WalletsService.findByWalletNo 替代 → 完全移除 |
| transaction-limit-creation-workflow | 读取 + 写入 | 读取通过 limitsService 方法替代 → 完全移除 |
| transaction-limit-change-workflow | 读取 + 写入 | 读取通过 limitsService 方法替代 → 完全移除 |

**目标：** 重构后 5 个 Workflow 文件中 0 个 import PrismaService。

### 事务补齐

`asset-listing-workflow.submitListing` 已有 `$transaction`。重构后需改为：
```typescript
await this.prisma.$transaction(async (tx) => {
  const asset = await this.assetsService.createAsset(dto, tx);
  await this.provisioningService.provision(asset.id, tx);
});
```

如果完全移除 PrismaService，则事务协调方式改为通过 domain service 暴露的事务辅助（或保留最小 PrismaService 注入仅用于 `$transaction`）。

**决定：** 允许 Workflow 保留 `PrismaService` 注入 **仅用于 `$transaction` 协调**，不允许直接对实体表 CRUD。

### deprecated 方法保留

`lazyActivateForCustomer` 的 `@deprecated` 标记保留不动。物理移除推迟到确认无其他调用者时。

---

## 文件变更清单

| 文件 | 变更类型 |
|------|---------|
| `assets.service.ts` | +1 方法 (createAsset) |
| `wallets.service.ts` | 扩展白名单 |
| `transaction-limits.service.ts` | +1 方法 (markRequestExecutionFailed) |
| `asset-activation-workflow.service.ts` | 重构 1 处写入 |
| `asset-listing-workflow.service.ts` | 重构 2 处写入 |
| `custodian-wallet-create-workflow.service.ts` | 重构 11 处写入 |
| `transaction-limit-creation-workflow.service.ts` | 重构 3 处写入 |
| `transaction-limit-change-workflow.service.ts` | 重构 9 处写入 |

---

## 验收标准

- [ ] `npx tsc --noEmit` 零 error
- [ ] 5 个 Workflow 文件中 0 处 `this.prisma.*.create/update/delete` 调用（仅允许 `$transaction`）
- [ ] 新增 2 个 L1 方法可独立编译
- [ ] 白名单扩展后法币钱包直激活路径正常
- [ ] `grep -r "this.prisma\." <workflow-files>` 仅返回 `$transaction` 和读取调用
